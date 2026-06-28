import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

interface SizeChartParseResult {
  headers: string[];
  rows: string[][];
}

interface SizeChartLayout {
  width: number;
  height: number;
  tableTop: number;
  tableLeft: number;
  tableWidth: number;
  tableHeight: number;
  cellHeight: number;
  firstColumnWidth: number;
  valueColumnWidth: number;
  footerFontSize: number;
  footerY: number;
}

@Injectable()
export class SizeChartService {
  async generateSizeChartPng(
    processedSizeInfo?: string | null,
    rawSizeInfo?: string | null,
  ) {
    const parsed = this.pickBestParseResult(processedSizeInfo, rawSizeInfo);
    if (!parsed) {
      return null;
    }
    const built = await this.buildFromTable(parsed.headers, parsed.rows);
    return { ...built, headers: parsed.headers, rows: parsed.rows };
  }

  async generateSizeChartFromTable(headers: string[], rows: string[][]) {
    if (!headers?.length || !rows?.length) {
      return null;
    }
    const built = await this.buildFromTable(headers, rows);
    return { ...built, headers, rows };
  }

  private async buildFromTable(headers: string[], rows: string[][]) {
    const { svg, width, height } = this.buildSvg({ headers, rows });
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return {
      buffer,
      width,
      height,
      mimeType: 'image/png',
    };
  }

  private pickBestParseResult(
    ...sizeInfoCandidates: Array<string | null | undefined>
  ) {
    const parsedResults = sizeInfoCandidates
      .map((sizeInfo) => this.parseSizeInfo(sizeInfo))
      .filter((item): item is SizeChartParseResult => Boolean(item));

    if (!parsedResults.length) {
      return null;
    }

    return parsedResults.sort((left, right) => {
      const leftScore = left.headers.length * left.rows.length;
      const rightScore = right.headers.length * right.rows.length;
      return rightScore - leftScore;
    })[0];
  }

  private parseSizeInfo(sizeInfo?: string | null): SizeChartParseResult | null {
    const normalized = (sizeInfo || '').trim();
    if (!normalized) {
      return null;
    }

    const lines = normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const rowMap = new Map<string, Record<string, string>>();
    const headers = new Set<string>();

    for (const line of lines) {
      const matches = [
        ...line.matchAll(
          /(\d{2,4}(?:cm|CM|厘米|センチ)?|XXL|XL|XS|S|M|L)\s*[:：]\s*([^:：]+)/gi,
        ),
      ];
      if (!matches.length) {
        continue;
      }

      for (const match of matches) {
        const size = match[1].toUpperCase();
        const content = match[2];
        const row = rowMap.get(size) || {};
        const metricMatches = [
          ...content.matchAll(
            /([\u4e00-\u9fa5A-Za-z\u3040-\u30ffー]+)\s*([0-9.]+)/g,
          ),
        ];
        for (const metric of metricMatches) {
          headers.add(metric[1]);
          row[metric[1]] = metric[2];
        }
        rowMap.set(size, row);
      }
    }

    if (!rowMap.size || !headers.size) {
      return null;
    }

    const headerList = ['尺码', ...headers];
    const rows = Array.from(rowMap.entries()).map(([size, values]) => [
      size,
      ...Array.from(headers).map((header) => values[header] || '-'),
    ]);

    return {
      headers: headerList,
      rows,
    };
  }

  private buildSvg(parsed: SizeChartParseResult) {
    const layout = this.buildLayout(parsed);
    const {
      width,
      height,
      tableLeft,
      tableTop,
      tableWidth,
      tableHeight,
      cellHeight,
      firstColumnWidth,
      valueColumnWidth,
      footerFontSize,
      footerY,
    } = layout;

    const columnLabels = parsed.headers;
    const rowLabels = parsed.rows.map((row) =>
      row[0].replace(/(?:CM|厘米|センチ)$/i, ''),
    );
    const headerFontSize = columnLabels.length >= 6 ? 24 : 28;
    const bodyFontSize =
      rowLabels.length >= 8 || columnLabels.length >= 6 ? 24 : 28;
    const headerFill = '#f3f3f3';
    const firstColumnFill = '#fafafa';
    const cellStroke = '#c8c8c8';

    const cells: string[] = [];

    cells.push(
      this.renderCell({
        x: tableLeft,
        y: tableTop,
        width: firstColumnWidth,
        height: cellHeight,
        text: columnLabels[0],
        fill: headerFill,
        stroke: cellStroke,
        fontSize: headerFontSize,
        fontWeight: 700,
      }),
    );

    columnLabels.slice(1).forEach((label, index) => {
      cells.push(
        this.renderCell({
          x: tableLeft + firstColumnWidth + index * valueColumnWidth,
          y: tableTop,
          width: valueColumnWidth,
          height: cellHeight,
          text: label,
          fill: headerFill,
          stroke: cellStroke,
          fontSize: headerFontSize,
          fontWeight: 700,
        }),
      );
    });

    parsed.rows.forEach((row, rowIndex) => {
      const y = tableTop + (rowIndex + 1) * cellHeight;
      cells.push(
        this.renderCell({
          x: tableLeft,
          y,
          width: firstColumnWidth,
          height: cellHeight,
          text: rowLabels[rowIndex],
          fill: firstColumnFill,
          stroke: cellStroke,
          fontSize: bodyFontSize,
          fontWeight: 700,
        }),
      );

      row.slice(1).forEach((value, valueIndex) => {
        cells.push(
          this.renderCell({
            x: tableLeft + firstColumnWidth + valueIndex * valueColumnWidth,
            y,
            width: valueColumnWidth,
            height: cellHeight,
            text: value || '-',
            fill: '#ffffff',
            stroke: cellStroke,
            fontSize: bodyFontSize,
            fontWeight: 500,
          }),
        );
      });
    });

    return {
      svg: `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#ffffff" />
        <rect x="${tableLeft}" y="${tableTop}" width="${tableWidth}" height="${tableHeight}" fill="#ffffff" stroke="${cellStroke}" stroke-width="2" />
        ${cells.join('')}
        <text x="${width / 2}" y="${footerY}" text-anchor="middle" font-size="${footerFontSize}" font-weight="700" fill="#5c6470" font-family="Microsoft YaHei">实测尺码（单位cm | 身幅=半胸围）</text>
      </svg>
    `,
      width,
      height,
    };
  }

  private buildLayout(parsed: SizeChartParseResult): SizeChartLayout {
    const rowCount = parsed.rows.length;
    const columnCount = parsed.headers.length;
    const horizontalPadding = 64;
    const firstColumnWidth = rowCount >= 8 ? 132 : 150;
    const valueColumnWidth = columnCount >= 6 ? 150 : 180;
    const tableLeft = horizontalPadding;
    const tableTop = 48;
    const cellHeight = rowCount >= 8 ? 64 : 72;
    const tableWidth = firstColumnWidth + valueColumnWidth * (columnCount - 1);
    const tableHeight = cellHeight * (rowCount + 1);
    const width = horizontalPadding * 2 + tableWidth;
    const footerGap = 40;
    const footerBottomPadding = 48;
    const footerFontSize = 28;
    const footerY = tableTop + tableHeight + footerGap;
    const height = footerY + footerBottomPadding;

    return {
      width,
      height,
      tableTop,
      tableLeft,
      tableWidth,
      tableHeight,
      cellHeight,
      firstColumnWidth,
      valueColumnWidth,
      footerFontSize,
      footerY,
    };
  }

  private renderCell(input: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    fill: string;
    stroke: string;
    fontSize: number;
    fontWeight: number;
  }) {
    const { x, y, width, height, text, fill, stroke, fontSize, fontWeight } =
      input;

    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
      <text
        x="${x + width / 2}"
        y="${y + height / 2}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="${fontSize}"
        font-weight="${fontWeight}"
        fill="#222222"
        font-family="Microsoft YaHei"
      >${this.escapeXml(text)}</text>
    `;
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
