import { ToolDef } from '../llm/types';

export interface ToolCtx {
  userId: string;
  threadId: string;
  runId: string;
}

export interface AgentTool {
  def: ToolDef;
  /** Returns the string that goes back into model context (pre-truncated). */
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolOutput>;
}

export interface ToolOutput {
  /** Full result fed to the model (and persisted in the run step). */
  content: string;
  /** Short display line for the timeline UI. */
  summary: string;
  /** Optional side effect (e.g. created artifact id). */
  artifactId?: string;
}
