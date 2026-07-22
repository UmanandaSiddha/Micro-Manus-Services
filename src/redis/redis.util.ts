import { RedisOptions } from 'ioredis';
import { env } from '../config';

/** One source of truth for Redis connection options — feeds ioredis AND BullMQ. */
export function redisConnectionOptions(): RedisOptions {
  const url = new URL(env('REDIS_URL'));
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
}
