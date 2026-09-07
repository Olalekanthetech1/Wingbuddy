---
name: Assistant UX foundation
description: Durable product boundary between communication personality, task mode, and deferred assistant capabilities.
---

Personality controls how the assistant communicates; assistant mode controls how it approaches a task. Keep those settings independent and persist them separately per Telegram user.

**Why:** Combining tone and task behavior makes the Telegram menu harder to understand and makes future modes difficult to extend without disturbing existing personality choices.

**How to apply:** Add new task approaches under modes and new communication styles under personalities. Menu entries for capabilities not yet implemented should explain their status rather than pretending to perform the action.