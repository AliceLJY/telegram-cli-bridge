<div align="center">

# telegram-cli-bridge

**task-api CLI 执行的 Telegram 前端**

*Telegram 消息转发到本地 task-api，在真实 CLI 上执行，结果推回来。*

一个薄桥接层，通过 `task-api` / `openclaw-worker` 驱动 Claude Code、Codex CLI 和 Gemini CLI——完整 CLI 执行留在拥有文件和凭据的机器上。

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

[English](README.md) | **简体中文**

</div>

---

## 这是什么

`task-api` 的 Telegram 前端。不是独立后端。

它强依赖一个已经可用的 `task-api` / `openclaw-worker`。没有后端，这个仓库几乎没有实际用途。bridge 接收 Telegram 消息，把任务转发到 task-api 端点，轮询结果，再推回 Telegram。

> **核心规则：** 一个 bot = 一个 CLI = 一条 task-api 路由。

### telegram-ai-bridge vs telegram-cli-bridge

| | telegram-ai-bridge | telegram-cli-bridge（本仓库） |
|---|---|---|
| 执行模型 | SDK-first（进程内 adapter） | CLI-first（通过 task-api worker） |
| 后端依赖 | 无——自包含 | 需要 `task-api` / `openclaw-worker` |
| 架构 | 统一 bridge 进程 | 三个独立 bot 脚本 |
| 适合场景 | 直接 SDK 集成 | worker 背后的完整本地 CLI 执行 |

如果你已经跑着 task-api，并希望 Telegram 驱动完整本地 CLI 执行（而非 SDK 壳），选这个仓库。

---

## 你能得到什么

| 功能 | 说明 |
|------|------|
| **三个 CLI bot** | `bridge.js`（Claude）、`codex-bridge.js`（Codex）、`gemini-bridge.js`（Gemini） |
| **媒体转发** | 文件、图片、语音输入转发到 task-api |
| **结果回传** | 轮询 + callback 结合 |
| **会话续接** | 按 chat、owner-only、内存存储 |
| **薄桥接** | 所有执行委托给 `openclaw-worker` |

---

## 快速开始

```bash
git clone https://github.com/AliceLJY/telegram-cli-bridge.git
cd telegram-cli-bridge
bun install
```

按不同脚本准备环境文件：

| 文件 | Bot |
|------|-----|
| `.env` | `bridge.js`（Claude） |
| `.env.codex` | `codex-bridge.js`（Codex） |
| `.env.gemini` | `gemini-bridge.js`（Gemini） |

必需环境变量：

```dotenv
TELEGRAM_BOT_TOKEN=...
OWNER_TELEGRAM_ID=...
TASK_API_URL=http://localhost:3456
TASK_API_TOKEN=...
# 可选：HTTPS_PROXY=...
```

### 运行

```bash
bun bridge.js           # Claude
bun run start:codex     # Codex
bun run start:gemini    # Gemini
```

应作为三个独立进程运行，不要合并成一个。

---

<details>
<summary><strong>后端差异</strong></summary>

- **Claude**（`bridge.js`）— 通过 `/claude` 端点做 `sessionId` 式续接
- **Codex**（`codex-bridge.js`）— `sessionId` 式，带本地 fallback 历史 `codex-sessions.json`
- **Gemini**（`gemini-bridge.js`）— 使用 `resumeLatest` 而非 UUID 会话恢复（Gemini CLI 限制）

这些脚本很像，但不是统一抽象出来的 adapter。

</details>

<details>
<summary><strong>前置条件与环境</strong></summary>

**必需：**
- Bun
- 可用的 `task-api` / `openclaw-worker` 后端
- 在后端机器上安装 Claude Code、Codex CLI 和/或 Gemini CLI
- 每个 CLI bridge 各一个 Telegram bot token
- 一个 owner Telegram 账号

**本地路径假设：**
- 下载文件目录：`~/Projects/telegram-cli-bridge/files`
- Codex 历史 fallback：`~/Projects/telegram-cli-bridge/codex-sessions.json`
- `TASK_API_URL` 默认 `http://localhost:3456`

**兼容性：**
- 仅在作者本人的 macOS + task-api 工作流中实测
- 部分本地路径硬编码，其他用户可能需要调整
- 在我自己的体系里，Claude/Codex 的主推荐路径是 `telegram-ai-bridge`（SDK-first）

</details>

<details>
<summary><strong>已知限制</strong></summary>

- 这是 task-api 前端，不是独立后端
- 会话映射存在内存里，bridge 重启后丢失
- Gemini 会话恢复和 Claude/Codex 不等价
- 三个脚本是手工拆开的，不是统一 adapter 架构
- 结果可靠性取决于 worker 侧任务执行

</details>

---

## 作者

作者是 **小试AI**（[@AliceLJY](https://github.com/AliceLJY)），公众号为 **我的AI小木屋**。

<img src="./assets/wechat_qr.jpg" width="200" alt="微信公众号二维码">

## 许可证

MIT
