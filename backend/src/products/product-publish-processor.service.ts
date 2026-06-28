import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaobaoSessionService } from './taobao-session.service';
import { CAPTCHA_TEXT_PATTERNS, PUBLISH_CHECKPOINTS } from './product-publish.constants';
import type { TaobaoProductPayload, TaobaoPublishLogEntry, TaobaoPublishResult } from './products.types';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class CaptchaPausedError extends Error {
  constructor(
    message: string,
    readonly checkpoint: string,
    readonly artifactPath: string | null,
  ) {
    super(message);
    this.name = 'CaptchaPausedError';
  }
}

interface PublishProductInput {
  id: number;
  title: string;
  taobaoPayload: TaobaoProductPayload;
  mainImagePaths: string[];
  detailImagePaths: string[];
  skus: Array<{
    skuCode: string;
    color: string | null;
    size: string | null;
    price: string | null;
    stock: number;
  }>;
}

@Injectable()
export class ProductPublishProcessorService {
  private readonly artifactRoot = path.resolve(process.cwd(), 'storage', 'taobao-publish');

  constructor(
    private readonly prismaService: PrismaService,
    private readonly taobaoSessionService: TaobaoSessionService,
  ) {}

  async processProduct(productId: number, taskId: number, attemptCount: number): Promise<TaobaoPublishResult> {
    const input = await this.buildProductInput(productId);
    const logEntries: TaobaoPublishLogEntry[] = [];
    const artifactDir = path.join(this.artifactRoot, `product-${productId}`, `task-${taskId}`, `attempt-${attemptCount}`);
    await mkdir(artifactDir, { recursive: true });

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let screenshotPath: string | null = null;

    const pushLog = (step: string, level: 'info' | 'warn' | 'error', message: string) => {
      logEntries.push({
        time: new Date().toISOString(),
        level,
        step,
        message,
      });
    };

    try {
      pushLog(PUBLISH_CHECKPOINTS.PREPARE, 'info', '开始准备淘宝发布数据');
      const cookies = await this.taobaoSessionService.assertCookiesReady();

      browser = await chromium.launch({
        headless: this.taobaoSessionService.isHeadless(),
      });
      context = await browser.newContext(this.taobaoSessionService.getContextOptions());
      await context.addCookies(cookies);
      page = await context.newPage();

      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.SESSION_READY);
      pushLog(PUBLISH_CHECKPOINTS.SESSION_READY, 'info', '淘宝 Cookie 已注入浏览器上下文');

      await page.goto(this.taobaoSessionService.getSellerHomeUrl(), { waitUntil: 'domcontentloaded' });
      await this.ensureNoCaptcha(page, artifactDir, PUBLISH_CHECKPOINTS.SESSION_READY, pushLog);

      await page.goto(this.taobaoSessionService.getPublishUrl(), { waitUntil: 'domcontentloaded' });
      await this.ensureNoCaptcha(page, artifactDir, PUBLISH_CHECKPOINTS.PAGE_READY, pushLog);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.PAGE_READY);
      pushLog(PUBLISH_CHECKPOINTS.PAGE_READY, 'info', '已打开淘宝发布商品页面');

      await this.fillTitle(page, input.taobaoPayload.title);
      await this.fillDescription(page, input.taobaoPayload.description);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.BASIC_INFO_FILLED);
      pushLog(PUBLISH_CHECKPOINTS.BASIC_INFO_FILLED, 'info', '已填写商品标题与描述');

      await this.fillAttributes(page, input.taobaoPayload.attributes);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.ATTRIBUTES_FILLED);
      pushLog(PUBLISH_CHECKPOINTS.ATTRIBUTES_FILLED, 'info', `已填写商品属性 ${input.taobaoPayload.attributes.length} 项`);

      await this.fillSkus(page, input.skus);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.SKU_FILLED);
      pushLog(PUBLISH_CHECKPOINTS.SKU_FILLED, 'info', `已填写 SKU ${input.skus.length} 项`);

      await this.uploadImages(page, input.mainImagePaths, input.detailImagePaths);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.IMAGES_UPLOADED);
      pushLog(
        PUBLISH_CHECKPOINTS.IMAGES_UPLOADED,
        'info',
        `已上传主图 ${input.mainImagePaths.length} 张，详情图 ${input.detailImagePaths.length} 张`,
      );

      await this.ensureNoCaptcha(page, artifactDir, PUBLISH_CHECKPOINTS.SUBMIT_READY, pushLog);
      await this.persistCheckpoint(taskId, PUBLISH_CHECKPOINTS.SUBMIT_READY);

      await this.clickPublish(page);
      await page.waitForLoadState('domcontentloaded');
      await this.ensureNoCaptcha(page, artifactDir, PUBLISH_CHECKPOINTS.SUBMIT_READY, pushLog);

      screenshotPath = await this.captureScreenshot(page, artifactDir, 'published');
      const taobaoProductId = await this.extractTaobaoProductId(page);
      const publishedAt = new Date().toISOString();
      const logPath = await this.writeLogs(artifactDir, logEntries);

      return {
        taobaoProductId,
        publishedAt,
        checkpoint: PUBLISH_CHECKPOINTS.PUBLISHED,
        artifacts: {
          logPath: this.toAssetUrl(logPath),
          screenshotPath: screenshotPath ? this.toAssetUrl(screenshotPath) : null,
        },
        logs: logEntries,
      };
    } catch (error) {
      if (page) {
        screenshotPath = screenshotPath || (await this.captureScreenshot(page, artifactDir, 'failed'));
      }
      const logPath = await this.writeLogs(artifactDir, logEntries);

      if (error instanceof CaptchaPausedError) {
        throw new CaptchaPausedError(
          error.message,
          error.checkpoint,
          error.artifactPath ?? (screenshotPath ? this.toAssetUrl(screenshotPath) : null),
        );
      }

      const message = error instanceof Error ? error.message : '淘宝自动发布失败';
      pushLog('FAILED', 'error', message);
      await this.writeLogs(artifactDir, logEntries);
      throw new Error(
        JSON.stringify({
          message,
          logPath: this.toAssetUrl(logPath),
          screenshotPath: screenshotPath ? this.toAssetUrl(screenshotPath) : null,
        }),
      );
    } finally {
      if (context) {
        await context.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }

  private async buildProductInput(productId: number): Promise<PublishProductInput> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        images: {
          orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
        },
        skus: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    if (product.aiProcessStatus !== 'SUCCESS' || !product.taobaoPayload) {
      throw new Error('商品 AI 处理尚未完成，无法自动发布');
    }

    if (product.imageProcessStatus !== 'SUCCESS') {
      throw new Error('商品图片处理尚未完成，无法自动发布');
    }

    const taobaoPayload = product.taobaoPayload as unknown as TaobaoProductPayload;
    const coverImages = product.images.filter((image) => image.isCover).slice(0, 5);
    const detailImages = product.images;
    const mainImagePaths = coverImages
      .map((image) => image.taobaoMainImageUrl)
      .filter((value): value is string => Boolean(value))
      .map((url) => this.assetUrlToFilePath(url));
    const detailImagePaths = detailImages
      .map((image) => image.taobaoDetailImageUrl)
      .filter((value): value is string => Boolean(value))
      .map((url) => this.assetUrlToFilePath(url));

    if (!mainImagePaths.length || !detailImagePaths.length) {
      throw new Error('淘宝主图或详情图缺失，无法自动发布');
    }

    return {
      id: product.id,
      title: product.processedTitle || product.title,
      taobaoPayload,
      mainImagePaths,
      detailImagePaths,
      skus: product.skus.map((sku, index) => ({
        skuCode: sku.skuCode,
        color: taobaoPayload.skus[index]?.color ?? sku.color,
        size: taobaoPayload.skus[index]?.size ?? sku.size,
        price: taobaoPayload.skus[index]?.price ?? sku.price,
        stock: sku.stock ?? this.taobaoSessionService.getDefaultSkuStock(),
      })),
    };
  }

  private async fillTitle(page: Page, title: string) {
    await this.fillFirstAvailable(page, [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[name="title"]',
      '[data-testid="title"] input',
    ], title);
  }

  private async fillDescription(page: Page, description: string) {
    const locator = await this.findFirstLocator(page, [
      'textarea[placeholder*="描述"]',
      'textarea[name="description"]',
      '[contenteditable="true"]',
      'iframe',
    ]);

    if (!locator) {
      throw new Error('未找到商品描述输入区域');
    }

    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
    if (tagName === 'iframe') {
      const frame = await (await locator.elementHandle())?.contentFrame();
      if (!frame) {
        throw new Error('商品描述编辑器未就绪');
      }
      const body = frame.locator('body');
      await body.click();
      await body.fill(description);
      return;
    }

    const isContentEditable = await locator.evaluate((element) => element.getAttribute('contenteditable') === 'true');
    if (isContentEditable) {
      await locator.click();
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
      await page.keyboard.type(description);
      return;
    }

    await locator.fill(description);
  }

  private async fillAttributes(page: Page, attributes: Array<{ name: string; value: string }>) {
    for (const attribute of attributes) {
      const filled = await this.fillByLabel(page, attribute.name, attribute.value);
      if (!filled) {
        continue;
      }
    }
  }

  private async fillSkus(
    page: Page,
    skus: Array<{ skuCode: string; color: string | null; size: string | null; price: string | null; stock: number }>,
  ) {
    const priceInputs = page.locator('input[placeholder*="价格"], input[name*="price"], input[data-testid*="price"]');
    const stockInputs = page.locator('input[placeholder*="库存"], input[name*="stock"], input[data-testid*="stock"]');

    const priceCount = await priceInputs.count();
    const stockCount = await stockInputs.count();

    for (let index = 0; index < skus.length; index += 1) {
      const sku = skus[index];
      if (index < priceCount) {
        await priceInputs.nth(index).fill(this.normalizePrice(sku.price));
      }
      if (index < stockCount) {
        await stockInputs.nth(index).fill(String(sku.stock));
      }
    }
  }

  private async uploadImages(page: Page, mainImagePaths: string[], detailImagePaths: string[]) {
    await this.setFiles(page, [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ], mainImagePaths);

    const detailUpload = await this.findFirstLocator(page, [
      'input[type="file"][multiple]',
      'input[type="file"]',
    ]);

    if (!detailUpload) {
      throw new Error('未找到商品图片上传控件');
    }

    await detailUpload.setInputFiles(detailImagePaths);
  }

  private async clickPublish(page: Page) {
    const locator = await this.findFirstLocator(page, [
      'button:has-text("发布")',
      'button:has-text("立即发布")',
      'button:has-text("提交")',
      'button[type="submit"]',
      '[role="button"]:has-text("发布")',
    ]);

    if (!locator) {
      throw new Error('未找到发布按钮');
    }

    await locator.click();
  }

  private async fillFirstAvailable(page: Page, selectors: string[], value: string) {
    const locator = await this.findFirstLocator(page, selectors);
    if (!locator) {
      throw new Error(`未找到输入控件: ${selectors[0]}`);
    }

    await locator.fill(value);
  }

  private async setFiles(page: Page, selectors: string[], filePaths: string[]) {
    const locator = await this.findFirstLocator(page, selectors);
    if (!locator) {
      throw new Error('未找到图片上传控件');
    }

    await locator.setInputFiles(filePaths);
  }

  private async fillByLabel(page: Page, label: string, value: string) {
    const normalized = label.trim();
    if (!normalized) {
      return false;
    }

    const labelLocator = page.locator(`label:has-text("${normalized}")`).first();
    if ((await labelLocator.count()) > 0) {
      const field = labelLocator.locator('xpath=following::input[1] | following::textarea[1]').first();
      if ((await field.count()) > 0) {
        await field.fill(value);
        return true;
      }
    }

    const placeholderField = await this.findFirstLocator(page, [
      `input[placeholder*="${normalized}"]`,
      `textarea[placeholder*="${normalized}"]`,
    ]);
    if (placeholderField) {
      await placeholderField.fill(value);
      return true;
    }

    return false;
  }

  private async findFirstLocator(page: Page, selectors: string[]) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        return locator;
      }
    }

    return null;
  }

  private async ensureNoCaptcha(
    page: Page,
    artifactDir: string,
    checkpoint: string,
    pushLog: (step: string, level: 'info' | 'warn' | 'error', message: string) => void,
  ) {
    if (!(await this.hasCaptcha(page))) {
      return;
    }

    pushLog(checkpoint, 'warn', '检测到验证码，等待人工处理');

    if (!this.taobaoSessionService.isHeadless()) {
      const deadline = Date.now() + this.taobaoSessionService.getManualCaptchaWaitMs();
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if (!(await this.hasCaptcha(page))) {
          pushLog(checkpoint, 'info', '人工验证码处理完成，继续执行发布');
          return;
        }
      }
    }

    const screenshotPath = await this.captureScreenshot(page, artifactDir, 'captcha');
    throw new CaptchaPausedError('检测到验证码，任务已暂停等待人工处理', checkpoint, this.toAssetUrl(screenshotPath));
  }

  private async hasCaptcha(page: Page) {
    const text = await page.textContent('body');
    const content = text || '';
    return CAPTCHA_TEXT_PATTERNS.some((pattern) => content.includes(pattern));
  }

  private async captureScreenshot(page: Page, artifactDir: string, prefix: string) {
    const filePath = path.join(artifactDir, `${prefix}-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  private async writeLogs(artifactDir: string, logs: TaobaoPublishLogEntry[]) {
    const filePath = path.join(artifactDir, 'publish-log.json');
    await writeFile(filePath, JSON.stringify(logs, null, 2), 'utf8');
    return filePath;
  }

  private toAssetUrl(filePath: string) {
    const relativePath = path.relative(path.resolve(process.cwd(), 'storage'), filePath).split(path.sep).join('/');
    return `${this.taobaoSessionService.getArtifactBaseUrl()}/uploads/${relativePath}`;
  }

  private assetUrlToFilePath(url: string) {
    const parsed = new URL(url);
    const relativePath = parsed.pathname.replace(/^\/uploads\//, '');
    return path.resolve(process.cwd(), 'storage', relativePath);
  }

  private normalizePrice(value: string | null) {
    return (value || '').replace(/[^\d.]/g, '') || '0';
  }

  private async extractTaobaoProductId(page: Page) {
    const url = page.url();
    const urlMatch = url.match(/(?:id|itemId|productId)=(\d{6,})/i);
    if (urlMatch) {
      return urlMatch[1];
    }

    const text = (await page.textContent('body')) || '';
    const textMatch = text.match(/商品ID[:：]?\s*(\d{6,})/i);
    if (textMatch) {
      return textMatch[1];
    }

    return `UNKNOWN-${Date.now()}`;
  }

  private async persistCheckpoint(taskId: number, checkpoint: string) {
    await this.prismaService.productPublishTask.update({
      where: { id: taskId },
      data: {
        checkpoint,
      },
    });
  }
}
