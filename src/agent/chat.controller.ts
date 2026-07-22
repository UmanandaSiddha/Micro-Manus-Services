import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { IsString, Length } from 'class-validator';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';
import { getModel } from '../models/registry';
import { RedisService } from '../redis/redis.service';
import { AGENT_QUEUE } from './agent.processor';
import { cancelKey } from './run-events';

class SendMessageDto {
  @IsString()
  @Length(1, 20_000)
  content!: string;

  @IsString()
  @Length(1, 100)
  modelId!: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue,
  ) {}

  @Get('threads')
  threads(@User() userId: string) {
    return this.db.query(
      `SELECT id, title, model_id, created_at, updated_at FROM threads
       WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    );
  }

  @Post('threads')
  async createThread(@User() userId: string) {
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO threads (user_id) VALUES ($1) RETURNING id`,
      [userId],
    );
    return { id: row!.id };
  }

  @Get('threads/:id')
  async thread(@User() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    const thread = await this.assertThread(userId, id);
    const [messages, runs, artifacts] = await Promise.all([
      this.db.query(
        `SELECT id, role, content, created_at FROM messages
         WHERE thread_id = $1 AND role IN ('user','assistant') ORDER BY created_at`,
        [id],
      ),
      this.db.query(
        `SELECT id, model_id, status, steps, error, started_at, finished_at
         FROM runs WHERE thread_id = $1 ORDER BY started_at`,
        [id],
      ),
      this.db.query(
        `SELECT id, type, title, size_bytes, created_at FROM artifacts
         WHERE thread_id = $1 ORDER BY created_at`,
        [id],
      ),
    ]);
    return { thread, messages, runs, artifacts };
  }

  @Delete('threads/:id')
  async deleteThread(@User() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertThread(userId, id);
    await this.db.query(`DELETE FROM threads WHERE id = $1`, [id]);
    return { ok: true };
  }

  @Post('threads/:id/messages')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(202)
  async sendMessage(
    @User() userId: string,
    @Param('id', ParseUUIDPipe) threadId: string,
    @Body() dto: SendMessageDto,
  ) {
    await this.assertThread(userId, threadId);
    if (!getModel(dto.modelId)) throw new NotFoundException(`Unknown model ${dto.modelId}`);

    const running = await this.db.one(
      `SELECT 1 FROM runs WHERE thread_id = $1 AND status = 'running' LIMIT 1`,
      [threadId],
    );
    if (running) throw new ForbiddenException('A run is already in progress on this thread');

    // Atomic credit deduction — the load-bearing pattern from docs/database.md.
    // The whole thing is one tx: if the run INSERT hits the one-running-per-
    // thread unique index (concurrent double-send), the deduction rolls back too.
    let result: { runId: string; credits: number } | null;
    try {
      result = await this.db.tx(async (q) => {
        const deducted = await q.one<{ credits: number }>(
          `UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits`,
          [userId],
        );
        if (!deducted) return null;
        await q.query(
          `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'user', $2)`,
          [threadId, dto.content],
        );
        const run = await q.one<{ id: string }>(
          `INSERT INTO runs (thread_id, user_id, model_id) VALUES ($1, $2, $3) RETURNING id`,
          [threadId, userId, dto.modelId],
        );
        await q.query(
          `INSERT INTO credit_ledger (user_id, delta, reason, ref_id) VALUES ($1, -1, 'run', $2)`,
          [userId, run!.id],
        );
        return { runId: run!.id, credits: deducted.credits };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ForbiddenException('A run is already in progress on this thread');
      }
      throw e;
    }
    if (!result) throw new HttpException('Out of credits', 402);

    await this.queue.add('run', { runId: result.runId }, { attempts: 2, backoff: { type: 'fixed', delay: 2000 } });
    return result;
  }

  @Post('runs/:id/cancel')
  async cancel(@User() userId: string, @Param('id', ParseUUIDPipe) runId: string) {
    const run = await this.db.one<{ user_id: string }>(
      `SELECT user_id FROM runs WHERE id = $1`,
      [runId],
    );
    if (!run || run.user_id !== userId) throw new NotFoundException();
    await this.redis.client.set(cancelKey(runId), '1', 'EX', 3600);
    return { ok: true };
  }

  private async assertThread(userId: string, id: string) {
    const thread = await this.db.one<{ id: string; user_id: string; title: string; model_id: string | null }>(
      `SELECT id, user_id, title, model_id FROM threads WHERE id = $1`,
      [id],
    );
    if (!thread || thread.user_id !== userId) throw new NotFoundException('Thread not found');
    return thread;
  }
}
