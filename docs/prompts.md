# Prompt configuration

This bot uses Discord-aware prompts with per-channel overrides. Prompts are composed at runtime to keep responses chat-friendly and respectful of channel norms.

## Defaults

- **System prompt (default)**: Discord-native formatting guidance that enforces bold headings, bullet lists, inline code for commands/identifiers, fenced code blocks with language tags, short paragraphs, and absolute timestamps (`<t:UNIX:f>` for full date+time display). Confirms side effects before acting and never mentions internal tools or models.
- **Personality (default)**: bubbly, witty, lightly humorous. Delivers tight, skimmable content with quick code examples when helpful. Respects channel norms.
- **Trigger names**: configured via `BOT_TRIGGER_NAMES` (comma-separated, lowercased), optional.

## Merge rules for channel overrides

Overrides can **replace**, **append**, or **clear** the defaults on a per-channel basis:

- **System prompt**:
  - `replace`: use only the provided text.
  - `append`: keep the default, then append the provided text.
  - `clear`: remove the system prompt for this channel.
- **Chat model**:
  - Must be in the allowlist (`OPENROUTER_ALLOWED_CHAT_MODELS`).
  - If not provided or invalid, the default `OPENROUTER_MODEL_CHAT` is used.
- **Trigger names**:
  - `replace`: use only the provided list.
  - `append`: merge provided names with defaults (deduplicated, lowercased).
  - `clear`: remove channel trigger names (bot still responds to mentions/replies and its username).

The resulting prompt stack includes the system prompt (if any), personality, example messages (if configured), conversation summary (if available), and recent messages.

## Admin slash commands

All commands require the **Manage Server** permission and apply to the channel they are run in.

- `/set-system-prompt action:<replace|append|clear> prompt:<text?>`
  - `prompt` is required for `replace` and `append`.
- `/set-chat-model model:<name>`
  - Must match the allowlist; replies with an error otherwise.
- `/set-trigger-names action:<replace|append|clear> names:<comma-separated?>`
  - `names` is required for `replace` and `append` (comma-separated).

Replies to these commands are ephemeral.

## Examples

- Append a safety note to the system prompt in #support:
  ```
  /set-system-prompt action:append prompt:"Keep answers under 8 lines; avoid spoilers."
  ```
- Set a faster model for #low-traffic:
  ```
  /set-chat-model model:openai/gpt-4o-mini
  ```
- Replace trigger names in #coding-help:
  ```
  /set-trigger-names action:replace names:"helper bot, codey"
  ```
