import {
  MASTERY_LEVELS,
  getMastery as readMastery,
  getMasteryClass,
  loadStoredNumber,
  saveMapAsObject
} from "../shared/storage.mjs";

export const ADAPTIVE_QUEUE_SIZE = 30;
export const REVIEW_SHARE = 0.4;
export const MIN_MISSED_REPEAT_GAP = 8;
export const MASTERED_DUE_VALUE = 999999;

export function loadStudyPosition(storageKeys) {
  return loadStoredNumber(storageKeys.position);
}

export function loadOrderMode(storageKeys) {
  return localStorage.getItem(storageKeys.orderMode) === "shuffle" ? "shuffle" : "study";
}

export function loadWaveNumber(storageKeys) {
  return loadStoredNumber(storageKeys.waveNumber, { min: 1, fallback: 1 });
}

export function saveWaveNumber(state, storageKeys) {
  localStorage.setItem(storageKeys.waveNumber, String(state.waveNumber));
}

export function loadStudyStep(storageKeys) {
  return loadStoredNumber(storageKeys.studyStep);
}

export function saveStudyStep(state, storageKeys) {
  localStorage.setItem(storageKeys.studyStep, String(state.studyStep));
}

export function loadScheduler(state, storageKeys) {
  const schedulerByCard = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.scheduler) || "{}");
    Object.entries(raw).forEach(([key, value]) => {
      const i = Number(key);
      if (Number.isInteger(i) && i >= 0 && i < state.allCards.length) {
        schedulerByCard.set(i, normalizeSchedulerState(state, i, value));
      }
    });
  } catch {
    return schedulerByCard;
  }
  return schedulerByCard;
}

export function getMastery(state, cardIndex) {
  return readMastery(state.masteryByCard, cardIndex);
}

export function getCardMasteryClass(state, cardIndex) {
  return getMasteryClass(getMastery(state, cardIndex));
}

export function saveMastery(state, storageKeys) {
  saveMapAsObject(storageKeys.mastery, state.masteryByCard);
}

export function saveScheduler(state, storageKeys) {
  saveMapAsObject(storageKeys.scheduler, state.schedulerByCard);
}

export function clearCurrentQueue(storageKeys) {
  localStorage.removeItem(storageKeys.waveQueue);
}

export function saveCurrentQueue(state, storageKeys) {
  localStorage.setItem(storageKeys.waveQueue, JSON.stringify(state.currentQueue.map(cardData => cardData._i)));
  savePosition(state, storageKeys);
}

export function savePosition(state, storageKeys) {
  localStorage.setItem(storageKeys.position, String(state.currentIndex));
}

export function loadCurrentQueue(state, storageKeys) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.waveQueue) || "[]");
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const valid = raw
      .filter(i => Number.isInteger(i) && i >= 0 && i < state.allCards.length)
      .filter(i => state.selectedCards.has(i))
      .filter(i => !state.focusCardIndexes || state.focusCardIndexes.has(i))
      .filter(i => state.showMastered || getMastery(state, i) !== "mastered");
    return valid.map(i => makeScheduledCard(state, i));
  } catch {
    return [];
  }
}

export function rebuildQueue(state, storageKeys, preserveIndex = false) {
  const currentCardIndex = state.currentQueue[state.currentIndex]?._i ?? null;
  state.sourceDeck = getActiveCards(state);
  state.currentQueue = loadCurrentQueue(state, storageKeys);
  if (!state.currentQueue.length) buildScheduledQueue(state, storageKeys);

  if (preserveIndex && currentCardIndex !== null) {
    const nextIndex = state.currentQueue.findIndex(cardData => cardData._i === currentCardIndex);
    state.currentIndex = nextIndex >= 0 ? nextIndex : Math.min(state.currentIndex, Math.max(state.currentQueue.length - 1, 0));
  } else {
    state.currentIndex = Math.min(state.currentIndex, Math.max(state.currentQueue.length - 1, 0));
  }
  savePosition(state, storageKeys);
}

export function getActiveCards(state) {
  return state.allCards
    .map((cardData, i) => ({ ...cardData, _i: i }))
    .filter(cardData => state.selectedCards.has(cardData._i))
    .filter(cardData => !state.focusCardIndexes || state.focusCardIndexes.has(cardData._i))
    .filter(cardData => state.showMastered || getMastery(state, cardData._i) !== "mastered")
    .sort((a, b) => a._i - b._i);
}

export function getCardReason(state, cardIndex) {
  const schedulerState = getSchedulerState(state, cardIndex);
  const level = getMastery(state, cardIndex);
  if (schedulerState.seenCount === 0) return "new";
  if (schedulerState.missedWave === state.waveNumber - 1) return "missed last round";
  if (level === "familiar") return schedulerState.correctStreak >= 1 ? "almost mastered" : "review";
  if (level === "mastered") return "mastered";
  return "review";
}

export function markCard(state, storageKeys, value, { rotateVariant } = {}) {
  if (!state.currentQueue.length) return;

  const current = state.currentQueue[state.currentIndex];
  const previous = getMastery(state, current._i);
  const previousScheduler = { ...getSchedulerState(state, current._i) };
  const previousQueue = state.currentQueue.map(cardData => cardData._i);
  const previousStudyStep = state.studyStep;

  state.history.push({
    cardIndex: current._i,
    previous,
    previousScheduler,
    variant: state.variantIndexes.get(current._i),
    position: state.currentIndex,
    queue: previousQueue,
    waveNumber: state.waveNumber,
    studyStep: previousStudyStep
  });

  const next = applyAnswerResult(state, current._i, value);
  if (rotateVariant) rotateVariant(current._i);
  saveMastery(state, storageKeys);
  saveScheduler(state, storageKeys);
  saveStudyStep(state, storageKeys);

  state.currentQueue.splice(state.currentIndex, 1);
  if (value === "learning" && !state.showMastered && next !== "mastered") {
    const repeatDelay = getRepeatDelay(next, state.currentQueue.length - state.currentIndex);
    if (Number.isInteger(repeatDelay)) {
      const repeatCard = makeScheduledCard(state, current._i, "review");
      state.currentQueue.splice(state.currentIndex + repeatDelay, 0, repeatCard);
    }
  }

  if (state.currentIndex >= state.currentQueue.length) {
    state.currentIndex = Math.max(state.currentQueue.length - 1, 0);
  }
  saveCurrentQueue(state, storageKeys);
  advanceQueueIfComplete(state, storageKeys);
}

export function applyAnswerResult(state, cardIndex, value) {
  const previous = getMastery(state, cardIndex);
  const schedulerState = { ...getSchedulerState(state, cardIndex) };

  state.studyStep += 1;
  schedulerState.seenCount += 1;
  schedulerState.lastSeenWave = state.waveNumber;
  schedulerState.lastSeenStep = state.studyStep;

  const next = value === "known"
    ? getNextMasteryAfterKnown(state, previous, schedulerState)
    : getNextMasteryAfterLearning(state, previous, schedulerState);

  if (value === "known" && schedulerState.missedWave > 0 && schedulerState.missedWave < state.waveNumber) {
    schedulerState.missedWave = 0;
  }

  state.masteryByCard.set(cardIndex, next);
  setSchedulerState(state, cardIndex, schedulerState);
  return next;
}

export function undoLastMark(state, storageKeys) {
  const last = state.history.pop();
  if (!last) return;

  if (last.previous) state.masteryByCard.set(last.cardIndex, last.previous);
  else state.masteryByCard.delete(last.cardIndex);

  if (last.previousScheduler) setSchedulerState(state, last.cardIndex, last.previousScheduler);
  if (Number.isInteger(last.variant)) state.variantIndexes.set(last.cardIndex, last.variant);
  else state.variantIndexes.delete(last.cardIndex);

  if (Array.isArray(last.queue)) {
    state.currentQueue = last.queue.map(i => makeScheduledCard(state, i));
  }
  if (Number.isInteger(last.waveNumber)) {
    state.waveNumber = last.waveNumber;
    saveWaveNumber(state, storageKeys);
  }
  if (Number.isInteger(last.studyStep)) {
    state.studyStep = last.studyStep;
    saveStudyStep(state, storageKeys);
  }

  saveMastery(state, storageKeys);
  saveScheduler(state, storageKeys);
  saveMapAsObject(storageKeys.variant, state.variantIndexes);
  saveCurrentQueue(state, storageKeys);

  const restored = state.currentQueue.findIndex(cardData => cardData._i === last.cardIndex);
  state.currentIndex = restored >= 0 ? restored : Math.min(last.position, Math.max(state.currentQueue.length - 1, 0));
  savePosition(state, storageKeys);
}

export function shuffleCurrentQueue(state, storageKeys) {
  state.orderMode = "shuffle";
  localStorage.setItem(storageKeys.orderMode, state.orderMode);
  shuffleArray(state.currentQueue);
  state.currentIndex = 0;
  saveCurrentQueue(state, storageKeys);
}

export function resetStudyOrder(state, storageKeys) {
  state.orderMode = "study";
  localStorage.setItem(storageKeys.orderMode, state.orderMode);
  state.waveNumber = 1;
  state.studyStep = 0;
  state.currentIndex = 0;
  saveWaveNumber(state, storageKeys);
  saveStudyStep(state, storageKeys);
  clearCurrentQueue(storageKeys);
  rebuildQueue(state, storageKeys);
}

export function resetStudyProgress(state, storageKeys) {
  state.masteryByCard = new Map();
  state.variantIndexes = new Map();
  state.generatedVariants = new Map();
  state.pendingRewords = new Map();
  state.failedRewords = new Set();
  state.schedulerByCard = new Map();
  state.history = [];
  state.waveNumber = 1;
  state.studyStep = 0;
  state.currentIndex = 0;
  saveMastery(state, storageKeys);
  saveScheduler(state, storageKeys);
  saveMapAsObject(storageKeys.variant, state.variantIndexes);
  saveMapAsObject(storageKeys.generatedVariants, state.generatedVariants);
  saveWaveNumber(state, storageKeys);
  saveStudyStep(state, storageKeys);
  clearCurrentQueue(storageKeys);
  rebuildQueue(state, storageKeys);
}

export function getQueueNote(state) {
  if (!state.sourceDeck.length) return "No active cards are left.";
  const counts = state.currentQueue.reduce((acc, cardData) => {
    const reason = cardData.waveReason || getCardReason(state, cardData._i);
    if (reason === "new") acc.new += 1;
    else acc.review += 1;
    if (reason === "missed last round") acc.missed += 1;
    return acc;
  }, { new: 0, review: 0, missed: 0 });
  const mode = state.orderMode === "shuffle" ? "shuffled queue" : "adaptive queue";
  const missed = counts.missed ? ` · ${counts.missed} missed last round` : "";
  return `${mode}: ${counts.review} review, ${counts.new} new${missed}`;
}

export function getCurrentCard(state) {
  return state.currentQueue[state.currentIndex] || null;
}

export function getSchedulerState(state, cardIndex) {
  if (!state.schedulerByCard.has(cardIndex)) {
    state.schedulerByCard.set(cardIndex, getDefaultSchedulerState(state, cardIndex));
  }
  return state.schedulerByCard.get(cardIndex);
}

function setSchedulerState(state, cardIndex, schedulerState) {
  state.schedulerByCard.set(cardIndex, normalizeSchedulerState(state, cardIndex, schedulerState));
}

function getDefaultSchedulerState(state, cardIndex) {
  const level = state.masteryByCard.get(cardIndex);
  return {
    seenCount: level && level !== "unfamiliar" ? 1 : 0,
    lastSeenWave: 0,
    nextDueWave: level === "mastered" ? MASTERED_DUE_VALUE : 0,
    lastSeenStep: 0,
    nextDueStep: 0,
    correctStreak: level === "mastered" ? 2 : 0,
    missedWave: 0
  };
}

function normalizeSchedulerState(state, cardIndex, value = {}) {
  const fallback = getDefaultSchedulerState(state, cardIndex);
  const seenCount = Number(value.seenCount);
  const lastSeenWave = Number(value.lastSeenWave);
  const nextDueWave = Number(value.nextDueWave);
  const lastSeenStep = Number(value.lastSeenStep);
  const nextDueStep = Number(value.nextDueStep);
  const correctStreak = Number(value.correctStreak);
  const missedWave = Number(value.missedWave);
  return {
    seenCount: Number.isInteger(seenCount) && seenCount >= 0 ? seenCount : fallback.seenCount,
    lastSeenWave: Number.isInteger(lastSeenWave) && lastSeenWave >= 0 ? lastSeenWave : fallback.lastSeenWave,
    nextDueWave: Number.isInteger(nextDueWave) && nextDueWave >= 0 ? nextDueWave : fallback.nextDueWave,
    lastSeenStep: Number.isInteger(lastSeenStep) && lastSeenStep >= 0 ? lastSeenStep : fallback.lastSeenStep,
    nextDueStep: Number.isInteger(nextDueStep) && nextDueStep >= 0 ? nextDueStep : fallback.nextDueStep,
    correctStreak: Number.isInteger(correctStreak) && correctStreak >= 0 ? correctStreak : fallback.correctStreak,
    missedWave: Number.isInteger(missedWave) && missedWave >= 0 ? missedWave : fallback.missedWave
  };
}

function makeScheduledCard(state, cardIndex, reason = getCardReason(state, cardIndex)) {
  return { ...state.allCards[cardIndex], _i: cardIndex, waveReason: reason };
}

function getReviewRank(state, cardData) {
  const schedulerState = getSchedulerState(state, cardData._i);
  const level = getMastery(state, cardData._i);
  const levelRank = MASTERY_LEVELS.indexOf(level);
  return [
    schedulerState.missedWave === state.waveNumber - 1 ? 0 : 1,
    schedulerState.nextDueWave <= state.waveNumber ? 0 : 1,
    Math.max(0, schedulerState.nextDueStep - state.studyStep),
    levelRank === -1 ? 0 : levelRank,
    schedulerState.nextDueWave,
    schedulerState.nextDueStep,
    schedulerState.lastSeenWave,
    schedulerState.lastSeenStep,
    cardData._i
  ];
}

function compareRank(state, a, b) {
  const left = getReviewRank(state, a);
  const right = getReviewRank(state, b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function takeCards(state, list, count, used) {
  const picked = [];
  for (const cardData of list) {
    if (picked.length >= count) break;
    if (used.has(cardData._i)) continue;
    used.add(cardData._i);
    picked.push(makeScheduledCard(state, cardData._i));
  }
  return picked;
}

function isReviewDue(state, cardIndex) {
  const schedulerState = getSchedulerState(state, cardIndex);
  const waveDue = schedulerState.nextDueWave <= state.waveNumber || schedulerState.missedWave === state.waveNumber - 1;
  return waveDue && schedulerState.nextDueStep <= state.studyStep;
}

function isCoolingMiss(state, cardIndex) {
  const schedulerState = getSchedulerState(state, cardIndex);
  return schedulerState.missedWave > 0 && schedulerState.nextDueStep > state.studyStep;
}

export function getScheduledQueuePlan(state) {
  const sourceDeck = getActiveCards(state);
  const used = new Set();
  const newCards = sourceDeck.filter(cardData => getSchedulerState(state, cardData._i).seenCount === 0);
  const reviewCards = sourceDeck
    .filter(cardData => getSchedulerState(state, cardData._i).seenCount > 0)
    .filter(cardData => getMastery(state, cardData._i) !== "mastered")
    .filter(cardData => isReviewDue(state, cardData._i))
    .sort((a, b) => compareRank(state, a, b));
  const futureReviewCards = sourceDeck
    .filter(cardData => getSchedulerState(state, cardData._i).seenCount > 0)
    .filter(cardData => getMastery(state, cardData._i) !== "mastered")
    .filter(cardData => !reviewCards.some(review => review._i === cardData._i))
    .filter(cardData => !isCoolingMiss(state, cardData._i))
    .sort((a, b) => compareRank(state, a, b));
  const coolingReviewCards = sourceDeck
    .filter(cardData => getSchedulerState(state, cardData._i).seenCount > 0)
    .filter(cardData => getMastery(state, cardData._i) !== "mastered")
    .filter(cardData => !reviewCards.some(review => review._i === cardData._i))
    .filter(cardData => isCoolingMiss(state, cardData._i))
    .sort((a, b) => compareRank(state, a, b));
  const reviewTarget = Math.min(reviewCards.length, Math.round(ADAPTIVE_QUEUE_SIZE * REVIEW_SHARE));
  const queue = [
    ...takeCards(state, reviewCards, reviewTarget, used)
  ];
  queue.push(...takeCards(state, newCards, ADAPTIVE_QUEUE_SIZE - queue.length, used));
  queue.push(...takeCards(state, reviewCards, ADAPTIVE_QUEUE_SIZE - queue.length, used));
  queue.push(...takeCards(state, futureReviewCards, ADAPTIVE_QUEUE_SIZE - queue.length, used));
  if (!queue.length) queue.push(...takeCards(state, coolingReviewCards, ADAPTIVE_QUEUE_SIZE, used));
  if (state.orderMode === "shuffle") shuffleArray(queue);
  return queue.map(cardData => ({
    cardIndex: cardData._i,
    reason: cardData.waveReason || getCardReason(state, cardData._i)
  }));
}

function buildScheduledQueue(state, storageKeys) {
  state.sourceDeck = getActiveCards(state);
  const queue = getScheduledQueuePlan(state)
    .map(cardData => makeScheduledCard(state, cardData.cardIndex, cardData.reason));
  state.currentQueue = queue;
  state.currentIndex = 0;
  saveCurrentQueue(state, storageKeys);
  return state.currentQueue;
}

function advanceQueueIfComplete(state, storageKeys) {
  if (state.currentQueue.length > 0) return;
  state.waveNumber += 1;
  state.currentIndex = 0;
  saveWaveNumber(state, storageKeys);
  clearCurrentQueue(storageKeys);
  buildScheduledQueue(state, storageKeys);
}

function getNextMasteryAfterKnown(state, previous, schedulerState) {
  if (previous === "unfamiliar") {
    schedulerState.correctStreak = 0;
    schedulerState.nextDueWave = state.waveNumber + 1;
    schedulerState.nextDueStep = state.studyStep;
    return "somewhat familiar";
  }
  if (previous === "somewhat familiar") {
    schedulerState.correctStreak = 0;
    schedulerState.nextDueWave = state.waveNumber + 1;
    schedulerState.nextDueStep = state.studyStep;
    return "familiar";
  }
  if (previous === "familiar") {
    schedulerState.correctStreak += 1;
    if (schedulerState.correctStreak >= 2) {
      schedulerState.nextDueWave = MASTERED_DUE_VALUE;
      schedulerState.nextDueStep = MASTERED_DUE_VALUE;
      return "mastered";
    }
    schedulerState.nextDueWave = state.waveNumber + 2;
    schedulerState.nextDueStep = state.studyStep;
    return "familiar";
  }
  schedulerState.correctStreak = Math.max(schedulerState.correctStreak, 2);
  schedulerState.nextDueWave = MASTERED_DUE_VALUE;
  schedulerState.nextDueStep = MASTERED_DUE_VALUE;
  return "mastered";
}

function getNextMasteryAfterLearning(state, previous, schedulerState) {
  schedulerState.correctStreak = 0;
  schedulerState.nextDueWave = state.waveNumber + 1;
  schedulerState.nextDueStep = state.studyStep + MIN_MISSED_REPEAT_GAP;
  schedulerState.missedWave = state.waveNumber;
  if (previous === "mastered") return "familiar";
  if (previous === "familiar") return "somewhat familiar";
  return "unfamiliar";
}

export function getRepeatDelay(level, remaining) {
  const target = level === "unfamiliar"
    ? MIN_MISSED_REPEAT_GAP
    : level === "somewhat familiar"
      ? MIN_MISSED_REPEAT_GAP + 2
      : MIN_MISSED_REPEAT_GAP + 4;
  return remaining >= target ? target : null;
}

function shuffleArray(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
