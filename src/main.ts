import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { assertEnv } from './config';

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Stripe webhook signature verification needs the raw body
  });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(4000);
}
void bootstrap();
