import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DatabaseService } from '../db/database.service';
import { LlmService } from '../llm/llm.service';
import { getModel } from '../models/registry';
import { embed, memoryEnabled, toVectorLiteral } from './voyage';
import { estimateTokens } from './memory.service';

export const SUMMARIZE_QUEUE = 'summarize';

const TRIGGER_TOKENS = 60_000;
const BLOCK_TOKENS = 30_000;
const KEEP_RECENT = 15;

const SUMMARY_PROMPT = `Summarize this conversation excerpt for long-term memory. Preserve: decisions made, key facts and figures, names, dates, open questions, and what the user cares about. Be specific — this summary is the only record once the originals are archived. Max ~500 words. Output only the summary.`;

@Processor(SUMMARIZE_QUEUE, { concurrency: 2 })
export class SummarizeProcessor extends WorkerHost {
  private readonly log = new Logger(SummarizeProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly llm: LlmService,
  ) {
    super();
  }

  async process(job: Job<{ threadId: string; userId: string; modelId: string }>): Promise<void> {
    if (!memoryEnabled()) return;
    const { threadId, userId, modelId } = job.data;

    const msgs = await this.db.query<{ id: string; role: string; content: string }>(
      `SELECT id, role, content FROM messages
       WHERE thread_id = $1 AND archived = false AND role IN ('user','assistant')
       ORDER BY created_at`,
      [threadId],
    );
    const totalTokens = estimateTokens(msgs.reduce((a, m) => a + m.content.length, 0));
    if (totalTokens < TRIGGER_TOKENS) return;

    // Oldest block ≈ 30k tokens; never touch the last 15 messages.
    const candidates = msgs.slice(0, Math.max(0, msgs.length - KEEP_RECENT));
    const block: typeof msgs = [];
    let blockTokens = 0;
    for (const m of candidates) {
      if (blockTokens >= BLOCK_TOKENS) break;
      block.push(m);
      blockTokens += estimateTokens(m.content.length);
    }
    if (block.length < 2) return;

    const model = getModel(modelId);
    if (!model) return;
    const key = await this.llm.resolveKey(userId, model);

    const transcript = block
      .map((m) => `${m.role}: ${m.content.slice(0, 2000)}`)
      .join('\n\n');
    const result = await this.llm.streamTurn(key, model, {
      system: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: transcript }],
      tools: [],
    });
    const summary = result.text.trim();
    if (!summary) return;

    const [vec] = await embed([summary], 'document');
    await this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO summaries (thread_id, content, embedding, first_message_id, last_message_id)
         VALUES ($1, $2, $3::vector, $4, $5)`,
        [threadId, summary, toVectorLiteral(vec), block[0].id, block[block.length - 1].id],
      );
      await q.query(`UPDATE messages SET archived = true WHERE id = ANY($1::uuid[])`, [
        block.map((m) => m.id),
      ]);
    });
    this.log.log(
      `Thread ${threadId}: archived ${block.length} messages into a summary (${blockTokens} est. tokens)`,
    );
  }
}
