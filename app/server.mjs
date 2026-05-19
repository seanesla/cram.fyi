import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const START_PORT = Number(process.env.PORT || 5174);
const HOST = "127.0.0.1";
const REPO_ROOT = normalize(join(ROOT, ".."));
const DEMO_DATA_ROOT = join(REPO_ROOT, "examples");
const { dataRoot: DATA_ROOT, dataLabel: DATA_LABEL } = resolveDataRoot();
const DATA_KEY = DATA_LABEL.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default";
const STUDY_GUIDE_PATH = join(DATA_ROOT, "study-guide.md");
const FLASHCARDS_PATH = join(DATA_ROOT, "flashcards.json");
const DATA_ROOT_EXISTS = await pathExists(DATA_ROOT);
const CODEX_CWD = DATA_ROOT_EXISTS ? DATA_ROOT : REPO_ROOT;
const CODEX_WORKSPACE_ROOTS = DATA_ROOT_EXISTS ? [REPO_ROOT, DATA_ROOT] : [REPO_ROOT];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const studyGuide = await readStudyGuide();
const flashcards = await loadFlashcards();

async function readStudyGuide() {
  const primary = await readFile(STUDY_GUIDE_PATH, "utf8").catch(() => "");
  if (primary) return primary;
  if (DATA_ROOT === DEMO_DATA_ROOT) {
    return readFile(join(DEMO_DATA_ROOT, "demo-study-guide.md"), "utf8").catch(() => "");
  }
  return "";
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveDataRoot() {
  const args = process.argv.slice(2);
  const classIndex = args.indexOf("--class");
  const dataIndex = args.indexOf("--data");
  const envData = process.env.AGENTIC_FLASHCARDS_DATA;

  if (dataIndex !== -1 && args[dataIndex + 1]) {
    const dataRoot = resolve(args[dataIndex + 1]);
    return { dataRoot, dataLabel: dataRoot };
  }
  if (classIndex !== -1 && args[classIndex + 1]) {
    const className = args[classIndex + 1].replace(/[^a-zA-Z0-9._-]/g, "");
    const dataRoot = join(REPO_ROOT, "classes", className);
    return { dataRoot, dataLabel: `classes/${className}` };
  }
  if (envData) {
    const dataRoot = resolve(envData);
    return { dataRoot, dataLabel: dataRoot };
  }
  return { dataRoot: DEMO_DATA_ROOT, dataLabel: "examples" };
}

async function loadFlashcards() {
  const raw = await readFile(FLASHCARDS_PATH, "utf8").catch(() => "[]");
  try {
    const cards = JSON.parse(raw);
    if (!Array.isArray(cards)) return [];
    return cards
      .map(card => ({
        topic: String(card.topic || "General").trim() || "General",
        front: String(card.front || "").trim(),
        back: String(card.back || "").trim()
      }))
      .filter(card => card.front && card.back);
  } catch {
    return [];
  }
}

async function handleChat(req, res) {
  const body = await readJson(req);
  const message = String(body.message || "").trim();
  if (!message) return sendJson(res, 400, { error: "Message is required." });

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  const prompt = buildTutorPrompt(body);
  try {
    const reply = await codex.ask({
      sessionId: String(body.sessionId || "default"),
      model: typeof body.model === "string" ? body.model : "",
      effort: typeof body.effort === "string" ? body.effort : "",
      summary: "auto",
      prompt,
      onReasoningSummaryDelta: chunk => sendChatEvent(res, "reasoning_summary_delta", chunk),
      onDelta: chunk => sendChatEvent(res, "answer_delta", chunk)
    });
    if (!reply.trim()) sendChatEvent(res, "answer_delta", "Codex finished without returning visible text.");
  } catch (error) {
    sendChatEvent(res, "error", formatError(error));
  } finally {
    res.end();
  }
}

function sendChatEvent(res, type, value) {
  res.write(`${JSON.stringify({ type, value: String(value || "") })}\n`);
}

function buildTutorPrompt(body) {
  const card = body.card && typeof body.card === "object" ? body.card : {};
  const mastery = String(body.mastery || "unfamiliar");
  const message = String(body.message || "").trim();
  return [
    "Current flashcard:",
    `Topic: ${card.topic || "unknown"}`,
    `Question: ${card.front || "unknown"}`,
    `Answer: ${card.back || "unknown"}`,
    `Mastery tier: ${mastery}`,
    "",
    "Student message:",
    message
  ].join("\n");
}

function buildBaseInstructions() {
  return [
    "You are the live study helper inside cram.fyi.",
    "",
    "Hard rules:",
    "- Be loyal to the active study guide included below.",
    "- Explain like the student is new to the concept.",
    "- Keep the answer concise unless the student asks for more detail.",
    "- Do not edit files, run commands, browse, or ask for tool permissions.",
    "- If the student asks whether a card is relevant, answer only from the study guide/card context.",
    "",
    `Active data source: ${DATA_LABEL}`,
    "",
    "Active study guide:",
    studyGuide || "(Study guide could not be loaded.)"
  ].join("\n");
}

function formatError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/Logged in using ChatGPT/i.test(message)) return message;
  if (/not logged in|requiresOpenaiAuth|unauthorized/i.test(message)) {
    return "Codex is not logged in with ChatGPT. Run `codex login`, choose Sign in with ChatGPT, then restart this flashcard server.";
  }
  if (isContextLimitError(error)) {
    return "Codex hit the context limit. I tried compacting the thread first. If this keeps happening, use /new to start fresh.";
  }
  return `Codex helper error: ${message}`;
}

function isContextLimitError(error) {
  const text = error && error.message ? error.message : String(error);
  return /contextWindowExceeded|context window|context length|too many tokens/i.test(text);
}

function isReasoningSummaryError(error) {
  const text = error && error.message ? error.message : String(error);
  return /reasoning summary|summary.*(unsupported|not supported|unavailable|invalid)|unsupported.*summary|organization verification/i.test(text);
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/flashcards.html" : decodeURIComponent(pathname);
  const target = normalize(join(ROOT, cleanPath));
  if (!target.startsWith(ROOT)) return sendText(res, 403, "Forbidden");
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 20000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

class CodexBridge {
  constructor() {
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Map();
    this.ready = null;
    this.lastStartupError = "";
  }

  async status() {
    try {
      await this.ensureReady();
      return { ok: true, detail: "Connected to Codex App Server using local Codex auth." };
    } catch (error) {
      return { ok: false, detail: formatError(error) };
    }
  }

  resetSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { exists: false, active: false, compacting: false, tokenUsage: null };
    }
    return {
      exists: true,
      active: Boolean(session.active),
      compacting: Boolean(session.compacting),
      tokenUsage: session.tokenUsage || null
    };
  }

  async compactSession(sessionId) {
    await this.ensureReady();
    const session = await this.ensureSession(sessionId);
    if (session.active) throw new Error("Wait for the current Codex answer to finish before compacting.");
    session.compacting = true;
    try {
      await this.request("thread/compact/start", { threadId: session.threadId });
      return { ok: true };
    } finally {
      setTimeout(() => {
        const current = this.sessions.get(sessionId);
        if (current) current.compacting = false;
      }, 1500);
    }
  }

  async ask({ sessionId, model, effort, summary, prompt, onDelta, onReasoningSummaryDelta }) {
    await this.ensureReady();
    const session = await this.ensureSession(sessionId);
    if (session.active) throw new Error("Codex is still answering the previous question.");

    try {
      return await this.startTurn(session, { model, effort, summary, prompt, onDelta, onReasoningSummaryDelta });
    } catch (error) {
      if (summary && isReasoningSummaryError(error)) {
        return this.startTurn(session, { model, effort, summary: "none", prompt, onDelta, onReasoningSummaryDelta });
      }
      if (!isContextLimitError(error)) throw error;
      await this.compactSession(sessionId);
      return this.startTurn(session, { model, effort, summary, prompt, onDelta, onReasoningSummaryDelta });
    }
  }

  async startTurn(session, { model, effort, summary, prompt, onDelta, onReasoningSummaryDelta }) {
    let fullText = "";
    const active = {
      turnId: null,
      onDelta: chunk => {
        fullText += chunk;
        onDelta(chunk);
      },
      onReasoningSummaryDelta: onReasoningSummaryDelta || (() => {}),
      resolve: null,
      reject: null
    };
    const completed = new Promise((resolve, reject) => {
      active.resolve = resolve;
      active.reject = reject;
    });
    session.active = active;

    try {
      const response = await this.request("turn/start", {
        threadId: session.threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        cwd: CODEX_CWD,
        runtimeWorkspaceRoots: CODEX_WORKSPACE_ROOTS,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        model: model || null,
        effort: effort || null,
        summary: summary || null
      });
      active.turnId = response.turn.id;
      await completed;
      return fullText;
    } catch (error) {
      session.active = null;
      throw error;
    }
  }

  async ensureSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const response = await this.request("thread/start", {
      cwd: CODEX_CWD,
      runtimeWorkspaceRoots: CODEX_WORKSPACE_ROOTS,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: buildBaseInstructions(),
      developerInstructions: "Use the current flashcard plus the active study guide already in the thread instructions. Be concise, direct, and beginner-friendly.",
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false
    });
    const session = { threadId: response.thread.id, active: null, tokenUsage: null, compacting: false };
    this.sessions.set(sessionId, session);
    return session;
  }

  async listModels() {
    await this.ensureReady();
    const response = await this.request("model/list", {
      includeHidden: false,
      limit: 100
    });
    return {
      models: (response.data || []).map(model => ({
        id: model.id,
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
        defaultReasoningEffort: model.defaultReasoningEffort,
        supportedReasoningEfforts: model.supportedReasoningEfforts || []
      }))
    };
  }

  async ensureReady() {
    if (this.ready) return this.ready;
    this.ready = this.start();
    return this.ready;
  }

  async start() {
    await this.assertChatGptLogin();
    this.proc = spawn("codex", ["app-server"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", chunk => this.onData(chunk));
    this.proc.stderr.on("data", chunk => {
      this.lastStartupError = `${this.lastStartupError}${chunk}`.slice(-4000);
    });
    this.proc.on("exit", code => {
      const error = new Error(`Codex App Server exited${code === null ? "" : ` with code ${code}`}. ${this.lastStartupError}`.trim());
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const session of this.sessions.values()) {
        if (session.active) session.active.reject(error);
      }
      this.sessions.clear();
      this.proc = null;
      this.ready = null;
    });
    await this.request("initialize", {
      clientInfo: { name: "cram.fyi", title: "cram.fyi", version: "1.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false }
    });
  }

  assertChatGptLogin() {
    return new Promise((resolve, reject) => {
      const check = spawn("codex", ["login", "status"], { cwd: REPO_ROOT });
      let out = "";
      let err = "";
      check.stdout.setEncoding("utf8");
      check.stderr.setEncoding("utf8");
      check.stdout.on("data", chunk => { out += chunk; });
      check.stderr.on("data", chunk => { err += chunk; });
      check.on("error", reject);
      check.on("close", code => {
        const text = `${out}\n${err}`;
        if (code === 0 && /Logged in using ChatGPT/i.test(text)) return resolve();
        reject(new Error("Codex is not logged in with ChatGPT. Run `codex login`, choose Sign in with ChatGPT, then restart this flashcard server."));
      });
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) return reject(new Error("Codex App Server is not running."));
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload, error => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch {
        this.lastStartupError = `Could not parse Codex message: ${line}`.slice(-4000);
      }
    }
  }

  onMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed."));
      else pending.resolve(message.result);
      return;
    }

    if (message.id && message.method) {
      this.answerServerRequest(message);
      return;
    }

    const params = message.params || {};
    const session = [...this.sessions.values()].find(item => item.threadId === params.threadId);
    if (!session) return;

    if (message.method === "thread/tokenUsage/updated") {
      session.tokenUsage = params.tokenUsage || null;
      return;
    }
    if (message.method === "thread/compacted") {
      session.compacting = false;
      return;
    }
    if (!session.active) return;

    if (message.method === "item/agentMessage/delta") {
      if (!session.active.turnId || params.turnId === session.active.turnId) {
        session.active.onDelta(params.delta || "");
      }
    }
    if (message.method === "item/reasoning/summaryTextDelta") {
      if (!session.active.turnId || params.turnId === session.active.turnId) {
        session.active.onReasoningSummaryDelta(params.delta || "");
      }
    }
    if (message.method === "error") {
      if (!session.active.turnId || params.turnId === session.active.turnId) {
        session.active.reject(new Error(params.error?.message || "Codex turn failed."));
        session.active = null;
      }
    }
    if (message.method === "turn/completed") {
      if (!session.active.turnId || params.turn?.id === session.active.turnId) {
        const active = session.active;
        session.active = null;
        session.compacting = false;
        if (params.turn?.status === "failed") {
          active.reject(new Error(params.turn.error?.message || "Codex turn failed."));
        } else {
          active.resolve();
        }
      }
    }
  }

  answerServerRequest(message) {
    let result = {};
    if (message.method === "item/commandExecution/requestApproval") {
      result = { decision: "denied" };
    } else if (message.method === "item/fileChange/requestApproval") {
      result = { decision: "denied" };
    } else if (message.method === "item/tool/requestUserInput") {
      result = { answers: {} };
    }
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  }
}

const codex = new CodexBridge();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${START_PORT}`);
    if (req.method === "GET" && url.pathname === "/api/deck") {
      return sendJson(res, 200, { cards: flashcards, dataSource: DATA_LABEL, storageKey: DATA_KEY });
    }
    if (req.method === "GET" && url.pathname === "/api/study-guide") {
      return sendJson(res, 200, { markdown: studyGuide, dataSource: DATA_LABEL, storageKey: DATA_KEY });
    }
    if (req.method === "GET" && url.pathname === "/api/codex-status") {
      return sendJson(res, 200, await codex.status());
    }
    if (req.method === "GET" && url.pathname === "/api/codex-models") {
      return sendJson(res, 200, await codex.listModels());
    }
    if (req.method === "GET" && url.pathname === "/api/codex-session-status") {
      return sendJson(res, 200, codex.getSessionStatus(String(url.searchParams.get("sessionId") || "default")));
    }
    if (req.method === "POST" && url.pathname === "/api/flashcard-chat/compact") {
      const body = await readJson(req);
      return sendJson(res, 200, await codex.compactSession(String(body.sessionId || "default")));
    }
    if (req.method === "POST" && url.pathname === "/api/flashcard-chat/reset") {
      const body = await readJson(req);
      codex.resetSession(String(body.sessionId || "default"));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/flashcard-chat") {
      return handleChat(req, res);
    }
    if (req.method !== "GET") return sendText(res, 405, "Method not allowed");
    return serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

listenWithFallback(server, START_PORT);

function listenWithFallback(targetServer, port) {
  targetServer.once("error", error => {
    if (error.code === "EADDRINUSE" && port < START_PORT + 20) {
      listenWithFallback(targetServer, port + 1);
      return;
    }
    throw error;
  });
  targetServer.listen(port, HOST, () => {
    console.log(`cram.fyi: http://${HOST}:${port}/flashcards.html`);
    console.log(`Data source: ${DATA_LABEL}`);
    console.log("Live helper: Codex App Server bridge using your ChatGPT login.");
  });
}
