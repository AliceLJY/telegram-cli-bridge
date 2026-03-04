#!/usr/bin/env bun
// Telegram → Claude Code 异步桥
// 零 AI 中间层，纯管道：Telegram Bot → task-api → CC

import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

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

// ── 会话映射（chatId → { sessionId, lastActive }）──
const sessions = new Map();
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 小时不活跃自动开新会话
const groupContext = new Map(); // chatId -> [{ messageId, role, source, text, ts }]
const recentTriggered = new Map(); // `${chatId}:${messageId}` -> ts

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

function getSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return null;
  if (Date.now() - s.lastActive > SESSION_TIMEOUT) {
    sessions.delete(chatId);
    return null; // 过期，开新会话
  }
  return s.sessionId;
}

function setSession(chatId, sessionId) {
  sessions.set(chatId, { sessionId, lastActive: Date.now() });
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

// ── 轮询等待结果（最多 15 分钟）──
async function waitForResult(taskId) {
  const maxWait = 15 * 60 * 1000;
  const pollInterval = 30000; // 长轮询 30s
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const result = await apiGet(`/tasks/${taskId}?wait=${pollInterval}`);
    if (result.stdout !== undefined || result.error) {
      return result;
    }
    // status: pending/processing → 继续轮询
  }
  return { error: "超时（15 分钟未完成）" };
}

// ── 消息分段发送（Telegram 单条上限 4096 字）──
async function sendLong(ctx, text) {
  const maxLen = 4000; // 留点余量
  if (text.length <= maxLen) {
    return await ctx.reply(text);
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  for (const chunk of chunks) {
    await ctx.reply(chunk);
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

// ── 检测 CC 回复末尾是否在问 是/否 类问题 ──
function detectQuickReplies(text) {
  const tail = text.slice(-150);
  // 是/否 类
  if (/要(吗|不要|么)[？?]?\s*$/.test(tail)) return ["要", "不要"];
  if (/好(吗|不好|么)[？?]?\s*$/.test(tail)) return ["好", "不好"];
  if (/是(吗|不是|么)[？?]?\s*$/.test(tail)) return ["是", "不是"];
  if (/对(吗|不对|么)[？?]?\s*$/.test(tail)) return ["对", "不对"];
  if (/可以(吗|么)[？?]?\s*$/.test(tail)) return ["可以", "不用了"];
  if (/继续(吗|么)[？?]?\s*$/.test(tail)) return ["继续", "算了"];
  if (/确认(吗|么)[？?]?\s*$/.test(tail)) return ["确认", "取消"];
  // 选项类：检测 1. 2. 3. 或 A B C
  const options = tail.match(/(?:^|\n)\s*(\d)\.\s+/g);
  if (options && options.length >= 2 && options.length <= 4) {
    return options.map((o) => o.trim().replace(/\.\s+$/, ""));
  }
  return null;
}

// ── 提交 prompt 并等结果（复用逻辑）──
async function submitAndWait(ctx, prompt) {
  const chatId = ctx.chat.id;
  const processing = await ctx.reply("CC 正在处理...");

  try {
    const body = { prompt: buildPromptWithContext(ctx, prompt), timeout: 900000 };
    const sessionId = getSession(chatId);
    if (sessionId) body.sessionId = sessionId;

    const task = await apiPost("/claude", body);
    if (task.error) {
      await ctx.api.editMessageText(chatId, processing.message_id, `提交失败: ${task.error}`);
      return;
    }

    if (task.sessionId) setSession(chatId, task.sessionId);

    const result = await waitForResult(task.taskId);
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});

    if (result.error) {
      await sendLong(ctx, `CC 错误: ${result.error}`);
    } else if (result.stdout) {
      // 检测是否需要快捷按钮
      const replies = detectQuickReplies(result.stdout);
      if (replies && result.stdout.length <= 4000) {
        const kb = new InlineKeyboard();
        for (const r of replies) {
          kb.text(r, `reply:${r}`);
        }
        await ctx.reply(result.stdout, { reply_markup: kb });
      } else {
        await sendLong(ctx, result.stdout);
      }
      if (result.stderr) {
        await sendLong(ctx, `[stderr] ${result.stderr}`);
      }
    } else {
      await ctx.reply("CC 无输出。");
    }
  } catch (e) {
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});
    await ctx.reply(`桥接错误: ${e.message}`);
  }
}

// ── 权限 + 群聊过滤中间件 ──
bot.use((ctx, next) => {
  // 群聊消息先入上下文（不触发处理）
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    pushGroupContext(ctx);
  }
  // 仅主人可触发处理
  if (ctx.from?.id !== OWNER_ID) return;
  // 群聊中：只响应 @提及、/命令、回复 bot 的消息、回调按钮
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
  await ctx.reply("会话已重置，下条消息将开启新 CC 会话。");
});

// ── /sessions 命令：按钮式会话列表 ──
bot.command("sessions", async (ctx) => {
  try {
    const data = await apiGet("/claude/recent?limit=8");
    if (!data.sessions?.length) {
      await ctx.reply("没有找到历史会话。");
      return;
    }
    const current = getSession(ctx.chat.id);
    const kb = new InlineKeyboard();
    for (const s of data.sessions) {
      const short = s.sessionId.slice(0, 8);
      const mark = current === s.sessionId ? " ✦当前" : "";
      const time = s.lastModified.slice(5, 16).replace("T", " ");
      const topic = s.topic.slice(0, 30) || "(空)";
      kb.text(`${time} ${topic}${mark}`, `resume:${s.sessionId}`).row();
    }
    kb.text("🆕 开新会话", "action:new").row();
    await ctx.reply("选择要恢复的会话：", { reply_markup: kb });
  } catch (e) {
    await ctx.reply(`查询失败: ${e.message}`);
  }
});

// ── 按钮回调：恢复会话 ──
bot.callbackQuery(/^resume:/, async (ctx) => {
  const sessionId = ctx.callbackQuery.data.replace("resume:", "");
  setSession(ctx.chat.id, sessionId);
  await ctx.answerCallbackQuery({ text: "已恢复 ✓" });
  await ctx.editMessageText(`已恢复会话 \`${sessionId.slice(0, 8)}\`\n继续发消息即可。`, { parse_mode: "Markdown" });
});

// ── 按钮回调：新会话 ──
bot.callbackQuery("action:new", async (ctx) => {
  sessions.delete(ctx.chat.id);
  await ctx.answerCallbackQuery({ text: "已重置 ✓" });
  await ctx.editMessageText("会话已重置，下条消息将开启新 CC 会话。");
});

// ── 按钮回调：快捷回复（是/否/选项）──
bot.callbackQuery(/^reply:/, async (ctx) => {
  const text = ctx.callbackQuery.data.replace("reply:", "");
  await ctx.answerCallbackQuery({ text: `发送: ${text}` });
  // 把原消息的按钮去掉，标记已选
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  // 当作普通消息发给 CC
  await submitAndWait(ctx, text);
});

// ── /status 命令：查状态 ──
bot.command("status", async (ctx) => {
  try {
    const health = await fetch(`${API_URL}/health`);
    const data = await health.json();
    const sessionId = getSession(ctx.chat.id);
    await ctx.reply(
      `task-api: ${health.ok ? "在线" : "异常"}\n` +
        `当前会话: ${sessionId ? sessionId.slice(0, 8) + "..." : "无（下条消息开新会话）"}`
    );
  } catch (e) {
    await ctx.reply(`task-api 连接失败: ${e.message}`);
  }
});

// ── 处理图片 ──
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1]; // 最大尺寸
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

  // 文件大小限制（Telegram Bot API 最大 20MB）
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

// ── 处理视频消息 ──
bot.on("message:video", async (ctx) => {
  await ctx.reply("暂不支持视频处理，可以截图发图片。");
});

// ── 处理普通文字消息 ──
bot.on("message:text", async (ctx) => {
  let text = ctx.message.text;
  // 群聊中去掉 @botname
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
setInterval(cleanOldFiles, 60 * 60 * 1000); // 每小时检查一次

// ── 启动 ──
console.log("Telegram-CC Bridge 启动中...");
bot.start({
  onStart: () => console.log(`已连接，仅接受用户 ${OWNER_ID} 的消息`),
});
