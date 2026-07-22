/**
 * Model + pricing registry. Prices are USD per 1M tokens, captured from live
 * sources (OpenRouter /api/v1/models + provider pricing pages) on 2026-07-22.
 * cost_usd is computed at usage-write time, so editing prices here never
 * rewrites history.
 */
export type KeyProvider = 'openai' | 'anthropic' | 'moonshot' | 'openrouter';

export interface ModelEntry {
  /** Canonical id — stored in usage_events.model_id and threads.model_id. */
  id: string;
  label: string;
  vendor: 'anthropic' | 'openai' | 'moonshot';
  contextWindow: number;
  /** Wire ids per key provider. `direct` = the vendor's own API. */
  ids: { direct: string; openrouter: string };
  /** USD per 1M tokens. */
  pricing: { in: number; out: number; cacheRead: number; cacheWrite: number };
}

export const MODELS: ModelEntry[] = [
  // ── Anthropic ─────────────────────────────────────────────────────────
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    vendor: 'anthropic',
    contextWindow: 1_000_000,
    ids: { direct: 'claude-opus-4-8', openrouter: 'anthropic/claude-opus-4.8' },
    pricing: { in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    vendor: 'anthropic',
    contextWindow: 1_000_000,
    ids: { direct: 'claude-sonnet-5', openrouter: 'anthropic/claude-sonnet-5' },
    // Intro pricing ($2/$10) in effect through 2026-08-31; matches what
    // providers actually bill today. Standard is $3/$15.
    pricing: { in: 2.0, out: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    vendor: 'anthropic',
    contextWindow: 200_000,
    ids: { direct: 'claude-haiku-4-5', openrouter: 'anthropic/claude-haiku-4.5' },
    pricing: { in: 1.0, out: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  // ── OpenAI ────────────────────────────────────────────────────────────
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    vendor: 'openai',
    contextWindow: 1_050_000,
    ids: { direct: 'gpt-5.6-sol', openrouter: 'openai/gpt-5.6-sol' },
    pricing: { in: 5.0, out: 30.0, cacheRead: 0.5, cacheWrite: 0 },
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    vendor: 'openai',
    contextWindow: 1_050_000,
    ids: { direct: 'gpt-5.6-terra', openrouter: 'openai/gpt-5.6-terra' },
    pricing: { in: 2.5, out: 15.0, cacheRead: 0.25, cacheWrite: 0 },
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    vendor: 'openai',
    contextWindow: 1_050_000,
    ids: { direct: 'gpt-5.6-luna', openrouter: 'openai/gpt-5.6-luna' },
    pricing: { in: 1.0, out: 6.0, cacheRead: 0.1, cacheWrite: 0 },
  },
  // ── Moonshot (Kimi) ───────────────────────────────────────────────────
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    vendor: 'moonshot',
    contextWindow: 1_048_576,
    ids: { direct: 'kimi-k3', openrouter: 'moonshotai/kimi-k3' },
    pricing: { in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 0 },
  },
  {
    id: 'kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    vendor: 'moonshot',
    contextWindow: 262_144,
    ids: { direct: 'kimi-k2.7-code', openrouter: 'moonshotai/kimi-k2.7-code' },
    pricing: { in: 0.82, out: 3.75, cacheRead: 0.16, cacheWrite: 0 },
  },
];

const VENDOR_TO_KEY_PROVIDER: Record<ModelEntry['vendor'], KeyProvider> = {
  anthropic: 'anthropic',
  openai: 'openai',
  moonshot: 'moonshot',
};

/** The wire id to send for a model given which provider's key is used. */
export function wireId(model: ModelEntry, keyProvider: KeyProvider): string {
  return keyProvider === 'openrouter' ? model.ids.openrouter : model.ids.direct;
}

/**
 * Which registry models a stored key unlocks. OpenRouter unlocks everything;
 * a direct key unlocks its vendor's models. We deliberately DON'T intersect
 * with the probed /models list — provider catalogs use ids that rarely match
 * our canonical ids exactly, and intersecting there would leave the picker
 * empty for a perfectly valid key. The key already proved itself at probe time.
 */
export function modelsForKey(provider: KeyProvider, _reportedIds: string[]): ModelEntry[] {
  if (provider === 'openrouter') return MODELS;
  return MODELS.filter((m) => VENDOR_TO_KEY_PROVIDER[m.vendor] === provider);
}

export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}
