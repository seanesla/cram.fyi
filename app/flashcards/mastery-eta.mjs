import {
  applyAnswerResult,
  getCardReason,
  getMastery,
  getRepeatDelay,
  getScheduledQueuePlan
} from "./scheduler.mjs";

const MAX_RECENT_EVENTS = 150;
const RECENT_WINDOW = 30;
const MIN_TIMING_EVENTS_FOR_MINUTES = 3;
const MIN_ACCURACY_EVENTS_FOR_RANGE = 5;
const IDLE_AFTER_SECONDS = 240;
const IDLE_CLIP_SECONDS = 45;
const SIMULATION_CAP = 20000;
const CODEX_REFRESH_ANSWER_STEP = 4;
const ETA_CACHE_LIMIT = 12;

export function createMasteryEtaController({ state, getStorageKeys, element }) {
  let answerStartedAt = Date.now();
  let answerKey = "";
  let pendingHash = "";

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
    clearMasteryEtaCache(getStorageKeys());
  }

  function clear() {
    clearMasteryEtaStorage(getStorageKeys());
    answerStartedAt = Date.now();
    answerKey = "";
    pendingHash = "";
  }

  function render() {
    syncAnswerTimer();
    const stats = buildMasteryEtaStats(state, getStorageKeys());
    const local = buildMathOnlyInterpretation(stats);
    setEtaLabel(local.label, local.confidence);

    if (!shouldAskCodex(stats)) return;

    const packet = buildCodexStatsPacket(stats);
    const hash = hashStatsPacket(packet);
    const cache = loadMasteryEtaCache(getStorageKeys());
    const cached = cache.entries[hash];
    if (cached) {
      setEtaLabel(cached.interpretation.label, cached.interpretation.confidence);
      return;
    }
    if (!shouldRefreshCodex(stats, cache) || pendingHash === hash) return;

    pendingHash = hash;
    requestCodexInterpretation(packet, hash);
  }

  async function requestCodexInterpretation(packet, hash) {
    try {
      const response = await fetch("/api/mastery-eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: packet })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.interpretation) return;
      if (hashStatsPacket(buildCodexStatsPacket(buildMasteryEtaStats(state, getStorageKeys()))) !== hash) return;
      if (data.source === "codex") {
        saveCachedInterpretation(getStorageKeys(), hash, data.interpretation, packet);
      }
      setEtaLabel(data.interpretation.label, data.interpretation.confidence);
    } catch {
      // The local math label is already visible.
    } finally {
      if (pendingHash === hash) pendingHash = "";
    }
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
  const math = calculateMathBounds(state, selectedIndexes, {
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
    recentMedianSeconds,
    historicalMedianSeconds,
    math
  });

  let status = "ready";
  if (state.allCards.length === 0) status = "emptyDeck";
  else if (totalSelected === 0) status = "noSelected";
  else if (remainingCards === 0) status = "mastered";

  return {
    version: 1,
    status,
    totalSelected,
    mastered,
    tierCounts,
    remainingCards,
    currentQueue: getCurrentQueueStats(state),
    fastestPathAnswers,
    mathAnswerRange: math.answerRange,
    mathAnswerBounds: math.answerBounds,
    mathMinuteRange: math.minuteRange,
    mathMinuteBounds: math.minuteBounds,
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

export function buildCodexStatsPacket(stats) {
  return {
    version: 1,
    totalSelected: stats.totalSelected,
    mastered: stats.mastered,
    tierCounts: stats.tierCounts,
    remainingCards: stats.remainingCards,
    currentQueue: stats.currentQueue,
    fastestPathAnswers: stats.fastestPathAnswers,
    mathAnswerRange: stats.mathAnswerRange,
    mathAnswerBounds: stats.mathAnswerBounds,
    mathMinuteRange: stats.mathMinuteRange,
    mathMinuteBounds: stats.mathMinuteBounds,
    recentAccuracy: stats.recentAccuracy,
    historicalAccuracy: stats.historicalAccuracy,
    recentMedianSeconds: stats.recentMedianSeconds,
    historicalMedianSeconds: stats.historicalMedianSeconds,
    recentAnswersPerMinute: stats.recentAnswersPerMinute,
    historicalAnswersPerMinute: stats.historicalAnswersPerMinute,
    timing: stats.timing,
    confidenceFlags: stats.confidenceFlags
  };
}

export function buildMathOnlyInterpretation(stats) {
  if (stats.status === "emptyDeck") {
    return { label: "no flashcards loaded", answerRange: null, minuteRange: null, confidence: "low", reason: "No deck is loaded." };
  }
  if (stats.status === "noSelected") {
    return { label: "no selected cards to master", answerRange: null, minuteRange: null, confidence: "low", reason: "No cards are selected." };
  }
  if (stats.status === "mastered") {
    return { label: "all selected cards mastered", answerRange: { low: 0, high: 0 }, minuteRange: { low: 0, high: 0 }, confidence: "high", reason: "Every selected card is already mastered." };
  }
  if (stats.confidenceFlags.includes("simulationCapHit")) {
    return {
      label: `estimate too uncertain · fastest path: ${formatAnswerCount(stats.fastestPathAnswers)}`,
      answerRange: { low: stats.fastestPathAnswers, high: stats.fastestPathAnswers },
      minuteRange: null,
      confidence: "low",
      reason: "The local simulation hit its answer cap."
    };
  }
  if (!stats.mathMinuteRange || stats.confidenceFlags.includes("tooEarly") || stats.confidenceFlags.includes("noTimingData")) {
    return {
      label: `answer a few more cards to estimate time · fastest path: ${formatAnswerCount(stats.fastestPathAnswers)}`,
      answerRange: { low: stats.fastestPathAnswers, high: stats.mathAnswerRange.high || stats.fastestPathAnswers },
      minuteRange: null,
      confidence: "low",
      reason: "There is not enough timing history yet."
    };
  }

  const answerRange = stats.mathAnswerRange;
  const minuteRange = stats.mathMinuteRange;
  const confidence = stats.confidenceFlags.includes("lowAccuracy") || stats.confidenceFlags.includes("unstableAccuracy")
    ? "low"
    : "medium";
  return {
    label: `about ${formatMinuteRange(minuteRange)} · ${formatAnswerRange(answerRange)}`,
    answerRange,
    minuteRange,
    confidence,
    reason: "Math-only fallback from local scheduler simulation."
  };
}

export function clearMasteryEtaStorage(storageKeys) {
  localStorage.removeItem(storageKeys.masteryEtaTiming);
  localStorage.removeItem(storageKeys.masteryEtaCache);
}

export function clearMasteryEtaCache(storageKeys) {
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

function calculateMathBounds(state, selectedIndexes, timingStats) {
  const fastestPathAnswers = timingStats.fastestPathAnswers;
  if (!selectedIndexes.length || fastestPathAnswers === 0) {
    return {
      answerRange: { low: 0, high: 0 },
      answerBounds: { lower: 0, base: 0, upper: 0 },
      minuteRange: { low: 0, high: 0 },
      minuteBounds: { lower: 0, base: 0, upper: 0 },
      simulationCapHit: false
    };
  }

  const enoughAccuracy = timingStats.timing.summary.answers >= MIN_ACCURACY_EVENTS_FOR_RANGE;
  const blendedAccuracy = enoughAccuracy
    ? blendAccuracy(timingStats.recentAccuracy, timingStats.historicalAccuracy)
    : null;
  const instability = getAccuracyInstability(timingStats.recentAccuracy, timingStats.historicalAccuracy);
  const baseAccuracy = blendedAccuracy === null ? null : clamp(blendedAccuracy, 0.35, 0.98);
  const upperAccuracy = blendedAccuracy === null
    ? null
    : clamp(blendedAccuracy - (instability > 0.18 ? 0.22 : 0.12), 0.2, 0.92);

  const baseSimulation = baseAccuracy === null
    ? { answers: fastestPathAnswers, capHit: false }
    : simulateRemainingMastery(state, selectedIndexes, createAccuracyPolicy(baseAccuracy));
  const upperSimulation = upperAccuracy === null
    ? { answers: fastestPathAnswers, capHit: false }
    : simulateRemainingMastery(state, selectedIndexes, createAccuracyPolicy(upperAccuracy));
  const upperAnswers = Math.max(fastestPathAnswers, baseSimulation.answers, upperSimulation.answers);
  const answerBounds = {
    lower: fastestPathAnswers,
    base: Math.max(fastestPathAnswers, baseSimulation.answers),
    upper: upperAnswers
  };
  const answerRange = {
    low: answerBounds.lower,
    high: answerBounds.upper
  };
  const minuteBounds = calculateMinuteBounds(answerBounds, timingStats, instability);
  return {
    answerRange,
    answerBounds,
    minuteRange: minuteBounds ? { low: minuteBounds.lower, high: minuteBounds.upper } : null,
    minuteBounds,
    simulationCapHit: baseSimulation.capHit || upperSimulation.capHit
  };
}

function simulateRemainingMastery(sourceState, selectedIndexes, answerPolicy) {
  const state = createSimulationState(sourceState, selectedIndexes);
  let answers = 0;

  while (!allSelectedMastered(state, selectedIndexes) && answers < SIMULATION_CAP) {
    let current = takeNextSimulationCard(state);
    if (!current) {
      state.waveNumber += 1;
      refillSimulationQueue(state);
      current = takeNextSimulationCard(state);
      if (!current) break;
    }

    const result = answerPolicy();
    const next = applyAnswerResult(state, current._i, result);
    answers += 1;

    if (result === "learning" && next !== "mastered") {
      const repeatDelay = getRepeatDelay(next, state.currentQueue.length);
      if (Number.isInteger(repeatDelay)) {
        state.currentQueue.splice(repeatDelay, 0, { _i: current._i, waveReason: "review" });
      }
    }

    if (!state.currentQueue.length && !allSelectedMastered(state, selectedIndexes)) {
      state.waveNumber += 1;
      refillSimulationQueue(state);
    }
  }

  return {
    answers,
    capHit: !allSelectedMastered(state, selectedIndexes)
  };
}

function createSimulationState(sourceState, selectedIndexes) {
  const selectedCards = new Set(selectedIndexes);
  const masteryByCard = new Map();
  sourceState.masteryByCard.forEach((value, key) => {
    if (selectedCards.has(Number(key))) masteryByCard.set(Number(key), value);
  });
  const schedulerByCard = new Map();
  sourceState.schedulerByCard.forEach((value, key) => {
    if (!selectedCards.has(Number(key)) || !value || typeof value !== "object") return;
    schedulerByCard.set(Number(key), { ...value });
  });

  const state = {
    allCards: sourceState.allCards.map(() => ({})),
    selectedCards,
    masteryByCard,
    schedulerByCard,
    showMastered: false,
    currentQueue: sourceState.currentQueue
      .slice(sourceState.currentIndex)
      .filter(cardData => cardData && selectedCards.has(cardData._i) && getMastery(sourceState, cardData._i) !== "mastered")
      .map(cardData => ({ _i: cardData._i, waveReason: cardData.waveReason || "review" })),
    sourceDeck: [],
    currentIndex: 0,
    orderMode: "study",
    waveNumber: sourceState.waveNumber,
    studyStep: sourceState.studyStep
  };
  if (!state.currentQueue.length) refillSimulationQueue(state);
  return state;
}

function refillSimulationQueue(state) {
  state.currentQueue = getScheduledQueuePlan(state)
    .map(item => ({ _i: item.cardIndex, waveReason: item.reason }));
  state.currentIndex = 0;
}

function takeNextSimulationCard(state) {
  while (state.currentQueue.length) {
    const current = state.currentQueue.shift();
    if (!current || !state.selectedCards.has(current._i)) continue;
    if (getMastery(state, current._i) === "mastered") continue;
    return current;
  }
  return null;
}

function allSelectedMastered(state, selectedIndexes) {
  return selectedIndexes.every(cardIndex => getMastery(state, cardIndex) === "mastered");
}

function createAccuracyPolicy(accuracy) {
  let total = 0;
  let known = 0;
  return () => {
    total += 1;
    const targetKnown = Math.round(total * accuracy);
    if (known < targetKnown) {
      known += 1;
      return "known";
    }
    return "learning";
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

function buildConfidenceFlags({
  state,
  timing,
  recentAccuracy,
  historicalAccuracy,
  recentMedianSeconds,
  historicalMedianSeconds,
  math
}) {
  const flags = [];
  if (timing.summary.answers === 0) flags.push("noTimingData");
  if (timing.summary.answers < MIN_ACCURACY_EVENTS_FOR_RANGE) flags.push("tooEarly");
  if (!Number.isFinite(recentMedianSeconds) && !Number.isFinite(historicalMedianSeconds)) flags.push("noPaceData");
  const blended = blendAccuracy(recentAccuracy, historicalAccuracy);
  if (blended !== null && blended < 0.55) flags.push("lowAccuracy");
  if (getAccuracyInstability(recentAccuracy, historicalAccuracy) > 0.18) flags.push("unstableAccuracy");
  if (math.simulationCapHit) flags.push("simulationCapHit");
  if (state.orderMode === "shuffle") flags.push("shuffleMode");
  if (timing.summary.idleClipped > 0) flags.push("idleClipped");
  return flags;
}

function shouldAskCodex(stats) {
  return stats.status === "ready"
    && stats.mathMinuteRange
    && !stats.confidenceFlags.includes("tooEarly")
    && stats.timing.historicalAnswers >= MIN_ACCURACY_EVENTS_FOR_RANGE
    && !stats.confidenceFlags.includes("simulationCapHit");
}

function shouldRefreshCodex(stats, cache) {
  const last = cache.lastRefresh;
  if (!last) return true;
  if (stats.totalSelected !== last.totalSelected) return true;
  if (stats.mastered !== last.mastered) return true;
  if (stats.fastestPathAnswers !== last.fastestPathAnswers) return true;
  return stats.timing.historicalAnswers - last.historicalAnswers >= CODEX_REFRESH_ANSWER_STEP;
}

function loadMasteryEtaCache(storageKeys) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.masteryEtaCache) || "{}");
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    const lastRefresh = parsed.lastRefresh && typeof parsed.lastRefresh === "object" ? parsed.lastRefresh : null;
    return { version: 1, entries, lastRefresh };
  } catch {
    return { version: 1, entries: {}, lastRefresh: null };
  }
}

function saveCachedInterpretation(storageKeys, hash, interpretation, packet) {
  const cache = loadMasteryEtaCache(storageKeys);
  cache.entries[hash] = {
    interpretation,
    createdAt: Date.now()
  };
  const hashes = Object.keys(cache.entries)
    .sort((a, b) => (cache.entries[b].createdAt || 0) - (cache.entries[a].createdAt || 0));
  hashes.slice(ETA_CACHE_LIMIT).forEach(oldHash => {
    delete cache.entries[oldHash];
  });
  cache.lastRefresh = {
    totalSelected: packet.totalSelected,
    mastered: packet.mastered,
    fastestPathAnswers: packet.fastestPathAnswers,
    historicalAnswers: packet.timing.historicalAnswers
  };
  localStorage.setItem(storageKeys.masteryEtaCache, JSON.stringify(cache));
}

function hashStatsPacket(packet) {
  const text = stableStringify(packet);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

function blendAccuracy(recentAccuracy, historicalAccuracy) {
  const recent = Number.isFinite(recentAccuracy) ? recentAccuracy : null;
  const historical = Number.isFinite(historicalAccuracy) ? historicalAccuracy : null;
  if (recent === null && historical === null) return null;
  if (recent === null) return historical;
  if (historical === null) return recent;
  return (recent * 0.65) + (historical * 0.35);
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
  return `${range.low}-${range.high} answers`;
}

function formatMinuteRange(range) {
  if (!range) return "";
  if (range.low === range.high) return `${range.low} min`;
  return `${range.low}-${range.high} min`;
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
