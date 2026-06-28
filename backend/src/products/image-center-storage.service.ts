import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

@Injectable()
export class ImageCenterStorageService {
  private readonly localRoot = path.resolve(process.cwd(), 'storage', 'image-center');

  constructor(private readonly configService: ConfigService) {}

  async uploadBuffer(storageKey: string, buffer: Buffer, mimeType: string) {
    const minioClient = this.createMinioClient();
    if (minioClient) {
      await this.ensureBucket();
      await minioClient.putObject(this.getMinioBucket(), storageKey, buffer, buffer.byteLength, {
        'Content-Type': mimeType,
      });

      return {
        storageKey,
        imageUrl: this.buildPublicUrl(storageKey),
      };
    }

    const filePath = path.join(this.localRoot, storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);

    return {
      storageKey,
      imageUrl: this.buildPublicUrl(storageKey),
    };
  }

  async deleteObject(storageKey: string) {
    const minioClient = this.createMinioClient();
    if (minioClient) {
      try {
        await minioClient.removeObject(this.getMinioBucket(), storageKey);
      } catch {
        return;
      }
      return;
    }

    return;
  }

  async getObjectBuffer(storageKey: string) {
    const minioClient = this.createMinioClient();
    if (minioClient) {
      const stream = await minioClient.getObject(this.getMinioBucket(), storageKey);
      return this.streamToBuffer(stream);
    }

    return readFile(path.join(this.localRoot, storageKey));
  }

  getLocalFilePath(storageKey: string) {
    return path.join(this.localRoot, storageKey);
  }

  isMinioEnabled() {
    return Boolean(this.createMinioClient());
  }

  private createMinioClient() {
    const endpoint = this.configService.get<string>('MINIO_ENDPOINT')?.trim();
    if (!endpoint) {
      return null;
    }

    return new MinioClient({
      endPoint: endpoint,
      port: Number(this.configService.get<string>('MINIO_PORT') || '9000'),
      useSSL: (this.configService.get<string>('MINIO_USE_SSL') || 'false').trim() === 'true',
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY')?.trim(),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY')?.trim(),
    });
  }

  private async ensureBucket() {
    const minioClient = this.createMinioClient();
    if (!minioClient) {
      return;
    }

    const bucketName = this.getMinioBucket();
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName);
    }
  }

  private buildPublicUrl(storageKey: string) {
    const publicBase = this.configService.get<string>('MINIO_PUBLIC_BASE_URL')?.trim();
    if (this.createMinioClient() && publicBase) {
      return `${publicBase}/${this.getMinioBucket()}/${storageKey}`;
    }

    const assetBaseUrl =
      this.configService.get<string>('ASSET_BASE_URL')?.trim() ||
      `http://localhost:${this.configService.get<string>('PORT')?.trim() || '3001'}`;

    return `${assetBaseUrl}/uploads/image-center/${storageKey}`;
  }

  private async streamToBuffer(stream: Readable) {
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private getMinioBucket() {
    return this.configService.get<string>('MINIO_BUCKET')?.trim() || 'jp-shopping-images';
  }
}
