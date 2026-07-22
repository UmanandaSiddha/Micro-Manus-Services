import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** General-purpose connection (publish, get/set). */
  readonly client = new Redis(env('REDIS_URL'), { maxRetriesPerRequest: null });

  /** Dedicated subscriber factory — SSE handlers create one per stream and must quit() it. */
  createSubscriber(): Redis {
    return new Redis(env('REDIS_URL'), { maxRetriesPerRequest: null });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
