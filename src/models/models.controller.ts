import { Controller, Get } from '@nestjs/common';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';
import { KeyProvider, modelsForKey } from './registry';

@Controller('models')
export class ModelsController {
  constructor(private readonly db: DatabaseService) {}

  /** Registry ∩ models the user's stored keys can reach. */
  @Get()
  async models(@User() userId: string) {
    const keys = await this.db.query<{ provider: KeyProvider; models: string[] }>(
      `SELECT provider, models FROM api_keys WHERE user_id = $1`,
      [userId],
    );

    const seen = new Map<
      string,
      { id: string; label: string; vendor: string; contextWindow: number; pricing: object; via: KeyProvider }
    >();
    for (const key of keys) {
      for (const m of modelsForKey(key.provider, key.models)) {
        // Direct vendor key wins over openrouter for the same model (cheaper, native caching)
        if (!seen.has(m.id) || seen.get(m.id)!.via === 'openrouter') {
          seen.set(m.id, {
            id: m.id,
            label: m.label,
            vendor: m.vendor,
            contextWindow: m.contextWindow,
            pricing: m.pricing,
            via: key.provider,
          });
        }
      }
    }
    return { models: [...seen.values()] };
  }
}
