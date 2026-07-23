import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AgentTool, ToolOutput } from './tool.types';

const PER_HIT_CHARS = 2000;

@Injectable()
export class WebSearchTool implements AgentTool {
  readonly def = {
    name: 'web_search',
    description:
      'Search the web. Returns up to 6 results with title, URL and extracted page content. ' +
      'Use focused queries; search multiple angles for thorough research.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolOutput> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey)
      throw new ServiceUnavailableException(
        'Search is not configured (TAVILY_API_KEY)',
      );
    const query = String(args.query ?? '').slice(0, 400);

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 6,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };

    const hits = body.results ?? [];
    const content = hits.length
      ? hits
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? '').slice(0, PER_HIT_CHARS)}`,
          )
          .join('\n\n')
      : 'No results.';

    return { content, summary: `${hits.length} results for “${query}”` };
  }
}
