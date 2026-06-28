import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        status: 'ok',
        service: 'jp-shopping-backend',
      });
  });

  it('/api/products/import (POST) invalid url', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/products/import')
      .send({ url: 'abc' })
      .expect(400);

    expect(response.body.message).toContain('请输入有效的商品 URL');
  });
});
