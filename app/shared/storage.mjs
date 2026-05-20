export const MASTERY_LEVELS = ["unfamiliar", "somewhat familiar", "familiar", "mastered"];
export const MASTERY_CLASSES = ["unfamiliar", "somewhat", "familiar", "mastered"];

export const GLOBAL_STORAGE_KEYS = {
  leftSidebarWidth: "cramFyi_leftSidebarWidth_v1",
  rightSidebarWidth: "cramFyi_rightSidebarWidth_v1",
  chatSession: "cramFyi_chatSession_v1",
  chatMessages: "cramFyi_chatMessages_v1",
  chatModel: "cramFyi_chatModel_v1",
  chatEffort: "cramFyi_chatEffort_v1"
};

export const STUDY_STORAGE_SUFFIXES = [
  "selected_v1",
  "size_v1",
  "status_v1",
  "mastery_v1",
  "variant_v1",
  "generatedVariants_v6",
  "showKnowns_v1",
  "position_v1",
  "orderMode_v1",
  "waveNumber_v1",
  "waveQueue_v1",
  "scheduler_v1",
  "studyStep_v1",
  "resetBackup_v1",
  "masteryEtaTiming_v1",
  "masteryEtaCache_v1"
];

export function createStudyStorage(sourceKey, suffixes = STUDY_STORAGE_SUFFIXES) {
  const sourceSlug = String(sourceKey || "default").replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  const oldPrefix = `agenticFlashcards_${sourceSlug}`;
  const prefix = `cramFyi_${sourceSlug}`;
  migrateStorageKeys(oldPrefix, prefix, suffixes);

  return {
    prefix,
    oldStatus: `${prefix}_status_v1`,
    mastery: `${prefix}_mastery_v1`,
    selected: `${prefix}_selected_v1`,
    size: `${prefix}_size_v1`,
    variant: `${prefix}_variant_v1`,
    generatedVariants: `${prefix}_generatedVariants_v6`,
    showKnowns: `${prefix}_showKnowns_v1`,
    position: `${prefix}_position_v1`,
    orderMode: `${prefix}_orderMode_v1`,
    waveQueue: `${prefix}_waveQueue_v1`,
    scheduler: `${prefix}_scheduler_v1`,
    studyStep: `${prefix}_studyStep_v1`,
    resetBackup: `${prefix}_resetBackup_v1`,
    masteryEtaTiming: `${prefix}_masteryEtaTiming_v1`,
    masteryEtaCache: `${prefix}_masteryEtaCache_v1`
  };
}

export function migrateGlobalStorageKeys() {
  migrateStorageKeys("agenticFlashcards", "cramFyi", [
    "leftSidebarWidth_v1",
    "rightSidebarWidth_v1",
    "chatSession_v1",
    "chatMessages_v1",
    "chatModel_v1",
    "chatEffort_v1"
  ]);
}

export function migrateStorageKeys(oldPrefix, newPrefix, suffixes) {
  suffixes.forEach(suffix => {
    const oldKey = `${oldPrefix}_${suffix}`;
    const newKey = `${newPrefix}_${suffix}`;
    if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  });
}

export function allCardIndexes(totalCards) {
  return Array.from({ length: totalCards }, (_, i) => i);
}

export function loadSelectedCards(keys, totalCards, { saveDefault = false } = {}) {
  const all = allCardIndexes(totalCards);
  const savedSize = Number(localStorage.getItem(keys.size));

  if (savedSize !== totalCards) {
    if (saveDefault) {
      localStorage.setItem(keys.selected, JSON.stringify(all));
      localStorage.setItem(keys.size, String(totalCards));
    }
    return new Set(all);
  }

  try {
    const raw = JSON.parse(localStorage.getItem(keys.selected) || "[]");
    const valid = raw.filter(i => Number.isInteger(i) && i >= 0 && i < totalCards);
    return new Set(valid.length ? valid : all);
  } catch {
    return new Set(all);
  }
}

export function loadMasteryMap(keys, totalCards) {
  const migrated = migrateOldStatus(keys, totalCards);
  try {
    const raw = localStorage.getItem(keys.mastery);
    if (!raw) return migrated;
    const obj = JSON.parse(raw);
    const map = new Map();
    Object.entries(obj).forEach(([key, value]) => {
      const i = Number(key);
      if (Number.isInteger(i) && i >= 0 && i < totalCards && MASTERY_LEVELS.includes(value)) {
        map.set(i, value);
      }
    });
    return map.size ? map : migrated;
  } catch {
    return migrated;
  }
}

export function saveMapAsObject(key, map) {
  const obj = {};
  map.forEach((value, mapKey) => {
    obj[mapKey] = value;
  });
  localStorage.setItem(key, JSON.stringify(obj));
}

export function loadStoredNumber(key, { min = 0, fallback = 0 } = {}) {
  const saved = Number(localStorage.getItem(key));
  return Number.isInteger(saved) && saved >= min ? saved : fallback;
}

export function getMastery(masteryByCard, cardIndex) {
  return masteryByCard.get(cardIndex) || "unfamiliar";
}

export function getMasteryClass(level) {
  return MASTERY_CLASSES[MASTERY_LEVELS.indexOf(level)] || "unfamiliar";
}

function migrateOldStatus(keys, totalCards) {
  const map = new Map();
  try {
    const raw = localStorage.getItem(keys.oldStatus);
    if (!raw) return map;
    const obj = JSON.parse(raw);
    Object.entries(obj).forEach(([key, value]) => {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= totalCards) return;
      if (value === "known") map.set(i, "familiar");
      if (value === "learning") map.set(i, "unfamiliar");
    });
  } catch {
    return map;
  }
  return map;
}
