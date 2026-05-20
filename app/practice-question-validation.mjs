export const PRACTICE_QUESTION_TYPES = ["multiple-choice", "true-false", "select-all"];

const MAX_PROMPT_CHARS = 360;
const MAX_CHOICE_CHARS = 220;
const MAX_EXPLANATION_CHARS = 500;

export function parsePracticeQuestion(text) {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const question = normalizePracticeQuestion(parsed);
      if (question) return question;
    } catch {
      continue;
    }
  }
  return null;
}

export function normalizePracticeQuestion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const type = String(value.type || "").trim();
  if (!PRACTICE_QUESTION_TYPES.includes(type)) return null;

  const prompt = clean(value.prompt).slice(0, MAX_PROMPT_CHARS);
  if (!prompt) return null;

  const choices = normalizeChoices(value.choices);
  if (!isValidChoiceCount(type, choices.length)) return null;

  const correctChoiceIds = normalizeCorrectChoiceIds(value.correctChoiceIds, choices);
  if (!isValidCorrectCount(type, correctChoiceIds.length, choices.length)) return null;

  if (type === "true-false") {
    const labels = choices.map(choice => normalizedText(choice.text));
    if (!labels.includes("true") || !labels.includes("false")) return null;
  }

  return {
    type,
    prompt,
    choices,
    correctChoiceIds,
    explanation: clean(value.explanation).slice(0, MAX_EXPLANATION_CHARS)
  };
}

export function parsePracticeQuestionJudgment(text, question) {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (parsed.supportedByCard !== true) return false;
      if (parsed.correctAnswersValid !== true) return false;
      if (parsed.distractorsPlausible !== true) return false;
      if (parsed.beginnerSafe !== true) return false;
      if (parsed.ambiguous === true) return false;
      if (parsed.answerableWithStudyContext !== true) return false;
      return Boolean(question);
    } catch {
      continue;
    }
  }
  return false;
}

function normalizeChoices(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  const seenText = new Set();
  const choices = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = clean(item.id).slice(0, 24);
    const text = clean(item.text).slice(0, MAX_CHOICE_CHARS);
    const textKey = normalizedText(text);
    if (!id || !text || seenIds.has(id) || seenText.has(textKey)) continue;
    seenIds.add(id);
    seenText.add(textKey);
    choices.push({ id, text });
  }
  return choices.slice(0, 6);
}

function normalizeCorrectChoiceIds(value, choices) {
  if (!Array.isArray(value)) return [];
  const choiceIds = new Set(choices.map(choice => choice.id));
  const seen = new Set();
  return value
    .map(id => clean(id).slice(0, 24))
    .filter(id => choiceIds.has(id))
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function isValidChoiceCount(type, count) {
  if (type === "true-false") return count === 2;
  if (type === "multiple-choice") return count >= 3 && count <= 5;
  if (type === "select-all") return count >= 4 && count <= 6;
  return false;
}

function isValidCorrectCount(type, correctCount, choiceCount) {
  if (type === "true-false") return correctCount === 1;
  if (type === "multiple-choice") return correctCount === 1;
  if (type === "select-all") return correctCount >= 2 && correctCount < choiceCount;
  return false;
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

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
