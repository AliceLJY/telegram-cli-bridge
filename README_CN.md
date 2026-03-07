# telegram-cli-bridge

[English](README.md) | **简体中文**

## 项目定位

这个仓库是 `task-api` 的 Telegram 前端，不是独立后端。

它强依赖一个已经可用的 `task-api` / `openclaw-worker`。没有后端，这个仓库几乎没有实际用途。它不能替代 worker，也不是一个自带统一适配层的完整系统。

它也不是“一个统一多后端桥进程”。仓库里其实是三份相似但分开的 Telegram bot 脚本：

- `bridge.js` 对应 Claude Code
- `codex-bridge.js` 对应 Codex CLI
- `gemini-bridge.js` 对应 Gemini CLI

这个仓库目前只在我自己的本地工作流里实测过。

## 这个项目做什么

- 接收 Telegram 消息、文件、图片和语音
- 把任务转发到本地 `task-api` 的 `/claude`、`/codex`、`/gemini` 等接口
- 轮询任务结果，再把结果发回 Telegram
- 在 bridge 进程内存中维护按 chat 的会话状态
- 每个 CLI 入口各用一个独立的 Telegram bot token

## 实测环境

- macOS
- Bun
- 本地已经运行好的 `task-api` / `openclaw-worker`
- 每个后端一个单独的 Telegram bot token
- 本地已安装 Claude Code / Codex / Gemini CLI

## 兼容性说明

- 目前只在我自己的 macOS + task-api 工作流里实测
- 部分本地路径是硬编码的，其他人使用时通常需要自己改
- 这个仓库在我自己的体系里并不是 Claude/Codex 的首选主路径
- Gemini 的会话恢复行为和 Claude/Codex 不同，因为 Gemini CLI 只支持 `resume latest`
- 这个仓库不应被表述成通用跨平台产品

## 架构前提

- bridge 进程通过 `TASK_API_URL` 和 `TASK_API_TOKEN` 调用后端
- 默认后端地址是 `http://localhost:3456`
- `task-api` 和 CLI 执行都在别处完成，通常由 `openclaw-worker` 负责
- 每个 Telegram bot 都需要单独启动一个脚本进程
- 默认假设是 owner-only 自用，而不是公共多用户 bot

## 后端差异

- `bridge.js` 是 Claude Code 的 Telegram bot
- `codex-bridge.js` 是 Codex 的 Telegram bot
- `gemini-bridge.js` 是 Gemini 的 Telegram bot
- Claude 和 Codex 走的是 `sessionId` 式续接
- Gemini 不等价，它走的是 `resumeLatest`，不是 UUID 会话恢复
- Codex 还会把本地 fallback 历史写到 `~/Projects/telegram-cli-bridge/codex-sessions.json`

这些脚本很像，但它们不是一个统一抽象出来的多后端适配器。

## 前置条件

- Bun
- 可用的 `task-api` / `openclaw-worker` 后端
- `TASK_API_URL` 和 `TASK_API_TOKEN`
- 在后端机器本地安装 Claude Code、Codex CLI 和/或 Gemini CLI
- 每个 CLI bridge 各自一个 Telegram bot token
- 一个实际使用的 owner Telegram 账号

## 本地假设

- 下载文件目录是 `~/Projects/telegram-cli-bridge/files`
- Codex 历史 fallback 文件是 `~/Projects/telegram-cli-bridge/codex-sessions.json`
- `TASK_API_URL` 默认是 `http://localhost:3456`
- 默认是 owner-only Telegram 使用方式
- 每个 CLI 预期单独使用一个 bot token

## 安装

```bash
bun install
```

按不同脚本准备各自环境文件：

- `.env` 给 `bridge.js`
- `.env.codex` 给 `codex-bridge.js`
- `.env.gemini` 给 `gemini-bridge.js`

最少需要这些环境变量：

- `TELEGRAM_BOT_TOKEN`
- `OWNER_TELEGRAM_ID`
- `TASK_API_URL`
- `TASK_API_TOKEN`

可选：

- `HTTPS_PROXY`

## 运行

按你要用的桥分别启动：

```bash
bun bridge.js
bun run start:codex
bun run start:gemini
```

它们应该作为三个分开的 Telegram bot 进程运行，而不是一个合并进程。

## 已知限制

- 这是 task-api 前端，不是独立后端
- 没有 `openclaw-worker` / task-api，这个仓库几乎不能用
- 会话映射保存在内存里，bridge 重启后会丢
- 硬编码本地路径未必适用于别的机器
- Gemini 的会话恢复和 Claude/Codex 不等价
- 三个脚本是手工拆开的，不是统一 adapter 架构
- 结果可靠性仍取决于 worker 侧任务执行和轮询是否正常

## 作者

作者：**小试AI**（[@AliceLJY](https://github.com/AliceLJY)）

## 公众号二维码

公众号：**我的AI小木屋**

<img src="./assets/wechat_qr.jpg" width="200" alt="公众号二维码">

## License

MIT
