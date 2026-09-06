# Telegram Gemini Assistant

A production-ready Telegram personal AI assistant backed by Google Gemini and PostgreSQL. Send the bot a normal message, and it responds naturally while keeping each Telegram user and chat isolated.

## What is included

- Telegram commands: `/start`, `/help`, `/clear`, `/reset`, `/status`, and `/personality`
- Persistent personality modes through `/personality`: Playful & chatty, Balanced, Focused, and Professional
- Persistent PostgreSQL conversation memory
- Configurable context window so history is never sent without a limit
- Google Gemini through the official `@google/genai` SDK
- Optional Telegram user allowlist
- Per-user rate limiting
- Telegram typing indicator refreshed while Gemini is generating
- Safe splitting for Telegram's 4,096-character message limit
- Polling for local development or a configurable webhook for a stable HTTPS deployment
- Friendly user-facing errors with technical details kept in server logs
- Strict TypeScript and automated unit/endpoint tests

The default personality is **Playful & chatty**. Users can run `/personality` to open an inline keyboard and choose a different tone. The selected mode is saved per Telegram user and included as Gemini personality guidance without being written into the conversation transcript.

## Architecture

```text
Telegram user
  -> grammY Telegram bot
  -> authorization + rate limit
  -> PostgreSQL conversation repository
  -> GeminiService (@google/genai)
  -> PostgreSQL response record
  -> Telegram response
```

The API server exposes:

- `GET /api/healthz` (also available at `GET /api/health`)
- `POST /api/telegram/webhook` when webhook mode is enabled

## Requirements

- Node.js 24 and pnpm
- A Telegram bot token from BotFather
- A Google Gemini API key
- A PostgreSQL database (Replit Database supplies `DATABASE_URL` automatically)

## Replit setup

Add these values through the Replit Secrets/environment UI. Never paste them into source code:

| Name | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | BotFather token |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string; provision a Replit database |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.5-flash` |
| `ALLOWED_TELEGRAM_USER_IDS` | No | Comma-separated Telegram user IDs; empty allows everyone |
| `MAX_HISTORY_MESSAGES` | No | Defaults to 20 messages |
| `RATE_LIMIT_MAX_REQUESTS` | No | Defaults to 6 requests |
| `RATE_LIMIT_WINDOW_MS` | No | Defaults to 60,000 ms |
| `GEMINI_TIMEOUT_MS` | No | Defaults to 45,000 ms |
| `TELEGRAM_WEBHOOK_URL` | No | Full public HTTPS URL for webhook mode |
| `TELEGRAM_WEBHOOK_SECRET` | No | Optional secret token for webhook requests |
| `PORT` | No | Supplied by Replit's workflow |

The project already has the API workflow configured:

```bash
pnpm --filter @workspace/api-server run dev
```

## Database

After `DATABASE_URL` is available, create/update the tables with:

```bash
pnpm --filter @workspace/db run push
```

The schema contains:

- `users`: Telegram profile metadata
- `conversations`: one isolated conversation per Telegram user and chat
- `messages`: ordered `user` and `model` messages

Indexes cover Telegram identity, conversation lookup, and recent message retrieval.

## Local development

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
```

Polling is selected automatically when `TELEGRAM_WEBHOOK_URL` is empty. The process removes any previous Telegram webhook before starting polling, so both update mechanisms cannot be active at once.

For a stable public HTTPS deployment, set `TELEGRAM_WEBHOOK_URL` to:

```text
https://your-public-domain.example/api/telegram/webhook
```

The process registers that webhook on startup and does not start polling.

## Testing and checks

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
pnpm run typecheck
pnpm run build
```

The tests mock Gemini and do not make real Telegram or Gemini requests.

## Telegram setup

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`.
3. Choose a display name and unique username ending in `bot`.
4. Save the token in the `TELEGRAM_BOT_TOKEN` Replit Secret.
5. Start the Replit workflow.
6. Open the bot in Telegram and send `/start`.

### Find your Telegram user ID

Message `@userinfobot` in Telegram. It replies with your numeric user ID. Put that number in `ALLOWED_TELEGRAM_USER_IDS` to make the bot private. Multiple IDs are comma-separated:

```text
123456789,987654321
```

If the variable is empty, the bot allows all Telegram users.

## Gemini setup

Create a Gemini API key in Google AI Studio and save it as the `GEMINI_API_KEY` Replit Secret. To change models later, set `GEMINI_MODEL` without changing application code.

## Deployment

1. Provision PostgreSQL and confirm `DATABASE_URL` exists.
2. Add the Telegram and Gemini secrets.
3. Run the database push command once.
4. For a deployment with a stable public HTTPS URL, set `TELEGRAM_WEBHOOK_URL`.
5. Publish the Replit project.
6. Send `/start` to the bot and then test a memory exchange:
   - `My name is ...`
   - `What is my name?`

## Security notes

- Credentials are read only from environment variables.
- Secrets are never logged or sent to Telegram.
- SQL is generated through Drizzle's parameterized query builder.
- Conversation queries always scope by both Telegram user ID and chat ID.
- User-facing errors intentionally avoid stack traces and infrastructure details.