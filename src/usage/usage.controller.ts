import { Controller, Get } from '@nestjs/common';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';
import { getModel, MODELS } from '../models/registry';

interface Group {
  thread_id: string;
  model_id: string;
  runs: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_write_tokens: string;
  cost_usd: string;
}

@Controller('usage')
export class UsageController {
  constructor(private readonly db: DatabaseService) {}

  @Get('stats')
  async stats(@User() userId: string) {
    const [groups, titles, perRun] = await Promise.all([
      this.db.query<Group>(
        `SELECT thread_id, model_id, COUNT(DISTINCT run_id) AS runs,
                SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(cache_write_tokens) AS cache_write_tokens,
                SUM(cost_usd) AS cost_usd
         FROM usage_events WHERE user_id = $1
         GROUP BY thread_id, model_id`,
        [userId],
      ),
      this.db.query<{ id: string; title: string }>(
        `SELECT id, title FROM threads WHERE user_id = $1`,
        [userId],
      ),
      this.db.query<{
        thread_id: string;
        run_id: string;
        cost_usd: string;
        at: string;
      }>(
        `SELECT thread_id, run_id, SUM(cost_usd) AS cost_usd, MIN(created_at) AS at
         FROM usage_events WHERE user_id = $1 AND run_id IS NOT NULL
         GROUP BY thread_id, run_id ORDER BY at`,
        [userId],
      ),
    ]);
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));

    // Per-thread rollup with cache savings priced from the registry.
    const threadsMap = new Map<
      string,
      {
        threadId: string;
        title: string;
        modelIds: string[];
        runs: number;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        costUsd: number;
        cacheSavedUsd: number;
        perRun: Array<{ runId: string; costUsd: number; at: string }>;
      }
    >();

    for (const g of groups) {
      const t = threadsMap.get(g.thread_id) ?? {
        threadId: g.thread_id,
        title: titleOf.get(g.thread_id) ?? '(deleted chat)',
        modelIds: [],
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        cacheSavedUsd: 0,
        perRun: [],
      };
      const m = getModel(g.model_id);
      const cr = Number(g.cache_read_tokens);
      const cw = Number(g.cache_write_tokens);
      t.modelIds.push(g.model_id);
      t.runs += Number(g.runs);
      t.inputTokens += Number(g.input_tokens);
      t.outputTokens += Number(g.output_tokens);
      t.cacheReadTokens += cr;
      t.cacheWriteTokens += cw;
      t.costUsd += Number(g.cost_usd);
      if (m) {
        // What caching saved: reads billed at cacheRead instead of in,
        // minus the write premium paid over plain input.
        t.cacheSavedUsd +=
          (cr * (m.pricing.in - m.pricing.cacheRead) -
            cw * (m.pricing.cacheWrite - m.pricing.in)) /
          1_000_000;
      }
      threadsMap.set(g.thread_id, t);
    }
    for (const r of perRun) {
      threadsMap.get(r.thread_id)?.perRun.push({
        runId: r.run_id,
        costUsd: Number(r.cost_usd),
        at: r.at,
      });
    }

    const threads = [...threadsMap.values()].sort(
      (a, b) => b.costUsd - a.costUsd,
    );
    const totals = threads.reduce(
      (a, t) => ({
        costUsd: a.costUsd + t.costUsd,
        cacheSavedUsd: a.cacheSavedUsd + t.cacheSavedUsd,
        inputTokens: a.inputTokens + t.inputTokens,
        outputTokens: a.outputTokens + t.outputTokens,
        cacheReadTokens: a.cacheReadTokens + t.cacheReadTokens,
        cacheWriteTokens: a.cacheWriteTokens + t.cacheWriteTokens,
        runs: a.runs + t.runs,
      }),
      {
        costUsd: 0,
        cacheSavedUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        runs: 0,
      },
    );

    // What-if: same total token mix priced on every registry model.
    const whatIf = MODELS.map((m) => ({
      modelId: m.id,
      label: m.label,
      costUsd:
        (totals.inputTokens * m.pricing.in +
          totals.outputTokens * m.pricing.out +
          totals.cacheReadTokens * m.pricing.cacheRead +
          totals.cacheWriteTokens * m.pricing.cacheWrite) /
        1_000_000,
    })).sort((a, b) => a.costUsd - b.costUsd);

    const cacheHitRate =
      totals.inputTokens + totals.cacheReadTokens > 0
        ? totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens)
        : 0;

    return { threads, totals: { ...totals, cacheHitRate }, whatIf };
  }
}
