# MicroManus server (NestJS 10)

Backend of the MicroManus deep-research agent. **Spec: `../docs/backend.md`** (modules, conventions) — plus per-subsystem docs: `agent.md` (loop, tools, usage normalization), `database.md` (DDL + atomic patterns), `billing.md` (credits, pricing registry), `memory.md`, `artifacts.md`, `api.md` (endpoints + frozen SSE contract). Root context: `../CLAUDE.md`.

## Rules of this app

- **Raw SQL** via `DatabaseService` (`db.query(sql, params)`, `db.tx(fn)`), always parameterized. Schema changes only through dbmate migrations in `db/migrations/` (this folder; `npm run db:up`).
- This folder owns ALL backend artifacts: `src/`, `db/migrations/`, `docker-compose.yml`, `.env`. Never create backend files at the repo root.
- Money/credit invariants use the exact atomic SQL patterns in `docs/database.md` (deduct `WHERE credits > 0 RETURNING`; grants gated on `ON CONFLICT DO NOTHING RETURNING`). Deviating is a bug even if it "works".
- User LLM keys: encrypt/decrypt only via `crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`). Responses carry `key_hint` only. Never log keys or ciphertext.
- LLM calls only through `LlmClient` — OpenAI SDK w/ `baseURL` for openai/moonshot/openrouter, **native Anthropic SDK** for anthropic (cache_control requires it). Usage normalized per the table in `docs/agent.md`; `cost_usd` computed at write time from `models/registry.ts`.
- Agent runs execute as BullMQ jobs (queue `agent-runs`); every step persists to `runs.steps` before the next begins; events publish to Redis `run:{runId}` and the SSE controller replays steps then subscribes.
- Stripe webhook: `rawBody` for signature verification; idempotent via `stripe_events`.
- Validation: class-validator DTO on every POST; ownership check on every `:id` route; `fetch_url` blocks private/localhost targets.
- Interfaces only where two implementations exist (`LlmProvider`, `ArtifactHandler`). No speculative abstraction, no new deps without justification.

## Dev

```sh
npm run start:dev        # :4000 (needs docker compose up + dbmate up first)
npm run test             # jest — keep the few tests that exist green
```

Env vars: full table in `docs/deployment.md`; startup asserts all required vars.
