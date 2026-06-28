import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrowserContextOptions, Cookie } from 'playwright';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

@Injectable()
export class TaobaoSessionService {
  private readonly sessionRoot = path.resolve(process.cwd(), 'storage', 'taobao-session');
  private readonly cookiesPath = path.join(this.sessionRoot, 'cookies.json');

  constructor(private readonly configService: ConfigService) {}

  async saveCookies(input: { cookieJson?: string; cookies?: Array<Partial<Cookie>> }) {
    const cookies = this.normalizeCookies(input);
    await mkdir(this.sessionRoot, { recursive: true });
    await writeFile(this.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');

    return {
      success: true,
      count: cookies.length,
      cookiesPath: this.cookiesPath,
    };
  }

  async getSessionStatus() {
    const cookies = await this.readCookies();
    return {
      hasCookies: cookies.length > 0,
      cookiesCount: cookies.length,
      cookiesPath: this.cookiesPath,
      headless: this.isHeadless(),
    };
  }

  async assertCookiesReady() {
    const cookies = await this.readCookies();
    if (!cookies.length) {
      throw new Error('淘宝 Cookie 未配置，请先保存卖家后台 Cookie');
    }

    return cookies;
  }

  async validateSession() {
    const cookies = await this.assertCookiesReady();
    const browser = await chromium.launch({
      headless: this.isHeadless(),
    });

    try {
      const context = await browser.newContext(this.getContextOptions());
      await context.addCookies(cookies);
      const page = await context.newPage();
      await page.goto(this.getSellerHomeUrl(), { waitUntil: 'domcontentloaded' });

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
      };
    } finally {
      await browser.close();
    }
  }

  getContextOptions(): BrowserContextOptions {
    return {
      viewport: { width: 1440, height: 980 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
  }

  getSellerHomeUrl() {
    return this.configService.get<string>('TAOBAO_SELLER_HOME_URL')?.trim() || 'https://myseller.taobao.com/home.htm';
  }

  getPublishUrl() {
    return (
      this.configService.get<string>('TAOBAO_PUBLISH_URL')?.trim() ||
      'https://upload.taobao.com/auction/publish.htm'
    );
  }

  getManualCaptchaWaitMs() {
    return Number(this.configService.get<string>('TAOBAO_CAPTCHA_WAIT_MS') || '300000');
  }

  getDefaultSkuStock() {
    return Number(this.configService.get<string>('TAOBAO_DEFAULT_STOCK') || '999');
  }

  getArtifactBaseUrl() {
    return (
      this.configService.get<string>('ASSET_BASE_URL')?.trim() ||
      `http://localhost:${this.configService.get<string>('PORT')?.trim() || '3001'}`
    );
  }

  isHeadless() {
    return (this.configService.get<string>('TAOBAO_HEADLESS') || 'true').trim() !== 'false';
  }

  private async readCookies() {
    try {
      const content = await readFile(this.cookiesPath, 'utf8');
      const parsed = JSON.parse(content) as Cookie[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizeCookies(input: { cookieJson?: string; cookies?: Array<Partial<Cookie>> }) {
    if (Array.isArray(input.cookies) && input.cookies.length) {
      return input.cookies.map((cookie) => this.normalizeSingleCookie(cookie));
    }

    if (!input.cookieJson?.trim()) {
      throw new Error('未提供有效的淘宝 Cookie');
    }

    const parsed = JSON.parse(input.cookieJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('淘宝 Cookie 必须是数组 JSON');
    }

    return (parsed as Array<Partial<Cookie>>).map((cookie) => this.normalizeSingleCookie(cookie));
  }

  private normalizeSingleCookie(cookie: Partial<Cookie>): Cookie {
    if (!cookie.name || !cookie.value || !cookie.domain || !cookie.path) {
      throw new Error('淘宝 Cookie 缺少 name/value/domain/path 必填字段');
    }

    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: cookie.sameSite || 'Lax',
    };
  }
}
