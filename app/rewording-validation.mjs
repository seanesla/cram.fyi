const MAX_FRONT_CHARS = 260;

export function buildRewordContract(card) {
  const front = cleanFront(card?.front);
  const answerKind = inferAnswerKind(front);
  const protectedAnchors = extractProtectedAnchors(front, answerKind);

  return {
    version: 1,
    answerKind,
    protectedAnchors,
    mustKeepAnchor: protectedAnchors.length > 0,
    forbiddenAnswerSeeking: protectedAnchors.length > 0 && ["definition", "criterion", "function"].includes(answerKind)
  };
}

export function parseCandidateRewordFronts(text, originalFront) {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const variants = Array.isArray(parsed.variants) ? parsed.variants : [];
      const seen = new Set();
      const candidates = [];

      for (const variant of variants) {
        const front = readCandidateFront(variant, originalFront);
        if (!front) continue;

        const key = normalizedText(front);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(front);
        if (candidates.length === 5) return candidates;
      }

      return candidates;
    } catch {
      continue;
    }
  }
  return [];
}

export function filterCandidatesByContract(candidates, contract) {
  if (!contract || !contract.mustKeepAnchor) return candidates;
  return candidates.filter(candidate => includesAnyAnchor(candidate, contract.protectedAnchors));
}

export function parseJudgedRewordVariants(text, candidateFronts, originalFront) {
  const allowedCandidates = new Map();
  candidateFronts.forEach(front => {
    const cleaned = readCandidateFront(front, originalFront);
    if (cleaned) allowedCandidates.set(normalizedText(cleaned), cleaned);
  });

  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const judgments = Array.isArray(parsed.judgments) ? parsed.judgments : [];
      const seen = new Set();
      const accepted = [];

      for (const judgment of judgments) {
        if (!judgment || typeof judgment !== "object" || Array.isArray(judgment)) continue;
        if (judgment.fixedBackStillAnswers !== true) continue;
        if (judgment.answerTargetChanged !== false) continue;
        if (judgment.fullCreditWithFixedBack !== true) continue;

        const key = normalizedText(judgment.front);
        const front = allowedCandidates.get(key);
        if (!front || seen.has(key)) continue;

        seen.add(key);
        accepted.push(front);
        if (accepted.length === 3) return accepted;
      }

      return accepted;
    } catch {
      continue;
    }
  }
  return [];
}

function inferAnswerKind(front) {
  const text = normalizedText(front);
  if (!text) return "other";
  if (/^why\b/.test(text)) return "reason";
  if (/^how\b/.test(text)) return "explanation";
  if (/\bcompare\b|\bdiffer\b|\bdifference\b/.test(text)) return "comparison";
  if (/\bexample\b|\bexamples\b/.test(text)) return "example";
  if (/^what (?:are|were) the\b/.test(text) || /\blist\b/.test(text)) return "list";
  if (/^how many\b|\bnumber\b/.test(text)) return "number";
  if (/^what (?:does|do) .+ use to\b/.test(text)) return "criterion";
  if (/^what (?:does|do) .+ do\b/.test(text) || /^what is .+ used for\b/.test(text)) return "function";
  if (extractDefinitionAnchor(front)) return "definition";
  return "other";
}

function extractProtectedAnchors(front, answerKind) {
  const anchors = [];
  if (answerKind === "definition") {
    const anchor = extractDefinitionAnchor(front);
    if (anchor) anchors.push(anchor);
  }
  if (answerKind === "criterion") {
    const match = cleanFront(front).match(/^what\s+(?:does|do)\s+(.+?)\s+use\s+to\b/i);
    if (match) anchors.push(cleanAnchor(match[1]));
  }
  if (answerKind === "function") {
    const usedFor = cleanFront(front).match(/^what\s+is\s+(.+?)\s+used\s+for\??$/i);
    const doesDo = cleanFront(front).match(/^what\s+(?:does|do)\s+(.+?)\s+do\??$/i);
    const anchor = usedFor ? usedFor[1] : doesDo ? doesDo[1] : "";
    if (anchor) anchors.push(cleanAnchor(anchor));
  }
  return [...new Set(anchors.map(cleanAnchor).filter(Boolean))];
}

function extractDefinitionAnchor(front) {
  const text = cleanFront(front).replace(/[?!.]+$/g, "").trim();
  const patterns = [
    /^define\s+(.+?)$/i,
    /^what\s+(?:does|do)\s+(.+?)\s+mean$/i,
    /^what\s+is\s+the\s+meaning\s+of\s+(.+?)$/i,
    /^what\s+(?:is|are|was|were)\s+(.+?)$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const anchor = cleanAnchor(match[1]);
    if (anchor && isDefinitionAnchor(anchor)) return anchor;
  }
  return "";
}

function isDefinitionAnchor(anchor) {
  const text = normalizedText(anchor);
  if (!text) return false;
  const rejected = [
    /\bused for\b/,
    /\bspecial about\b/,
    /\bdifference between\b/,
    /\bone difference\b/,
    /\bexamples? of\b/,
    /\bmain traits\b/,
    /\bkey traits\b/,
    /\bthree main\b/,
    /\bfour distinguishing\b/,
    /\bfive\b/,
    /\bhow many\b/,
    /\bwhy\b/,
    /\bhow\b/
  ];
  return !rejected.some(pattern => pattern.test(text));
}

function includesAnyAnchor(candidate, anchors) {
  const text = normalizedText(candidate);
  return anchors.some(anchor => anchorVariants(anchor).some(variant => variant && text.includes(variant)));
}

function anchorVariants(anchor) {
  const text = stripLeadingArticle(normalizedText(anchor));
  const variants = new Set([text]);
  if (text.endsWith("s")) variants.add(text.slice(0, -1));
  else variants.add(`${text}s`);
  return [...variants];
}

function readCandidateFront(value, originalFront) {
  const front = cleanFront(value && typeof value === "object" && !Array.isArray(value) ? value.front : value);
  if (!front || front.length > MAX_FRONT_CHARS) return "";
  if (normalizedText(front) === normalizedText(originalFront)) return "";
  return front;
}

function getJsonCandidates(text) {
  const raw = String(text || "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const object = raw.match(/\{[\s\S]*\}/);
  if (object) candidates.push(object[0]);
  return candidates;
}

function cleanFront(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAnchor(value) {
  return cleanFront(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingArticle(value) {
  return String(value || "").replace(/^(?:a|an|the)\s+/i, "");
}
