# Telegram CC Bridge

Async bridge between Telegram and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via task-api.

> 通过 Telegram 远程异步操控 Claude Code — 发消息、锁屏走人、完成后收通知。零 AI 中间层，纯管道。

## Architecture

```
Phone (Telegram) → Telegram Bot (local, Bun) → task-api:3456 → CC Worker → Claude Code
                         ↑ poll result & send back to Telegram
```

## Features

- **Text messages** — send any prompt to Claude Code
- **Photos** — send images for CC to analyze (multimodal)
- **Documents** — send PDF, code, text files for CC to read
- **Voice** — send voice messages
- **Session persistence** — messages in the same conversation share CC context
- **Auto session timeout** — 2 hours idle → auto new session
- **Inline keyboard** — tap buttons for yes/no questions and session switching
- **Session resume** — `/sessions` shows recent sessions with tap-to-restore
- **Owner-only** — silently ignores messages from anyone else
- **Auto file cleanup** — downloaded files deleted after 24 hours
- **Proxy support** — for regions where Telegram API is blocked

## Prerequisites

- [Bun](https://bun.sh) runtime
- A running [task-api](https://github.com/anthropics/claude-code) + CC Worker setup
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-cc-bridge.git
cd telegram-cc-bridge
bun install

cp .env.example .env
# Edit .env with your bot token and config
```

## Usage

```bash
# Run directly
bun bridge.js

# Or with PM2
pm2 start bridge.js --name telegram-cc-bridge --interpreter bun
```

### macOS LaunchAgent (recommended)

See `com.telegram-cc-bridge.plist` for auto-start on login with crash recovery.

### Commands

| Command | Description |
|---------|-------------|
| `/sessions` | List recent CC sessions with tap-to-restore buttons |
| `/new` | Reset current session, next message starts fresh |
| `/status` | Check task-api health and current session |

### Sending files

Use the Telegram paperclip (📎) button to send:
- **Photos** — CC reads images (multimodal)
- **PDF / text / code** — CC reads file content
- **Voice** — CC processes audio

Add a caption to tell CC what to do with the file.

## How it works

1. You send a message to the Telegram bot
2. Bridge posts to `task-api /claude` endpoint
3. CC Worker picks up the task, runs Claude Code
4. Bridge polls for result (long-polling, up to 10 min)
5. Result sent back to your Telegram chat
6. Session ID is remembered for follow-up messages

## License

MIT
