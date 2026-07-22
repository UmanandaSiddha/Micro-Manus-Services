import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { KeyProvider } from '../models/registry';
import { encrypt, hint } from './crypto';

export const PROVIDER_BASE_URLS: Record<KeyProvider, string> = {
  openai: 'https://api.openai.com/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

interface ProbeResult {
  provider: KeyProvider;
  baseUrl: string;
  models: string[];
}

@Injectable()
export class KeysService {
  constructor(private readonly db: DatabaseService) {}

  async addKey(userId: string, apiKey: string, provider?: KeyProvider, baseUrl?: string) {
    const probe = await this.probe(apiKey, provider, baseUrl);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO api_keys (user_id, provider, base_url, key_ciphertext, key_hint, models)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         base_url = EXCLUDED.base_url,
         key_ciphertext = EXCLUDED.key_ciphertext,
         key_hint = EXCLUDED.key_hint,
         models = EXCLUDED.models,
         created_at = now()
       RETURNING id`,
      [userId, probe.provider, probe.baseUrl, encrypt(apiKey), hint(apiKey), JSON.stringify(probe.models)],
    );
    return { id: row!.id, provider: probe.provider, keyHint: hint(apiKey), models: probe.models };
  }

  async listKeys(userId: string) {
    return this.db.query(
      `SELECT id, provider, key_hint, models, created_at FROM api_keys
       WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
  }

  async deleteKey(userId: string, id: string) {
    const rows = await this.db.query(
      `DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    if (!rows.length) throw new NotFoundException();
    return { ok: true };
  }

  /**
   * Validate the key against the provider and learn which models it reaches.
   * Detection order: explicit provider → key-prefix heuristic → probe cascade.
   */
  private async probe(apiKey: string, provider?: KeyProvider, baseUrl?: string): Promise<ProbeResult> {
    const candidates: KeyProvider[] = provider
      ? [provider]
      : apiKey.startsWith('sk-ant-')
        ? ['anthropic']
        : apiKey.startsWith('sk-or-')
          ? ['openrouter']
          : ['openai', 'moonshot', 'openrouter', 'anthropic'];

    const errors: string[] = [];
    for (const p of candidates) {
      const base = baseUrl && candidates.length === 1 ? baseUrl : PROVIDER_BASE_URLS[p];
      try {
        const models = await this.fetchModels(p, base, apiKey);
        return { provider: p, baseUrl: base, models };
      } catch (e) {
        errors.push(`${p}: ${(e as Error).message}`);
      }
    }
    throw new BadRequestException(
      `Could not validate this key against any provider. ${errors.join(' | ')}`,
    );
  }

  private async fetchModels(p: KeyProvider, base: string, apiKey: string): Promise<string[]> {
    // OpenRouter's /models is PUBLIC — it would "validate" any key. Its /key
    // endpoint is authenticated; a valid OR key unlocks the whole registry,
    // so no model list is needed.
    if (p === 'openrouter') {
      const res = await fetch(`${base.replace(/\/$/, '')}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return [];
    }

    const url = `${base.replace(/\/$/, '')}/models`;
    const headers: Record<string, string> =
      p === 'anthropic'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${apiKey}` };

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }
}
