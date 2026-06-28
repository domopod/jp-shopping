import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  SMART_CROP_JPG_QUALITY,
  SMART_CROP_MAX_UPSCALE,
  SMART_CROP_TARGETS,
  type SmartCropCategory,
} from './smart-crop.constants';

export interface SmartCropDetectedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
  label: string;
  confidence?: number;
}

export interface SmartCropResult {
  category: SmartCropCategory;
  targetWidth: number;
  targetHeight: number;
  originalWidth: number;
  originalHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  upscaled: boolean;
  usedFallback: boolean;
  warnings: string[];
  score: number;
  detectedBoxes: SmartCropDetectedBox[];
  outputBuffer: Buffer;
  outputMimeType: string;
  outputSize: number;
}

interface ImageInfo {
  normalized: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class SmartCropService {
  private readonly logger = new Logger(SmartCropService.name);

  /**
   * 执行单张图片的智能裁切
   */
  async processImage(
    inputBuffer: Buffer,
    category: SmartCropCategory,
    originalName = 'image',
  ): Promise<SmartCropResult> {
    const target = SMART_CROP_TARGETS[category];
    const warnings: string[] = [];

    const { normalized, width: origW, height: origH } =
      await this.normalizeImage(inputBuffer);

    let upscaled = false;
    let workBuffer = normalized;
    let workW = origW;
    let workH = origH;

    // 小图放大：确保宽高都不小于目标
    const scaleNeeded = Math.max(
      target.width / workW,
      target.height / workH,
    );
    if (scaleNeeded > 1) {
      const upscale = Math.ceil(scaleNeeded * 100) / 100;
      if (upscale > SMART_CROP_MAX_UPSCALE) {
        warnings.push(
          `图片清晰度可能不足（放大倍率 ${upscale.toFixed(
            2,
          )}x，超过建议上限 ${SMART_CROP_MAX_UPSCALE}x）`,
        );
      }
      const newW = Math.max(target.width, Math.round(workW * upscale));
      const newH = Math.max(target.height, Math.round(workH * upscale));
      workBuffer = await sharp(workBuffer)
        .resize(newW, newH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .toBuffer();
      workW = newW;
      workH = newH;
      upscaled = true;
    }

    // 内容感知裁切
    let finalCrop: {
      x: number;
      y: number;
      width: number;
      height: number;
      score: number;
      boxes: SmartCropDetectedBox[];
    } | null = null;
    let usedFallback = false;

    try {
      const boxes = await this.detectImportantRegions(workBuffer, workW, workH);
      const best = this.findBestCropWindow(
        workW,
        workH,
        target.width,
        target.height,
        boxes,
      );
      if (best) {
        finalCrop = { ...best, boxes };
      }
    } catch (err) {
      this.logger.warn(
        `[${originalName}] 内容感知裁切失败，回退居中裁切: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!finalCrop) {
      const center = this.computeCenterCrop(
        workW,
        workH,
        target.width,
        target.height,
      );
      finalCrop = { ...center, boxes: [] };
      usedFallback = true;
    }

    const cropped = await sharp(workBuffer)
      .extract({
        left: Math.max(0, finalCrop.x),
        top: Math.max(0, finalCrop.y),
        width: Math.min(workW - Math.max(0, finalCrop.x), finalCrop.width),
        height: Math.min(workH - Math.max(0, finalCrop.y), finalCrop.height),
      })
      .resize(target.width, target.height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      })
      .toBuffer();

    const { buffer: outputBuffer, mimeType } = await this.exportImage(cropped);

    return {
      category,
      targetWidth: target.width,
      targetHeight: target.height,
      originalWidth: origW,
      originalHeight: origH,
      cropX: finalCrop.x,
      cropY: finalCrop.y,
      cropWidth: finalCrop.width,
      cropHeight: finalCrop.height,
      upscaled,
      usedFallback,
      warnings,
      score: finalCrop.score,
      detectedBoxes: finalCrop.boxes,
      outputBuffer,
      outputMimeType: mimeType,
      outputSize: outputBuffer.byteLength,
    };
  }

  /**
   * 图像标准化（EXIF 方向纠正 + sRGB）
   */
  private async normalizeImage(inputBuffer: Buffer): Promise<ImageInfo> {
    const rotated = await sharp(inputBuffer)
      .rotate()
      .toColorspace('srgb')
      .toBuffer();

    const meta = await sharp(rotated).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (!width || !height) {
      throw new Error('无法读取图片尺寸');
    }

    return { normalized: rotated, width, height };
  }

  /**
   * 重要区域检测：基于图像本身的内容分析（主体 + 头部/Logo/四角）
   */
  private async detectImportantRegions(
    buffer: Buffer,
    width: number,
    height: number,
  ): Promise<SmartCropDetectedBox[]> {
    const boxes: SmartCropDetectedBox[] = [];

    try {
      // 主体区域检测（基于图像边缘强度的中心区域）
      const subject = await this.estimateSubjectBox(buffer, width, height);
      if (subject) {
        boxes.push({ ...subject, weight: 100, label: '商品主体', confidence: 0.75 });
      }
    } catch {
      // 失败忽略
    }

    try {
      // 模特头部保护区域（上半部中间）
      const headBox = this.estimateHeadBox(width, height);
      if (headBox) {
        boxes.push({ ...headBox, weight: 100, label: '模特头部', confidence: 0.7 });
      }
    } catch {
      // 忽略
    }

    try {
      // 文字/Logo/角标区域（四角）
      const textBoxes = await this.estimateTextBoxes(buffer, width, height);
      for (const box of textBoxes) {
        boxes.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          weight: 70,
          label: '文字/Logo',
          confidence: 0.55,
        });
      }
    } catch {
      // 忽略
    }

    try {
      // 细节/商品局部区域（左右边缘）
      const detailBoxes = this.estimateDetailBoxes(width, height);
      for (const box of detailBoxes) {
        boxes.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          weight: 40,
          label: '局部细节',
          confidence: 0.4,
        });
      }
    } catch {
      // 忽略
    }

    return boxes;
  }

  /**
   * 主体区域估算：通过图像灰度边缘强度识别最有信息量的区域，向外扩展至整个商品
   */
  private async estimateSubjectBox(
    buffer: Buffer,
    width: number,
    height: number,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const sampleWidth = 128;
    const sampleHeight = Math.round((128 / width) * height);
    const grayBuffer = await sharp(buffer)
      .resize(sampleWidth, sampleHeight, { fit: 'fill', kernel: sharp.kernel.cubic })
      .grayscale()
      .raw()
      .toBuffer();

    // 计算边缘强度（简化版 Sobel）
    const intensity: number[] = new Array(sampleWidth * sampleHeight).fill(0);
    for (let y = 1; y < sampleHeight - 1; y++) {
      for (let x = 1; x < sampleWidth - 1; x++) {
        const idx = y * sampleWidth + x;
        const gx = grayBuffer[idx + 1] - grayBuffer[idx - 1];
        const gy =
          grayBuffer[(y + 1) * sampleWidth + x] - grayBuffer[(y - 1) * sampleWidth + x];
        intensity[idx] = Math.abs(gx) + Math.abs(gy);
      }
    }

    // 阈值化
    const sorted = [...intensity].sort((a, b) => b - a);
    const threshold = sorted[Math.floor(sorted.length * 0.2)] || 20;

    // 计算外接矩形
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < sampleHeight; y++) {
      for (let x = 0; x < sampleWidth; x++) {
        if (intensity[y * sampleWidth + x] > threshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }

    if (count < sampleWidth * sampleHeight * 0.02) {
      return null;
    }

    // 扩展 12% 保证主体完整
    const paddingX = Math.round((maxX - minX) * 0.12);
    const paddingY = Math.round((maxY - minY) * 0.12);
    const scaleX = width / sampleWidth;
    const scaleY = height / sampleHeight;

    return {
      x: Math.max(0, Math.round((minX - paddingX) * scaleX)),
      y: Math.max(0, Math.round((minY - paddingY) * scaleY)),
      width: Math.min(width, Math.round((maxX - minX + paddingX * 2) * scaleX)),
      height: Math.min(height, Math.round((maxY - minY + paddingY * 2) * scaleY)),
    };
  }

  /**
   * 模特头部保护区域（上半部中心的 40% x 28%）
   */
  private estimateHeadBox(
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const headW = Math.round(width * 0.4);
    const headH = Math.round(height * 0.28);
    return {
      x: Math.round((width - headW) / 2),
      y: Math.round(height * 0.08),
      width: headW,
      height: headH,
    };
  }

  /**
   * 四角/顶部 文字/Logo 区域检测
   */
  private async estimateTextBoxes(
    buffer: Buffer,
    width: number,
    height: number,
  ): Promise<{ x: number; y: number; width: number; height: number }[]> {
    const candidates = [
      {
        x: 0,
        y: 0,
        w: Math.round(width * 0.2),
        h: Math.round(height * 0.12),
      },
      {
        x: width - Math.round(width * 0.2),
        y: 0,
        w: Math.round(width * 0.2),
        h: Math.round(height * 0.12),
      },
      {
        x: 0,
        y: height - Math.round(height * 0.1),
        w: Math.round(width * 0.25),
        h: Math.round(height * 0.1),
      },
      {
        x: width - Math.round(width * 0.25),
        y: height - Math.round(height * 0.1),
        w: Math.round(width * 0.25),
        h: Math.round(height * 0.1),
      },
    ];

    const result: { x: number; y: number; width: number; height: number }[] = [];
    for (const c of candidates) {
      try {
        const region = await sharp(buffer)
          .extract({
            left: Math.max(0, c.x),
            top: Math.max(0, c.y),
            width: Math.min(width - Math.max(0, c.x), c.w),
            height: Math.min(height - Math.max(0, c.y), c.h),
          })
          .resize(64, 64, { fit: 'fill' })
          .grayscale()
          .raw()
          .toBuffer();

        let sum = 0;
        for (const v of region) sum += v;
        const mean = sum / region.length;
        let variance = 0;
        for (const v of region) variance += (v - mean) ** 2;
        variance /= region.length;

        if (variance > 800) {
          result.push({
            x: Math.max(0, c.x - Math.round(c.w * 0.1)),
            y: Math.max(0, c.y - Math.round(c.h * 0.1)),
            width: Math.min(
              width - Math.max(0, c.x - Math.round(c.w * 0.1)),
              Math.round(c.w * 1.2),
            ),
            height: Math.min(
              height - Math.max(0, c.y - Math.round(c.h * 0.1)),
              Math.round(c.h * 1.2),
            ),
          });
        }
      } catch {
        // 区域分析失败则跳过
      }
    }

    return result;
  }

  /**
   * 左右边缘的细节区域
   */
  private estimateDetailBoxes(
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number }[] {
    const w = Math.round(width * 0.25);
    const h = Math.round(height * 0.18);
    return [
      { x: 0, y: Math.round(height * 0.3), width: w, height: h },
      { x: width - w, y: Math.round(height * 0.3), width: w, height: h },
    ];
  }

  /**
   * 寻找信息损失最小的裁切窗口
   */
  private findBestCropWindow(
    workWidth: number,
    workHeight: number,
    targetWidth: number,
    targetHeight: number,
    boxes: SmartCropDetectedBox[],
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
  } | null {
    const workRatio = workWidth / workHeight;
    const targetRatio = targetWidth / targetHeight;

    if (Math.abs(workRatio - targetRatio) < 0.01) {
      return { x: 0, y: 0, width: workWidth, height: workHeight, score: 999 };
    }

    let cropBoxW: number;
    let cropBoxH: number;
    if (workRatio > targetRatio) {
      cropBoxH = workHeight;
      cropBoxW = Math.round(workHeight * targetRatio);
    } else {
      cropBoxW = workWidth;
      cropBoxH = Math.round(workWidth / targetRatio);
    }

    if (cropBoxW > workWidth || cropBoxH > workHeight) {
      return null;
    }

    const maxX = workWidth - cropBoxW;
    const maxY = workHeight - cropBoxH;

    // 候选窗口（水平 7 个位置 × 垂直 5 个位置，精细搜索）
    const candidates: { x: number; y: number; score: number }[] = [];
    const hSteps = maxX === 0 ? 1 : 7;
    const vSteps = maxY === 0 ? 1 : 5;

    for (let i = 0; i < hSteps; i++) {
      const x = Math.round((maxX * i) / Math.max(1, hSteps - 1));
      for (let j = 0; j < vSteps; j++) {
        const y = Math.round((maxY * j) / Math.max(1, vSteps - 1));
        const score = this.scoreCropWindow({ x, y, width: cropBoxW, height: cropBoxH }, boxes);
        candidates.push({ x, y, score });
      }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 分数相同时，优先选靠近中心的
      const centerX = Math.abs(a.x + cropBoxW / 2 - workWidth / 2);
      const centerY = Math.abs(a.y + cropBoxH / 2 - workHeight / 2);
      const centerX2 = Math.abs(b.x + cropBoxW / 2 - workWidth / 2);
      const centerY2 = Math.abs(b.y + cropBoxH / 2 - workHeight / 2);
      return centerX + centerY - (centerX2 + centerY2);
    });

    return { x: candidates[0].x, y: candidates[0].y, width: cropBoxW, height: cropBoxH, score: candidates[0].score };
  }

  /**
   * 居中裁切（降级方案）
   */
  private computeCenterCrop(
    workWidth: number,
    workHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): { x: number; y: number; width: number; height: number; score: number } {
    const workRatio = workWidth / workHeight;
    const targetRatio = targetWidth / targetHeight;
    let cropBoxW: number;
    let cropBoxH: number;
    if (workRatio > targetRatio) {
      cropBoxH = workHeight;
      cropBoxW = Math.round(workHeight * targetRatio);
    } else {
      cropBoxW = workWidth;
      cropBoxH = Math.round(workWidth / targetRatio);
    }
    return {
      x: Math.round((workWidth - cropBoxW) / 2),
      y: Math.round((workHeight - cropBoxH) / 2),
      width: cropBoxW,
      height: cropBoxH,
      score: 0,
    };
  }

  /**
   * 评分：基于窗口与每个重要 box 的交集面积
   */
  private scoreCropWindow(
    window: { x: number; y: number; width: number; height: number },
    boxes: SmartCropDetectedBox[],
  ): number {
    let score = 0;
    for (const box of boxes) {
      const ix1 = Math.max(window.x, box.x);
      const iy1 = Math.max(window.y, box.y);
      const ix2 = Math.min(window.x + window.width, box.x + box.width);
      const iy2 = Math.min(window.y + window.height, box.y + box.height);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      const intersectArea = iw * ih;
      const boxArea = Math.max(1, box.width * box.height);
      const retention = intersectArea / boxArea;

      let multiplier = 1;
      if (box.label === '模特头部') {
        if (retention < 0.95) multiplier = retention < 0.5 ? 0.1 : 0.5;
        else multiplier = 1.5;
      }
      if (box.label === '商品主体') {
        if (retention >= 0.95) multiplier = 1.3;
        else if (retention < 0.8) multiplier = retention < 0.5 ? 0.2 : 0.6;
      }

      score += retention * box.weight * multiplier;
    }
    return score;
  }

  /**
   * 手动裁切：根据用户指定的 offset 和 scale 进行裁切
   * offsetX/offsetY 表示目标画布左上角对应缩放后图片的位置
   * scale 表示图片的缩放比例（基于原始尺寸）
   */
  async processImageManual(
    inputBuffer: Buffer,
    category: SmartCropCategory,
    options: {
      offsetX: number;
      offsetY: number;
      scale: number;
    },
    originalName = 'image',
  ): Promise<SmartCropResult> {
    const target = SMART_CROP_TARGETS[category];
    const warnings: string[] = [];

    const { normalized, width: origW, height: origH } =
      await this.normalizeImage(inputBuffer);

    const scale = Math.max(0.01, options.scale);
    const scaledW = Math.round(origW * scale);
    const scaledH = Math.round(origH * scale);

    // 缩放图片
    let workBuffer = normalized;
    let workW = origW;
    let workH = origH;

    if (Math.abs(scale - 1) > 0.001) {
      workBuffer = await sharp(workBuffer)
        .resize(scaledW, scaledH, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .toBuffer();
      workW = scaledW;
      workH = scaledH;
    }

    // 计算裁切区域
    // offsetX/offsetY 是画布左上角在缩放后图片中的位置
    // 确保裁切区域在图片范围内
    let cropX = Math.round(options.offsetX);
    let cropY = Math.round(options.offsetY);
    let cropW = target.width;
    let cropH = target.height;

    // 如果缩放后的图片比目标小，则居中并扩展（实际上应该由前端保证 scale 足够大）
    if (workW < target.width || workH < target.height) {
      warnings.push('图片尺寸小于目标尺寸，可能会出现模糊');
      // 这种情况下直接 resize 到目标尺寸
      const finalBuffer = await sharp(workBuffer)
        .resize(target.width, target.height, {
          fit: 'fill',
          kernel: sharp.kernel.lanczos3,
        })
        .toBuffer();

      const { buffer: outputBuffer, mimeType } =
        await this.exportImage(finalBuffer);

      return {
        category,
        targetWidth: target.width,
        targetHeight: target.height,
        originalWidth: origW,
        originalHeight: origH,
        cropX: 0,
        cropY: 0,
        cropWidth: workW,
        cropHeight: workH,
        upscaled: workW < target.width || workH < target.height,
        usedFallback: true,
        warnings,
        score: 0,
        detectedBoxes: [],
        outputBuffer,
        outputMimeType: mimeType,
        outputSize: outputBuffer.byteLength,
      };
    }

    // 限制裁切区域在图片范围内
    cropX = Math.max(0, Math.min(workW - target.width, cropX));
    cropY = Math.max(0, Math.min(workH - target.height, cropY));

    const cropped = await sharp(workBuffer)
      .extract({
        left: cropX,
        top: cropY,
        width: Math.min(workW - cropX, target.width),
        height: Math.min(workH - cropY, target.height),
      })
      .resize(target.width, target.height, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      })
      .toBuffer();

    const { buffer: outputBuffer, mimeType } =
      await this.exportImage(cropped);

    return {
      category,
      targetWidth: target.width,
      targetHeight: target.height,
      originalWidth: origW,
      originalHeight: origH,
      cropX,
      cropY,
      cropWidth: Math.min(workW - cropX, target.width),
      cropHeight: Math.min(workH - cropY, target.height),
      upscaled: scale > 1,
      usedFallback: false,
      warnings,
      score: 0,
      detectedBoxes: [],
      outputBuffer,
      outputMimeType: mimeType,
      outputSize: outputBuffer.byteLength,
    };
  }

  /**
   * 导出最终图像（JPG/PNG 自动判断）
   */
  private async exportImage(
    input: Buffer,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const meta = await sharp(input).metadata();
    const hasAlpha = meta.hasAlpha ?? false;
    const isPng = meta.format === 'png' || hasAlpha;

    if (isPng) {
      const outputBuffer = await sharp(input)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .withMetadata({
          exif: {
            IFD0: {},
            IFD3: {},
          },
        })
        .toBuffer();
      return { buffer: outputBuffer, mimeType: 'image/png' };
    }

    const outputBuffer = await sharp(input)
      .jpeg({
        quality: SMART_CROP_JPG_QUALITY,
        progressive: true,
        mozjpeg: true,
      })
      .withMetadata({
        exif: {
          IFD0: {},
          IFD3: {},
        },
      })
      .toBuffer();

    return { buffer: outputBuffer, mimeType: 'image/jpeg' };
  }
}
