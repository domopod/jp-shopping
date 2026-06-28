import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AgnesImageService {
  private readonly logger = new Logger(AgnesImageService.name);

  constructor(private readonly configService: ConfigService) {}

  async editImage(input: {
    sourceImages: string[];
    prompt: string;
    size: string;
    model?: string;
    seed?: number;
  }) {
    const apiKey = this.configService.get<string>('AGNES_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('Agnes API Key 未配置');
    }

    const baseUrl =
      this.configService.get<string>('AGNES_BASE_URL')?.trim() || 'https://apihub.agnes-ai.com/v1';
    const defaultModel =
      this.configService.get<string>('AGNES_MODEL')?.trim() || 'agnes-image-2.0-flash';
    const model = input.model || defaultModel;
    const sourceImages = await this.resolveSourceImages(input.sourceImages);

    const requestBody = {
      model,
      prompt: input.prompt,
      size: input.size,
      extra_body: {
        image: sourceImages,
        response_format: 'url',
      },
    };

    this.logger.log(
      `[Agnes] 发起请求: model=${model}, size=${input.size}, ` +
        `seed=${input.seed ?? 'none'}, sourceImages=${sourceImages.length}, ` +
        `promptLength=${input.prompt.length}`,
    );

    const response = await this.fetchWithTimeout(
      `${baseUrl}/images/generations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
      180000,
      'Agnes 图片处理请求',
    );

    if (!response.ok) {
      const message = await response.text();
      this.logger.error(
        `[Agnes] 请求失败: status=${response.status}, body=${message}`,
      );
      throw new Error(`Agnes 图片处理失败: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as { data?: Array<{ url?: string }> };
    const imageUrl = payload.data?.[0]?.url;
    if (!imageUrl) {
      this.logger.error(
        `[Agnes] 返回格式异常: payload=${JSON.stringify(payload).slice(0, 300)}`,
      );
      throw new Error('Agnes 未返回可用图片地址');
    }

    this.logger.log(`[Agnes] 成功获取生成图: ${imageUrl}`);
    return {
      imageUrl,
    };
  }

  async downloadGeneratedImage(url: string) {
    const response = await this.fetchWithTimeout(url, {}, 120000, '下载 Agnes 生成图');
    if (!response.ok) {
      throw new Error(`下载 Agnes 生成图失败: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async resolveSourceImages(sourceImages: string[]) {
    const resolved: string[] = [];

    for (const sourceImage of sourceImages) {
      if (!sourceImage) {
        continue;
      }

      if (sourceImage.startsWith('data:')) {
        resolved.push(sourceImage);
        continue;
      }

      if (this.canUseDirectSourceUrl(sourceImage)) {
        resolved.push(sourceImage);
        continue;
      }

      const response = await this.fetchWithTimeout(sourceImage, {}, 30000, '读取源图片');
      if (!response.ok) {
        throw new Error(`读取源图片失败: ${response.status} ${sourceImage}`);
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      resolved.push(`data:${contentType};base64,${base64}`);
    }

    if (!resolved.length) {
      throw new Error('未找到可用源图片');
    }

    return resolved;
  }

  private canUseDirectSourceUrl(sourceImage: string) {
    try {
      const parsed = new URL(sourceImage);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return false;
      }

      return !['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`${label}超时: ${timeoutMs}ms ${url}`);
        throw new Error(`${label}超时: ${timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
