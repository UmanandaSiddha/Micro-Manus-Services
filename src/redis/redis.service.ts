import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnectionOptions } from './redis.util';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);

  /** General-purpose connection (publish, get/set). */
  readonly client = this.build('main');

  /** Dedicated subscriber factory — SSE handlers create one per stream and must quit() it. */
  createSubscriber(): Redis {
    return this.build('sub');
  }

  private build(label: string): Redis {
    const conn = new Redis({
      ...redisConnectionOptions(),
      maxRetriesPerRequest: null,
    });
    // Without an 'error' listener ioredis spams unhandled-error events; a Redis
    // blip must degrade (retryStrategy reconnects), not crash the app.
    conn.on('error', (e) => this.log.warn(`redis(${label}): ${e.message}`));
    return conn;
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => {});
  }
}
