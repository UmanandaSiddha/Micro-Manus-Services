import Anthropic from '@anthropic-ai/sdk';
import { ChatMsg, TurnRequest, TurnResult } from './types';

/**
 * Native Anthropic SDK path. Required because the OpenAI-compat shim drops
 * cache_control — without explicit breakpoints the cache token columns stay
 * zero forever (a graded requirement). See docs/agent.md.
 */
export async function streamAnthropicTurn(req: TurnRequest): Promise<TurnResult> {
  const client = new Anthropic({ apiKey: req.apiKey });

  const stream = client.messages.stream({
    model: req.model,
    max_tokens: 8192,
    system: [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ],
    messages: withCacheBreakpoint(toAnthropicMessages(req.messages)),
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    })),
  });

  stream.on('text', (delta) => req.onTextDelta?.(delta));

  const final = await stream.finalMessage();

  let text = '';
  const toolCalls: TurnResult['toolCalls'] = [];
  for (const block of final.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: JSON.stringify(block.input) });
    }
  }

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: final.usage.input_tokens, // already excludes cached
      outputTokens: final.usage.output_tokens,
      cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

type AMsg = Anthropic.MessageParam;

/**
 * Convert internal (OpenAI-flavored) history to Anthropic blocks.
 * Consecutive tool results MUST merge into a single user message.
 */
function toAnthropicMessages(messages: ChatMsg[]): AMsg[] {
  const out: AMsg[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId!,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const t of m.toolCalls) {
        content.push({
          type: 'tool_use',
          id: t.id,
          name: t.name,
          input: JSON.parse(t.args || '{}') as Record<string, unknown>,
        });
      }
      out.push({ role: 'assistant', content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** Second breakpoint (after system): last block of the newest message. */
function withCacheBreakpoint(messages: AMsg[]): AMsg[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  if (typeof last.content === 'string') {
    last.content = [
      { type: 'text', text: last.content, cache_control: { type: 'ephemeral' } },
    ];
  } else if (Array.isArray(last.content) && last.content.length) {
    const block = last.content[last.content.length - 1] as { cache_control?: unknown };
    block.cache_control = { type: 'ephemeral' };
  }
  return messages;
}
