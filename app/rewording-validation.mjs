const MAX_FRONT_CHARS = 260;

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

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
