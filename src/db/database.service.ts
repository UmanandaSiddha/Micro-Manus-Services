import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env } from '../config';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: env('DATABASE_URL'), max: 10 });
  private closed = false;

  /** Readiness ping — fail at boot, not on the first request. */
  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  isClosed(): boolean {
    return this.closed;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (this.closed) throw new Error('Database pool is closed');
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /** Run fn inside a transaction. fn receives a client with the same query shape. */
  async tx<T>(fn: (q: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new TxClient(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    this.closed = true; // interval sweeps must not hammer a dying pool
    await this.pool.end();
  }
}

export class TxClient {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.client.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }
}
