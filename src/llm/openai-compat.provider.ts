import OpenAI from 'openai';
import { ChatMsg, TurnRequest, TurnResult } from './types';

/**
 * OpenAI / Moonshot / OpenRouter — one OpenAI-compatible code path.
 * For anthropic models routed via OpenRouter, cache_control breakpoints are
 * injected (OpenRouter passes them through; without them cache columns stay 0).
 */
export async function streamOpenAiCompatTurn(req: TurnRequest): Promise<TurnResult> {
  const client = new OpenAI({ apiKey: req.apiKey, baseURL: req.baseUrl });
  const cacheable = req.keyProvider === 'openrouter' && req.model.startsWith('anthropic/');

  const messages = [systemMsg(req.system, cacheable), ...req.messages.map(toWire)];
  if (cacheable) markLastUserBlock(messages);

  const stream = await client.chat.completions.create({
    model: req.model,
    messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
    tools: req.tools.length
      ? req.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined,
    stream: true,
    stream_options: { include_usage: true },
  });

  let text = '';
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let usage: OpenAI.CompletionUsage | undefined;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      text += delta.content;
      req.onTextDelta?.(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const acc = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name += tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      toolAcc.set(tc.index, acc);
    }
    if (chunk.usage) usage = chunk.usage;
  }

  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    text,
    toolCalls: [...toolAcc.values()].filter((t) => t.id && t.name),
    usage: {
      inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
      outputTokens: usage?.completion_tokens ?? 0,
      cacheReadTokens: cached,
      cacheWriteTokens: 0, // no write-premium concept on OpenAI-compatible usage
    },
  };
}

type WireMsg = Record<string, unknown>;

function systemMsg(system: string, cacheable: boolean): WireMsg {
  return cacheable
    ? {
        role: 'system',
        content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      }
    : { role: 'system', content: system };
}

function toWire(m: ChatMsg): WireMsg {
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args },
      })),
    };
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

/** Multi-turn cache pattern: breakpoint on the newest user-side content. */
function markLastUserBlock(messages: WireMsg[]): void {
  for (let i = messages.length - 1; i > 0; i--) {
    const m = messages[i];
    if (m.role === 'user' || m.role === 'tool') {
      m.content = [
        { type: 'text', text: m.content as string, cache_control: { type: 'ephemeral' } },
      ];
      return;
    }
  }
}
