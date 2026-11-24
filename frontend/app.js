const SESSION_STORAGE_KEY = "disclosure_experiment_session_id";
const CHARACTER_DELAY_MS = 30;
const SLOW_POST_API_DELAY_MS = 6000;
const SLOW_PERIOD_PAUSE_MS = 3000;
const TOTAL_ROUNDS = 6;
const API_BASE_URL = String(window.EXPERIMENT_CONFIG?.API_BASE_URL || "http://127.0.0.1:4174").replace(/\/$/, "");

const loginView = document.querySelector("#login-view");
const loginForm = document.querySelector("#login-form");
const passwordInput = document.querySelector("#password-input");
const loginError = document.querySelector("#login-error");
const experimentView = document.querySelector("#experiment-view");
const chatShell = document.querySelector("#chat-shell");
const starter = document.querySelector("#starter");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const chatError = document.querySelector("#chat-error");
const roundCurrent = document.querySelector("#round-current");
const roundRemaining = document.querySelector("#round-remaining");
const countdownStatus = document.querySelector("#countdown-status");
const countdownNumber = document.querySelector("#countdown-number");
const completionPanel = document.querySelector("#completion-panel");
const completionTitle = document.querySelector("#completion-title");
const completionCode = document.querySelector("#completion-code");
const copyCodeButton = document.querySelector("#copy-code");
const copyStatus = document.querySelector("#copy-status");
const messageTemplate = document.querySelector("#message-template");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const state = {
  session: null,
  busy: false,
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试。");
  return payload;
}

function setChatEnabled(enabled) {
  chatInput.disabled = !enabled;
  sendButton.disabled = !enabled;
  if (enabled) chatInput.focus();
}

function resizeTextarea() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 150)}px`;
}

function scrollToLatest() {
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
}

function createMessage(role) {
  const row = messageTemplate.content.firstElementChild.cloneNode(true);
  row.classList.add(role);
  const content = row.querySelector(".message-content");
  messages.append(row);
  return { row, content };
}

function addUserMessage(text) {
  const { row, content } = createMessage("user");
  content.textContent = text;
  scrollToLatest();
  return row;
}

function replyParagraphs({ generatedDisclosure, fixedQuestion }) {
  if (generatedDisclosure) return [generatedDisclosure, fixedQuestion];
  return [fixedQuestion];
}

function addBotMessage(reply) {
  const { row, content } = createMessage("bot");
  for (const text of replyParagraphs(reply)) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    content.append(paragraph);
  }
  scrollToLatest();
  return row;
}

function addThinking() {
  const { row, content } = createMessage("bot");
  content.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span>';
  scrollToLatest();
  return row;
}

async function typeInto(element, text, periodPauseMs) {
  for (const character of Array.from(text)) {
    element.textContent += character;
    scrollToLatest();
    await sleep(CHARACTER_DELAY_MS);
    if (character === "。" && periodPauseMs > 0) {
      await sleep(periodPauseMs);
    }
  }
}

async function animateBotMessage(reply) {
  const { content } = createMessage("bot");
  const periodPauseMs = reply.pace === "slow" ? SLOW_PERIOD_PAUSE_MS : 0;
  content.classList.add("is-typing");

  const paragraphs = replyParagraphs(reply);
  for (const [index, text] of paragraphs.entries()) {
    const paragraph = document.createElement("p");
    content.append(paragraph);
    await typeInto(paragraph, text, periodPauseMs);

    // 披露末尾句号的停顿也用于换段。旧回复缺少句号时保留换段停顿。
    if (periodPauseMs && index < paragraphs.length - 1 && !text.endsWith("。")) {
      await sleep(periodPauseMs);
    }
  }
  content.classList.remove("is-typing");
}

function updateRoundDisplay() {
  const completed = state.session?.currentRound ?? 0;
  if (completed >= TOTAL_ROUNDS) {
    roundCurrent.textContent = "已完成 6 轮对话";
    roundRemaining.textContent = "实验已结束";
    return;
  }

  const current = completed + 1;
  const remainingAfterCurrent = TOTAL_ROUNDS - current;
  roundCurrent.textContent = `第 ${current} 轮，共 ${TOTAL_ROUNDS} 轮`;
  roundRemaining.textContent = remainingAfterCurrent > 0
    ? `完成本轮后还剩 ${remainingAfterCurrent} 轮`
    : "完成本轮后实验结束";
}

function enterExperiment() {
  loginView.classList.add("is-hidden");
  experimentView.classList.remove("is-hidden");
  updateRoundDisplay();
}

function setConversationStarted(started) {
  chatShell.classList.toggle("is-empty", !started);
  starter.classList.toggle("is-hidden", started);
}

function hydrateSession(session) {
  state.session = session;
  messages.replaceChildren();
  enterExperiment();
  setConversationStarted(session.turns.length > 0);

  for (const turn of session.turns) {
    addUserMessage(turn.userMessage);
    addBotMessage(turn);
  }
  updateRoundDisplay();

  if (session.completed) {
    setChatEnabled(false);
    showCompletion(session.completionCode);
  } else {
    setChatEnabled(!session.inFlight);
    if (session.inFlight) resumeInFlightSession();
  }
}

async function resumeInFlightSession() {
  const thinking = addThinking();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await sleep(1200);
    try {
      const session = await api(`/api/session/${encodeURIComponent(state.session.sessionId)}`);
      if (!session.inFlight) {
        thinking.remove();
        chatError.textContent = "";
        hydrateSession(session);
        return;
      }
    } catch {
      break;
    }
  }
  thinking.remove();
  chatError.textContent = "会话恢复超时，请刷新页面重试。";
}

async function showCountdownAndCompletion(code) {
  chatShell.classList.add("is-completed");
  countdownNumber.textContent = "2";
  countdownStatus.classList.remove("is-hidden");
  scrollToLatest();
  await sleep(1000);
  countdownNumber.textContent = "1";
  await sleep(1000);
  countdownStatus.classList.add("is-hidden");
  showCompletion(code);
}

function showCompletion(code) {
  chatShell.classList.add("is-completed");
  completionCode.textContent = code;
  copyStatus.textContent = "";
  completionPanel.classList.remove("is-hidden");
  completionTitle.focus({ preventScroll: true });
  scrollToLatest();
}

async function copyCompletionCode() {
  const code = completionCode.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const input = document.createElement("textarea");
    input.value = code;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  copyStatus.textContent = "已复制，请粘贴到问卷中。";
}

async function submitMessage(message) {
  if (state.busy || !state.session) return;
  state.busy = true;
  chatError.textContent = "";
  setChatEnabled(false);
  setConversationStarted(true);

  const userRow = addUserMessage(message);
  const thinkingRow = addThinking();

  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: state.session.sessionId, message }),
    });

    if (result.pace === "slow") {
      await sleep(SLOW_POST_API_DELAY_MS);
    }

    thinkingRow.remove();
    await animateBotMessage(result);

    state.session.currentRound = result.currentRound;
    state.session.completed = result.completed;
    state.session.completionCode = result.completionCode;
    updateRoundDisplay();

    if (result.completed) {
      await showCountdownAndCompletion(result.completionCode);
    } else {
      setChatEnabled(true);
    }
  } catch (error) {
    thinkingRow.remove();
    userRow.remove();
    chatInput.value = message;
    resizeTextarea();
    chatError.textContent = error.message;
    setChatEnabled(true);
  } finally {
    state.busy = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const password = passwordInput.value.trim();
  if (!/^[1-4]$/.test(password)) {
    loginError.textContent = "请输入正确的随机数格式。";
    return;
  }

  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    const session = await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    localStorage.setItem(SESSION_STORAGE_KEY, session.sessionId);
    hydrateSession(session);
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = "";
  resizeTextarea();
  submitMessage(message);
});

chatInput.addEventListener("input", resizeTextarea);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

copyCodeButton.addEventListener("click", copyCompletionCode);

async function bootstrap() {
  const sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    passwordInput.focus();
    return;
  }

  try {
    const session = await api(`/api/session/${encodeURIComponent(sessionId)}`);
    if (session.completed) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      passwordInput.focus();
      return;
    }
    hydrateSession(session);
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    passwordInput.focus();
  }
}

bootstrap();
