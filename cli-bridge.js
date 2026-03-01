#!/usr/bin/env bun
// Telegram → Codex/Gemini CLI 通用桥（支持会话续接）
// 环境变量驱动：CLI_TYPE（显示名）+ CLI_ENDPOINT（API 路径）

import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

// ── 配置 ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
const API_URL = process.env.TASK_API_URL || "http://localhost:3456";
const API_TOKEN = process.env.TASK_API_TOKEN;
const PROXY = process.env.HTTPS_PROXY;
const CLI_TYPE = process.env.CLI_TYPE || "CLI";
const CLI_ENDPOINT = process.env.CLI_ENDPOINT || "/codex";

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

// ── 会话历史持久化 ──
const HISTORY_FILE = join(process.env.HOME, `Projects/telegram-cc-bridge/${CLI_TYPE.toLowerCase()}-sessions.json`);
const MAX_HISTORY = 20;

function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {}
  return [];
}

function saveToHistory(sessionId, firstPrompt) {
  const history = loadHistory();
  // 已存在则更新时间
  const existing = history.find((h) => h.sessionId === sessionId);
  if (existing) {
    existing.lastActive = Date.now();
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    return;
  }
  history.unshift({ sessionId, firstPrompt: firstPrompt.slice(0, 50), lastActive: Date.now() });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function getSession(chatId) {
  const s = sessions.get(chatId);
  if (!s) return null;
  if (Date.now() - s.lastActive > SESSION_TIMEOUT) {
    sessions.delete(chatId);
    return null;
  }
  return s.sessionId;
}

function setSession(chatId, sessionId, firstPrompt) {
  const isNew = !sessions.has(chatId) || sessions.get(chatId).sessionId !== sessionId;
  sessions.set(chatId, { sessionId, lastActive: Date.now() });
  if (isNew && firstPrompt) saveToHistory(sessionId, firstPrompt);
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
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
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

// ── 消息分段发送（Telegram 单条上限 4096 字）──
async function sendLong(ctx, text) {
  const maxLen = 4000;
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
const FILE_DIR = join(process.env.HOME, "Projects/telegram-cc-bridge/files");
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
  const processing = await ctx.reply(`${CLI_TYPE} 正在处理...`);

  try {
    const body = { prompt, timeout: 600000 };
    const sessionId = getSession(chatId);
    if (sessionId) body.sessionId = sessionId;

    const task = await apiPost(CLI_ENDPOINT, body);
    if (task.error) {
      await ctx.api.editMessageText(chatId, processing.message_id, `提交失败: ${task.error}`);
      return;
    }

    const result = await waitForResult(task.taskId);
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});

    // 从结果中提取并保存 sessionId
    if (result.metadata?.sessionId) {
      setSession(chatId, result.metadata.sessionId, prompt);
    }

    if (result.error) {
      await sendLong(ctx, `${CLI_TYPE} 错误: ${result.error}`);
    } else if (result.stdout) {
      const replies = detectQuickReplies(result.stdout);
      if (replies && result.stdout.length <= 4000) {
        const kb = new InlineKeyboard();
        for (const r of replies) {
          kb.text(r, `qr:${r}`);
        }
        await ctx.reply(result.stdout, { reply_markup: kb });
      } else {
        await sendLong(ctx, result.stdout);
      }
    } else {
      await ctx.reply(`${CLI_TYPE} 无输出。`);
    }
  } catch (e) {
    await ctx.api.deleteMessage(chatId, processing.message_id).catch(() => {});
    await ctx.reply(`桥接错误: ${e.message}`);
  }
}

// ── 权限检查中间件 ──
bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return;
  return next();
});

// ── /new 命令：重置会话 ──
bot.command("new", async (ctx) => {
  sessions.delete(ctx.chat.id);
  await ctx.reply("会话已重置，下条消息将开启新会话。");
});

// ── /sessions 命令：按钮式会话列表 ──
bot.command("sessions", async (ctx) => {
  const history = loadHistory();
  if (!history.length) {
    await ctx.reply("没有历史会话记录。");
    return;
  }
  const current = getSession(ctx.chat.id);
  const kb = new InlineKeyboard();
  for (const h of history.slice(0, 8)) {
    const short = h.sessionId.slice(0, 8);
    const mark = current === h.sessionId ? " ✦当前" : "";
    const time = new Date(h.lastActive).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }).slice(5, 16);
    const topic = h.firstPrompt || "(空)";
    kb.text(`${time} ${topic}${mark}`, `resume:${h.sessionId}`).row();
  }
  kb.text("🆕 开新会话", "action:new").row();
  await ctx.reply(`${CLI_TYPE} 会话列表：`, { reply_markup: kb });
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
  await ctx.editMessageText("会话已重置，下条消息将开启新会话。");
});

// ── /status 命令 ──
bot.command("status", async (ctx) => {
  try {
    const health = await fetch(`${API_URL}/health`);
    const sessionId = getSession(ctx.chat.id);
    await ctx.reply(
      `${CLI_TYPE} Bridge\n` +
      `task-api: ${health.ok ? "在线" : "异常"}\n` +
      `端点: ${CLI_ENDPOINT}\n` +
      `当前会话: ${sessionId ? sessionId.slice(0, 8) + "..." : "无（下条消息开新会话）"}`
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
  await submitAndWait(ctx, ctx.message.text);
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
console.log(`${CLI_TYPE} Telegram Bridge 启动中...`);
bot.start({
  onStart: () => console.log(`[${CLI_TYPE}] 已连接，端点 ${CLI_ENDPOINT}，仅接受用户 ${OWNER_ID}`),
});
