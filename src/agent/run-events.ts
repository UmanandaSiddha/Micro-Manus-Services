import { NormUsage, ToolCall } from '../llm/types';

/** SSE event contract — FROZEN, see docs/api.md. Additive changes only. */
export type RunEvent =
  | { event: 'run_started'; data: { runId: string; threadId: string; modelId: string } }
  | { event: 'text_delta'; data: { stepIndex: number; delta: string } }
  | { event: 'tool_started'; data: { stepIndex: number; tool: string; args: unknown } }
  | { event: 'tool_finished'; data: { stepIndex: number; tool: string; summary: string; durationMs: number } }
  | { event: 'token_usage'; data: { stepIndex: number } & NormUsage }
  | { event: 'cost_updated'; data: { runCostUsd: number; threadCostUsd: number } }
  | { event: 'artifact_created'; data: { artifactId: string; type: string; title: string } }
  | { event: 'run_completed'; data: { runId: string; costUsd: number; credits: number } }
  | { event: 'run_failed'; data: { runId: string; error: string; creditRefunded: boolean } };

/** Persisted step records in runs.steps — the trace + resume state. */
export type RunStep =
  | {
      i: number;
      kind: 'llm';
      text: string;
      toolCalls: ToolCall[];
      usage: NormUsage;
      costUsd: number;
      at: string;
    }
  | {
      i: number;
      kind: 'tool';
      callId: string;
      tool: string;
      args: unknown;
      content: string;
      summary: string;
      durationMs: number;
      artifactId?: string;
      at: string;
    };

/** Map persisted steps back to SSE events (connect-time replay). */
export function stepsToEvents(steps: RunStep[]): RunEvent[] {
  const events: RunEvent[] = [];
  for (const s of [...steps].sort((a, b) => a.i - b.i)) {
    if (s.kind === 'llm') {
      if (s.text) events.push({ event: 'text_delta', data: { stepIndex: s.i, delta: s.text } });
      events.push({ event: 'token_usage', data: { stepIndex: s.i, ...s.usage } });
    } else {
      events.push({ event: 'tool_started', data: { stepIndex: s.i, tool: s.tool, args: s.args } });
      events.push({
        event: 'tool_finished',
        data: { stepIndex: s.i, tool: s.tool, summary: s.summary, durationMs: s.durationMs },
      });
      if (s.artifactId) {
        events.push({
          event: 'artifact_created',
          data: { artifactId: s.artifactId, type: 'pdf', title: s.summary },
        });
      }
    }
  }
  return events;
}

export const runChannel = (runId: string) => `run:${runId}`;
export const cancelKey = (runId: string) => `cancel:run:${runId}`;
