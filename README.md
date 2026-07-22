# MicroManus

A deep-research AI agent with usage-based billing. Ask a hard question — the agent plans, searches the web, reads sources, reasons in a loop, and writes cited reports you can download as typeset PDFs. Bring your own LLM key (OpenRouter / OpenAI / Anthropic / Kimi) and see exactly what every step cost, split by input / output / cache tokens.

**Stack:** Next.js 16 (client) · NestJS 10 (server) · PostgreSQL + pgvector · Redis + BullMQ · Puppeteer · Stripe (test mode) · Tavily · Voyage AI. No ORM (raw SQL + dbmate), no agent framework (custom loop — raw provider `usage` objects are the point).

## How it works

1. **Sign in** with Google or GitHub (Firebase popup, no passwords).
2. **Unlock** with the coupon `SID_DRDROID` or a $5 test-mode card payment (`4242 4242 4242 4242`) → 5 credits. 1 credit = 1 research run; failed runs auto-refund.
3. **Add your LLM API key** in Settings — auto-detected, AES-256-GCM encrypted, only a hint ever leaves the server. OpenRouter unlocks Claude + GPT + Kimi at once.
4. **Research.** Watch the agent's live trace (searches, page reads, token usage, running cost) stream in. Ask for a report → downloadable typeset PDF with citations.
5. **Dashboard** shows per-chat cost split by input / output / cache-read / cache-write tokens, cache savings, and a what-if comparison across models.

## Run locally

```sh
# infra
cd server
docker compose up -d          # postgres(+pgvector) on 55432, redis on 6379
npm install && npm run db:up  # dbmate migrations

# env — copy and fill (see docs/deployment.md for every var)
cp .env.example .env

# backend
npm run start:dev             # :4000

# frontend
cd ../client && npm install && npm run dev   # :3000

# stripe webhooks (optional, for the card flow)
stripe listen --forward-to localhost:4000/billing/webhook
```

Auth setup (Firebase): enable Google + GitHub providers in the Firebase console, and put the service-account fields in `server/.env` (`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`). The web config lives in `client/lib/firebase.ts` (public by design).

## Repo map

```
client/   Next.js app — landing, paywall, chat + live run timeline, dashboard, settings
server/   NestJS app — auth, billing, BYOK keys, agent loop (BullMQ), tools, artifacts,
          memory (pgvector), usage metering; db/migrations; docker-compose.yml
docs/     the full spec — architecture, agent loop, API contract, billing math, roadmap
```

Read `docs/architecture.md` first; `docs/roadmap.md` has the milestone exit tests and the end-to-end demo script.
