import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMasteryEtaStats,
  buildMathOnlyInterpretation,
  calculateMathBounds
} from "./flashcards/mastery-eta.mjs";

function makeState({ cards = 1, mastery = {}, scheduler = {}, queue = [] } = {}) {
  return {
    allCards: Array.from({ length: cards }, () => ({})),
    selectedCards: new Set(Array.from({ length: cards }, (_, i) => i)),
    masteryByCard: new Map(Object.entries(mastery).map(([key, value]) => [Number(key), value])),
    schedulerByCard: new Map(Object.entries(scheduler).map(([key, value]) => [Number(key), value])),
    currentQueue: queue.map(i => ({ _i: i })),
    currentIndex: 0,
    orderMode: "study"
  };
}

function withStorage(value, callback) {
  const store = new Map(Object.entries(value || {}));
  const previous = global.localStorage;
  global.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, item) {
      store.set(key, String(item));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
  try {
    return callback();
  } finally {
    global.localStorage = previous;
  }
}

function timingStorage(events) {
  const summary = events.reduce((acc, event) => {
    acc.answers += 1;
    if (event.result === "known") acc.known += 1;
    else acc.learning += 1;
    acc.elapsedSeconds += event.elapsedSeconds;
    if (event.idleClipped) acc.idleClipped += 1;
    return acc;
  }, { answers: 0, known: 0, learning: 0, elapsedSeconds: 0, idleClipped: 0 });
  summary.elapsedSeconds = Math.round(summary.elapsedSeconds * 10) / 10;
  return JSON.stringify({ version: 1, events, summary });
}

function makeEvents(count, known, elapsedSeconds = 30) {
  return Array.from({ length: count }, (_, i) => ({
    result: i < known ? "known" : "learning",
    elapsedSeconds,
    timestamp: 1_700_000_000_000 + i,
    idleClipped: false
  }));
}

const keys = {
  masteryEtaTiming: "test_masteryEtaTiming_v1",
  masteryEtaCache: "test_masteryEtaCache_v1"
};

test("p=1 returns the exact fastest path", () => {
  const bounds = calculateMathBounds({
    fastestPathAnswers: 12,
    recentAccuracy: 1,
    historicalAccuracy: 1,
    recentMedianSeconds: 20,
    historicalMedianSeconds: 20,
    timing: {
      summary: { answers: 30, known: 30, learning: 0, elapsedSeconds: 600, idleClipped: 0 }
    }
  });

  assert.equal(bounds.expectedAnswers, 12);
  assert.equal(bounds.answerRange.low, 12);
  assert.equal(bounds.answerRange.high, 13);
  assert.equal(bounds.confidenceLabel, "high");
});

test("a familiar card with one correct streak needs one best-case answer", () => {
  withStorage({}, () => {
    const state = makeState({
      cards: 1,
      mastery: { 0: "familiar" },
      scheduler: { 0: { correctStreak: 1, seenCount: 2 } },
      queue: [0]
    });
    const stats = buildMasteryEtaStats(state, keys);

    assert.equal(stats.fastestPathAnswers, 1);
    assert.equal(stats.mathAnswerRange.low >= 1, true);
  });
});

test("ten recorded answers produce an ETA with confidence percent", () => {
  const events = makeEvents(10, 7, 24);
  withStorage({ [keys.masteryEtaTiming]: timingStorage(events) }, () => {
    const state = makeState({ cards: 10, queue: [0, 1, 2] });
    const stats = buildMasteryEtaStats(state, keys);
    const interpretation = buildMathOnlyInterpretation(stats);

    assert.match(interpretation.label, /confidence \d+% · (low|medium|high)/);
    assert.doesNotMatch(interpretation.label, /uncertain|few more/i);
    assert.ok(stats.mathAnswerRange.high >= stats.mathAnswerRange.low);
  });
});

test("no timing data still returns an answer-only estimate", () => {
  withStorage({}, () => {
    const state = makeState({ cards: 4, queue: [0, 1, 2, 3] });
    const stats = buildMasteryEtaStats(state, keys);
    const interpretation = buildMathOnlyInterpretation(stats);

    assert.equal(stats.mathMinuteRange, null);
    assert.match(interpretation.label, /\d+-\d+ answers · confidence \d+% · low/);
  });
});

test("low accuracy widens the range and lowers confidence", () => {
  const high = calculateMathBounds({
    fastestPathAnswers: 40,
    recentAccuracy: 0.9,
    historicalAccuracy: 0.9,
    recentMedianSeconds: 20,
    historicalMedianSeconds: 20,
    timing: {
      summary: { answers: 30, known: 27, learning: 3, elapsedSeconds: 600, idleClipped: 0 }
    }
  });
  const low = calculateMathBounds({
    fastestPathAnswers: 40,
    recentAccuracy: 0.3,
    historicalAccuracy: 0.3,
    recentMedianSeconds: 20,
    historicalMedianSeconds: 20,
    timing: {
      summary: { answers: 30, known: 9, learning: 21, elapsedSeconds: 600, idleClipped: 0 }
    }
  });

  assert.ok(low.answerRange.high > high.answerRange.high);
  assert.ok(low.confidenceScore < high.confidenceScore);
});

test("bio-sized deck does not produce capped or uncertain ETA", () => {
  const mastery = {};
  const scheduler = {};
  for (let i = 0; i < 28; i += 1) mastery[i] = "familiar";
  for (let i = 28; i < 56; i += 1) mastery[i] = "somewhat familiar";
  for (let i = 0; i < 215; i += 1) scheduler[i] = { seenCount: i < 56 ? 1 : 0, correctStreak: 0 };
  const events = makeEvents(79, 50, 30);

  withStorage({ [keys.masteryEtaTiming]: timingStorage(events) }, () => {
    const state = makeState({ cards: 215, mastery, scheduler, queue: [0, 1, 2] });
    const stats = buildMasteryEtaStats(state, keys);
    const interpretation = buildMathOnlyInterpretation(stats);

    assert.equal(stats.fastestPathAnswers, 776);
    assert.ok(stats.mathAnswerRange.high < 20_000);
    assert.match(interpretation.label, /confidence \d+% · (low|medium|high)/);
    assert.doesNotMatch(interpretation.label, /uncertain|cap/i);
  });
});
