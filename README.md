# telegram-cli-bridge

Telegram → AI CLI bridge via task-api. All backends get **full CLI capabilities** — file access, command execution, tool use.

> Telegram 多后端 AI 桥（task-api 方案）— 所有后端都能获得完整 CLI 能力：读写文件、执行命令、调用工具。

Three bridges for three CLIs — **Claude Code**, **Codex CLI**, **Gemini CLI** — each as an independent Telegram bot backed by task-api.

### Why this bridge?

This is the **task-api approach**: Telegram → task-api → CLI. The CLI runs on your machine with full access to your filesystem and tools.

The companion project **[telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge)** takes the **SDK approach**: Telegram → SDK direct. Faster and real-time, but Gemini is limited to chat-only (Code Assist API can't access local files).

> 姐妹项目 [telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge) 走 SDK 直连，延迟更低、有实时进度，但 Gemini 只能聊天（Code Assist API 不能操作本地文件）。本项目通过 task-api 中转，三个后端都能获得完整 CLI 能力。

**Mix and match**: use telegram-ai-bridge for Claude + Codex (SDK direct, real-time progress), and this bridge for Gemini (full CLI via task-api). Or use whichever you prefer.

| | telegram-ai-bridge (SDK) | telegram-cli-bridge (task-api) |
|---|---|---|
| Connection | SDK direct | task-api relay |
| Claude | Agent SDK — full tool use | task-api → Claude Code CLI |
| Codex | Codex SDK — sandbox execution | task-api → Codex CLI |
| Gemini | Code Assist API — **chat only** | task-api → Gemini CLI — **full CLI** |
| Real-time progress | Yes (streaming) | No (polling) |
| Extra dependency | None | task-api + worker |
| Best for | Claude/Codex primary | Gemini with full CLI, or unified task-api setup |

> 两个桥可以混搭：Claude+Codex 用 ai-bridge（SDK 直连），Gemini 用 cli-bridge（task-api，完整 CLI 能力）。

## Architecture

```
                     ┌─ telegram-ai-bridge (separate repo) → Agent SDK + Codex SDK → Claude Code / Codex
Phone (Telegram) ────┼─ codex-bridge.js (.env.codex)     → task-api /codex  → Codex CLI
                     └─ gemini-bridge.js (.env.gemini)    → task-api /gemini → Gemini CLI
                              ↑ poll result & send back to Telegram
```

Each CLI runs as a separate Telegram bot with its own token and bridge process:
- **Codex**: UUID-based `--resume <sessionId>` — full session restore by ID
- **Gemini**: `--resume latest` only — no UUID support, always resumes last session

## Features

| Feature | Description |
|---------|-------------|
| **Multi-CLI** | Claude Code, Codex CLI, Gemini CLI — each as separate Telegram bot |
| **Text** | Send any prompt to your chosen CLI |
| **Photos** | Send images for analysis (multimodal) |
| **Documents** | Send PDF, code, text files |
| **Voice** | Send voice messages |
| **Session persistence** | Messages in the same conversation share CC context |
| **Session resume** | `/sessions` shows recent sessions with tap-to-restore buttons |
| **Auto session timeout** | 2 hours idle → auto new session |
| **Inline keyboard** | Tap buttons for yes/no questions and session switching |
| **Owner-only** | Silently ignores messages from anyone else |
| **Auto file cleanup** | Downloaded files deleted after 24 hours |
| **Proxy support** | For regions where Telegram API is blocked |

> 支持三种 CLI（Claude Code / Codex / Gemini）；文字、图片、文档、语音；会话自动续接 + 按钮式交互；文件 24 小时自动清理；仅主人可用。

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

- [Bun](https://bun.sh) runtime
- A running task-api + CC Worker (see [openclaw-worker](https://github.com/AliceLJY/openclaw-worker))
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

> 需要 Bun 运行时、task-api + Worker 后端、Telegram Bot Token。

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-cli-bridge.git
cd telegram-cli-bridge
bun install

cp .env.example .env
# Edit .env with your bot token and config
# 编辑 .env 填入你的 Bot Token 和配置
```

### Environment Variables

**For `bridge.js` (Claude Code)** — use `.env`:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `OWNER_TELEGRAM_ID` | Your Telegram user ID (only you can use the bot) |
| `TASK_API_URL` | task-api endpoint (default: `http://localhost:3456`) |
| `TASK_API_TOKEN` | task-api auth token |
| `HTTPS_PROXY` | Proxy for Telegram API (optional, for blocked regions) |

**For `codex-bridge.js`** — use `.env.codex`:
**For `gemini-bridge.js`** — use `.env.gemini`:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | A **separate** bot token (one per CLI) |
| `OWNER_TELEGRAM_ID` | Same as above |
| `TASK_API_URL` | Same task-api endpoint |
| `TASK_API_TOKEN` | Same task-api auth token |
| `HTTPS_PROXY` | Same proxy (optional) |

> 每个 CLI 用独立的 Telegram Bot（独立 token），各自的 bridge 文件已硬编码后端路径，无需额外配置。

## Usage

```bash
# Claude Code (original bridge)
bun bridge.js

# Codex CLI
env $(cat .env.codex | xargs) bun codex-bridge.js

# Gemini CLI
env $(cat .env.gemini | xargs) bun gemini-bridge.js
```

### macOS LaunchAgent (recommended)

For auto-start on login with crash recovery, create `~/Library/LaunchAgents/com.telegram-cli-bridge.plist`:

> macOS 推荐用 LaunchAgent 守护进程，开机自启 + 崩溃自动重启。

```xml
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram-cli-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>/path/to/telegram-cli-bridge/bridge.js</string>
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
| `/sessions` | List recent sessions with tap-to-restore buttons |
| `/new` | Reset current session, next message starts fresh |
| `/status` | Check task-api health and current session |
| `/model` | Switch model (Codex: gpt-5.3-codex, o3, etc. / Gemini: 2.5-flash, 2.5-pro, etc.) |

> `/sessions` 列出历史会话；`/new` 重置；`/status` 查状态；`/model` 切换模型。

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
2. Bridge POSTs to task-api   →  /claude or /codex or /gemini endpoint, with sessionId
3. Worker picks up task       →  Runs the corresponding CLI (--resume if session exists)
4. Bridge polls for result    →  Long-polling, up to 10 minutes
5. Result sent back           →  Telegram chat, with smart buttons if applicable
6. Session remembered         →  Follow-up messages share context
```

### Multi-CLI + Multi-Frontend Architecture

The task-api backend supports multiple CLIs and multiple frontends simultaneously. Run all three Telegram bots + Discord bridge and you get 4+ independent AI coding windows:

> task-api 后端同时支持多种 CLI 和多个前端入口。三个 Telegram bot + Discord bridge 可以同时运行，每个独立会话。

```
Discord  ──→ openclaw-cli-bridge ──────────────────────┐
                                                       │
Telegram (CC bot)     ──→ bridge.js ───────────────────┼──→ task-api ──→ Claude Code
Telegram (Codex bot)  ──→ codex-bridge.js (.env.codex) ┼──→ task-api ──→ Codex CLI
Telegram (Gemini bot) ──→ gemini-bridge.js (.env.gemini)┘──→ task-api ──→ Gemini CLI
```

Each bot maintains its own sessions. Run all of them and you get independent windows into Claude Code, Codex, and Gemini — all from your phone.

## Ecosystem

This bridge is part of a personal AI infrastructure built around Claude Code and [OpenClaw](https://openclaw.com). Each project handles one layer — from task execution to content publishing. They work independently, but together they form a complete remote-first AI workflow.

> 这个桥是围绕 Claude Code 和 OpenClaw 搭建的个人 AI 基础设施的一部分。每个项目负责一层——从任务执行到内容发布。可以独立使用，组合起来就是完整的远程 AI 工作流。

```
                          ┌─ telegram-cli-bridge (you are here)
                          │     Telegram → async tasks
        ┌─────────────┐   │
Phone ──┤  task-api    ├───┼─ openclaw-cli-bridge
        │  (worker)    │   │     Discord → CC commands
        └──────┬───────┘   │
               │           └─ openclaw-cli-pipeline
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
| **[telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge)** | Frontend | Telegram → CC/Codex/Gemini via SDK direct (real-time progress, Gemini chat-only) |
| **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** | Frontend | *This project.* Telegram → CC/Codex/Gemini via task-api (all backends get full CLI) |
| **[openclaw-cli-bridge](https://github.com/AliceLJY/openclaw-cli-bridge)** | Frontend | Discord → CC/Codex/Gemini via OpenClaw Bot plugin |
| **[openclaw-cli-pipeline](https://github.com/AliceLJY/openclaw-cli-pipeline)** | Orchestration | Multi-turn Claude Code sessions from Discord — complex tasks, step by step |
| **[content-alchemy](https://github.com/AliceLJY/content-alchemy)** | Skill | 7-stage content pipeline: Research → Analysis → Writing → Illustration → WeChat Publishing |
| **[openclaw-content-alchemy](https://github.com/AliceLJY/openclaw-content-alchemy)** | Skill (Bot) | Content Alchemy packaged for OpenClaw bots — 56 art styles, auto-rotation |
| **[digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill)** | Skill | 6-stage workflow to create AI digital clones from corpus data |

> All projects are MIT licensed and built by one person with zero programming background — proof that AI tools can genuinely empower non-developers.
>
> 所有项目 MIT 开源，由一个零编程基础的人独立搭建——AI 工具确实能赋能非开发者。

## Known Issues & Gotchas

> 踩过的坑，省你踩一遍。

| Issue | Detail |
|-------|--------|
| **Gemini resume is `latest` only** | Gemini CLI `--resume` only accepts `latest` or index numbers, NOT UUIDs. Tapping any session in `/sessions` activates "resume latest" mode — it always resumes the most recent session, not the one you tapped. |
| **Gemini thinking mode** | Gemini CLI forces thinking mode. Models that don't support thinking (e.g. `gemini-2.0-flash`) will crash with exit code 144. Only `gemini-2.5-flash` and above work. |
| **Codex sandbox** | Codex CLI has a built-in sandbox. Even when resuming a TG-started session in terminal, system-level commands (`launchctl`, `docker`) require explicit permission approval. CC and Gemini CLI don't have this limitation. |
| **Worker restart after code changes** | After editing `worker.js` or `server.js`, the LaunchAgent keeps running the old code. You must `launchctl unload` + `load` the worker plist to pick up changes. |
| **Bridge restart clears session state** | Session maps are in-memory. Restarting a bridge loses all active session tracking — Gemini's `resumeLatest` won't be set until the user sends a new message or taps a session button. |

> Gemini CLI 只能 `--resume latest`，不支持按 UUID 恢复；Gemini 2.0 系列不兼容（强制思考模式）；Codex 有沙箱限制；改了 worker 代码要重启 LaunchAgent；重启 bridge 会丢内存会话状态。

## Author

**小试AI** — WeChat Public Account「我的AI小木屋」

Not a developer. Medical background, works in cultural administration, self-taught AI the hard way. Writes about AI hands-on experience, real-world pitfalls, and the human side of technology.

> 医学出身，文化口工作，AI 野路子。公众号记录 AI 实操、踩坑、人文思考。

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

[MIT](LICENSE)
