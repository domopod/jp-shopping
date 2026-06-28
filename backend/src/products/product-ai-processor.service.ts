import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Product, ProductSku } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductTranslationService } from './product-translation.service';
import type {
  ProcessedProductAttribute,
  ProcessedProductResult,
  ProcessedProductSku,
  TaobaoProductPayload,
} from './products.types';

interface ProductWithSkus extends Product {
  skus: ProductSku[];
}

interface OpenAiProcessingResponse {
  title?: unknown;
  description_text?: unknown;
  description_html?: unknown;
  size_info?: unknown;
  specification?: unknown;
  selling_points?: unknown;
  attributes?: unknown;
  skus?: unknown;
}

const GENERAL_TRANSLATIONS: Array<[string, string]> = [
  ['ロゴ', 'Logo'],
  ['タグ', '标签'],
  ['ペンギン', '企鹅'],
  ['ドリンク', '饮料'],
  ['フード', 'Food'],
  ['フォレスト', '森林绿'],
  ['モーブピンク', '豆沙粉'],
  ['ソフトコーラル', '珊瑚粉'],
  ['クリアブルー', '清透蓝'],
  ['イエローグリーン', '黄绿色'],
  ['セージ', '鼠尾草绿'],
  ['クリームグリーン', '奶油绿'],
  ['スミクロ', '炭黑色'],
  ['バイオレット', '紫罗兰'],
  ['【リンク】', '亲子款'],
  ['リンク', '亲子款'],
  ['セットアップ可', '可成套'],
  ['セットアップ', '套装'],
  ['リゾート', '度假风'],
  ['アロハ', '夏威夷风'],
  ['ハーフパンツ', '短裤'],
  ['5分丈', '五分裤'],
  ['6分丈', '六分裤'],
  ['7分丈', '七分裤'],
  ['総柄', '满印'],
  ['ポケット', '口袋'],
  ['UVカット', '防晒'],
  ['ラッシュガード', '防晒外套'],
  ['半袖Tシャツ', '短袖T恤'],
  ['長袖Tシャツ', '长袖T恤'],
  ['Tシャツ', 'T恤'],
  ['リリック', '印花'],
  ['プリント', '印花'],
  ['無地', '纯色'],
  ['キッズ', '儿童'],
  ['ベビー', '婴童'],
  ['ジュニア', '中大童'],
  ['トップス', '上衣'],
  ['ボトムス', '下装'],
  ['パンツ', '裤子'],
  ['ショートパンツ', '短裤'],
  ['ワンピース', '连衣裙'],
  ['トレーナー', '卫衣'],
  ['パーカー', '连帽卫衣'],
  ['シャツ', '衬衫'],
  ['ブラウス', '衬衫'],
  ['デニム', '牛仔'],
  ['スカート', '裙子'],
  ['ジャケット', '外套'],
  ['素材', '材质'],
  ['サイズ', '尺码'],
  ['実寸', '平铺尺寸'],
  ['カラー', '颜色'],
  ['ブランド', '品牌'],
  ['カテゴリ', '分类'],
  ['品番', '型号'],
  ['本体', '主体'],
  ['綿', '棉'],
  ['ポリエステル', '聚酯纤维'],
  ['ナイロン', '尼龙'],
  ['レーヨン', '人造丝'],
  ['ポリウレタン', '氨纶'],
  ['洗濯', '洗护'],
  ['中国製', '中国制造'],
  ['中国', '中国'],
  ['販売', '发售'],
  ['限定', '限定'],
  ['人気', '人气'],
  ['手頃な価格', '性价比高'],
  ['豊富なバリエーション', '多色可选'],
  ['通園・通学', '上学出行'],
  ['着回し力抜群', '百搭易穿'],
  ['おすすめ', '推荐'],
  ['おしゃれ', '时尚'],
  ['動きやすい', '活动方便'],
  ['お取り扱いのご注意', '使用注意事项'],
  ['材質', '材质'],
  ['この素材', '该材质'],
  ['水洗い', '水洗'],
  ['収縮', '缩水'],
  ['柄のズレ', '花纹偏移'],
  ['歪み', '变形'],
  ['着用', '穿着'],
  ['摩擦', '摩擦'],
  ['毛羽立ち', '起毛'],
  ['雨や水に濡れますと', '如遇雨水或沾水'],
  ['シミのような跡', '类似水渍的痕迹'],
  ['ご留意下さい', '请注意以下事项'],
  ['短時間で押し洗いを推奨いたします', '建议短时间轻压手洗'],
  ['脱水は手絞りで弱く絞り', '脱水时请轻柔手拧'],
  ['形を整えてから吊り陰干し', '整理版型后悬挂阴干'],
  ['アイロンはスチームを使用しないで下さい', '请勿使用蒸汽熨斗'],
  ['原産国', '产地'],
  ['ミャンマー', '缅甸'],
  ['平織り', '平纹面料'],
  ['ウエスト幅', '腰围宽'],
  ['前股上', '前裆'],
  ['股下', '裤长内侧'],
  ['足口幅', '裤口宽'],
  ['腰幅', '臀围宽'],
  ['袖丈', '袖长'],
  ['袖口幅', '袖口宽'],
  ['胸回り', '胸围'],
  ['背肩幅', '背部和肩宽'],
  ['袖口回り', '袖口周长'],
  ['身丈', '衣长'],
  ['身幅', '胸围宽'],
  ['肩幅', '肩宽'],
  ['着丈', '衣长'],
  ['身長', '身高'],
  ['対応', '适用'],
];

const COLOR_TRANSLATIONS: Array<[string, string]> = [
  ['ライトグレー', '浅灰色'],
  ['ダークグレー', '深灰色'],
  ['グレー', '灰色'],
  ['サックス', '浅蓝色'],
  ['グリーン', '绿色'],
  ['イエロー', '黄色'],
  ['ブルー', '蓝色'],
  ['ネイビー', '藏蓝色'],
  ['ブラック', '黑色'],
  ['ホワイト', '白色'],
  ['アイボリー', '米白色'],
  ['ベージュ', '米色'],
  ['ピンク', '粉色'],
  ['レッド', '红色'],
  ['オレンジ', '橙色'],
  ['パープル', '紫色'],
  ['ブラウン', '棕色'],
  ['キナリ', '原色米白'],
  ['レインボー', '彩虹色'],
  ['チャコール', '炭灰色'],
];

const ATTRIBUTE_KEY_TRANSLATIONS: Record<string, string> = {
  品番: '型号',
  ブランド: '品牌',
  カテゴリ: '分类',
  カラー: '颜色',
  素材: '材质',
  サイズ: '尺码',
  実寸: '平铺尺寸',
};

@Injectable()
export class ProductAiProcessorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly productTranslationService: ProductTranslationService,
  ) {}

  async processProduct(productId: number): Promise<ProcessedProductResult> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        skus: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    if (this.configService.get<string>('OPENAI_API_KEY')) {
      try {
        return await this.processWithOpenAi(product);
      } catch {
        return this.processWithFallback(product);
      }
    }

    return this.processWithFallback(product);
  }

  private async processWithOpenAi(
    product: ProductWithSkus,
  ): Promise<ProcessedProductResult> {
    const baseUrl =
      this.configService.get<string>('OPENAI_BASE_URL')?.trim() ||
      'https://api.openai.com/v1/chat/completions';
    const model =
      this.configService.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4o-mini';
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是跨境电商商品处理助手。请把日文商品加工成淘宝风格中文数据。要求：保留品牌、型号、规格；标题简体中文且30字以内；同时返回 description_text、size_info、specification 三个纯文本中文字段；description_html 输出安全的 HTML；selling_points 输出 3-5 条；attributes 输出数组，元素结构为{name,value}；skus 输出数组，字段 skuCode,name,color,size,price,imageUrl；严格返回 JSON 对象，不要输出额外说明。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              source: {
                title: product.title,
                brand: product.brand,
                price: product.price,
                description: product.description,
                sizeInfo: product.sizeInfo,
                specification: product.specification,
                skus: product.skus.map((sku) => ({
                  skuCode: sku.skuCode,
                  name: sku.name,
                  color: sku.color,
                  size: sku.size,
                  price: sku.price,
                  imageUrl: sku.imageUrl,
                })),
              },
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI 接口调用失败: ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI 返回内容为空');
    }

    const parsed = JSON.parse(
      this.stripJsonFence(content),
    ) as OpenAiProcessingResponse;

    const translatedSkus = product.skus.map((sku) => this.translateSku(sku));
    const [
      defaultTitle,
      defaultDescriptionText,
      defaultSizeInfo,
      defaultSpecification,
    ] = await Promise.all([
      this.buildTaobaoTitle(product),
      this.buildDescriptionText(product),
      this.buildSizeInfo(product),
      this.buildSpecification(product),
    ]);
    const title = this.limitTitle(String(parsed.title || defaultTitle));
    const descriptionText = this.sanitizeMultilineText(
      String(parsed.description_text || defaultDescriptionText),
    );
    const sizeInfo = this.sanitizeMultilineText(
      String(parsed.size_info || defaultSizeInfo),
    );
    const specification = this.sanitizeMultilineText(
      String(parsed.specification || defaultSpecification),
    );
    const descriptionHtml = this.sanitizeHtml(
      String(
        parsed.description_html ||
          this.buildDescriptionHtmlFromTexts(
            descriptionText,
            sizeInfo,
            specification,
            translatedSkus,
          ),
      ),
    );
    const sellingPoints = this.sanitizeSellingPoints(
      parsed.selling_points,
      product,
    );
    const attributes = this.sanitizeAttributes(parsed.attributes, product);

    return this.toProcessedResult({
      title,
      descriptionText,
      descriptionHtml,
      sizeInfo,
      specification,
      sellingPoints,
      attributes,
      skus: translatedSkus,
    });
  }

  private async processWithFallback(
    product: ProductWithSkus,
  ): Promise<ProcessedProductResult> {
    const skus = product.skus.map((sku) => this.translateSku(sku));
    const attributes = this.buildAttributes(product);
    const [title, descriptionText, sizeInfo, specification] = await Promise.all(
      [
        this.buildTaobaoTitle(product),
        this.buildDescriptionText(product),
        this.buildSizeInfo(product),
        this.buildSpecification(product),
      ],
    );
    const descriptionHtml = this.buildDescriptionHtmlFromTexts(
      descriptionText,
      sizeInfo,
      specification,
      skus,
    );
    const sellingPoints = this.buildSellingPoints(product, skus);

    return this.toProcessedResult({
      title,
      descriptionText,
      descriptionHtml,
      sizeInfo,
      specification,
      sellingPoints,
      attributes,
      skus,
    });
  }

  private toProcessedResult(input: {
    title: string;
    descriptionText: string;
    descriptionHtml: string;
    sizeInfo: string;
    specification: string;
    sellingPoints: string[];
    attributes: ProcessedProductAttribute[];
    skus: ProcessedProductSku[];
  }): ProcessedProductResult {
    const taobaoPayload: TaobaoProductPayload = {
      title: input.title,
      description: input.descriptionHtml,
      selling_points: input.sellingPoints,
      attributes: input.attributes,
      skus: input.skus,
    };

    return {
      title: input.title,
      descriptionText: input.descriptionText,
      descriptionHtml: input.descriptionHtml,
      sizeInfo: input.sizeInfo,
      specification: input.specification,
      sellingPoints: input.sellingPoints,
      attributes: input.attributes,
      skus: input.skus,
      taobaoPayload,
    };
  }

  private async buildTaobaoTitle(product: ProductWithSkus) {
    const model = this.extractModel(product);
    const translated = await this.productTranslationService.translateText(
      product.title,
    );
    const parts = [product.brand || '', model, translated]
      .map((item) => this.normalizeText(item))
      .filter(Boolean);

    const uniqueParts = parts.filter(
      (item, index) => parts.indexOf(item) === index,
    );
    return this.limitTitle(uniqueParts.join(' ').replace(/\s+/g, ' ').trim());
  }

  private buildDescriptionHtmlFromTexts(
    descriptionText: string,
    sizeInfo: string,
    specification: string,
    skus: ProcessedProductSku[],
  ) {
    const sections: string[] = [];
    const descriptionLines = this.splitLines(descriptionText);
    const sizeLines = this.splitLines(sizeInfo);
    const specificationLines = this.splitLines(specification);

    if (descriptionLines.length) {
      sections.push(`<p>${this.escapeHtml(descriptionLines.join('，'))}</p>`);
    }

    if (sizeLines.length) {
      sections.push(
        `<h3>尺码信息</h3><ul>${sizeLines.map((line) => `<li>${this.escapeHtml(line)}</li>`).join('')}</ul>`,
      );
    }

    if (specificationLines.length) {
      sections.push(
        `<h3>商品参数</h3><ul>${specificationLines
          .map((line) => `<li>${this.escapeHtml(line)}</li>`)
          .join('')}</ul>`,
      );
    }

    if (skus.length) {
      sections.push(
        `<h3>SKU 信息</h3><ul>${skus
          .map(
            (sku) =>
              `<li>${this.escapeHtml(
                [sku.name, sku.color, sku.size, sku.price]
                  .filter(Boolean)
                  .join(' / '),
              )}</li>`,
          )
          .join('')}</ul>`,
      );
    }

    return sections.join('');
  }

  private async buildDescriptionText(product: ProductWithSkus) {
    return (
      await this.productTranslationService.translateMultiline(
        product.description,
      )
    ).join('\n');
  }

  private async buildSizeInfo(product: ProductWithSkus) {
    return this.localTranslateMultiline(product.sizeInfo).join('\n');
  }

  private async buildSpecification(product: ProductWithSkus) {
    return (
      await this.productTranslationService.translateMultiline(
        product.specification,
      )
    ).join('\n');
  }

  private buildSellingPoints(
    product: ProductWithSkus,
    skus: ProcessedProductSku[],
  ) {
    const points = [
      `${product.brand || '品牌'}款式已转为中文信息，适合直接同步淘宝商品库。`,
      `保留型号${this.extractModel(product) || '与核心规格'}，便于后续刊登和比对货源。`,
      skus.length
        ? `当前共整理 ${skus.length} 条 SKU，颜色尺码信息已自动中文化。`
        : '',
      product.sizeInfo
        ? '尺码与参数信息已同步整理，详情页可直接展示。'
        : '商品参数已自动提炼，方便快速上架。',
      product.description
        ? '描述内容已转为中文 HTML，可直接用于淘宝详情。'
        : '',
    ]
      .map((item) => this.normalizeText(item))
      .filter(Boolean);

    return points.slice(0, 5);
  }

  private buildAttributes(
    product: ProductWithSkus,
  ): ProcessedProductAttribute[] {
    const attributes: ProcessedProductAttribute[] = [];
    const pushAttribute = (name: string, value: string | null | undefined) => {
      const normalizedValue = this.normalizeText(value);
      if (!name || !normalizedValue) {
        return;
      }

      if (
        !attributes.some(
          (item) => item.name === name && item.value === normalizedValue,
        )
      ) {
        attributes.push({ name, value: normalizedValue });
      }
    };

    pushAttribute('品牌', product.brand);
    pushAttribute('型号', this.extractModel(product));
    pushAttribute('价格', product.price);
    pushAttribute('来源链接', product.sourceUrl);

    for (const line of this.splitLines(product.specification).slice(0, 8)) {
      const [rawKey, ...rest] = line.split(/[:：]/);
      const key = ATTRIBUTE_KEY_TRANSLATIONS[rawKey.trim()];
      if (!key || !rest.length) {
        continue;
      }

      pushAttribute(key, this.localTranslateText(rest.join(':')));
    }

    return attributes;
  }

  private translateSku(sku: ProductSku): ProcessedProductSku {
    const color = sku.color ? this.localTranslateColor(sku.color) : null;
    const size = sku.size ? this.localTranslateText(sku.size) : null;
    const rawName = sku.name || sku.color || sku.skuCode;
    const name = this.localTranslateText(rawName);

    return {
      skuCode: sku.skuCode,
      name: this.normalizeText(name) || sku.skuCode,
      color,
      size,
      price: sku.price,
      imageUrl: sku.imageUrl,
    };
  }

  private sanitizeSkus(
    input: unknown,
    originalSkus: ProductSku[],
  ): ProcessedProductSku[] {
    if (!Array.isArray(input)) {
      return originalSkus.map((sku) => this.translateSku(sku));
    }

    const originalMap = new Map(originalSkus.map((sku) => [sku.skuCode, sku]));

    const sanitized: ProcessedProductSku[] = input
      .map((item): ProcessedProductSku | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const rawSku = item as Record<string, unknown>;
        const skuCode = this.normalizeText(rawSku.skuCode);
        const original = originalMap.get(skuCode);
        if (!original) {
          return null;
        }

        const translatedOriginal = this.translateSku(original);

        return {
          skuCode,
          name:
            this.normalizeText(rawSku.name) ||
            translatedOriginal.name ||
            original.skuCode,
          color:
            this.normalizeText(rawSku.color) ||
            translatedOriginal.color ||
            null,
          size:
            this.normalizeText(rawSku.size) || translatedOriginal.size || null,
          price: this.normalizeText(rawSku.price) || original.price,
          imageUrl:
            this.normalizeText(rawSku.imageUrl) || original.imageUrl || null,
        };
      })
      .filter((item): item is ProcessedProductSku => Boolean(item));

    return sanitized.length
      ? sanitized
      : originalSkus.map((sku) => this.translateSku(sku));
  }

  private sanitizeSellingPoints(input: unknown, product: ProductWithSkus) {
    if (!Array.isArray(input)) {
      return this.buildSellingPoints(product, []);
    }

    const points = input
      .map((item) => this.normalizeText(item))
      .filter(Boolean)
      .slice(0, 5);

    return points.length ? points : this.buildSellingPoints(product, []);
  }

  private sanitizeAttributes(input: unknown, product: ProductWithSkus) {
    if (!Array.isArray(input)) {
      return this.buildAttributes(product);
    }

    const attributes = input
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const rawAttribute = item as Record<string, unknown>;
        const name = this.normalizeText(rawAttribute.name);
        const value = this.normalizeText(rawAttribute.value);
        if (!name || !value) {
          return null;
        }

        return { name, value } satisfies ProcessedProductAttribute;
      })
      .filter((item): item is ProcessedProductAttribute => Boolean(item));

    return attributes.length ? attributes : this.buildAttributes(product);
  }

  private localTranslateText(value?: string | null) {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return '';
    }

    let translated = normalized;
    for (const [source, target] of [
      ...COLOR_TRANSLATIONS,
      ...GENERAL_TRANSLATIONS,
    ].sort((left, right) => right[0].length - left[0].length)) {
      translated = translated.replaceAll(source, target);
    }

    return translated
      .replace(/：/g, ': ')
      .replace(/・/g, ' / ')
      .replace(/～/g, '~')
      .replace(/(\d+)cm/g, '$1厘米')
      .replace(/(\d+)mm/g, '$1毫米')
      .replace(/(\d+)kg/g, '$1千克')
      .replace(/(\d+)点/g, '$1点')
      .replace(/%/g, '%')
      .replace(/，+/g, '，')
      .replaceAll('（', '(')
      .replaceAll('）', ')')
      .replaceAll('　', ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private localTranslateColor(value?: string | null) {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return null;
    }
    return this.localTranslateText(normalized);
  }

  private localTranslateMultiline(value?: string | null) {
    return this.splitLines(value).map((line) => this.localTranslateText(line));
  }

  private splitLines(value?: string | null) {
    return this.normalizeText(value)
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private extractModel(product: Pick<Product, 'title' | 'specification'>) {
    const source = `${product.title}\n${product.specification || ''}`;
    const match = source.match(/[A-Z]{1,6}[-]?\d{3,}[A-Z0-9-]*/);
    return match?.[0] || '';
  }

  private limitTitle(value: string) {
    return Array.from(this.normalizeText(value)).slice(0, 30).join('');
  }

  private normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private stripJsonFence(value: string) {
    return value
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  private sanitizeMultilineText(value: string) {
    return value
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private sanitizeHtml(value: string) {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .trim();
  }
}
