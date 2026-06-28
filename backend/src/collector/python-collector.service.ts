import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { resolve } from 'path';
import type { CollectorPayload } from '../products/products.types';

@Injectable()
export class PythonCollectorService {
  constructor(private readonly configService: ConfigService) {}

  async collect(url: string): Promise<CollectorPayload> {
    const pythonBin = this.configService.get<string>('PYTHON_BIN') || 'python3';
    const configuredScript = this.configService.get<string>('PYTHON_COLLECTOR_SCRIPT');
    const scriptPath = resolve(process.cwd(), configuredScript || '../collector/collector.py');

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
        rejectPromise(new InternalServerErrorException(`Python 采集器启动失败: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          rejectPromise(
            new InternalServerErrorException(
              `Python 采集器执行失败: ${stderr || `退出码 ${code}`}`,
            ),
          );
          return;
        }

        try {
          const payload = JSON.parse(stdout) as CollectorPayload;
          resolvePromise(payload);
        } catch (error) {
          rejectPromise(new InternalServerErrorException(`采集结果解析失败: ${(error as Error).message}`));
        }
      });
    });
  }
}
