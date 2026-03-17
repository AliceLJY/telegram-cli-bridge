<div align="center">

# telegram-cli-bridge

**Telegram Frontend for task-api CLI Execution**

*Forward Telegram messages to your local task-api, execute on the real CLI, send results back.*

A thin Telegram bridge that drives Claude Code, Codex CLI, and Gemini CLI through `task-api` / `openclaw-worker` — keeping full CLI execution on the machine that owns the files and credentials.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

**English** | [简体中文](README_CN.md)

</div>

---

## What This Is

A Telegram frontend for `task-api`. Not a standalone backend.

It depends on a working `task-api` / `openclaw-worker` setup. Without that, this repository is close to useless. The bridge accepts Telegram messages, forwards tasks to task-api endpoints, polls for results, and sends responses back.

> **Core rule:** One bot = one CLI = one task-api route.

### telegram-ai-bridge vs telegram-cli-bridge

| | telegram-ai-bridge | telegram-cli-bridge (this) |
|---|---|---|
| Execution model | SDK-first (in-process adapter) | CLI-first (via task-api worker) |
| Backend dependency | None — self-contained | Requires `task-api` / `openclaw-worker` |
| Architecture | Unified bridge process | Three separate bot scripts |
| Best for | Direct SDK integration | Full local CLI execution behind a worker |

Choose this repo when you already have `task-api` running and want Telegram to drive full local CLI execution instead of SDK wrappers.

---

## What You Get

| Feature | Description |
|---------|-------------|
| **Three CLI bots** | `bridge.js` (Claude), `codex-bridge.js` (Codex), `gemini-bridge.js` (Gemini) |
| **Media forwarding** | Files, photos, and voice input forwarded to task-api |
| **Result delivery** | Polling + callback style |
| **Session continuity** | Per-chat, owner-only, in-memory |
| **Thin bridge** | All execution delegated to `openclaw-worker` |

---

## Quick Start

```bash
git clone https://github.com/AliceLJY/telegram-cli-bridge.git
cd telegram-cli-bridge
bun install
```

Prepare environment files:

| File | Bot |
|------|-----|
| `.env` | `bridge.js` (Claude) |
| `.env.codex` | `codex-bridge.js` (Codex) |
| `.env.gemini` | `gemini-bridge.js` (Gemini) |

Required variables:

```dotenv
TELEGRAM_BOT_TOKEN=...
OWNER_TELEGRAM_ID=...
TASK_API_URL=http://localhost:3456
TASK_API_TOKEN=...
# Optional: HTTPS_PROXY=...
```

### Run

```bash
bun bridge.js           # Claude
bun run start:codex     # Codex
bun run start:gemini    # Gemini
```

Run them as separate processes, not one combined bridge.

---

<details>
<summary><strong>Backend Differences</strong></summary>

- **Claude** (`bridge.js`) — `sessionId`-style continuation via `/claude` endpoint
- **Codex** (`codex-bridge.js`) — `sessionId`-style, with local fallback history at `codex-sessions.json`
- **Gemini** (`gemini-bridge.js`) — uses `resumeLatest` instead of UUID session restore (Gemini CLI limitation)

These are similar scripts, not a unified adapter abstraction.

</details>

<details>
<summary><strong>Prerequisites & Environment</strong></summary>

**Required:**
- Bun
- A working `task-api` / `openclaw-worker` backend
- Local installs of Claude Code, Codex CLI, and/or Gemini CLI on the backend machine
- One Telegram bot token per CLI bridge
- Owner Telegram account

**Local path assumptions:**
- Downloaded files: `~/Projects/telegram-cli-bridge/files`
- Codex history fallback: `~/Projects/telegram-cli-bridge/codex-sessions.json`
- `TASK_API_URL` defaults to `http://localhost:3456`

**Compatibility:**
- Tested only on the author's macOS + task-api workflow
- Some local paths are hardcoded and may need adjustment
- Not the recommended primary path for Claude/Codex (use `telegram-ai-bridge` for SDK-first)

</details>

<details>
<summary><strong>Known Limits</strong></summary>

- This is a task-api frontend, not a standalone backend
- Session maps are in-memory — lost on bridge restart
- Gemini session restore is not equivalent to Claude/Codex
- Three scripts are manually split, not a unified adapter
- Reliability depends on worker-side task execution

</details>

---

## Author

Built by **小试AI** ([@AliceLJY](https://github.com/AliceLJY)) for the WeChat public account **我的AI小木屋**.

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

MIT
