import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { decrypt } from '../keys/crypto';
import { KeyProvider, ModelEntry, wireId } from '../models/registry';
import { streamAnthropicTurn } from './anthropic.provider';
import { streamOpenAiCompatTurn } from './openai-compat.provider';
import { TurnRequest, TurnResult } from './types';

export interface ResolvedKey {
  provider: KeyProvider;
  baseUrl: string;
  apiKey: string;
}

@Injectable()
export class LlmService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Pick the key to use for a model: the vendor's own key when stored
   * (native caching, no markup), otherwise an OpenRouter key.
   */
  async resolveKey(userId: string, model: ModelEntry): Promise<ResolvedKey> {
    const rows = await this.db.query<{
      provider: KeyProvider;
      base_url: string;
      key_ciphertext: string;
    }>(
      `SELECT provider, base_url, key_ciphertext FROM api_keys
       WHERE user_id = $1 AND provider IN ($2, 'openrouter')
       ORDER BY CASE provider WHEN $2 THEN 0 ELSE 1 END
       LIMIT 1`,
      [userId, model.vendor],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(
        `No API key stored that can run ${model.label}`,
      );
    }
    return {
      provider: row.provider,
      baseUrl: row.base_url,
      apiKey: decrypt(row.key_ciphertext),
    };
  }

  streamTurn(
    key: ResolvedKey,
    model: ModelEntry,
    req: Omit<TurnRequest, 'keyProvider' | 'apiKey' | 'baseUrl' | 'model'>,
  ): Promise<TurnResult> {
    const full: TurnRequest = {
      ...req,
      keyProvider: key.provider,
      apiKey: key.apiKey,
      baseUrl: key.baseUrl,
      model: wireId(model, key.provider),
    };
    return key.provider === 'anthropic'
      ? streamAnthropicTurn(full)
      : streamOpenAiCompatTurn(full);
  }
}
