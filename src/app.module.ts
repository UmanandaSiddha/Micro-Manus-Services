import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health.controller';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [DatabaseModule, RedisModule, AuthModule, UsersModule, BillingModule],
  controllers: [HealthController],
})
export class AppModule {}
