import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from './agent/agent.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { DatabaseModule } from './db/database.module';
import { redisConnectionOptions } from './redis/redis.util';
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
      useFactory: () => ({
        prefix: 'micromanus', // namespace jobs on shared Redis instances
        connection: { ...redisConnectionOptions(), maxRetriesPerRequest: null },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      }),
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
