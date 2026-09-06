# Telegram Gemini Assistant

A Telegram personal AI assistant that keeps isolated PostgreSQL conversation memory and uses Google Gemini for natural replies.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the Telegram/Gemini API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — run bot service and health endpoint tests
- Required secrets: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`
- Required runtime env: `DATABASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/telegram` — grammY bot, commands, webhook/polling startup, typing indicator
- `artifacts/api-server/src/gemini` — official Google GenAI service
- `artifacts/api-server/src/services` — authorization, rate limiting, and conversation persistence
- `artifacts/api-server/src/utils` — Telegram-safe message splitting
- `lib/db/src/schema/index.ts` — PostgreSQL source-of-truth schema
- `artifacts/api-server/tests` — unit and endpoint tests

## Architecture decisions

- Polling is the default for local/Replit development; setting `TELEGRAM_WEBHOOK_URL` switches to webhook mode and prevents duplicate consumers.
- Gemini calls are isolated in `GeminiService`, with a timeout and a configurable model/system instruction.
- Conversations are scoped by Telegram user ID and chat ID, so group chats and separate users cannot share memory.
- The API server keeps user-facing errors generic and logs technical failures server-side.

## Product

Users can message the Telegram bot naturally, choose a persistent personality with `/personality`, revisit context later, clear or reset memory, and restrict access to a private allowlist.

## User preferences

No additional preferences recorded.

## Gotchas

- Run `pnpm --filter @workspace/db run push` after provisioning PostgreSQL and after schema changes.
- Do not place bot tokens, Gemini keys, or database credentials in source control.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
