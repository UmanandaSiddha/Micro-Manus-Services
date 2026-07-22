import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { embed, memoryEnabled, toVectorLiteral } from './voyage';

/** chars/4 ≈ tokens — a trigger heuristic, not accounting (docs/memory.md). */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

const MAX_ORIGINAL_CHARS = 16_000; // ~4k tokens of original excerpts
const DISTANCE_CUTOFF = 0.55;

@Injectable()
export class MemoryService {
  private readonly log = new Logger(MemoryService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Long-term memory block for a new question, or null when the thread has no
   * summaries / retrieval finds nothing relevant. RAG augments context — it
   * never replaces recency (docs/memory.md).
   */
  async retrievalBlock(threadId: string, question: string): Promise<string | null> {
    if (!memoryEnabled()) return null;
    const any = await this.db.one(`SELECT 1 FROM summaries WHERE thread_id = $1 LIMIT 1`, [
      threadId,
    ]);
    if (!any) return null;

    try {
      const [qVec] = await embed([question.slice(0, 4000)], 'query');
      const hits = await this.db.query<{
        content: string;
        first_message_id: string;
        last_message_id: string;
        dist: number;
      }>(
        `SELECT content, first_message_id, last_message_id, embedding <=> $2::vector AS dist
         FROM summaries WHERE thread_id = $1
         ORDER BY dist LIMIT 3`,
        [threadId, toVectorLiteral(qVec)],
      );
      const relevant = hits.filter((h) => Number(h.dist) < DISTANCE_CUTOFF);
      if (!relevant.length) return null;

      const lines = relevant.map((h, i) => `${i + 1}. ${h.content}`);

      // For the single best hit, include the original archived messages.
      const best = relevant[0];
      const originals = await this.db.query<{ role: string; content: string }>(
        `SELECT role, content FROM messages
         WHERE thread_id = $1
           AND created_at >= (SELECT created_at FROM messages WHERE id = $2)
           AND created_at <= (SELECT created_at FROM messages WHERE id = $3)
           AND role IN ('user','assistant')
         ORDER BY created_at`,
        [threadId, best.first_message_id, best.last_message_id],
      );
      let excerpt = '';
      for (const m of originals) {
        const line = `${m.role}: ${m.content.slice(0, 1500)}\n`;
        if (excerpt.length + line.length > MAX_ORIGINAL_CHARS) break;
        excerpt += line;
      }

      return [
        '<long_term_memory>',
        'Earlier in this conversation (summarized):',
        ...lines,
        excerpt ? `\nMost relevant original excerpt:\n${excerpt}` : '',
        '</long_term_memory>',
      ].join('\n');
    } catch (e) {
      this.log.warn(`memory retrieval failed: ${(e as Error).message}`);
      return null; // memory is an enhancement — never fail the run for it
    }
  }
}
