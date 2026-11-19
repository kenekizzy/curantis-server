import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor.js';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor.js';

async function bootstrap() {
  // Disable built-in body parser so we can control order (raw before JSON for webhooks)
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));

  // Raw body for webhook HMAC verification — must come before JSON parser
  app.use('/api/v1/payments/webhooks', express.raw({ type: 'application/json' }));

  // JSON + urlencoded parser for all other routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Cookies
  app.use(cookieParser());

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  // CORS — whitelist only
  app.enableCors({
    origin: [process.env.CLIENT_URL!, process.env.WORKER_URL!, process.env.ADMIN_URL!],
    credentials: true,
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters — most specific first
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(new BigIntSerializerInterceptor(), new ResponseTransformInterceptor());

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger — dev and staging only
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Curantis API')
      .setDescription('Healthcare marketplace backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(process.env.PORT ?? 5000);
}

bootstrap();
