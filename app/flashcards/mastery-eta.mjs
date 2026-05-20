import {
  getCardReason,
  getMastery
} from "./scheduler.mjs";

const MAX_RECENT_EVENTS = 150;
const RECENT_WINDOW = 30;
const MIN_TIMING_EVENTS_FOR_MINUTES = 3;
const IDLE_AFTER_SECONDS = 240;
const IDLE_CLIP_SECONDS = 45;
const DEFAULT_SUCCESS_RATE = 0.65;
const MIN_SUCCESS_RATE = 0.15;
const MAX_SUCCESS_RATE = 1;
const WILSON_Z = 1.44;

export function createMasteryEtaController({ state, getStorageKeys, element }) {
  let answerStartedAt = Date.now();
  let answerKey = "";

  function syncAnswerTimer() {
    const current = getCurrentEtaCard();
    const nextKey = current ? `${current._i}:${state.studyStep}:${state.currentIndex}` : "";
    if (nextKey === answerKey) return;
    answerKey = nextKey;
    answerStartedAt = Date.now();
  }

  function recordAnswer(result) {
    const current = getCurrentEtaCard();
    if (!current) return;
    const timing = getAnswerTiming(answerStartedAt);
    appendTimingEvent(getStorageKeys(), {
      result,
      elapsedSeconds: timing.elapsedSeconds,
      timestamp: Date.now(),
      idleClipped: timing.idleClipped
    });
  }

  function undoLatestAnswer() {
    undoLatestTimingEvent(getStorageKeys());
  }

  function clear() {
    clearMasteryEtaStorage(getStorageKeys());
    answerStartedAt = Date.now();
    answerKey = "";
  }

  function render() {
    syncAnswerTimer();
    const stats = buildMasteryEtaStats(state, getStorageKeys());
    const local = buildMathOnlyInterpretation(stats);
    setEtaLabel(local.label, local.confidenceLabel);
  }

  function getCurrentEtaCard() {
    const current = state.currentQueue[state.currentIndex];
    if (!current || !state.selectedCards.has(current._i)) return null;
    return getMastery(state, current._i) === "mastered" ? null : current;
  }

  function setEtaLabel(label, confidence = "") {
    if (!element) return;
    element.textContent = label ? `Mastery ETA: ${label}` : "";
    element.dataset.confidence = confidence || "";
  }

  return {
    clear,
    recordAnswer,
    render,
    undoLatestAnswer
  };
}

export function getAnswerTiming(startedAt, now = Date.now()) {
  const rawSeconds = Math.max(0, (now - startedAt) / 1000);
  const idleClipped = rawSeconds > IDLE_AFTER_SECONDS;
  const elapsedSeconds = idleClipped
    ? IDLE_CLIP_SECONDS
    : Math.min(IDLE_AFTER_SECONDS, Math.max(1, rawSeconds));
  return {
    elapsedSeconds: roundNumber(elapsedSeconds, 1),
    idleClipped
  };
}

export function buildMasteryEtaStats(state, storageKeys) {
  const timing = loadTimingHistory(storageKeys);
  const selectedIndexes = getSelectedIndexes(state);
  const tierCounts = countTiers(state, selectedIndexes);
  const totalSelected = selectedIndexes.length;
  const mastered = tierCounts.mastered;
  const remainingCards = totalSelected - mastered;
  const recentEvents = timing.events.slice(-RECENT_WINDOW);
  const recentMedianSeconds = medianSeconds(recentEvents, MIN_TIMING_EVENTS_FOR_MINUTES);
  const historicalMedianSeconds = medianSeconds(timing.events, MIN_TIMING_EVENTS_FOR_MINUTES);
  const recentAccuracy = accuracyForEvents(recentEvents);
  const historicalAccuracy = timing.summary.answers
    ? timing.summary.known / timing.summary.answers
    : null;
  const fastestPathAnswers = calculateFastestPathAnswers(state, selectedIndexes);
  const math = calculateMathBounds({
    fastestPathAnswers,
    recentAccuracy,
    historicalAccuracy,
    recentMedianSeconds,
    historicalMedianSeconds,
    timing
  });
  const confidenceFlags = buildConfidenceFlags({
    state,
    timing,
    recentAccuracy,
    historicalAccuracy,
    math
  });

  let status = "ready";
  if (state.allCards.length === 0) status = "emptyDeck";
  else if (totalSelected === 0) status = "noSelected";
  else if (remainingCards === 0) status = "mastered";

  return {
    version: 2,
    status,
    totalSelected,
    mastered,
    tierCounts,
    remainingCards,
    currentQueue: getCurrentQueueStats(state),
    fastestPathAnswers,
    expectedAnswers: math.expectedAnswers,
    mathAnswerRange: math.answerRange,
    mathAnswerBounds: math.answerBounds,
    mathMinuteRange: math.minuteRange,
    mathMinuteBounds: math.minuteBounds,
    successRate: math.successRate,
    successRateRange: math.successRateRange,
    confidenceScore: math.confidenceScore,
    confidenceLabel: math.confidenceLabel,
    recentAccuracy: roundNullable(recentAccuracy, 2),
    historicalAccuracy: roundNullable(historicalAccuracy, 2),
    recentMedianSeconds: roundNullable(recentMedianSeconds, 1),
    historicalMedianSeconds: roundNullable(historicalMedianSeconds, 1),
    recentAnswersPerMinute: secondsToAnswersPerMinute(recentMedianSeconds),
    historicalAnswersPerMinute: secondsToAnswersPerMinute(historicalMedianSeconds),
    timing: {
      recentEvents: recentEvents.length,
      historicalAnswers: timing.summary.answers,
      idleClipped: timing.summary.idleClipped
    },
    confidenceFlags
  };
}

export function buildMathOnlyInterpretation(stats) {
  if (stats.status === "emptyDeck") {
    return { label: "no flashcards loaded", answerRange: null, minuteRange: null, confidenceScore: 0, confidenceLabel: "low", reason: "No deck is loaded." };
  }
  if (stats.status === "noSelected") {
    return { label: "no selected cards to master", answerRange: null, minuteRange: null, confidenceScore: 0, confidenceLabel: "low", reason: "No cards are selected." };
  }
  if (stats.status === "mastered") {
    return { label: "all selected cards mastered · confidence 100% · high", answerRange: { low: 0, high: 0 }, minuteRange: { low: 0, high: 0 }, confidenceScore: 100, confidenceLabel: "high", reason: "Every selected card is already mastered." };
  }

  const answerRange = stats.mathAnswerRange;
  const minuteRange = stats.mathMinuteRange;
  const rangeText = minuteRange
    ? `about ${formatMinuteRange(minuteRange)} · ${formatAnswerRange(answerRange)}`
    : `${formatAnswerRange(answerRange)}`;
  return {
    label: `${rangeText} · confidence ${stats.confidenceScore}% · ${stats.confidenceLabel}`,
    answerRange,
    minuteRange,
    confidenceScore: stats.confidenceScore,
    confidenceLabel: stats.confidenceLabel,
    reason: "Local estimate from required mastery steps, observed accuracy, and observed pace."
  };
}

export function clearMasteryEtaStorage(storageKeys) {
  localStorage.removeItem(storageKeys.masteryEtaTiming);
  localStorage.removeItem(storageKeys.masteryEtaCache);
}

function loadTimingHistory(storageKeys) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.masteryEtaTiming) || "{}");
    const events = Array.isArray(parsed.events)
      ? parsed.events.map(normalizeTimingEvent).filter(Boolean).slice(-MAX_RECENT_EVENTS)
      : [];
    const summary = normalizeTimingSummary(parsed.summary);
    if (!summary.answers && events.length) return rebuildTimingHistory(events);
    return { version: 1, events, summary };
  } catch {
    return emptyTimingHistory();
  }
}

function appendTimingEvent(storageKeys, event) {
  const history = loadTimingHistory(storageKeys);
  const normalized = normalizeTimingEvent(event);
  if (!normalized) return;
  history.events.push(normalized);
  history.events = history.events.slice(-MAX_RECENT_EVENTS);
  history.summary.answers += 1;
  if (normalized.result === "known") history.summary.known += 1;
  else history.summary.learning += 1;
  history.summary.elapsedSeconds = roundNumber(history.summary.elapsedSeconds + normalized.elapsedSeconds, 1);
  if (normalized.idleClipped) history.summary.idleClipped += 1;
  saveTimingHistory(storageKeys, history);
}

function undoLatestTimingEvent(storageKeys) {
  const history = loadTimingHistory(storageKeys);
  const event = history.events.pop();
  if (!event) return;
  history.summary.answers = Math.max(0, history.summary.answers - 1);
  if (event.result === "known") history.summary.known = Math.max(0, history.summary.known - 1);
  else history.summary.learning = Math.max(0, history.summary.learning - 1);
  history.summary.elapsedSeconds = roundNumber(Math.max(0, history.summary.elapsedSeconds - event.elapsedSeconds), 1);
  if (event.idleClipped) history.summary.idleClipped = Math.max(0, history.summary.idleClipped - 1);
  saveTimingHistory(storageKeys, history);
}

function saveTimingHistory(storageKeys, history) {
  localStorage.setItem(storageKeys.masteryEtaTiming, JSON.stringify({
    version: 1,
    events: history.events.slice(-MAX_RECENT_EVENTS),
    summary: history.summary
  }));
}

function emptyTimingHistory() {
  return {
    version: 1,
    events: [],
    summary: {
      answers: 0,
      known: 0,
      learning: 0,
      elapsedSeconds: 0,
      idleClipped: 0
    }
  };
}

function rebuildTimingHistory(events) {
  const history = emptyTimingHistory();
  events.forEach(event => {
    history.summary.answers += 1;
    if (event.result === "known") history.summary.known += 1;
    else history.summary.learning += 1;
    history.summary.elapsedSeconds += event.elapsedSeconds;
    if (event.idleClipped) history.summary.idleClipped += 1;
  });
  history.summary.elapsedSeconds = roundNumber(history.summary.elapsedSeconds, 1);
  history.events = events.slice(-MAX_RECENT_EVENTS);
  return history;
}

function normalizeTimingEvent(event) {
  if (!event || typeof event !== "object") return null;
  const result = event.result === "known" ? "known" : event.result === "learning" ? "learning" : "";
  const elapsedSeconds = Number(event.elapsedSeconds);
  const timestamp = Number(event.timestamp);
  if (!result || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  return {
    result,
    elapsedSeconds: roundNumber(Math.min(IDLE_AFTER_SECONDS, Math.max(1, elapsedSeconds)), 1),
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : Date.now(),
    idleClipped: Boolean(event.idleClipped)
  };
}

function normalizeTimingSummary(summary) {
  const value = summary && typeof summary === "object" ? summary : {};
  return {
    answers: normalizeCount(value.answers),
    known: normalizeCount(value.known),
    learning: normalizeCount(value.learning),
    elapsedSeconds: roundNumber(Math.max(0, Number(value.elapsedSeconds) || 0), 1),
    idleClipped: normalizeCount(value.idleClipped)
  };
}

function getSelectedIndexes(state) {
  return [...state.selectedCards]
    .filter(i => Number.isInteger(i) && i >= 0 && i < state.allCards.length)
    .filter(i => !state.focusCardIndexes || state.focusCardIndexes.has(i))
    .sort((a, b) => a - b);
}

function countTiers(state, selectedIndexes) {
  const counts = {
    unfamiliar: 0,
    somewhatFamiliar: 0,
    familiar: 0,
    mastered: 0
  };
  selectedIndexes.forEach(cardIndex => {
    const level = getMastery(state, cardIndex);
    if (level === "mastered") counts.mastered += 1;
    else if (level === "familiar") counts.familiar += 1;
    else if (level === "somewhat familiar") counts.somewhatFamiliar += 1;
    else counts.unfamiliar += 1;
  });
  return counts;
}

function getCurrentQueueStats(state) {
  const stats = {
    remainingInQueue: 0,
    new: 0,
    review: 0,
    missedLastRound: 0,
    almostMastered: 0
  };
  state.currentQueue.slice(state.currentIndex).forEach(cardData => {
    if (!cardData || !state.selectedCards.has(cardData._i) || getMastery(state, cardData._i) === "mastered") return;
    if (state.focusCardIndexes && !state.focusCardIndexes.has(cardData._i)) return;
    const reason = cardData.waveReason || getCardReason(state, cardData._i);
    stats.remainingInQueue += 1;
    if (reason === "new") stats.new += 1;
    else stats.review += 1;
    if (reason === "missed last round") stats.missedLastRound += 1;
    if (reason === "almost mastered") stats.almostMastered += 1;
  });
  return stats;
}

function calculateFastestPathAnswers(state, selectedIndexes) {
  return selectedIndexes.reduce((sum, cardIndex) => {
    const level = getMastery(state, cardIndex);
    if (level === "mastered") return sum;
    if (level === "familiar") return sum + (getCorrectStreak(state, cardIndex) >= 1 ? 1 : 2);
    if (level === "somewhat familiar") return sum + 3;
    return sum + 4;
  }, 0);
}

function getCorrectStreak(state, cardIndex) {
  const schedulerState = state.schedulerByCard.get(cardIndex);
  const value = schedulerState ? Number(schedulerState.correctStreak) : 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function calculateMathBounds(timingStats) {
  const fastestPathAnswers = timingStats.fastestPathAnswers;
  if (fastestPathAnswers === 0) {
    return {
      expectedAnswers: 0,
      answerRange: { low: 0, high: 0 },
      answerBounds: { lower: 0, base: 0, upper: 0 },
      minuteRange: { low: 0, high: 0 },
      minuteBounds: { lower: 0, base: 0, upper: 0 },
      successRate: 1,
      successRateRange: { low: 1, high: 1 },
      confidenceScore: 100,
      confidenceLabel: "high"
    };
  }

  const sample = buildSuccessRateSample(timingStats);
  const successRate = sample.rate;
  const successRateRange = sample.range;
  const expectedAnswers = Math.max(fastestPathAnswers, Math.ceil(fastestPathAnswers / successRate));
  const lowerAnswers = Math.max(fastestPathAnswers, Math.floor(fastestPathAnswers / successRateRange.high));
  const upperAnswers = Math.max(expectedAnswers, Math.ceil(fastestPathAnswers / successRateRange.low));
  const answerBounds = {
    lower: lowerAnswers,
    base: expectedAnswers,
    upper: upperAnswers
  };
  const answerRange = {
    low: answerBounds.lower,
    high: answerBounds.upper
  };
  const instability = getAccuracyInstability(timingStats.recentAccuracy, timingStats.historicalAccuracy);
  const minuteBounds = calculateMinuteBounds(answerBounds, timingStats, instability);
  const confidenceScore = calculateConfidenceScore({
    answers: timingStats.timing.summary.answers,
    answerBounds,
    minuteBounds,
    instability,
    successRate,
    hasTiming: Boolean(minuteBounds),
    idleClipped: timingStats.timing.summary.idleClipped
  });

  return {
    expectedAnswers,
    answerRange,
    answerBounds,
    minuteRange: minuteBounds ? { low: minuteBounds.lower, high: minuteBounds.upper } : null,
    minuteBounds,
    successRate,
    successRateRange,
    confidenceScore,
    confidenceLabel: getConfidenceLabel(confidenceScore)
  };
}

function buildSuccessRateSample(timingStats) {
  const answers = timingStats.timing.summary.answers;
  if (answers <= 0 || !Number.isFinite(timingStats.historicalAccuracy)) {
    return {
      rate: DEFAULT_SUCCESS_RATE,
      range: { low: 0.35, high: 0.9 }
    };
  }

  const historical = timingStats.historicalAccuracy;
  const recent = Number.isFinite(timingStats.recentAccuracy) ? timingStats.recentAccuracy : historical;
  const rate = clamp((recent * 0.65) + (historical * 0.35), MIN_SUCCESS_RATE, MAX_SUCCESS_RATE);
  const known = Math.round(historical * answers);
  const interval = wilsonInterval(known, answers);
  const instability = Math.abs(recent - historical);
  return {
    rate,
    range: {
      low: clamp(interval.low - (instability * 0.35), MIN_SUCCESS_RATE, MAX_SUCCESS_RATE),
      high: clamp(interval.high + (instability * 0.2), MIN_SUCCESS_RATE, MAX_SUCCESS_RATE)
    }
  };
}

function wilsonInterval(successes, total) {
  if (total <= 0) return { low: 0.35, high: 0.9 };
  const p = successes / total;
  const z2 = WILSON_Z ** 2;
  const denominator = 1 + (z2 / total);
  const center = p + (z2 / (2 * total));
  const margin = WILSON_Z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator)
  };
}

function calculateMinuteBounds(answerBounds, timingStats, instability) {
  const recent = timingStats.recentMedianSeconds;
  const historical = timingStats.historicalMedianSeconds;
  const candidates = [recent, historical].filter(value => Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return null;
  const fastSeconds = Math.max(1, Math.min(...candidates) * 0.9);
  const baseSeconds = blendSeconds(recent, historical);
  const slowSeconds = Math.max(...candidates) * (instability > 0.18 ? 1.35 : 1.18);
  const lower = Math.max(1, Math.floor((answerBounds.lower * fastSeconds) / 60));
  const base = Math.max(lower, Math.round((answerBounds.base * baseSeconds) / 60));
  const upper = Math.max(base, Math.ceil((answerBounds.upper * slowSeconds) / 60));
  return { lower, base, upper };
}

function calculateConfidenceScore({ answers, answerBounds, minuteBounds, instability, successRate, hasTiming, idleClipped }) {
  const sampleScore = answers <= 0 ? 8 : Math.min(38, Math.round(38 * Math.log1p(answers) / Math.log1p(80)));
  const answerWidth = answerBounds.upper <= 0 ? 0 : (answerBounds.upper - answerBounds.lower) / answerBounds.upper;
  const answerScore = Math.round(34 * (1 - clamp(answerWidth, 0, 0.8) / 0.8));
  const timeScore = hasTiming
    ? Math.round(18 * (1 - clamp(getRangeWidth(minuteBounds), 0, 0.85) / 0.85))
    : 5;
  const perfectAccuracyBonus = successRate >= 0.99 && answers >= 20 ? 12 : 0;
  const stabilityPenalty = Math.round(clamp(instability, 0, 0.45) * 45);
  const idlePenalty = Math.min(8, idleClipped * 2);
  return clamp(Math.round(sampleScore + answerScore + timeScore + perfectAccuracyBonus - stabilityPenalty - idlePenalty), 5, 100);
}

function getRangeWidth(range) {
  if (!range || range.upper <= 0) return 1;
  return (range.upper - range.lower) / range.upper;
}

function getConfidenceLabel(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function buildConfidenceFlags({
  state,
  timing,
  recentAccuracy,
  historicalAccuracy,
  math
}) {
  const flags = [];
  if (timing.summary.answers === 0) flags.push("noTimingData");
  if (!math.minuteRange) flags.push("noPaceData");
  if (math.successRate < 0.55) flags.push("lowAccuracy");
  if (getAccuracyInstability(recentAccuracy, historicalAccuracy) > 0.18) flags.push("unstableAccuracy");
  if (state.orderMode === "shuffle") flags.push("shuffleMode");
  if (timing.summary.idleClipped > 0) flags.push("idleClipped");
  return flags;
}

function accuracyForEvents(events) {
  if (!events.length) return null;
  return events.filter(event => event.result === "known").length / events.length;
}

function medianSeconds(events, minimumCount) {
  const values = events
    .map(event => Number(event.elapsedSeconds))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (values.length < minimumCount) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function getAccuracyInstability(recentAccuracy, historicalAccuracy) {
  if (!Number.isFinite(recentAccuracy) || !Number.isFinite(historicalAccuracy)) return 0;
  return Math.abs(recentAccuracy - historicalAccuracy);
}

function blendSeconds(recentSeconds, historicalSeconds) {
  const recent = Number.isFinite(recentSeconds) ? recentSeconds : null;
  const historical = Number.isFinite(historicalSeconds) ? historicalSeconds : null;
  if (recent === null && historical === null) return 1;
  if (recent === null) return historical;
  if (historical === null) return recent;
  return (recent * 0.65) + (historical * 0.35);
}

function secondsToAnswersPerMinute(seconds) {
  return Number.isFinite(seconds) && seconds > 0
    ? roundNumber(60 / seconds, 2)
    : null;
}

function formatAnswerCount(count) {
  return `${count} ${count === 1 ? "answer" : "answers"}`;
}

function formatAnswerRange(range) {
  if (!range) return "";
  if (range.low === range.high) return formatAnswerCount(range.low);
  return `${formatCompactNumber(range.low)}-${formatCompactNumber(range.high)} answers`;
}

function formatMinuteRange(range) {
  if (!range) return "";
  if (range.low === range.high) return formatTimeValue(range.low);
  if (range.high < 60) return `${range.low}-${range.high} min`;
  if (range.low >= 60) return `${formatHourValue(range.low)}-${formatHourValue(range.high)} hr`;
  return `${range.low} min-${formatHourValue(range.high)} hr`;
}

function formatTimeValue(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${formatHourValue(minutes)} hr`;
}

function formatHourValue(minutes) {
  const hours = minutes / 60;
  return String(roundNumber(hours, hours < 10 ? 1 : 0));
}

function formatCompactNumber(value) {
  if (value < 1000) return String(value);
  const rounded = value < 10000 ? roundNumber(value / 1000, 1) : Math.round(value / 1000);
  return `${rounded}k`;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function roundNullable(value, digits) {
  return Number.isFinite(value) ? roundNumber(value, digits) : null;
}

function roundNumber(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
