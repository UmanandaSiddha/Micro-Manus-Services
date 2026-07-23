import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { AgentTool, ToolOutput } from './tool.types';

const MAX_CHARS = 8000;

/** SSRF guard: model-supplied URLs must never reach private networks. */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) URLs are allowed');
  }
  const host = url.hostname;
  const ips = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  for (const ip of ips) {
    if (isPrivate(ip))
      throw new BadRequestException('URL resolves to a private address');
  }
  return url;
}

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    // v4-mapped (::ffff:a.b.c.d) → validate the embedded v4 address directly
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivate(mapped[1]);
    // v6: loopback, link-local, unique-local
    return (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fe80') ||
      low.startsWith('fc') ||
      low.startsWith('fd')
    );
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Crude but dependency-free HTML → text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;|&\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

@Injectable()
export class FetchUrlTool implements AgentTool {
  readonly def = {
    name: 'fetch_url',
    description:
      'Fetch a specific web page and return its readable text content. ' +
      'Use after web_search when a result needs deeper reading.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
      },
      required: ['url'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolOutput> {
    let url = await assertPublicHttpUrl(String(args.url ?? ''));
    // Follow redirects MANUALLY, re-validating each hop — otherwise a public
    // host can 302 to 169.254.169.254 / 127.0.0.1 and bypass the SSRF guard.
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'MicroManusBot/1.0 (+research agent)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get('location');
      if (!location || hop >= 5) break;
      url = await assertPublicHttpUrl(new URL(location, url).toString());
    }
    if (!res.ok) {
      return {
        content: `Fetch failed: HTTP ${res.status}`,
        summary: `HTTP ${res.status} — ${url.hostname}`,
      };
    }
    const ct = res.headers.get('content-type') ?? '';
    const raw = (await res.text()).slice(0, 500_000);
    const text = ct.includes('html') ? htmlToText(raw) : raw;
    const clipped = text.slice(0, MAX_CHARS);
    return {
      content: clipped + (text.length > MAX_CHARS ? '\n…[truncated]' : ''),
      summary: `Read ${url.hostname} (${Math.min(text.length, MAX_CHARS)} chars)`,
    };
  }
}
