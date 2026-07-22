import { KeyProvider } from '../models/registry';

/** Internal message shape — OpenAI-flavored; the Anthropic provider converts. */
export interface ChatMsg {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[]; // assistant messages that requested tools
  toolCallId?: string; // role='tool' results
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON string as sent by the provider. */
  args: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema (OpenAI `parameters` shape). */
  parameters: Record<string, unknown>;
}

/** Normalized usage — see docs/agent.md. input excludes cached tokens. */
export interface NormUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TurnRequest {
  keyProvider: KeyProvider;
  apiKey: string;
  baseUrl: string;
  /** Provider wire id (registry wireId()). */
  model: string;
  system: string;
  messages: ChatMsg[];
  tools: ToolDef[];
  onTextDelta?: (delta: string) => void;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: NormUsage;
}
