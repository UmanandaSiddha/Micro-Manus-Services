import { Controller, NotFoundException, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import { Get } from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';
import { RedisService } from '../redis/redis.service';
import { runChannel, RunEvent, RunStep, stepsToEvents } from './run-events';

@Controller('chat/runs')
export class SseController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * SSE stream for a run: replay persisted steps first (lossless refresh /
   * reconnect), then forward live events from Redis. See docs/api.md.
   */
  @Get(':id/events')
  async events(
    @User() userId: string,
    @Param('id', ParseUUIDPipe) runId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const run = await this.db.one<{
      id: string;
      user_id: string;
      thread_id: string;
      model_id: string;
      status: string;
      error: string | null;
    }>(`SELECT id, user_id, thread_id, model_id, status, error FROM runs WHERE id = $1`, [runId]);
    if (!run || run.user_id !== userId) throw new NotFoundException();

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // survive proxies (Next rewrite / Nginx)
    });
    res.flushHeaders();

    let closed = false;
    const send = (e: RunEvent) => {
      if (closed) return; // a live terminal event may end the response mid-replay
      res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };

    // Subscribe BEFORE replaying so no live event slips through the gap.
    const sub = this.redis.createSubscriber();
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      void sub.quit();
      res.end();
    };
    const ping = setInterval(() => !closed && res.write(': ping\n\n'), 25_000);
    req.on('close', cleanup);

    await sub.subscribe(runChannel(runId));
    sub.on('message', (_ch, raw) => {
      if (closed) return;
      const e = JSON.parse(raw) as RunEvent;
      send(e);
      if (e.event === 'run_completed' || e.event === 'run_failed') cleanup();
    });

    // Replay
    send({
      event: 'run_started',
      data: { runId: run.id, threadId: run.thread_id, modelId: run.model_id },
    });
    const stepsRow = await this.db.one<{ steps: RunStep[] }>(
      `SELECT steps FROM runs WHERE id = $1`,
      [runId],
    );
    for (const e of stepsToEvents(stepsRow?.steps ?? [])) send(e);

    // Terminal already? Emit the terminal event and close.
    const fresh = await this.db.one<{ status: string; error: string | null }>(
      `SELECT status, error FROM runs WHERE id = $1`,
      [runId],
    );
    if (fresh?.status === 'done') {
      const [credits, cost] = await Promise.all([
        this.db.one<{ credits: number }>(`SELECT credits FROM users WHERE id = $1`, [userId]),
        this.db.one<{ sum: string | null }>(
          `SELECT SUM(cost_usd) AS sum FROM usage_events WHERE run_id = $1`,
          [runId],
        ),
      ]);
      send({
        event: 'run_completed',
        data: { runId, costUsd: Number(cost?.sum ?? 0), credits: credits?.credits ?? 0 },
      });
      cleanup();
    } else if (fresh?.status === 'failed') {
      const refunded = await this.db.one(
        `SELECT 1 FROM credit_ledger WHERE reason = 'refund' AND ref_id = $1 LIMIT 1`,
        [runId],
      );
      send({
        event: 'run_failed',
        data: { runId, error: fresh.error ?? 'failed', creditRefunded: !!refunded },
      });
      cleanup();
    }
  }
}
