import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from './agent/agent.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { env } from './config';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { KeysModule } from './keys/keys.module';
import { MemoryModule } from './memory/memory.module';
import { ModelsModule } from './models/models.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      useFactory: () => {
        const url = new URL(env('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    BillingModule,
    KeysModule,
    ModelsModule,
    AgentModule,
    ArtifactsModule,
    MemoryModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
