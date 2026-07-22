import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DatabaseService } from '../db/database.service';
import { LlmService } from '../llm/llm.service';
import { ChatMsg } from '../llm/types';
import { MemoryService } from '../memory/memory.service';
import { SUMMARIZE_QUEUE } from '../memory/summarize.processor';
import { getModel } from '../models/registry';
import { RedisService } from '../redis/redis.service';
import { ToolRegistry } from '../tools/tool.registry';
import { UsageService } from '../usage/usage.service';
import { SYSTEM_PROMPT } from './prompts';
import { cancelKey, runChannel, RunEvent, RunStep } from './run-events';

export const AGENT_QUEUE = 'agent-runs';
const MAX_ITERATIONS = 12;
const TOOL_CONTENT_CAP = 12_000;

interface RunRow {
  id: string;
  thread_id: string;
  user_id: string;
  model_id: string;
  status: string;
  steps: RunStep[];
}

@Processor(AGENT_QUEUE, { concurrency: 5 })
export class AgentProcessor extends WorkerHost {
  private readonly log = new Logger(AgentProcessor.name);

  /** Boot sweep: runs stuck 'running' >30min lost their job — fail + refund. */
  async onModuleInit(): Promise<void> {
    const stale = await this.db.query<RunRow>(
      `SELECT * FROM runs WHERE status = 'running' AND started_at < now() - interval '30 minutes'`,
    );
    for (const run of stale) {
      this.log.warn(`Sweeping stale run ${run.id}`);
      await this.finalizeFailed(run, 'Run interrupted by a server restart');
    }
  }

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly llm: LlmService,
    private readonly tools: ToolRegistry,
    private readonly usage: UsageService,
    private readonly memory: MemoryService,
    @InjectQueue(SUMMARIZE_QUEUE) private readonly summarizeQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ runId: string }>): Promise<void> {
    const run = await this.db.one<RunRow>(`SELECT * FROM runs WHERE id = $1`, [job.data.runId]);
    if (!run || run.status !== 'running') return; // already finalized

    const model = getModel(run.model_id);
    if (!model) return this.finalizeFailed(run, `Unknown model ${run.model_id}`);

    const publish = (e: RunEvent) =>
      this.redis.client.publish(runChannel(run.id), JSON.stringify(e));

    try {
      const key = await this.llm.resolveKey(run.user_id, model);

      // Base context: persisted thread history (user + assistant messages).
      const base = await this.db.query<{
        role: ChatMsg['role'];
        content: string;
        tool_calls: ChatMsg['toolCalls'] | null;
        tool_call_id: string | null;
      }>(
        `SELECT role, content, tool_calls, tool_call_id FROM messages
         WHERE thread_id = $1 AND archived = false ORDER BY created_at`,
        [run.thread_id],
      );
      const msgs: ChatMsg[] = base.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls ?? undefined,
        toolCallId: m.tool_call_id ?? undefined,
      }));

      // Long-term memory (docs/memory.md): retrieved block goes before recency.
      const question = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
      const memoryBlock = await this.memory.retrievalBlock(run.thread_id, question);
      if (memoryBlock) msgs.unshift({ role: 'user', content: memoryBlock });

      // Resume support: overlay already-completed steps (BullMQ retry).
      // Concurrent tool persistence can append out of index order — sort.
      const steps: RunStep[] = (run.steps ?? []).sort((a, b) => a.i - b.i);
      for (const s of steps) {
        if (s.kind === 'llm') {
          msgs.push({ role: 'assistant', content: s.text, toolCalls: s.toolCalls.length ? s.toolCalls : undefined });
        } else {
          msgs.push({ role: 'tool', content: s.content, toolCallId: s.callId });
        }
      }

      await publish({
        event: 'run_started',
        data: { runId: run.id, threadId: run.thread_id, modelId: run.model_id },
      });

      let runCost = steps.filter((s) => s.kind === 'llm').reduce((a, s) => a + (s as { costUsd: number }).costUsd, 0);
      let iteration = steps.filter((s) => s.kind === 'llm').length;
      let finalText = '';
      const ctx = { userId: run.user_id, threadId: run.thread_id, runId: run.id };

      while (iteration < MAX_ITERATIONS) {
        if (await this.redis.client.get(cancelKey(run.id))) {
          return this.finalizeFailed(run, 'Cancelled by user', steps);
        }

        const stepIndex = steps.length;
        const forceFinal = iteration === MAX_ITERATIONS - 1;
        const result = await this.llm.streamTurn(key, model, {
          system: SYSTEM_PROMPT,
          messages: forceFinal
            ? [...msgs, { role: 'user' as const, content: '[system] Tool budget exhausted — write your final answer now with what you have.' }]
            : msgs,
          tools: forceFinal ? [] : this.tools.defs(),
          onTextDelta: (delta) =>
            void publish({ event: 'text_delta', data: { stepIndex, delta } }),
        });

        const costUsd = await this.usage.record({
          userId: run.user_id,
          threadId: run.thread_id,
          runId: run.id,
          modelId: run.model_id,
          usage: result.usage,
        });
        runCost += costUsd;

        const llmStep: RunStep = {
          i: stepIndex,
          kind: 'llm',
          text: result.text,
          toolCalls: result.toolCalls,
          usage: result.usage,
          costUsd,
          at: new Date().toISOString(),
        };
        await this.persistStep(run.id, llmStep);
        steps.push(llmStep);

        await publish({ event: 'token_usage', data: { stepIndex, ...result.usage } });
        await publish({
          event: 'cost_updated',
          data: { runCostUsd: runCost, threadCostUsd: await this.usage.threadCost(run.thread_id) },
        });

        msgs.push({
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
        });

        if (!result.toolCalls.length) {
          finalText = result.text;
          break;
        }

        // Execute requested tools concurrently.
        await Promise.all(
          result.toolCalls.map(async (tc, k) => {
            const toolStepIndex = stepIndex + 1 + k;
            let args: unknown = {};
            try {
              args = JSON.parse(tc.args || '{}');
            } catch {
              /* registry handles bad json too */
            }
            await publish({
              event: 'tool_started',
              data: { stepIndex: toolStepIndex, tool: tc.name, args },
            });
            const started = Date.now();
            const out = await this.tools.execute(tc.name, tc.args, ctx);
            const durationMs = Date.now() - started;

            const toolStep: RunStep = {
              i: toolStepIndex,
              kind: 'tool',
              callId: tc.id,
              tool: tc.name,
              args,
              content: out.content.slice(0, TOOL_CONTENT_CAP),
              summary: out.summary,
              durationMs,
              artifactId: out.artifactId,
              at: new Date().toISOString(),
            };
            await this.persistStep(run.id, toolStep);
            steps.push(toolStep);

            await publish({
              event: 'tool_finished',
              data: { stepIndex: toolStepIndex, tool: tc.name, summary: out.summary, durationMs },
            });
            if (out.artifactId) {
              await publish({
                event: 'artifact_created',
                data: { artifactId: out.artifactId, type: 'pdf', title: out.summary },
              });
            }
            msgs.push({ role: 'tool', content: toolStep.content, toolCallId: tc.id });
          }),
        );
        iteration++;
      }

      // Finalize success
      await this.db.tx(async (q) => {
        await q.query(
          `INSERT INTO messages (thread_id, role, content) VALUES ($1, 'assistant', $2)`,
          [run.thread_id, finalText],
        );
        await q.query(
          `UPDATE threads SET updated_at = now(), model_id = $2,
             title = CASE WHEN title = 'New chat'
               THEN (SELECT LEFT(content, 80) FROM messages WHERE thread_id = $1 AND role = 'user' ORDER BY created_at LIMIT 1)
               ELSE title END
           WHERE id = $1`,
          [run.thread_id, run.model_id],
        );
        await q.query(`UPDATE runs SET status = 'done', finished_at = now() WHERE id = $1`, [run.id]);
      });

      const credits = await this.db.one<{ credits: number }>(
        `SELECT credits FROM users WHERE id = $1`,
        [run.user_id],
      );
      await publish({
        event: 'run_completed',
        data: { runId: run.id, costUsd: runCost, credits: credits?.credits ?? 0 },
      });

      // Fold old turns into summaries when the thread grows (docs/memory.md).
      await this.summarizeQueue.add('summarize', {
        threadId: run.thread_id,
        userId: run.user_id,
        modelId: run.model_id,
      });
    } catch (e) {
      const attempts = (job.opts.attempts ?? 1) as number;
      if (job.attemptsMade + 1 < attempts) {
        this.log.warn(`Run ${run.id} attempt ${job.attemptsMade + 1} failed, retrying: ${(e as Error).message}`);
        throw e; // BullMQ retry → resume from persisted steps
      }
      await this.finalizeFailed(run, (e as Error).message);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ runId: string }> | undefined, err: Error) {
    this.log.error(`Job failed permanently: ${job?.data.runId}: ${err.message}`);
  }

  private async persistStep(runId: string, step: RunStep): Promise<void> {
    await this.db.query(`UPDATE runs SET steps = steps || $2::jsonb WHERE id = $1`, [
      runId,
      JSON.stringify([step]),
    ]);
  }

  /** Refund the credit only when the run produced nothing (docs/billing.md). */
  private async finalizeFailed(run: RunRow, error: string, steps?: RunStep[]): Promise<void> {
    const currentSteps =
      steps ??
      ((await this.db.one<{ steps: RunStep[] }>(`SELECT steps FROM runs WHERE id = $1`, [run.id]))
        ?.steps ?? []);
    const producedText = currentSteps.some((s) => s.kind === 'llm' && s.text.trim().length > 0);
    const refund = !producedText;

    await this.db.tx(async (q) => {
      await q.query(
        `UPDATE runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
        [run.id, error.slice(0, 500)],
      );
      if (refund) {
        await q.query(`UPDATE users SET credits = credits + 1 WHERE id = $1`, [run.user_id]);
        await q.query(
          `INSERT INTO credit_ledger (user_id, delta, reason, ref_id) VALUES ($1, 1, 'refund', $2)`,
          [run.user_id, run.id],
        );
      }
    });
    await this.redis.client.publish(
      runChannel(run.id),
      JSON.stringify({
        event: 'run_failed',
        data: { runId: run.id, error: error.slice(0, 300), creditRefunded: refund },
      } satisfies RunEvent),
    );
  }
}
