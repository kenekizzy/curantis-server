import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { ResponseTransformInterceptor } from './../src/common/interceptors/response-transform.interceptor';
import { BigIntSerializerInterceptor } from './../src/common/interceptors/bigint-serializer.interceptor';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

describe('Curantis API E2E', () => {
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
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(
      new BigIntSerializerInterceptor(),
      new ResponseTransformInterceptor(),
    );
    app.setGlobalPrefix('api/v1');

    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Discovery & Caregivers (/api/v1/caregivers)', () => {
    it('GET /api/v1/caregivers returns standard envelope with list and pagination meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/caregivers')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('hasMore');
    });
  });

  describe('Authentication (/api/v1/auth)', () => {
    it('POST /api/v1/auth/login rejects non-existent credentials with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          identifier: 'nonexistent@curantis.ng',
          password: 'WrongPassword123!',
          role: 'CLIENT',
        })
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('statusCode', 401);
    });

    it('POST /api/v1/auth/password/reset-request succeeds with identifier', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset-request')
        .send({
          identifier: 'test@curantis.ng',
        })
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
  });
});
