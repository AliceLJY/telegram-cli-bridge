# Telegram CC Bridge

Async bridge between Telegram and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via task-api. Zero AI middleware, pure pipe.

> 通过 Telegram 远程异步操控 Claude Code — 发消息、锁屏走人、完成后收通知。零 AI 中间层，纯管道。

## Architecture

```
Phone (Telegram) → Telegram Bot (local, Bun) → task-api:3456 → CC Worker → Claude Code
                         ↑ poll result & send back to Telegram
```

## Features

| Feature | Description |
|---------|-------------|
| **Text** | Send any prompt to Claude Code |
| **Photos** | Send images for CC to analyze (multimodal) |
| **Documents** | Send PDF, code, text files for CC to read |
| **Voice** | Send voice messages |
| **Session persistence** | Messages in the same conversation share CC context |
| **Session resume** | `/sessions` shows recent sessions with tap-to-restore buttons |
| **Auto session timeout** | 2 hours idle → auto new session |
| **Inline keyboard** | Tap buttons for yes/no questions and session switching |
| **Owner-only** | Silently ignores messages from anyone else |
| **Auto file cleanup** | Downloaded files deleted after 24 hours |
| **Proxy support** | For regions where Telegram API is blocked |

> 支持文字、图片、文档、语音；会话自动续接 + 按钮式交互；文件 24 小时自动清理；仅主人可用。

## Prerequisites

- [Bun](https://bun.sh) runtime (or Node.js)
- A running task-api + CC Worker (see [openclaw-worker](https://github.com/AliceLJY/openclaw-worker))
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

> 需要 Bun 运行时、task-api + Worker 后端、Telegram Bot Token。

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-cc-bridge.git
cd telegram-cc-bridge
bun install

cp .env.example .env
# Edit .env with your bot token and config
# 编辑 .env 填入你的 Bot Token 和配置
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `OWNER_TELEGRAM_ID` | Your Telegram user ID (only you can use the bot) |
| `TASK_API_URL` | task-api endpoint (default: `http://localhost:3456`) |
| `TASK_API_TOKEN` | task-api auth token |
| `HTTPS_PROXY` | Proxy for Telegram API (optional, for blocked regions) |

## Usage

```bash
# Run directly / 直接运行
bun bridge.js

# Or with PM2 / 或用 PM2 守护
pm2 start bridge.js --name telegram-cc-bridge --interpreter bun
```

### macOS LaunchAgent (recommended)

For auto-start on login with crash recovery, create `~/Library/LaunchAgents/com.telegram-cc-bridge.plist`:

> macOS 推荐用 LaunchAgent 守护进程，开机自启 + 崩溃自动重启。

```xml
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram-cc-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>/path/to/telegram-cc-bridge/bridge.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

### Commands

| Command | Description |
|---------|-------------|
| `/sessions` | List recent CC sessions with tap-to-restore buttons |
| `/new` | Reset current session, next message starts fresh |
| `/status` | Check task-api health and current session |

> `/sessions` 列出历史会话（按钮点选恢复）；`/new` 重置会话；`/status` 查状态。

### Sending Files

Use the Telegram paperclip button to send:

| Type | Support | CC Handling |
|------|---------|-------------|
| Photos | ✅ | CC reads images (multimodal) |
| PDF / text / code | ✅ | CC reads file content |
| Voice | ✅ | CC processes audio |
| Video | ❌ | Prompt to send screenshot instead |

Add a caption to tell CC what to do with the file.

> 用回形针按钮发送文件，附上说明文字告诉 CC 要干嘛。

## How It Works

```
1. You send a message         →  Telegram Bot receives it
2. Bridge POSTs to task-api   →  /claude endpoint, with sessionId
3. CC Worker picks up task    →  Runs Claude Code CLI (--resume if session exists)
4. Bridge polls for result    →  Long-polling, up to 10 minutes
5. Result sent back           →  Telegram chat, with smart buttons if applicable
6. Session remembered         →  Follow-up messages share context
```

## Ecosystem

> 这些项目配合使用效果更好 / Better together with these projects:

- [openclaw-worker](https://github.com/AliceLJY/openclaw-worker) — Task queue + CC Worker that powers this bridge
- [openclaw-cc-bridge](https://github.com/AliceLJY/openclaw-cc-bridge) — Discord → Claude Code bridge (via OpenClaw Bot)
- [openclaw-cc-pipeline](https://github.com/AliceLJY/openclaw-cc-pipeline) — Multi-turn Claude Code orchestration via Discord
- [content-alchemy](https://github.com/AliceLJY/content-alchemy) — 7-stage content pipeline, from idea to WeChat article
- [digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill) — Create digital clones from corpus data

## Author

**小试AI** — WeChat Public Account「我的AI小木屋」

> 医学出身，文化口工作，AI 野路子。公众号记录 AI 实操、踩坑、人文思考。

## License

[MIT](LICENSE)
