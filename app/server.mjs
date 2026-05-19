import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCandidateRewordFronts, parseJudgedRewordVariants } from "./rewording-validation.mjs";

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
const REWORD_MODEL = "gpt-5.4-mini";
const REWORD_EFFORT = "low";
const MAX_REWORD_CONTEXT_CHARS = 1800;
const ETA_MODEL = REWORD_MODEL;
const ETA_EFFORT = "low";
const ETA_CODEX_CWD = ROOT;
const ETA_CODEX_WORKSPACE_ROOTS = [ROOT];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

async function handleRewordCard(req, res) {
  const body = await readJson(req);
  const card = normalizeCard(body.card);
  if (!card.front || !card.back) {
    return sendJson(res, 400, { error: "Card front and back are required." });
  }

  const available = await codex.hasModel(REWORD_MODEL);
  if (!available) {
    return sendJson(res, 503, { error: `${REWORD_MODEL} is not available. Rewording was skipped.` });
  }

  const candidateReply = await codex.askOneShot({
    sessionId: `reword-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: REWORD_MODEL,
    effort: REWORD_EFFORT,
    summary: "none",
    baseInstructions: buildRewordInstructions(),
    developerInstructions: "Return only JSON. Do not run tools. Do not browse. Do not edit files.",
    prompt: buildRewordPrompt(card)
  });
  const candidates = parseCandidateRewordFronts(candidateReply, card.front);
  if (!candidates.length) {
    return sendJson(res, 502, { error: "Codex did not return usable variants." });
  }

  const judgeReply = await codex.askOneShot({
    sessionId: `reword-judge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: REWORD_MODEL,
    effort: REWORD_EFFORT,
    summary: "none",
    baseInstructions: buildRewordJudgeInstructions(),
    developerInstructions: "Return only JSON. Do not run tools. Do not browse. Do not edit files.",
    prompt: buildRewordJudgePrompt(card, candidates)
  });
  const variants = parseJudgedRewordVariants(judgeReply, candidates, card.front);
  if (!variants.length) {
    return sendJson(res, 502, { error: "Codex did not approve any safe variants." });
  }
  return sendJson(res, 200, { variants, model: REWORD_MODEL });
}

async function handleMasteryEta(req, res) {
  const body = await readJson(req);
  const stats = sanitizeMasteryEtaStats(body.stats);
  if (!stats) return sendJson(res, 400, { error: "Valid mastery ETA stats are required." });

  const fallback = buildMathOnlyMasteryEta(stats);
  try {
    const reply = await codex.askOneShot({
      sessionId: `mastery-eta-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      model: ETA_MODEL,
      effort: ETA_EFFORT,
      summary: "none",
      cwd: ETA_CODEX_CWD,
      workspaceRoots: ETA_CODEX_WORKSPACE_ROOTS,
      baseInstructions: buildMasteryEtaInstructions(),
      developerInstructions: "Return only strict JSON. Do not run tools. Do not browse. Do not edit files.",
      prompt: buildMasteryEtaPrompt(stats)
    });
    const parsed = JSON.parse(String(reply || "").trim());
    const interpretation = validateMasteryEtaInterpretation(parsed, stats);
    return sendJson(res, 200, { interpretation, source: "codex", model: ETA_MODEL });
  } catch (error) {
    return sendJson(res, 200, {
      interpretation: fallback,
      source: "math",
      error: formatMasteryEtaError(error)
    });
  }
}

function sanitizeMasteryEtaStats(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const totalSelected = cleanInteger(input.totalSelected, 0, 100000);
  const mastered = cleanInteger(input.mastered, 0, totalSelected);
  const fastestPathAnswers = cleanInteger(input.fastestPathAnswers, 0, 1000000);
  const mathAnswerRange = cleanRange(input.mathAnswerRange, { min: fastestPathAnswers, max: 1000000, allowNull: false });
  if (!mathAnswerRange) return null;
  const mathAnswerBounds = cleanBounds(input.mathAnswerBounds, mathAnswerRange);
  const mathMinuteRange = cleanRange(input.mathMinuteRange, { min: 0, max: 1000000, allowNull: true });
  const mathMinuteBounds = mathMinuteRange ? cleanBounds(input.mathMinuteBounds, mathMinuteRange) : null;

  return {
    version: 1,
    totalSelected,
    mastered,
    tierCounts: {
      unfamiliar: cleanInteger(input.tierCounts?.unfamiliar, 0, totalSelected),
      somewhatFamiliar: cleanInteger(input.tierCounts?.somewhatFamiliar, 0, totalSelected),
      familiar: cleanInteger(input.tierCounts?.familiar, 0, totalSelected),
      mastered: cleanInteger(input.tierCounts?.mastered, 0, totalSelected)
    },
    remainingCards: cleanInteger(input.remainingCards, 0, totalSelected),
    currentQueue: {
      remainingInQueue: cleanInteger(input.currentQueue?.remainingInQueue, 0, 100000),
      new: cleanInteger(input.currentQueue?.new, 0, 100000),
      review: cleanInteger(input.currentQueue?.review, 0, 100000),
      missedLastRound: cleanInteger(input.currentQueue?.missedLastRound, 0, 100000),
      almostMastered: cleanInteger(input.currentQueue?.almostMastered, 0, 100000)
    },
    fastestPathAnswers,
    mathAnswerRange,
    mathAnswerBounds,
    mathMinuteRange,
    mathMinuteBounds,
    recentAccuracy: cleanRatio(input.recentAccuracy),
    historicalAccuracy: cleanRatio(input.historicalAccuracy),
    recentMedianSeconds: cleanOptionalNumber(input.recentMedianSeconds, 1, 3600),
    historicalMedianSeconds: cleanOptionalNumber(input.historicalMedianSeconds, 1, 3600),
    recentAnswersPerMinute: cleanOptionalNumber(input.recentAnswersPerMinute, 0.01, 600),
    historicalAnswersPerMinute: cleanOptionalNumber(input.historicalAnswersPerMinute, 0.01, 600),
    timing: {
      recentEvents: cleanInteger(input.timing?.recentEvents, 0, 100000),
      historicalAnswers: cleanInteger(input.timing?.historicalAnswers, 0, 1000000),
      idleClipped: cleanInteger(input.timing?.idleClipped, 0, 1000000)
    },
    confidenceFlags: cleanConfidenceFlags(input.confidenceFlags)
  };
}

function buildMasteryEtaInstructions() {
  return [
    "You interpret aggregate flashcard mastery ETA stats for cram.fyi.",
    "You are not given card fronts, backs, topics, study guides, file paths, or private class content.",
    "Use only the numeric stats packet in the prompt.",
    "Choose a clear ballpark range inside the provided math guardrails.",
    "Return only JSON shaped exactly like:",
    "{\"label\":\"about 45-70 min · 130-190 answers\",\"answerRange\":{\"low\":130,\"high\":190},\"minuteRange\":{\"low\":45,\"high\":70},\"confidence\":\"medium\",\"reason\":\"short reason\"}",
    "Use confidence as one of low, medium, or high.",
    "If minuteRange in the packet is null, return minuteRange null and make the label answer-count-only.",
    "The label must not include the prefix Mastery ETA:."
  ].join("\n");
}

function buildMasteryEtaPrompt(stats) {
  return [
    "Interpret this sanitized aggregate stats packet.",
    "",
    JSON.stringify(stats, null, 2),
    "",
    "Rules:",
    "- answerRange.low must be at least mathAnswerRange.low.",
    "- answerRange.high must be no more than mathAnswerRange.high.",
    "- minuteRange must stay inside mathMinuteRange when mathMinuteRange is present.",
    "- Widen the chosen range when confidenceFlags include lowAccuracy or unstableAccuracy.",
    "- Keep reason under 140 characters.",
    "- Return only strict JSON with no Markdown."
  ].join("\n");
}

function validateMasteryEtaInterpretation(value, stats) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mastery ETA JSON must be an object.");
  const answerRange = readRangeInside(value.answerRange, stats.mathAnswerRange.low, stats.mathAnswerRange.high);
  if (!answerRange) throw new Error("Mastery ETA answer range is outside math bounds.");
  const minuteRange = stats.mathMinuteRange
    ? readRangeInside(value.minuteRange, stats.mathMinuteRange.low, stats.mathMinuteRange.high)
    : null;
  if (stats.mathMinuteRange && !minuteRange) throw new Error("Mastery ETA minute range is outside math bounds.");
  const confidence = ["low", "medium", "high"].includes(value.confidence) ? value.confidence : "";
  if (!confidence) throw new Error("Mastery ETA confidence is invalid.");
  const rawLabel = cleanShortText(value.label, 140);
  const reason = cleanShortText(value.reason, 180);
  if (!rawLabel || !reason) throw new Error("Mastery ETA label and reason are required.");
  const label = minuteRange
    ? `about ${formatEtaMinuteRange(minuteRange)} · ${formatEtaAnswerRange(answerRange)}`
    : `about ${formatEtaAnswerRange(answerRange)}`;
  return { label, answerRange, minuteRange, confidence, reason };
}

function buildMathOnlyMasteryEta(stats) {
  if (stats.confidenceFlags.includes("simulationCapHit")) {
    return {
      label: `estimate too uncertain · fastest path: ${formatEtaAnswerCount(stats.fastestPathAnswers)}`,
      answerRange: { low: stats.fastestPathAnswers, high: stats.fastestPathAnswers },
      minuteRange: null,
      confidence: "low",
      reason: "The local scheduler simulation hit its answer cap."
    };
  }
  if (!stats.mathMinuteRange) {
    return {
      label: `answer a few more cards to estimate time · fastest path: ${formatEtaAnswerCount(stats.fastestPathAnswers)}`,
      answerRange: stats.mathAnswerRange,
      minuteRange: null,
      confidence: "low",
      reason: "There is not enough timing history yet."
    };
  }
  const confidence = stats.confidenceFlags.includes("lowAccuracy") || stats.confidenceFlags.includes("unstableAccuracy")
    ? "low"
    : "medium";
  return {
    label: `about ${formatEtaMinuteRange(stats.mathMinuteRange)} · ${formatEtaAnswerRange(stats.mathAnswerRange)}`,
    answerRange: stats.mathAnswerRange,
    minuteRange: stats.mathMinuteRange,
    confidence,
    reason: "Codex was unavailable, so cram.fyi used the local math estimate."
  };
}

function cleanRange(value, { min, max, allowNull }) {
  if (value === null && allowNull) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const low = cleanInteger(value.low, min, max);
  const high = cleanInteger(value.high, low, max);
  if (low < min || high > max || low > high) return null;
  return { low, high };
}

function readRangeInside(value, min, max) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const low = Number(value.low);
  const high = Number(value.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const roundedLow = Math.round(low);
  const roundedHigh = Math.round(high);
  if (roundedLow !== low || roundedHigh !== high) return null;
  if (roundedLow < min || roundedHigh > max || roundedLow > roundedHigh) return null;
  return { low: roundedLow, high: roundedHigh };
}

function cleanBounds(value, range) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      lower: range.low,
      base: Math.round((range.low + range.high) / 2),
      upper: range.high
    };
  }
  const lower = cleanInteger(value.lower, range.low, range.high);
  const base = cleanInteger(value.base, lower, range.high);
  const upper = cleanInteger(value.upper, base, range.high);
  return { lower, base, upper };
}

function cleanInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanRatio(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, Math.round(number * 100) / 100));
}

function cleanOptionalNumber(value, min, max) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.round(number * 10) / 10));
}

function cleanConfidenceFlags(value) {
  const allowed = new Set([
    "noTimingData",
    "tooEarly",
    "noPaceData",
    "lowAccuracy",
    "unstableAccuracy",
    "simulationCapHit",
    "shuffleMode",
    "idleClipped"
  ]);
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || ""))
    .filter(item => allowed.has(item))
    .slice(0, 12);
}

function cleanShortText(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function formatEtaAnswerCount(count) {
  return `${count} ${count === 1 ? "answer" : "answers"}`;
}

function formatEtaAnswerRange(range) {
  if (range.low === range.high) return formatEtaAnswerCount(range.low);
  return `${range.low}-${range.high} answers`;
}

function formatEtaMinuteRange(range) {
  if (range.low === range.high) return `${range.low} min`;
  return `${range.low}-${range.high} min`;
}

function formatMasteryEtaError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/not logged in|requiresOpenaiAuth|unauthorized/i.test(message)) return "Codex is not connected.";
  return "Codex interpretation was unavailable.";
}

function normalizeCard(card) {
  const value = card && typeof card === "object" ? card : {};
  return {
    topic: String(value.topic || "General").trim().slice(0, 160),
    front: String(value.front || "").trim().slice(0, 1200),
    back: String(value.back || "").trim().slice(0, 1200)
  };
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

function buildRewordInstructions() {
  return [
    "You propose alternate cram.fyi flashcard fronts while keeping the back answer fixed.",
    "The existing back answer is the target answer. Every proposed front should be answerable by that exact back answer.",
    "Generate candidate prompts that make the student understand the same fact instead of memorizing the same wording.",
    "Never add new facts, change the answer target, or ask for information not already answered by the fixed back answer.",
    "A separate judge will reject unsafe candidates, so return only candidate front strings.",
    "Return only valid JSON shaped like {\"variants\":[\"...\",\"...\",\"...\"]}."
  ].join("\n");
}

function buildRewordPrompt(card) {
  const context = getStudyGuideExcerpt(card.topic);
  return [
    "Create 3 alternate front prompts for this flashcard.",
    "Important: the back answer below will not be rewritten. Your job is only to rewrite the front so that this exact back answer still makes sense.",
    "",
    `Topic: ${card.topic || "General"}`,
    `Original front: ${card.front}`,
    `Fixed back answer: ${card.back}`,
    "",
    "Relevant study guide context:",
    context || "(No relevant study guide excerpt found.)",
    "",
    "Rules:",
    "- The fixed back answer must directly answer every generated front.",
    "- Preserve the subject of the original front. If the original asks about Charles Lyell, the generated front must still ask about Charles Lyell.",
    "- Preserve the answer type. If the fixed back is an explanation, ask for an explanation, not a person, date, place, or term.",
    "- Do not ask \"What is the term for...?\" when the fixed back is a definition or explanation instead of the term itself.",
    "- Do not include the answer or obvious answer words in the front.",
    "- Do not make the prompt longer than the original unless needed for clarity.",
    "- Use natural wording. Do not mention AI, variants, or rewording.",
    "- Return only JSON: {\"variants\":[\"prompt 1\",\"prompt 2\",\"prompt 3\",\"prompt 4\",\"prompt 5\"]}"
  ].join("\n");
}

function buildRewordJudgeInstructions() {
  return [
    "You are a strict flashcard safety judge for cram.fyi.",
    "Your job is to decide whether each candidate front is correctly answered by the unchanged fixed back answer.",
    "Reject any candidate that changes the answer target, even if it is about the same topic.",
    "If a candidate asks for a term/name/process but the fixed back is a definition or explanation, reject it.",
    "If a candidate asks for a definition/explanation but the fixed back is only a term/name, reject it.",
    "When unsure, reject.",
    "Return only valid JSON shaped like {\"judgments\":[{\"front\":\"...\",\"fixedBackStillAnswers\":true,\"answerTargetChanged\":false,\"reason\":\"...\"}]}."
  ].join("\n");
}

function buildRewordJudgePrompt(card, candidates) {
  return [
    "Judge these candidate flashcard fronts.",
    "For each candidate, decide whether the fixed back answer would be a correct answer to that exact candidate front.",
    "",
    `Topic: ${card.topic || "General"}`,
    `Original front: ${card.front}`,
    `Fixed back answer: ${card.back}`,
    "",
    "Candidates:",
    JSON.stringify(candidates, null, 2),
    "",
    "Important examples:",
    "- If the candidate asks \"What is the term for large-scale evolutionary change?\" but the fixed back is \"Large-scale evolutionary change produced by many accumulated microevolutionary changes...\", reject it. That question expects the term, not the definition sentence.",
    "- If the candidate asks \"How would you define macroevolution?\" and the fixed back is the definition of macroevolution, accept it.",
    "",
    "Rules:",
    "- fixedBackStillAnswers is true only if the fixed back directly answers the candidate front.",
    "- answerTargetChanged is true if the candidate asks for a different kind of answer than the original front.",
    "- Do not invent new fronts. Copy each candidate front exactly into its judgment.",
    "- Return one judgment per candidate.",
    "- Return only JSON: {\"judgments\":[{\"front\":\"candidate front\",\"fixedBackStillAnswers\":false,\"answerTargetChanged\":true,\"reason\":\"short reason\"}]}"
  ].join("\n");
}

function getStudyGuideExcerpt(topic) {
  const guide = studyGuide.trim();
  if (!guide) return "";
  const cleanTopic = String(topic || "").trim().toLowerCase();
  if (!cleanTopic) return guide.slice(0, MAX_REWORD_CONTEXT_CHARS);
  const lines = guide.split(/\r?\n/);
  const topicIndex = lines.findIndex(line => line.toLowerCase().includes(cleanTopic));
  if (topicIndex === -1) return guide.slice(0, MAX_REWORD_CONTEXT_CHARS);
  let start = topicIndex;
  while (start > 0 && !/^#{1,6}\s+/.test(lines[start])) start -= 1;
  if (!/^#{1,6}\s+/.test(lines[start])) start = Math.max(0, topicIndex - 4);
  let end = topicIndex + 1;
  while (end < lines.length && !/^#{1,6}\s+/.test(lines[end])) end += 1;
  const excerpt = lines.slice(start, Math.min(end, start + 80)).join("\n").trim();
  return excerpt.slice(0, MAX_REWORD_CONTEXT_CHARS);
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

  async askOneShot({
    sessionId,
    model,
    effort,
    summary,
    prompt,
    baseInstructions,
    developerInstructions,
    cwd = CODEX_CWD,
    workspaceRoots = CODEX_WORKSPACE_ROOTS
  }) {
    await this.ensureReady();
    const response = await this.request("thread/start", {
      cwd,
      runtimeWorkspaceRoots: workspaceRoots,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions,
      developerInstructions,
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false
    });
    const session = { threadId: response.thread.id, active: null, tokenUsage: null, compacting: false };
    this.sessions.set(sessionId, session);
    try {
      return await this.startTurn(session, {
        model,
        effort,
        summary,
        prompt,
        cwd,
        workspaceRoots,
        onDelta: () => {},
        onReasoningSummaryDelta: () => {}
      });
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async startTurn(session, {
    model,
    effort,
    summary,
    prompt,
    onDelta,
    onReasoningSummaryDelta,
    cwd = CODEX_CWD,
    workspaceRoots = CODEX_WORKSPACE_ROOTS
  }) {
    let fullText = "";
    const active = {
      turnId: null,
      onDelta: chunk => {
        fullText += chunk;
        if (onDelta) onDelta(chunk);
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
        cwd,
        runtimeWorkspaceRoots: workspaceRoots,
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

  async hasModel(modelId) {
    const { models } = await this.listModels();
    return models.some(model => model.id === modelId || model.model === modelId);
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
    if (req.method === "POST" && url.pathname === "/api/reword-card") {
      return handleRewordCard(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/mastery-eta") {
      return handleMasteryEta(req, res);
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
