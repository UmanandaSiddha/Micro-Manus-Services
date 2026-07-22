import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { NormUsage } from '../llm/types';
import { getModel } from '../models/registry';

@Injectable()
export class UsageService {
  constructor(private readonly db: DatabaseService) {}

  /** Price at write time (docs/billing.md) so history never shifts. */
  cost(modelId: string, u: NormUsage): number {
    const m = getModel(modelId);
    if (!m) return 0;
    const p = m.pricing;
    return (
      (u.inputTokens * p.in +
        u.outputTokens * p.out +
        u.cacheReadTokens * p.cacheRead +
        u.cacheWriteTokens * p.cacheWrite) /
      1_000_000
    );
  }

  async record(params: {
    userId: string;
    threadId: string;
    runId: string;
    modelId: string;
    usage: NormUsage;
  }): Promise<number> {
    const costUsd = this.cost(params.modelId, params.usage);
    await this.db.query(
      `INSERT INTO usage_events
         (user_id, thread_id, run_id, model_id, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        params.userId,
        params.threadId,
        params.runId,
        params.modelId,
        params.usage.inputTokens,
        params.usage.outputTokens,
        params.usage.cacheReadTokens,
        params.usage.cacheWriteTokens,
        costUsd,
      ],
    );
    return costUsd;
  }

  async threadCost(threadId: string): Promise<number> {
    const row = await this.db.one<{ sum: string | null }>(
      `SELECT SUM(cost_usd) AS sum FROM usage_events WHERE thread_id = $1`,
      [threadId],
    );
    return Number(row?.sum ?? 0);
  }
}
