import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { resolve } from 'path';

export interface MontbellStockSku {
  skuCode: string;
  color: string;
  colorCode: string;
  size: string;
  stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'BACKORDER';
  restockDate: string | null;
  price: string | null;
}

export interface MontbellStockResult {
  title: string;
  brand: string;
  price: string | null;
  imageUrl: string | null;
  skus: MontbellStockSku[];
}

@Injectable()
export class MontbellCollectorService {
  constructor(private readonly configService: ConfigService) {}

  async collectStock(url: string): Promise<MontbellStockResult> {
    const pythonBin = this.configService.get<string>('PYTHON_BIN') || 'python3';
    const configuredScript = this.configService.get<string>('MONTBELL_COLLECTOR_SCRIPT');
    const scriptPath = resolve(process.cwd(), configuredScript || '../collector/montbell_stock.py');

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(pythonBin, [scriptPath, url]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        rejectPromise(new InternalServerErrorException(`Montbell 采集器启动失败: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          rejectPromise(
            new InternalServerErrorException(
              `Montbell 采集器执行失败: ${stderr || `退出码 ${code}`}`,
            ),
          );
          return;
        }

        try {
          const payload = JSON.parse(stdout) as MontbellStockResult;
          resolvePromise(payload);
        } catch (error) {
          rejectPromise(new InternalServerErrorException(`采集结果解析失败: ${(error as Error).message}`));
        }
      });
    });
  }
}
