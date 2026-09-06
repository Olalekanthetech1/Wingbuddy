---
name: Telegram bot runtime
description: Non-obvious grammY and esbuild constraints for this project's Telegram service.
---

The Telegram server bundle must externalize `grammy` so Node resolves grammY's platform adapter files from the package installation. The webhook callback must only be created when `TELEGRAM_WEBHOOK_URL` is configured because grammY's callback replaces `bot.start()` and otherwise blocks polling.

**Why:** Bundling grammY caused a runtime `platform.node` resolution failure, and initializing the webhook adapter during polling mode made grammY reject the subsequent `bot.start()` call.

**How to apply:** If the server build or update transport changes, preserve the external package entry and keep webhook callback registration conditional on the selected transport.