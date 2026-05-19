import { saveMapAsObject } from "../shared/storage.mjs";

const REWORD_PREFETCH_LOOKAHEAD = 8;
const MAX_BACKGROUND_REWORDS = 2;

export function loadVariantIndexes(storageKeys, totalCards) {
  try {
    const raw = localStorage.getItem(storageKeys.variant);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const map = new Map();
    Object.entries(obj).forEach(([key, value]) => {
      const i = Number(key);
      if (Number.isInteger(i) && i >= 0 && i < totalCards && Number.isInteger(value) && value >= 0) {
        map.set(i, value);
      }
    });
    return map;
  } catch {
    return new Map();
  }
}

export function loadGeneratedVariants(storageKeys, totalCards) {
  try {
    const raw = localStorage.getItem(storageKeys.generatedVariants);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const map = new Map();
    Object.entries(obj).forEach(([key, value]) => {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= totalCards || !Array.isArray(value)) return;
      const cleaned = cleanVariants(value);
      if (cleaned.length) map.set(i, cleaned);
    });
    return map;
  } catch {
    return new Map();
  }
}

export function saveVariantIndexes(state, storageKeys) {
  saveMapAsObject(storageKeys.variant, state.variantIndexes);
}

export function saveGeneratedVariants(state, storageKeys) {
  saveMapAsObject(storageKeys.generatedVariants, state.generatedVariants);
}

export function createRewordingController({ state, storageKeys, getMastery, getSchedulerState, getCurrentCard, render }) {
  function getGeneratedVariants(cardIndex) {
    return state.generatedVariants.get(cardIndex) || [];
  }

  function shouldUseGeneratedVariant(cardIndex) {
    return getSchedulerState(cardIndex).seenCount > 0 && getMastery(cardIndex) !== "mastered";
  }

  function shouldRequestReword(cardData) {
    return shouldUseGeneratedVariant(cardData._i)
      && !getGeneratedVariants(cardData._i).length
      && !state.pendingRewords.has(cardData._i)
      && !state.failedRewords.has(cardData._i);
  }

  function isRewordLoading(cardIndex) {
    return shouldUseGeneratedVariant(cardIndex)
      && !getGeneratedVariants(cardIndex).length
      && !state.failedRewords.has(cardIndex);
  }

  function getCardText(cardData) {
    const generated = getGeneratedVariants(cardData._i);
    if (shouldUseGeneratedVariant(cardData._i) && generated.length) {
      const variant = (state.variantIndexes.get(cardData._i) || 0) % generated.length;
      return { front: generated[variant], back: cardData.back };
    }
    if (isRewordLoading(cardData._i)) {
      return { front: "rewording...", back: cardData.back, loading: true };
    }
    return { front: cardData.front, back: cardData.back };
  }

  function rotateVariant(cardIndex) {
    if (!getGeneratedVariants(cardIndex).length) return;
    const current = state.variantIndexes.get(cardIndex) || 0;
    state.variantIndexes.set(cardIndex, current + 1);
    saveVariantIndexes(state, storageKeys);
  }

  function queueRewordIfNeeded(cardData, options = {}) {
    if (!shouldRequestReword(cardData)) return;
    if (!options.priority && state.pendingRewords.size >= MAX_BACKGROUND_REWORDS) return;

    const cardIndex = cardData._i;
    const request = fetch("/api/reword-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card: {
          topic: cardData.topic,
          front: cardData.front,
          back: cardData.back
        }
      })
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not reword card.");
        const cleaned = Array.isArray(data.variants) ? cleanVariants(data.variants) : [];
        if (!cleaned.length) throw new Error("No usable reworded prompts returned.");
        state.generatedVariants.set(cardIndex, cleaned);
        saveGeneratedVariants(state, storageKeys);
        renderIfCurrentCard(cardIndex);
      })
      .catch(() => {
        state.failedRewords.add(cardIndex);
        renderIfCurrentCard(cardIndex);
      })
      .finally(() => {
        state.pendingRewords.delete(cardIndex);
        prefetchUpcomingRewords();
      });

    state.pendingRewords.set(cardIndex, request);
  }

  function prefetchUpcomingRewords() {
    if (!state.currentQueue.length || state.pendingRewords.size >= MAX_BACKGROUND_REWORDS) return;
    const queued = new Set();
    const limit = Math.min(state.currentQueue.length, state.currentIndex + REWORD_PREFETCH_LOOKAHEAD + 1);
    for (let i = state.currentIndex + 1; i < limit; i += 1) {
      const cardData = state.currentQueue[i];
      if (!cardData || queued.has(cardData._i)) continue;
      queued.add(cardData._i);
      queueRewordIfNeeded(cardData);
      if (state.pendingRewords.size >= MAX_BACKGROUND_REWORDS) return;
    }
  }

  function renderIfCurrentCard(cardIndex) {
    const current = getCurrentCard();
    if (current && current._i === cardIndex) render();
  }

  return {
    getCardText,
    queueRewordIfNeeded,
    prefetchUpcomingRewords,
    rotateVariant
  };
}

function cleanVariants(value) {
  return value
    .map(item => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}
