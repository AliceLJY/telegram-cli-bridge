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

### Inline Keyboard Buttons

**Session picker** — tap `/sessions`, get a list of buttons. Tap to restore any session:

> `/sessions` 弹出按钮列表，点一下恢复对应会话，不用打字。

```
┌─────────────────────────────────┐
│ 02-24 03:07  帮我看看这个报错...  │
├─────────────────────────────────┤
│ 02-23 22:15  写一篇关于AI的...    │
├─────────────────────────────────┤
│ 02-23 18:30  检查worker状态...   │
├─────────────────────────────────┤
│ 🆕 开新会话                      │
└─────────────────────────────────┘
```

**Smart quick replies** — when CC asks a yes/no question, buttons appear automatically:

> CC 问「要吗？」「继续吗？」时自动弹出按钮，点一下回复。

```
CC: 要把这段代码重构成两个函数吗？

        ┌──────┐  ┌──────┐
        │  要  │  │ 不要 │
        └──────┘  └──────┘
```

Detected patterns: 要吗 / 好吗 / 是吗 / 对吗 / 可以吗 / 继续吗 / 确认吗 + numbered options (1. 2. 3.)

> 自动检测：要吗、好吗、是吗、对吗、可以吗、继续吗、确认吗，以及编号选项。

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

### Multi-Frontend Architecture

The task-api backend supports multiple frontends simultaneously. You can use both Discord and Telegram as entry points to the same Claude Code worker:

> task-api 后端同时支持多个前端入口。Discord 和 Telegram 可以同时连接同一个 CC Worker，相当于两个独立的 CC 窗口。

```
Discord  ──→ openclaw-cc-bridge ──┐
                                  ├──→ task-api ──→ CC Worker ──→ Claude Code
Telegram ──→ telegram-cc-bridge ──┘
```

Each frontend maintains its own session. Run both and you get two independent CC windows — one on Discord, one on Telegram.

## Ecosystem

This bridge is part of a personal AI infrastructure built around Claude Code and [OpenClaw](https://openclaw.com). Each project handles one layer — from task execution to content publishing. They work independently, but together they form a complete remote-first AI workflow.

> 这个桥是围绕 Claude Code 和 OpenClaw 搭建的个人 AI 基础设施的一部分。每个项目负责一层——从任务执行到内容发布。可以独立使用，组合起来就是完整的远程 AI 工作流。

```
                          ┌─ telegram-cc-bridge (you are here)
                          │     Telegram → async tasks
        ┌─────────────┐   │
Phone ──┤  task-api    ├───┼─ openclaw-cc-bridge
        │  (worker)    │   │     Discord → CC commands
        └──────┬───────┘   │
               │           └─ openclaw-cc-pipeline
         Claude Code            Multi-turn orchestration
               │
        ┌──────┴───────┐
        │   Skills     │
        ├──────────────┤
        │ content-     │──→ WeChat articles
        │ alchemy      │
        ├──────────────┤
        │ digital-     │──→ AI personas
        │ clone-skill  │
        └──────────────┘
```

| Project | Layer | What it does |
|---------|-------|-------------|
| **[openclaw-worker](https://github.com/AliceLJY/openclaw-worker)** | Backend | Security-first task queue + CC Worker. The engine behind all bridges — deploy on cloud or local Docker |
| **[telegram-cc-bridge](https://github.com/AliceLJY/telegram-cc-bridge)** | Frontend | *This project.* Telegram as async remote control for Claude Code |
| **[openclaw-cc-bridge](https://github.com/AliceLJY/openclaw-cc-bridge)** | Frontend | Discord as remote control for Claude Code, via OpenClaw Bot plugin |
| **[openclaw-cc-pipeline](https://github.com/AliceLJY/openclaw-cc-pipeline)** | Orchestration | Multi-turn Claude Code sessions from Discord — complex tasks, step by step |
| **[content-alchemy](https://github.com/AliceLJY/content-alchemy)** | Skill | 7-stage content pipeline: Research → Analysis → Writing → Illustration → WeChat Publishing |
| **[openclaw-content-alchemy](https://github.com/AliceLJY/openclaw-content-alchemy)** | Skill (Bot) | Content Alchemy packaged for OpenClaw bots — 56 art styles, auto-rotation |
| **[digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill)** | Skill | 6-stage workflow to create AI digital clones from corpus data |

> All projects are MIT licensed and built by one person with zero programming background — proof that AI tools can genuinely empower non-developers.
>
> 所有项目 MIT 开源，由一个零编程基础的人独立搭建——AI 工具确实能赋能非开发者。

## Author

**小试AI** — WeChat Public Account「我的AI小木屋」

Not a developer. Medical background, works in cultural administration, self-taught AI the hard way. Writes about AI hands-on experience, real-world pitfalls, and the human side of technology.

> 医学出身，文化口工作，AI 野路子。公众号记录 AI 实操、踩坑、人文思考。

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

[MIT](LICENSE)
