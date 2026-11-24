import { readFileSync } from "node:fs";

import { DEMO_DISCLOSURES } from "./config.mjs";

const MAX_DISCLOSURE_LENGTH = 60;

function stripPromptComments(prompt) {
  return prompt
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .trim();
}

function renderPrompt(template, values) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{{${key}}}`, value ?? ""),
    template,
  );
}

function disclosureError(normalized) {
  const length = Array.from(normalized).length;

  if (!normalized) return "Disclosure为空";
  if (normalized.includes("\n")) return "Disclosure不能换行";
  if (!/^(?:[^。！？!?\r\n]+。){2}$/u.test(normalized)) return "自我披露须恰好两句，每句以中文句号结尾";
  if (length > MAX_DISCLOSURE_LENGTH) return `Disclosure超过${MAX_DISCLOSURE_LENGTH}个字符`;
  return null;
}

function historyForPrompt(history) {
  if (!history.length) return "尚无此前对话。";
  return history
    .slice(-5)
    .map((turn) => `第${turn.round_number}轮用户：${turn.user_message}`)
    .join("\n");
}

export function createReplyGenerator({
  promptPath,
  apiKey,
  apiUrl,
  model,
  demoMode,
}) {
  const promptTemplate = stripPromptComments(readFileSync(promptPath, "utf8"));

  async function callDeepSeek(messages, sessionId) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.5,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 512,
        stream: false,
        user_id: sessionId,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`DeepSeek API返回${response.status}: ${detail}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek API未返回文本内容");

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("DeepSeek返回内容不是有效JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("DeepSeek返回内容不是有效回复对象");
    }
    return parsed;
  }

  return async function generateReply({
    roundNumber,
    theme,
    fixedQuestion,
    userMessage,
    history,
    sessionId,
  }) {
    if (demoMode) {
      return {
        disclosure: DEMO_DISCLOSURES[roundNumber],
        latencyMs: null,
      };
    }

    if (!apiKey || !apiUrl || !model) {
      throw new Error("DeepSeek尚未配置。请填写.env中的API地址、模型和密钥。");
    }

    const systemPrompt = renderPrompt(promptTemplate, {
      ROUND_THEME: theme,
      FIXED_QUESTION: fixedQuestion,
    });
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `此前对话：\n${historyForPrompt(history)}\n用户当前表达：\n${userMessage}` },
    ];

    const startedAt = Date.now();
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const reply = await callDeepSeek(messages, sessionId);
        const disclosure = typeof reply.disclosure === "string" ? reply.disclosure.trim() : "";
        const validationError = disclosureError(disclosure);
        if (!validationError) {
          return { disclosure, latencyMs: Date.now() - startedAt };
        }
        lastError = new Error(validationError);
        messages.push({ role: "assistant", content: JSON.stringify(reply) });
        messages.push({
          role: "user",
          content: `上次输出不合格：${validationError}。请修正，并只返回JSON对象。`,
        });
      } catch (error) {
        lastError = error;
        if (attempt < 3) continue;
      }
    }

    throw new Error(`回复生成失败：${lastError?.message ?? "未知错误"}`);
  };
}
