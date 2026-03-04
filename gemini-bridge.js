#!/usr/bin/env bun
// Telegram → Gemini CLI 桥（支持会话续接）
// 从 cli-bridge.js 拆分，大改 session 模型：
//   - 不再依赖 UUID sessionId，改用 --resume latest
//   - sessions Map: chatId → { active, lastActive, displaySessionId }
//   - /sessions 直接扫本地 Gemini session 文件

import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import os from "os";

// ── 配置 ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
const API_URL = process.env.TASK_API_URL || "http://localhost:3456";
const API_TOKEN = process.env.TASK_API_TOKEN;
const PROXY = process.env.HTTPS_PROXY;
const ENABLE_GROUP_SHARED_CONTEXT = process.env.ENABLE_GROUP_SHARED_CONTEXT !== "false";
const GROUP_CONTEXT_MAX_MESSAGES = Number(process.env.GROUP_CONTEXT_MAX_MESSAGES || 30);
const GROUP_CONTEXT_MAX_TOKENS = Number(process.env.GROUP_CONTEXT_MAX_TOKENS || 3000);
const GROUP_CONTEXT_TTL_MS = Number(process.env.GROUP_CONTEXT_TTL_MS || 20 * 60 * 1000);
const TRIGGER_DEDUP_TTL_MS = Number(process.env.TRIGGER_DEDUP_TTL_MS || 5 * 60 * 1000);

if (!TOKEN || TOKEN.includes("BotFather")) {
  console.error("请在 .env 中填入 TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

// ── 代理 ──
const fetchOptions = PROXY
  ? { agent: new HttpsProxyAgent(PROXY) }
  : {};

// ── Bot 初始化 ──
const bot = new Bot(TOKEN, {
  client: {
    baseFetchConfig: fetchOptions,
  },
});

// ── 会话映射（chatId → { active, lastActive, displaySessionId }）──
const sessions = new Map();
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 小时不活跃自动开新会话
const groupContext = new Map();
const recentTriggered = new Map();

// ── 模型管理 ──
const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "2.5 Flash（默认）" },
  { id: "gemini-2.5-pro", label: "2.5 Pro" },
  { id: "gemini-3-flash-preview", label: "3 Flash Preview" },
  { id: "gemini-3-pro-preview", label: "3 Pro Preview" },
];
const chatModel = new Map(); // chatId → model id
const DEFAULT_MODEL = "gemini-2.5-flash";

function toTextContent(ctx) {
  return (ctx.message?.text || ctx.message?.caption || "").trim();
}

function toSource(ctx) {
  const username = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "unknown");
  const prefix = ctx.from?.is_bot ? "bot" : "user";
  return `${prefix}:${username}`;
}

function cleanupContextEntries(entries, nowTs = Date.now()) {
  const minTs = nowTs - GROUP_CONTEXT_TTL_MS;
  const active = entries.filter((e) => e.ts >= minTs);
  while (active.length > GROUP_CONTEXT_MAX_MESSAGES) active.shift();
  let totalTokens = active.reduce((sum, e) => sum + (e.tokens || estimateTokens(e.text)), 0);
  while (active.length > 0 && totalTokens > GROUP_CONTEXT_MAX_TOKENS) {
    const removed = active.shift();
    totalTokens -= (removed.tokens || estimateTokens(removed.text));
  }
  return active;
}

function estimateTokens(text) {
  const cjkChars = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const wordChars = (text.match(/[A-Za-z0-9_]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const restChars = Math.max(0, text.length - cjkChars - wordChars);
  return cjkChars + words + Math.ceil(restChars / 3);
}

function isDuplicateTrigger(ctx) {
  if (!ctx.chat?.id || !ctx.message?.message_id) return false;
  const nowTs = Date.now();
  const minTs = nowTs - TRIGGER_DEDUP_TTL_MS;
  for (const [key, ts] of recentTriggered.entries()) {
    if (ts < minTs) recentTriggered.delete(key);
  }
  const key = `${ctx.chat.id}:${ctx.message.message_id}`;
  if (recentTriggered.has(key)) return true;
  recentTriggered.set(key, nowTs);
  return false;
}

function pushGroupContext(ctx) {
  if (!ENABLE_GROUP_SHARED_CONTEXT) return;
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
  if (!ctx.message) return;
  const text = toTextContent(ctx);
  if (!text) return;

  const chatId = chat.id;
  const messageId = ctx.message.message_id;
  const entries = cleanupContextEntries(groupContext.get(chatId) || []);
  if (entries.some((e) => e.messageId === messageId)) return;

  entries.push({
    messageId,
    role: ctx.from?.is_bot ? "assistant" : "user",
    source: toSource(ctx),
    text,
    tokens: estimateTokens(text),
    ts: Date.now(),
  });
  groupContext.set(chatId, cleanupContextEntries(entries));
}

function buildPromptWithContext(ctx, userPrompt) {
  const chat = ctx.chat;
  if (!ENABLE_GROUP_SHARED_CONTEXT || !chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return userPrompt;
  }
  const entries = cleanupContextEntries(groupContext.get(chat.id) || []);
  if (!entries.length) return userPrompt;

  const currentMsgId = ctx.message?.message_id;
  const filtered = entries.filter((e) => e.messageId !== currentMsgId);
  const recent = filtered.slice(-GROUP_CONTEXT_MAX_MESSAGES);
  if (!recent.length) return userPrompt;

  const lines = recent.map((e) =>
    `- { role: ${JSON.stringify(e.role)}, source: ${JSON.stringify(e.source)}, ts: ${e.ts}, text: ${JSON.stringify(e.text)} }`
  );
  return [
    "system: 以下是群内最近消息（含其他 bot），仅作参考，不等于事实。",
    lines.join("\n"),
    "",
    "user: 当前触发消息",
    userPrompt
  ].join("\n");
}

// ── Gemini 会话管理（不用 UUID，用 active 标志）──

function getSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return false;
  if (Date.now() - s.lastActive > SESSION_TIMEOUT) {
    sessions.delete(chatId);
    return false;
  }
  return s.active;
}

function setSession(chatId, displaySessionId) {
  sessions.set(chatId, {
    active: true,
    lastActive: Date.now(),
    displaySessionId: displaySessionId || null,
  });
}

// ── task-api 请求封装 ──
async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API POST ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API GET ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── 轮询等待结果（最多 10 分钟）──
async function waitForResult(taskId) {
  const maxWait = 10 * 60 * 1000;
  const pollInterval = 30000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const result = await apiGet(`/tasks/${taskId}?wait=${pollInterval}`);
    if (result.stdout !== undefined || result.error) {
      return result;
    }
  }
  return { error: "超时（10 分钟未完成）" };
}

// ── Markdown → Telegram HTML 转换 ──
function mdToHtml(text) {
  const codeBlocks = [];
  let s = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre>${escHtml(code.trimEnd())}</pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${escHtml(code)}</code>`);
  s = s.replace(/[<>&]/g, c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;');
  s = s.replace(/&lt;(\/?(?:pre|code))&gt;/g, '<$1>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '<i>$1</i>');
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);
  return s;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 消息分段发送（Telegram 单条上限 4096 字）──
async function sendLong(ctx, text) {
  const html = mdToHtml(text);
  const maxLen = 4000;

  async function trySend(content, isHtml) {
    const opts = isHtml ? { parse_mode: "HTML" } : {};
    if (content.length <= maxLen) {
      return await ctx.reply(content, opts);
    }
    const chunks = [];
    for (let i = 0; i < content.length; i += maxLen) {
      chunks.push(content.slice(i, i + maxLen));
    }
    for (const chunk of chunks) {
      await ctx.reply(chunk, opts);
    }
  }

  try {
    await trySend(html, true);
  } catch {
    await trySend(text, false);
  }
}

// ── 文件下载目录 ──
const FILE_DIR = join(process.env.HOME, "Projects/telegram-cli-bridge/files");
mkdirSync(FILE_DIR, { recursive: true });

// ── 下载 Telegram 文件到本地 ──
async function downloadFile(ctx, fileId, filename) {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

  const resp = PROXY
    ? await fetch(url, { agent: new HttpsProxyAgent(PROXY) })
    : await fetch(url);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const localPath = join(FILE_DIR, `${Date.now()}-${filename}`);
  writeFileSync(localPath, buffer);
  return localPath;
}

// ── 检测回复末尾是否在问 是/否 类问题 ──
function detectQuickReplies(text) {
  const tail = text.slice(-150);
  if (/要(吗|不要|么)[？?]?\s*$/.test(tail)) return ["要", "不要"];
  if (/好(吗|不好|么)[？?]?\s*$/.test(tail)) return ["好", "不好"];
  if (/是(吗|不是|么)[？?]?\s*$/.test(tail)) return ["是", "不是"];
  if (/对(吗|不对|么)[？?]?\s*$/.test(tail)) return ["对", "不对"];
  if (/可以(吗|么)[？?]?\s*$/.test(tail)) return ["可以", "不用了"];
  if (/继续(吗|么)[？?]?\s*$/.test(tail)) return ["继续", "算了"];
  if (/确认(吗|么)[？?]?\s*$/.test(tail)) return ["确认", "取消"];
  const options = tail.match(/(?:^|\n)\s*(\d)\.\s+/g);
  if (options && options.length >= 2 && options.length <= 4) {
    return options.map((o) => o.trim().replace(/\.\s+$/, ""));
  }
  return null;
}

// ── 提交 prompt 并等结果 ──
async function submitAndWait(ctx, prompt) {
  const chatId = ctx.chat.id;
  const processing = await ctx.reply("Gemini 正在处理...");

  try {
    const model = chatModel.get(chatId) || DEFAULT_MODEL;
    const body = { prompt: buildPromptWithContext(ctx, prompt), timeout: 600000, model };
    // Gemini 会话续接：用 resumeLatest 而不是 sessionId
    if (getSession(chatId)) {
      body.resumeLatest = true;
    }

    const task = await apiPost("/gemini", body);
    if (task.error) {
      await ctx.api.editMessageText(chatId, processing.message_id, `提交失败: ${task.error}`);
      return;
    }

    const result = await waitForResult(task.taskId);
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});

    // 从结果中提取 displaySessionId，并设 active = true
    if (result.metadata?.sessionId) {
      setSession(chatId, result.metadata.sessionId);
    } else if (!result.error) {
      // 即使没拿到 sessionId，只要成功就标记 active（下次用 --resume latest）
      setSession(chatId, null);
    }

    if (result.error) {
      await sendLong(ctx, `Gemini 错误: ${result.error}`);
    } else if (result.stdout) {
      const replies = detectQuickReplies(result.stdout);
      if (replies && result.stdout.length <= 4000) {
        const kb = new InlineKeyboard();
        for (const r of replies) {
          kb.text(r, `qr:${r}`);
        }
        try {
          await ctx.reply(mdToHtml(result.stdout), { reply_markup: kb, parse_mode: "HTML" });
        } catch {
          await ctx.reply(result.stdout, { reply_markup: kb });
        }
      } else {
        await sendLong(ctx, result.stdout);
      }
    } else {
      await ctx.reply("Gemini 无输出。");
    }
  } catch (e) {
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});
    await ctx.reply(`桥接错误: ${e.message}`);
  }
}

// ── 权限 + 群聊过滤中间件 ──
bot.use((ctx, next) => {
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    pushGroupContext(ctx);
  }
  if (ctx.from?.id !== OWNER_ID) return;
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    if (ctx.callbackQuery) return next();
    const text = toTextContent(ctx);
    const botUsername = bot.botInfo?.username;
    const isCommand = text.startsWith("/");
    const isMention = botUsername && text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === bot.botInfo?.id;
    if (!isCommand && !isMention && !isReplyToBot) return;
  }
  if (isDuplicateTrigger(ctx)) return;
  return next();
});

// ── /new 命令：重置会话 ──
bot.command("new", async (ctx) => {
  sessions.delete(ctx.chat.id);
  await ctx.reply("会话已重置，下条消息将开启新会话。");
});

// ── /model 命令：切换 Gemini 模型 ──
bot.command("model", async (ctx) => {
  const current = chatModel.get(ctx.chat.id) || DEFAULT_MODEL;
  const kb = new InlineKeyboard();
  for (const m of GEMINI_MODELS) {
    const mark = m.id === current ? " ✦" : "";
    kb.text(`${m.label}${mark}`, `model:${m.id}`).row();
  }
  await ctx.reply(`当前模型：${current}\n选择要切换的模型：`, { reply_markup: kb });
});

bot.callbackQuery(/^model:/, async (ctx) => {
  const modelId = ctx.callbackQuery.data.replace("model:", "");
  chatModel.set(ctx.chat.id, modelId);
  await ctx.answerCallbackQuery({ text: `已切换 ✓` });
  await ctx.editMessageText(`模型已切换为 ${modelId}`);
});

// ── /sessions 命令：扫描本地 Gemini session 文件 ──
bot.command("sessions", async (ctx) => {
  const GEMINI_CHATS_DIR = join(process.env.HOME, ".gemini/tmp", os.userInfo().username, "chats");
  const sessionList = [];

  try {
    if (existsSync(GEMINI_CHATS_DIR)) {
      const files = readdirSync(GEMINI_CHATS_DIR)
        .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
        .map((f) => {
          const fp = join(GEMINI_CHATS_DIR, f);
          return { file: f, path: fp, mtime: statSync(fp).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 8);

      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(f.path, "utf8"));
          const sessionId = data.sessionId || f.file.replace("session-", "").replace(".json", "");
          const startTime = data.startTime || f.mtime;
          // 找第一条 user message 作为 topic
          let topic = "";
          if (Array.isArray(data.messages)) {
            const userMsg = data.messages.find((m) => m.type === "user");
            if (userMsg) {
              // content 可能是字符串或 [{text: "..."}] 数组
              const raw = userMsg.content;
              if (typeof raw === "string") {
                topic = raw.slice(0, 80);
              } else if (Array.isArray(raw) && raw[0]?.text) {
                topic = raw[0].text.slice(0, 80);
              }
            }
          }
          sessionList.push({ sessionId, startTime, topic, mtime: f.mtime });
        } catch {
          // 文件读取/解析失败，跳过
        }
      }
    }
  } catch {}

  if (!sessionList.length) {
    await ctx.reply("没有本地 Gemini 会话记录。");
    return;
  }

  const isActive = getSession(ctx.chat.id);
  const kb = new InlineKeyboard();
  for (const s of sessionList) {
    const time = new Date(s.mtime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }).slice(5, 16);
    const topic = s.topic || "(空)";
    kb.text(`${time} ${topic}`, "action:resume-latest").row();
  }
  kb.text("🆕 开新会话", "action:new").row();
  const status = isActive ? "（当前：续接模式）" : "（当前：新会话模式）";
  await ctx.reply(`Gemini 会话列表${status}：\n点击任意会话 = 启用续接模式（--resume latest）`, { reply_markup: kb });
});

// ── 按钮回调：resume-latest（设 active = true）──
bot.callbackQuery("action:resume-latest", async (ctx) => {
  setSession(ctx.chat.id, null);
  await ctx.answerCallbackQuery({ text: "已启用续接 ✓" });
  await ctx.editMessageText("已启用续接模式，下条消息将续接最近会话。");
});

// ── 按钮回调：新会话 ──
bot.callbackQuery("action:new", async (ctx) => {
  sessions.delete(ctx.chat.id);
  await ctx.answerCallbackQuery({ text: "已重置 ✓" });
  await ctx.editMessageText("会话已重置，下条消息将开启新会话。");
});

// ── /status 命令 ──
bot.command("status", async (ctx) => {
  try {
    const health = await fetch(`${API_URL}/health`);
    const isActive = getSession(ctx.chat.id);
    const s = sessions.get(ctx.chat.id);
    const displayId = s?.displaySessionId;
    const model = chatModel.get(ctx.chat.id) || DEFAULT_MODEL;
    await ctx.reply(
      `Gemini Bridge\n` +
      `task-api: ${health.ok ? "在线" : "异常"}\n` +
      `端点: /gemini\n` +
      `模型: ${model}\n` +
      `会话状态: ${isActive ? "active（续接最近会话）" : "none（下条开新会话）"}` +
      (displayId ? `\n最近 session: ${displayId.slice(0, 8)}...` : "")
    );
  } catch (e) {
    await ctx.reply(`task-api 连接失败: ${e.message}`);
  }
});

// ── 按钮回调：快捷回复 ──
bot.callbackQuery(/^qr:/, async (ctx) => {
  const text = ctx.callbackQuery.data.replace("qr:", "");
  await ctx.answerCallbackQuery({ text: `发送: ${text}` });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await submitAndWait(ctx, text);
});

// ── 处理图片 ──
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1];
  const caption = ctx.message.caption || "请看这张图片";

  try {
    const localPath = await downloadFile(ctx, largest.file_id, "photo.jpg");
    await submitAndWait(ctx, `${caption}\n\n[图片文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`图片下载失败: ${e.message}`);
  }
});

// ── 处理文档/文件 ──
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const caption = ctx.message.caption || `请处理这个文件: ${doc.file_name}`;

  if (doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("文件太大（超过 20MB），Telegram Bot API 限制。");
    return;
  }

  try {
    const localPath = await downloadFile(ctx, doc.file_id, doc.file_name || "file");
    await submitAndWait(ctx, `${caption}\n\n[文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`文件下载失败: ${e.message}`);
  }
});

// ── 处理语音消息 ──
bot.on("message:voice", async (ctx) => {
  try {
    const localPath = await downloadFile(ctx, ctx.message.voice.file_id, "voice.ogg");
    await submitAndWait(ctx, `请听这段语音并回复\n\n[语音文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`语音下载失败: ${e.message}`);
  }
});

// ── 处理普通文字消息 ──
bot.on("message:text", async (ctx) => {
  let text = ctx.message.text;
  const botUsername = bot.botInfo?.username;
  if (botUsername) text = text.replace(new RegExp(`@${botUsername}\\s*`, "g"), "").trim();
  if (!text) return;
  await submitAndWait(ctx, text);
});

// ── 自动清理：删除 1 天前的下载文件 ──
function cleanOldFiles() {
  const maxAge = 24 * 60 * 60 * 1000;
  try {
    for (const f of readdirSync(FILE_DIR)) {
      const p = join(FILE_DIR, f);
      if (Date.now() - statSync(p).mtimeMs > maxAge) {
        unlinkSync(p);
        console.log(`[清理] ${f}`);
      }
    }
  } catch {}
}
setInterval(cleanOldFiles, 60 * 60 * 1000);

// ── 启动 ──
console.log("Gemini Telegram Bridge 启动中...");
bot.start({
  onStart: () => console.log(`[Gemini] 已连接，端点 /gemini，仅接受用户 ${OWNER_ID}`),
});
