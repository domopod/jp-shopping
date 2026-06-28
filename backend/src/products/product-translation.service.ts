import { Injectable, Logger } from '@nestjs/common';

const REMOTE_TRANSLATE_CONCURRENCY = 2;
const REMOTE_TRANSLATE_COOLDOWN_MS = 5 * 60 * 1000;

interface TranslationProvider {
  name: string;
  buildUrl: (value: string) => string;
  extract: (payload: unknown) => string;
}

const LOCAL_TERM_TRANSLATIONS: Array<[string, string]> = [
  ['【リンク】', '亲子款'],
  ['リンク', '亲子款'],
  ['セットアップ可', '可成套'],
  ['セットアップ', '套装'],
  ['リゾート', '度假风'],
  ['アロハ', '夏威夷风'],
  ['半袖Tシャツ', '短袖T恤'],
  ['長袖Tシャツ', '长袖T恤'],
  ['ショートパンツ', '短裤'],
  ['ハーフパンツ', '五分裤'],
  ['ラッシュガード', '防晒外套'],
  ['スイムウェア', '泳装'],
  ['ワンピース', '连衣裙'],
  ['トレーナー', '卫衣'],
  ['パーカー', '连帽卫衣'],
  ['ブラウス', '衬衫'],
  ['シャツ', '衬衫'],
  ['ジャケット', '外套'],
  ['スカート', '裙子'],
  ['デニム', '牛仔'],
  ['ボトムス', '下装'],
  ['トップス', '上衣'],
  ['パンツ', '裤子'],
  ['Tシャツ', 'T恤'],
  ['プリント', '印花'],
  ['バックプリント', '背部印花'],
  ['バック', '背部'],
  ['ロゴ', 'logo'],
  ['カラフル', '彩色'],
  ['総柄', '满印'],
  ['ポケット', '口袋'],
  ['無地', '纯色'],
  ['素材', '材质'],
  ['材質', '材质'],
  ['サイズ', '尺码'],
  ['実寸', '平铺尺寸'],
  ['カラー', '颜色'],
  ['ブランド', '品牌'],
  ['カテゴリ', '分类'],
  ['品番', '型号'],
  ['原産国', '产地'],
  ['本体', '主体'],
  ['衿ぐり部分', '领口部分'],
  ['リブ部分', '罗纹部分'],
  ['キッズ', '儿童'],
  ['ベビー', '婴童'],
  ['ジュニア', '中大童'],
  ['中国製', '中国制造'],
  ['中国', '中国'],
  ['ミャンマー', '缅甸'],
  ['綿', '棉'],
  ['ポリエステル', '聚酯纤维'],
  ['ポリウレタン', '氨纶'],
  ['ナイロン', '尼龙'],
  ['レーヨン', '人造丝'],
  ['天竺', '平纹针织'],
  ['平織り', '平纹面料'],
  ['ツイル', '斜纹面料'],
  ['ライトグレー', '浅灰色'],
  ['ダークグレー', '深灰色'],
  ['ネイビーブルー', '藏蓝色'],
  ['ネイビー', '藏蓝色'],
  ['サックス', '浅蓝色'],
  ['アイボリー', '米白色'],
  ['ブラック', '黑色'],
  ['ホワイト', '白色'],
  ['グリーン', '绿色'],
  ['イエロー', '黄色'],
  ['ブルー', '蓝色'],
  ['ピンク', '粉色'],
  ['レッド', '红色'],
  ['オレンジ', '橙色'],
  ['パープル', '紫色'],
  ['ブラウン', '棕色'],
  ['ベージュ', '米色'],
  ['キナリ', '原色米白'],
  ['レインボー', '彩虹色'],
  ['チャコール', '炭灰色'],
  ['花柄', '花卉图案'],
  ['迷彩柄', '迷彩图案'],
  ['ストライプ柄', '条纹图案'],
  ['ウエスト幅', '腰围宽'],
  ['前股上', '前裆'],
  ['股下', '裤长内侧'],
  ['足口幅', '裤口宽'],
  ['腰幅', '臀围宽'],
  ['身丈', '衣长'],
  ['着丈', '衣长'],
  ['身幅', '胸围宽'],
  ['肩幅', '肩宽'],
  ['袖丈', '袖长'],
  ['袖口幅', '袖口宽'],
  ['胸回り', '胸围'],
  ['背肩幅', '背部和肩宽'],
  ['袖口回り', '袖口周长'],
  ['バスト', '胸围'],
  ['身長', '身高'],
  ['対応', '适用'],
  ['販売', '发售'],
  ['発売', '发售'],
  ['おすすめ', '推荐'],
  ['おしゃれ', '时尚'],
  ['動きやすい', '活动方便'],
  ['人気', '人气'],
  ['通園・通学', '上学出行'],
  ['お取り扱いのご注意', '使用注意事项'],
  ['ご留意下さい', '请注意以下事项'],
  ['水洗い', '水洗'],
  ['収縮', '缩水'],
  ['柄のズレ', '花纹偏移'],
  ['歪み', '变形'],
  ['着用', '穿着'],
  ['洗濯', '洗护'],
  ['摩擦', '摩擦'],
  ['毛羽立ち', '起毛'],
  ['毛玉', '起球'],
  ['雨や水に濡れますと', '如遇雨水或沾水'],
  ['シミのような跡', '类似水渍的痕迹'],
  ['短時間で押し洗いを推奨いたします', '建议短时间轻压手洗'],
  ['脱水は手絞りで弱く絞り', '脱水时请轻柔手拧'],
  ['形を整えてから吊り陰干し', '整理版型后悬挂阴干'],
  ['アイロンはスチームを使用しないで下さい', '请勿使用蒸汽熨斗'],
  ['SALE', '特价'],
  ['sale', '特价'],
];

@Injectable()
export class ProductTranslationService {
  private readonly logger = new Logger(ProductTranslationService.name);
  private readonly cache = new Map<string, string>();
  private readonly providerCooldowns = new Map<string, number>();
  private readonly providers: TranslationProvider[] = [
    {
      name: 'google',
      buildUrl: (value) =>
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=zh-CN&dt=t&q=${encodeURIComponent(value)}`,
      extract: (payload) => this.extractGoogleTranslatedText(payload),
    },
    {
      name: 'mymemory',
      buildUrl: (value) =>
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(value)}&langpair=ja|zh-CN`,
      extract: (payload) => this.extractMyMemoryTranslatedText(payload),
    },
  ];

  async translateText(value?: string | null) {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return '';
    }

    return this.translateBlock(normalized);
  }

  async translateMultiline(value?: string | null) {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return [];
    }

    const lines = normalized
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return this.mapWithConcurrency(
      lines,
      REMOTE_TRANSLATE_CONCURRENCY,
      (line) => this.translateBlock(line),
    );
  }

  private async translateBlock(value: string) {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return '';
    }

    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }

    const localFallback = this.applyLocalFallback(normalized);
    if (!this.containsKana(normalized)) {
      const localResult = this.finalizeTranslation(localFallback);
      this.cache.set(normalized, localResult);
      return localResult;
    }

    let remoteTranslation = '';
    if (normalized.length <= 120 && this.hasAvailableRemoteProvider()) {
      remoteTranslation = await this.translateWithRetry(normalized);
    }

    if (!this.isBetterThanSource(normalized, remoteTranslation)) {
      remoteTranslation = await this.translateBySegments(normalized);
    }

    const candidate = this.pickTranslation(
      normalized,
      remoteTranslation,
      localFallback,
    );
    const result = this.finalizeTranslation(candidate);
    this.cache.set(normalized, result);
    return result;
  }

  private async translateBySegments(value: string) {
    const segments = this.splitIntoSegments(value);
    if (segments.length <= 1) {
      return '';
    }

    const translatedSegments = await this.mapWithConcurrency(
      segments,
      REMOTE_TRANSLATE_CONCURRENCY,
      async (segment) => {
        if (!this.containsKana(segment)) {
          return this.applyLocalFallback(segment);
        }

        if (!this.hasAvailableRemoteProvider()) {
          return this.applyLocalFallback(segment);
        }

        const translated = await this.translateWithRetry(segment);
        return this.pickTranslation(
          segment,
          translated,
          this.applyLocalFallback(segment),
        );
      },
    );

    return translatedSegments.join('');
  }

  private splitIntoSegments(value: string) {
    const sentenceSegments = value
      .split(/(?<=[。！？!?])/u)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (sentenceSegments.length > 1) {
      return sentenceSegments;
    }

    const clauseSegments = value
      .split(/(?<=[、，,・\/])/u)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (clauseSegments.length > 1) {
      return clauseSegments;
    }

    return [value];
  }

  private pickTranslation(
    source: string,
    remoteTranslation: string,
    localFallback: string,
  ) {
    const normalizedRemote = this.normalizeText(remoteTranslation);
    if (this.isBetterThanSource(source, normalizedRemote)) {
      return normalizedRemote;
    }

    if (this.isBetterThanSource(source, localFallback)) {
      return localFallback;
    }

    return localFallback || source;
  }

  private isBetterThanSource(source: string, candidate?: string | null) {
    const normalizedCandidate = this.normalizeText(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    const sourceJapanese = this.countJapaneseChars(source);
    const candidateJapanese = this.countJapaneseChars(normalizedCandidate);
    return normalizedCandidate !== source || candidateJapanese < sourceJapanese;
  }

  private countJapaneseChars(value: string) {
    const matches = value.match(/[\p{Script=Hiragana}\p{Script=Katakana}々]/gu);
    return matches?.length ?? 0;
  }

  private containsKana(value: string) {
    return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  }

  private async translateWithRetry(value: string) {
    if (!this.hasAvailableRemoteProvider()) {
      return '';
    }

    const attempts = 3;
    let lastError: unknown;

    for (let index = 0; index < attempts; index += 1) {
      for (const provider of this.providers) {
        if (this.isProviderCoolingDown(provider.name)) {
          continue;
        }

        let timeout: NodeJS.Timeout | undefined;

        try {
          const controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), 15000);
          const response = await fetch(provider.buildUrl(value), {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`${provider.name} status ${response.status}`);
          }

          const payload = (await response.json()) as unknown;
          const translated = provider.extract(payload);
          if (translated) {
            this.providerCooldowns.delete(provider.name);
            return translated;
          }
        } catch (error) {
          lastError = `${provider.name}: ${String(error)}`;
          if (this.isRemoteAvailabilityError(error)) {
            this.providerCooldowns.set(
              provider.name,
              Date.now() + REMOTE_TRANSLATE_COOLDOWN_MS,
            );
          }
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
        }
      }

      if (!this.hasAvailableRemoteProvider()) {
        break;
      }

      await this.delay((index + 1) * 300);
    }

    this.logger.warn(`整句翻译失败，回退到本地词典: ${String(lastError)}`);
    return '';
  }

  private isRemoteAvailabilityError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    return /fetch failed|network|abort|timeout/i.test(error.message);
  }

  private isProviderCoolingDown(providerName: string) {
    return (this.providerCooldowns.get(providerName) ?? 0) > Date.now();
  }

  private hasAvailableRemoteProvider() {
    return this.providers.some(
      (provider) => !this.isProviderCoolingDown(provider.name),
    );
  }

  private extractGoogleTranslatedText(payload: unknown) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      return '';
    }

    return payload[0]
      .map((item) =>
        Array.isArray(item) && typeof item[0] === 'string' ? item[0] : '',
      )
      .join('')
      .trim();
  }

  private extractMyMemoryTranslatedText(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const responseData = (
      payload as { responseData?: { translatedText?: unknown } }
    ).responseData;
    return typeof responseData?.translatedText === 'string'
      ? responseData.translatedText.trim()
      : '';
  }

  private applyLocalFallback(value: string) {
    let translated = value;
    for (const [source, target] of [...LOCAL_TERM_TRANSLATIONS].sort(
      (left, right) => right[0].length - left[0].length,
    )) {
      translated = translated.replaceAll(source, target);
    }

    return translated;
  }

  private finalizeTranslation(value: string) {
    return value
      .replace(/：/g, ': ')
      .replace(/・/g, ' / ')
      .replace(/～/g, '~')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/　/g, ' ')
      .replace(/(\d+)\s*cm/gi, '$1厘米')
      .replace(/(\d+)\s*mm/gi, '$1毫米')
      .replace(/(\d+)\s*kg/gi, '$1千克')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
  ) {
    const results = new Array<R>(items.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < items.length) {
        const index = currentIndex;
        currentIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
    return results;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeText(value?: string | null) {
    return typeof value === 'string' ? value.trim() : '';
  }
}
