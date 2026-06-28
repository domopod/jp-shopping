import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    app.enableShutdownHooks();
  }
}
