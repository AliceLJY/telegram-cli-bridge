# telegram-cli-bridge

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/interface-Telegram-26A5E4.svg)](https://telegram.org/)

**English** | [简体中文](README_CN.md)

Turn Telegram into the remote control for your local AI CLI through `task-api`.

`telegram-cli-bridge` is the task-api path in this ecosystem: three Telegram bot entrypoints that forward work to a local worker, so Claude Code, Codex CLI, and Gemini CLI can keep their full CLI execution model on the machine that actually owns the files and credentials.

Core product rule:

> One bot = one CLI = one task-api route = one clear operator mental model.

## Project Positioning

This repository is a Telegram frontend for `task-api`, not a standalone backend.

It depends on a working `task-api` / `openclaw-worker` setup. Without that backend, this repository is close to useless. It does not replace the worker, and it does not provide a unified adapter framework by itself.

It is also not one single multi-backend bridge process. The repository contains three separate Telegram bot scripts with similar but different behavior:

- `bridge.js` for Claude Code
- `codex-bridge.js` for Codex CLI
- `gemini-bridge.js` for Gemini CLI

This repository is only tested in my own local workflow.

## Why This Exists

`telegram-ai-bridge` is the cleaner SDK-first path.

This repository exists for the other case: when you want Telegram on the front, but you still want the real backend to be a worker that can run the local CLI directly.

Choose this repo when:

- you already have `task-api` / `openclaw-worker` running
- you want Telegram to drive full local CLI execution instead of an SDK wrapper
- you prefer keeping backend execution, file access, and credentials behind a worker boundary
- you are okay running separate bot scripts for separate CLIs

## What You Get

- Telegram bots for Claude Code, Codex CLI, and Gemini CLI
- file / photo / voice forwarding to task-api routes
- polling + callback style result delivery
- owner-only session continuation per chat
- a simpler bridge process that delegates execution to `openclaw-worker`

## What It Does

- Accepts Telegram messages, files, photos, and voice input
- Forwards tasks to local `task-api` endpoints such as `/claude`, `/codex`, and `/gemini`
- Polls task results and sends responses back to Telegram
- Maintains per-chat session state in bridge memory
- Uses one Telegram bot token per CLI entrypoint

## Tested Environment

- macOS
- Bun
- Local `task-api` / `openclaw-worker` already running
- Separate Telegram bot token per backend
- Local CLI installs for Claude Code / Codex / Gemini

## Compatibility Notes

- Tested only in my own macOS + task-api workflow
- Some local paths are hardcoded and should be changed by other users
- This repository is not the recommended primary path for Claude/Codex in my own setup
- Gemini session behavior differs from Claude/Codex because Gemini CLI only supports resume latest
- This is not presented as a general-purpose cross-platform product

## Architecture Assumptions

- The bridge processes talk to `TASK_API_URL` with `TASK_API_TOKEN`
- Default backend URL is `http://localhost:3456`
- `task-api` and CLI execution are handled elsewhere, typically by `openclaw-worker`
- Each Telegram bot process is started separately
- Owner-only usage is assumed, not public multi-user bot usage

## Backend Differences

- `bridge.js` is the Claude Code Telegram bot
- `codex-bridge.js` is the Codex Telegram bot
- `gemini-bridge.js` is the Gemini Telegram bot
- Claude and Codex use `sessionId`-style continuation
- Gemini does not behave the same way: it uses `resumeLatest` instead of UUID session restore
- Codex keeps a local JSON fallback history in `~/Projects/telegram-cli-bridge/codex-sessions.json`

These are similar scripts, but they are not one unified backend abstraction layer.

## Prerequisites

- Bun
- A working `task-api` / `openclaw-worker` backend
- `TASK_API_URL` and `TASK_API_TOKEN`
- Local installs of Claude Code, Codex CLI, and/or Gemini CLI on the backend machine
- One Telegram bot token per CLI bridge
- A single owner Telegram account for actual use

## Local Assumptions

- Downloaded files are stored under `~/Projects/telegram-cli-bridge/files`
- Codex history fallback is stored at `~/Projects/telegram-cli-bridge/codex-sessions.json`
- `TASK_API_URL` defaults to `http://localhost:3456`
- Owner-only Telegram usage is assumed
- One bot token is expected per CLI

## Setup

```bash
bun install
```

Prepare separate environment files as needed for each script:

- `.env` for `bridge.js`
- `.env.codex` for `codex-bridge.js`
- `.env.gemini` for `gemini-bridge.js`

Minimum environment variables:

- `TELEGRAM_BOT_TOKEN`
- `OWNER_TELEGRAM_ID`
- `TASK_API_URL`
- `TASK_API_TOKEN`

Optional:

- `HTTPS_PROXY`

## Running

Start the specific bridge you want:

```bash
bun bridge.js
bun run start:codex
bun run start:gemini
```

Run them as separate Telegram bots, not as one combined process.

## Known Limits

- This is a task-api frontend, not a standalone backend
- Without `openclaw-worker` / task-api, the repository is almost unusable
- Session maps are stored in memory and are lost on bridge restart
- Hardcoded local paths may not match other machines
- Gemini session restore is not equivalent to Claude/Codex
- The three scripts are manually split and not a unified adapter architecture
- Results and reliability depend on worker-side task execution and polling success

## Author

Built by **小试AI** ([@AliceLJY](https://github.com/AliceLJY))

## WeChat Public Account

WeChat public account: **我的AI小木屋**

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

MIT
