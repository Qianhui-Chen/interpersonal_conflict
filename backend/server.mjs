import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONDITIONS, ROUND_CONTENT, TOTAL_ROUNDS } from "./src/config.mjs";
import { createDatabase } from "./src/db.mjs";
import { createReplyGenerator } from "./src/deepseek.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    value = value.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(join(root, ".env"));

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4174", 10);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:4173";
const databasePath = join(root, "data", "experiment.db");
await mkdir(join(root, "data"), { recursive: true });

const database = createDatabase(databasePath);
const generateReply = createReplyGenerator({
  promptPath: join(root, "prompts", "disclosure-system.txt"),
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  apiUrl: process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions",
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
  demoMode: String(process.env.DEMO_MODE ?? "true").toLowerCase() !== "false",
});

function apiHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Origin": frontendOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, apiHeaders());
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error("请求内容过长");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("请求格式不正确");
  }
}

function publicSession(session) {
  const completed = session.current_round >= TOTAL_ROUNDS;
  return {
    sessionId: session.session_id,
    condition: session.condition,
    pace: session.pace,
    disclosure: session.disclosure_enabled,
    currentRound: session.current_round,
    totalRounds: TOTAL_ROUNDS,
    inFlight: session.in_flight,
    completed,
    completionCode: completed ? session.completion_code : null,
    turns: session.turns.map((turn) => ({
      roundNumber: turn.round_number,
      userMessage: turn.user_message,
      generatedDisclosure: turn.generated_disclosure,
      fixedQuestion: turn.fixed_question,
      apiLatencyMs: turn.api_latency_ms,
      createdAt: turn.created_at,
    })),
  };
}

async function handleCreateSession(request, response) {
  const body = await readJson(request);
  const password = String(body.password ?? "").trim();
  const condition = CONDITIONS[password];
  if (!condition) {
    sendJson(response, 400, { error: "请输入正确的随机数格式。" });
    return;
  }

  const now = new Date().toISOString();
  const session = database.createSession({
    sessionId: randomUUID(),
    condition: condition.key,
    pace: condition.pace,
    disclosure: condition.disclosure,
    completionCode: condition.completionCode,
    createdAt: now,
  });
  sendJson(response, 201, publicSession(session));
}

async function handleChat(request, response) {
  const body = await readJson(request);
  const sessionId = String(body.sessionId ?? "").trim();
  const userMessage = String(body.message ?? "").trim();

  if (!sessionId || !userMessage) {
    sendJson(response, 400, { error: "请输入你想分享的内容。" });
    return;
  }
  if (Array.from(userMessage).length > 2000) {
    sendJson(response, 400, { error: "本轮输入内容过长，请缩短后重试。" });
    return;
  }

  const claim = database.claimNextRound(sessionId, new Date().toISOString());
  if (!claim) {
    const current = database.readSession(sessionId);
    if (!current) sendJson(response, 404, { error: "会话不存在，请重新进入实验。" });
    else if (current.current_round >= TOTAL_ROUNDS) sendJson(response, 409, { error: "本次实验已经完成。" });
    else sendJson(response, 409, { error: "机器人正在回复，请稍候。" });
    return;
  }

  const { session, roundNumber } = claim;
  const roundContent = ROUND_CONTENT[roundNumber];
  let generatedDisclosure = null;
  let apiLatencyMs = null;

  try {
    if (session.disclosure_enabled && roundNumber < TOTAL_ROUNDS) {
      const history = database.readSession(sessionId).turns;
      const generated = await generateReply({
        roundNumber,
        theme: roundContent.theme,
        fixedQuestion: roundContent.fixedQuestion,
        userMessage,
        history,
        sessionId,
      });
      generatedDisclosure = generated.disclosure;
      apiLatencyMs = generated.latencyMs;
    }

    const createdAt = new Date().toISOString();
    const updated = database.completeRound({
      sessionId,
      condition: session.condition,
      roundNumber,
      userMessage,
      generatedAcknowledgment: null,
      generatedDisclosure,
      fixedQuestion: roundContent.fixedQuestion,
      apiLatencyMs,
      createdAt,
    });

    const completed = roundNumber === TOTAL_ROUNDS;
    sendJson(response, 200, {
      roundNumber,
      generatedDisclosure,
      fixedQuestion: roundContent.fixedQuestion,
      apiLatencyMs,
      pace: session.pace,
      completed,
      completionCode: completed ? updated.completion_code : null,
      currentRound: updated.current_round,
      totalRounds: TOTAL_ROUNDS,
    });
  } catch (error) {
    database.release(sessionId);
    console.error(error);
    sendJson(response, 502, {
      error: process.env.NODE_ENV === "production"
        ? "机器人回复生成失败，请稍后重试。"
        : error.message,
    });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, apiHeaders());
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      await handleCreateSession(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/session/")) {
      const sessionId = decodeURIComponent(url.pathname.slice("/api/session/".length));
      const session = database.readSession(sessionId);
      if (!session) sendJson(response, 404, { error: "会话不存在。" });
      else sendJson(response, 200, publicSession(session));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(request, response);
      return;
    }
    sendJson(response, 404, { error: "API接口不存在。" });
  } catch (error) {
    console.error(error);
    sendJson(response, 400, { error: error.message || "请求处理失败。" });
  }
});

server.listen(port, host, () => {
  console.log(`后端API已启动：http://${host}:${port}`);
  console.log(`允许的前端来源：${frontendOrigin}`);
  console.log(`数据库：${databasePath}`);
  console.log(`演示模式：${String(process.env.DEMO_MODE ?? "true").toLowerCase() !== "false" ? "开启" : "关闭"}`);
});
