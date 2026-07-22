import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { assertEnv } from './config';

// A rejected promise nobody awaited must not kill the worker; a truly
// uncaught exception must — the orchestrator restarts a clean process.
process.on('unhandledRejection', (reason) => {
  new Logger('Process').error(`Unhandled rejection: ${String(reason)}`);
});
process.on('uncaughtException', (err) => {
  new Logger('Process').error(`Uncaught exception: ${err.stack ?? err.message}`);
  process.exit(1);
});

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Stripe webhook signature verification needs the raw body
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // mass-assignment defense
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks(); // drain pg pool / BullMQ workers on SIGTERM
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Listening on :${port}`);
}
void bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
