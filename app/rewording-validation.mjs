const MAX_FRONT_CHARS = 260;

export function parseAcceptedRewordVariants(text, originalFront) {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const variants = Array.isArray(parsed.variants) ? parsed.variants : [];
      const seen = new Set();
      const accepted = [];

      for (const variant of variants) {
        const front = readAcceptedFront(variant, originalFront);
        if (!front) continue;

        const key = normalizedText(front);
        if (seen.has(key)) continue;
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

function readAcceptedFront(variant, originalFront) {
  if (!variant || typeof variant !== "object" || Array.isArray(variant)) return "";
  if (variant.fixedBackStillAnswers !== true) return "";
  if (variant.answerTargetChanged !== false) return "";

  const front = cleanFront(variant.front);
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
