import { createChatHelper } from "./flashcards/chat.mjs";
import {
  createRewordingController,
  loadGeneratedVariants,
  loadVariantIndexes
} from "./flashcards/rewording.mjs";
import {
  clearCurrentQueue,
  getActiveCards,
  getCardMasteryClass,
  getCardReason,
  getCurrentCard as getCurrentScheduledCard,
  getMastery,
  getQueueNote,
  getSchedulerState,
  loadOrderMode,
  loadScheduler,
  loadStudyPosition,
  loadStudyStep,
  loadWaveNumber,
  markCard,
  rebuildQueue,
  resetStudyOrder,
  resetStudyProgress,
  shuffleCurrentQueue,
  undoLastMark
} from "./flashcards/scheduler.mjs";
import { renderStudyGuide, updateStudyGuideTree } from "./flashcards/study-guide.mjs";
import { createMasteryEtaController } from "./flashcards/mastery-eta.mjs";
import { escapeHtml } from "./shared/html.mjs";
import {
  cardMatchesGuideFilters,
  describeGuideFilters
} from "./shared/study-guide-model.mjs";
import {
  GLOBAL_STORAGE_KEYS,
  createStudyStorage,
  loadMasteryMap,
  loadSelectedCards,
  migrateGlobalStorageKeys
} from "./shared/storage.mjs";

migrateGlobalStorageKeys();

const QUESTION_TYPES = ["flashcard", "multiple-choice", "true-false", "select-all"];
const GENERATED_QUESTION_TYPES = QUESTION_TYPES.filter(type => type !== "flashcard");

let storageKeys = createStudyStorage("examples");

const state = {
  allCards: [],
  selectedCards: new Set(),
  masteryByCard: new Map(),
  variantIndexes: new Map(),
  generatedVariants: new Map(),
  pendingRewords: new Map(),
  failedRewords: new Set(),
  enabledQuestionTypes: new Set(["flashcard"]),
  practiceQuestions: new Map(),
  pendingPracticeQuestions: new Map(),
  failedPracticeQuestions: new Set(),
  currentPractice: null,
  bookmarkedCards: new Set(),
  browseBookmarkOnly: false,
  schedulerByCard: new Map(),
  showMastered: false,
  currentQueue: [],
  sourceDeck: [],
  history: [],
  currentIndex: 0,
  orderMode: "study",
  studyMode: "mastery",
  browseOrder: "guide",
  browseQueue: [],
  browseIndex: 0,
  waveNumber: 1,
  studyStep: 0,
  guideModel: null,
  guideProgress: null,
  topicScope: { kind: "all", label: "all topics" },
  masteryFilter: { kind: "all", label: "all levels" },
  focusCardIndexes: null,
  guideSections: [],
  guideItems: []
};

const els = {
  card: document.getElementById("card"),
  cardWrap: document.getElementById("cardWrap"),
  empty: document.getElementById("empty"),
  counter: document.getElementById("counter"),
  frontText: document.getElementById("frontText"),
  backText: document.getElementById("backText"),
  questionForm: document.getElementById("questionForm"),
  choiceList: document.getElementById("choiceList"),
  submitQuestion: document.getElementById("submitQuestion"),
  questionFeedback: document.getElementById("questionFeedback"),
  frontTopic: document.getElementById("frontTopic"),
  backTopic: document.getElementById("backTopic"),
  frontStatus: document.getElementById("frontStatus"),
  backStatus: document.getElementById("backStatus"),
  unfamiliarCount: document.getElementById("unfamiliarCount"),
  somewhatCount: document.getElementById("somewhatCount"),
  familiarCount: document.getElementById("familiarCount"),
  masteredCount: document.getElementById("masteredCount"),
  leftCount: document.getElementById("leftCount"),
  totalCount: document.getElementById("totalCount"),
  undoBtn: document.getElementById("undo"),
  regenerateRewords: document.getElementById("regenerateRewords"),
  restoreReset: document.getElementById("restoreReset"),
  toggleKnowns: document.getElementById("toggleKnowns"),
  masteryMode: document.getElementById("masteryMode"),
  browseMode: document.getElementById("browseMode"),
  studyGuideOrder: document.getElementById("studyGuideOrder"),
  shuffleOrder: document.getElementById("shuffleOrder"),
  browseBookmarkFilter: document.querySelector(".browse-bookmark-filter"),
  browseAllCards: document.getElementById("browseAllCards"),
  browseBookmarkedOnly: document.getElementById("browseBookmarkedOnly"),
  bookmarkCount: document.getElementById("bookmarkCount"),
  bookmarkCard: document.getElementById("bookmarkCard"),
  waveNote: document.getElementById("waveNote"),
  masteryEta: document.getElementById("masteryEta"),
  studyShell: document.querySelector(".study-shell"),
  guideBody: document.getElementById("guideBody"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  commandMenu: document.getElementById("commandMenu"),
  helperStatus: document.getElementById("helperStatus"),
  helperHint: document.getElementById("helperHint"),
  helperExplain: document.getElementById("helperExplain"),
  helperWhy: document.getElementById("helperWhy"),
  helperNewChat: document.getElementById("helperNewChat"),
  modelChip: document.getElementById("modelChip"),
  effortChip: document.getElementById("effortChip"),
  modelValue: document.getElementById("modelValue"),
  effortValue: document.getElementById("effortValue"),
  contextValue: document.getElementById("contextValue"),
  queueValue: document.getElementById("queueValue")
};
els.flipBtn = document.getElementById("flip");
els.markLearning = document.getElementById("markLearning");
els.markKnown = document.getElementById("markKnown");
els.continuePractice = document.getElementById("continuePractice");
els.questionTypeInputs = [...document.querySelectorAll(".question-types input[type='checkbox']")];
els.supplementsLink = document.getElementById("supplementsLink");

let rewording = createRewording();
const masteryEta = createMasteryEtaController({
  state,
  getStorageKeys: () => storageKeys,
  element: els.masteryEta
});

const chat = createChatHelper({
  elements: els,
  getCurrentCard: () => getCurrentScheduledCard(state),
  getOriginalCard: cardData => state.allCards[cardData._i] || cardData,
  getMastery: cardIndex => getMastery(state, cardIndex)
});

function createRewording() {
  return createRewordingController({
    state,
    storageKeys,
    getMastery: cardIndex => getMastery(state, cardIndex),
    getSchedulerState: cardIndex => getSchedulerState(state, cardIndex),
    getCurrentCard: () => getCurrentScheduledCard(state),
    render
  });
}

function render() {
  if (state.guideModel) applyFocus();
  syncQueueForMode();
  renderGuide();
  state.sourceDeck = state.studyMode === "mastery" ? getActiveCards(state) : getBrowseDeck();
  const selectedCards = state.allCards
    .map((cardData, i) => ({ ...cardData, _i: i }))
    .filter(cardData => state.selectedCards.has(cardData._i))
    .filter(cardData => !state.focusCardIndexes || state.focusCardIndexes.has(cardData._i));

  els.unfamiliarCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "unfamiliar").length;
  els.somewhatCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "somewhat familiar").length;
  els.familiarCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "familiar").length;
  els.masteredCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "mastered").length;
  els.leftCount.textContent = state.studyMode === "mastery"
    ? (state.orderMode === "study" ? state.sourceDeck.length : state.currentQueue.length)
    : state.currentQueue.length;
  els.totalCount.textContent = selectedCards.length;
  els.toggleKnowns.textContent = state.showMastered ? "hide mastered" : "show mastered";
  els.undoBtn.disabled = state.studyMode !== "mastery" || state.history.length === 0;
  els.restoreReset.classList.toggle("hidden", !hasResetBackup());
  els.masteryMode.classList.toggle("active", state.studyMode === "mastery");
  els.browseMode.classList.toggle("active", state.studyMode === "browse");
  els.studyGuideOrder.classList.toggle("active", getActiveOrderMode() === "study");
  els.shuffleOrder.classList.toggle("active", getActiveOrderMode() === "shuffle");
  els.browseAllCards.classList.toggle("active", !state.browseBookmarkOnly);
  els.browseBookmarkedOnly.classList.toggle("active", state.browseBookmarkOnly);
  els.browseBookmarkedOnly.disabled = state.bookmarkedCards.size === 0 && !state.browseBookmarkOnly;
  els.bookmarkCount.textContent = state.bookmarkedCards.size;
  els.browseBookmarkFilter.classList.toggle("hidden", state.studyMode !== "browse");
  els.toggleKnowns.disabled = state.studyMode !== "mastery";
  els.regenerateRewords.disabled = state.studyMode !== "mastery";
  els.regenerateRewords.classList.toggle("hidden", state.studyMode !== "mastery");
  els.waveNote.textContent = getModeNote();
  if (state.studyMode === "mastery") masteryEta.render();
  else {
    els.masteryEta.textContent = "";
    els.masteryEta.dataset.confidence = "";
  }

  if (state.currentQueue.length === 0) {
    els.cardWrap.classList.add("hidden");
    els.empty.classList.remove("hidden");
    els.bookmarkCard.classList.add("hidden");
    els.empty.textContent = getEmptyMessage();
    els.counter.textContent = "0 of 0";
    return;
  }

  els.cardWrap.classList.remove("hidden");
  els.empty.classList.add("hidden");

  const current = state.currentQueue[state.currentIndex];
  renderBookmarkButton(current);
  const practice = state.studyMode === "mastery" ? getCurrentPractice(current) : getBrowsePractice(current);
  if (practice.answered) els.card.classList.add("flipped");
  else els.card.classList.remove("flipped");
  const text = getCurrentDisplayText(current, practice);
  els.card.classList.toggle("rewording", Boolean(text.loading));
  els.counter.textContent = getCounterText();
  els.frontText.textContent = text.front;
  els.backText.textContent = text.back;
  els.frontTopic.textContent = current.topic;
  els.backTopic.textContent = current.topic;

  const cardStatus = getMastery(state, current._i);
  const className = getCardMasteryClass(state, current._i);
  [els.frontStatus, els.backStatus].forEach(statusEl => {
    statusEl.classList.toggle("hidden", !cardStatus);
    statusEl.textContent = state.studyMode === "mastery"
      ? `${cardStatus || "unfamiliar"} · ${current.waveReason || getCardReason(state, current._i)}`
      : `${cardStatus || "unfamiliar"} · read-only browse`;
    statusEl.className = `status ${className || "hidden"}`;
  });

  renderQuestionForm(practice);
  renderActionState(practice, Boolean(text.loading));
  chat.renderContextHint();
  updateStudyGuideTree({
    topic: current.topic,
    model: state.guideModel,
    guideSections: state.guideSections,
    guideItems: state.guideItems,
    guideBody: els.guideBody
  });
  if (state.studyMode === "mastery") rewording.prefetchUpcomingRewords();
}

function getCurrentDisplayText(cardData, practice) {
  if (state.studyMode === "browse") {
    return { front: cardData.front, back: cardData.back };
  }
  if (practice.type === "flashcard") {
    rewording.queueRewordIfNeeded(cardData, { priority: true });
    return rewording.getCardText(cardData);
  }
  if (practice.question) {
    return {
      front: practice.question.prompt,
      back: getPracticeBackText(practice)
    };
  }
  queuePracticeQuestionIfNeeded(cardData, practice.type);
  if (practice.failed) return { front: cardData.front, back: cardData.back };
  return {
    front: `building ${questionTypeLabel(practice.type)} question...`,
    back: cardData.back,
    loading: true
  };
}

function renderBookmarkButton(cardData) {
  const active = state.bookmarkedCards.has(cardData._i);
  els.bookmarkCard.classList.toggle("hidden", state.studyMode !== "browse");
  els.bookmarkCard.classList.toggle("active", active);
  els.bookmarkCard.textContent = active ? "★" : "☆";
  els.bookmarkCard.setAttribute("aria-pressed", String(active));
  els.bookmarkCard.title = active ? "Remove bookmark" : "Bookmark this card";
}

function getBrowsePractice(cardData) {
  return {
    key: `browse:${cardData._i}`,
    cardIndex: cardData._i,
    type: "flashcard",
    selectedChoiceIds: new Set(),
    answered: false,
    correct: false,
    question: null,
    failed: false
  };
}

function renderGuide() {
  const guideView = renderStudyGuide({
    markdown: state.studyGuideMarkdown || "",
    dataSource: state.dataSource || "active data",
    allCards: state.allCards,
    guideBody: els.guideBody,
    selectedCards: state.selectedCards,
    masteryForCard: cardIndex => getMastery(state, cardIndex),
    topicScope: state.topicScope,
    masteryFilter: state.masteryFilter,
    onFilterChange: setGuideFilterAndRender
  });
  state.guideModel = guideView.model;
  state.guideProgress = guideView.progress;
  state.guideSections = guideView.guideSections;
  state.guideItems = guideView.guideItems;
}

function setGuideFilterAndRender(change) {
  applyFilterChange(change);
  saveFilters();
  applyFocus();
  clearCurrentQueue(storageKeys);
  state.currentIndex = 0;
  state.browseIndex = 0;
  state.browseQueue = [];
  rebuildQueue(state, storageKeys);
  render();
}

function applyFocus() {
  if (!state.allCards.length) {
    state.focusCardIndexes = null;
    return;
  }
  const allIndexes = state.allCards
    .map((cardData, cardIndex) => ({ cardData, cardIndex }))
    .filter(({ cardData, cardIndex }) => cardMatchesGuideFilters(
      state.guideModel,
      cardData,
      cardIndex,
      {
        topicScope: state.topicScope,
        masteryFilter: state.masteryFilter
      },
      index => getMastery(state, index)
    ))
    .map(({ cardIndex }) => cardIndex);
  state.focusCardIndexes = allIndexes.length === state.allCards.length ? null : new Set(allIndexes);
}

function syncQueueForMode() {
  if (state.studyMode === "browse") {
    ensureBrowseQueue();
    state.currentQueue = state.browseQueue;
    state.currentIndex = state.browseIndex;
  }
}

function ensureBrowseQueue() {
  const deck = getBrowseDeck();
  const deckIds = deck.map(cardData => cardData._i);
  const valid = state.browseQueue
    .map(cardData => cardData._i)
    .filter(i => deckIds.includes(i));
  if (valid.length !== deckIds.length || valid.some((id, index) => id !== state.browseQueue[index]?._i)) {
    const nextIds = state.browseOrder === "shuffle" ? shuffleIds([...deckIds]) : deckIds;
    state.browseQueue = nextIds.map(i => makeBrowseCard(i));
    state.browseIndex = 0;
    saveBrowseState();
  }
  state.browseIndex = Math.min(state.browseIndex, Math.max(state.browseQueue.length - 1, 0));
}

function getBrowseDeck() {
  return state.allCards
    .map((cardData, i) => ({ ...cardData, _i: i }))
    .filter(cardData => state.selectedCards.has(cardData._i))
    .filter(cardData => !state.focusCardIndexes || state.focusCardIndexes.has(cardData._i))
    .filter(cardData => !state.browseBookmarkOnly || state.bookmarkedCards.has(cardData._i))
    .sort((a, b) => a._i - b._i);
}

function makeBrowseCard(cardIndex) {
  return { ...state.allCards[cardIndex], _i: cardIndex, waveReason: "browse" };
}

function getActiveOrderMode() {
  if (state.studyMode === "browse") return state.browseOrder === "shuffle" ? "shuffle" : "study";
  return state.orderMode;
}

function getModeNote() {
  const focusText = describeGuideFilters({
    topicScope: state.topicScope,
    masteryFilter: state.masteryFilter
  });
  if (state.studyMode === "browse") {
    const order = state.browseOrder === "shuffle" ? "shuffled" : "guide order";
    const bookmarkText = state.browseBookmarkOnly ? "bookmarked only" : `${state.bookmarkedCards.size} bookmarked`;
    return `browse mode: ${state.currentQueue.length} cards · ${order} · ${bookmarkText} · ${focusText}`;
  }
  return `${getQueueNote(state)} · ${focusText}`;
}

function getEmptyMessage() {
  if (state.studyMode === "browse" && state.browseBookmarkOnly) {
    return "No bookmarked cards match the current study guide and mastery filters. Switch back to all cards or bookmark cards in browse mode.";
  }
  if (state.studyMode === "browse") {
    return "No cards match the current browse filters.";
  }
  return "All active cards are mastered. Press \"show mastered\" or \"reset marks\" to see them again.";
}

function getCounterText() {
  if (state.studyMode === "browse") {
    return `card ${state.currentIndex + 1} of ${state.currentQueue.length} in read-only browse`;
  }
  return state.orderMode === "study"
    ? `card ${state.currentIndex + 1} of ${state.currentQueue.length} in this study queue`
    : `card ${state.currentIndex + 1} of ${state.currentQueue.length} in this shuffled queue`;
}

function applyFilterChange(change) {
  if (!change || change.type === "topic-scope") {
    const next = normalizeTopicScope(change?.value);
    state.topicScope = isSameFilter(next, state.topicScope)
      ? { kind: "all", label: "all topics" }
      : next;
    return;
  }
  if (change.type === "mastery-filter") {
    state.masteryFilter = normalizeMasteryFilter(change.value);
  }
}

function normalizeTopicScope(topicScope) {
  const value = topicScope && typeof topicScope === "object" ? topicScope : {};
  if (value.kind === "section") return { kind: "section", id: String(value.id || ""), label: String(value.label || "section") };
  if (value.kind === "item") return { kind: "item", id: String(value.id || ""), label: String(value.label || "topic") };
  if (value.kind === "topic") return { kind: "topic", topic: String(value.topic || ""), label: String(value.label || value.topic || "topic") };
  return { kind: "all", label: "all topics" };
}

function normalizeMasteryFilter(masteryFilter) {
  const value = masteryFilter && typeof masteryFilter === "object" ? masteryFilter : {};
  if (value.kind === "tier") {
    const tier = ["unfamiliar", "somewhat familiar", "familiar", "mastered"].includes(value.tier)
      ? value.tier
      : "unfamiliar";
    return { kind: "tier", tier, label: String(value.label || tier) };
  }
  if (value.kind === "needs-work") return { kind: "needs-work", label: "needs work" };
  return { kind: "all", label: "all levels" };
}

function saveFilters() {
  sessionStorage.setItem(storageKeys.focus, JSON.stringify({
    version: 2,
    topicScope: state.topicScope,
    masteryFilter: state.masteryFilter
  }));
}

function loadFilters() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKeys.focus) || "{}");
    return normalizeStoredFilters(parsed);
  } catch {
    return {
      topicScope: { kind: "all", label: "all topics" },
      masteryFilter: { kind: "all", label: "all levels" }
    };
  }
}

function normalizeStoredFilters(value) {
  if (value?.version === 2 || value?.topicScope || value?.masteryFilter) {
    return {
      topicScope: normalizeTopicScope(value.topicScope),
      masteryFilter: normalizeMasteryFilter(value.masteryFilter)
    };
  }
  if (value?.kind === "section" || value?.kind === "item" || value?.kind === "topic") {
    return {
      topicScope: normalizeTopicScope(value),
      masteryFilter: { kind: "all", label: "all levels" }
    };
  }
  if (value?.kind === "needs-work" || value?.kind === "tier") {
    return {
      topicScope: { kind: "all", label: "all topics" },
      masteryFilter: normalizeMasteryFilter(value)
    };
  }
  return {
    topicScope: { kind: "all", label: "all topics" },
    masteryFilter: { kind: "all", label: "all levels" }
  };
}

function isSameFilter(left, right) {
  return left?.kind === right?.kind
    && (left?.id || "") === (right?.id || "")
    && (left?.tier || "") === (right?.tier || "")
    && (left?.topic || "") === (right?.topic || "");
}

function loadStudyMode() {
  return localStorage.getItem(storageKeys.studyMode) === "browse" ? "browse" : "mastery";
}

function saveStudyMode() {
  localStorage.setItem(storageKeys.studyMode, state.studyMode);
}

function loadBrowseState() {
  state.browseOrder = localStorage.getItem(storageKeys.browseOrder) === "shuffle" ? "shuffle" : "guide";
  state.browseIndex = loadSavedNumber(storageKeys.browsePosition);
  state.browseBookmarkOnly = localStorage.getItem(storageKeys.browseBookmarkOnly) === "true";
  state.bookmarkedCards = loadBookmarkedCards(state.allCards.length);
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.browseQueue) || "[]");
    state.browseQueue = Array.isArray(raw)
      ? raw.filter(i => Number.isInteger(i) && i >= 0 && i < state.allCards.length).map(i => makeBrowseCard(i))
      : [];
  } catch {
    state.browseQueue = [];
  }
}

function saveBrowseState() {
  localStorage.setItem(storageKeys.browseOrder, state.browseOrder);
  localStorage.setItem(storageKeys.browsePosition, String(state.browseIndex));
  localStorage.setItem(storageKeys.browseQueue, JSON.stringify(state.browseQueue.map(cardData => cardData._i)));
  localStorage.setItem(storageKeys.browseBookmarkOnly, String(state.browseBookmarkOnly));
}

function loadBookmarkedCards(totalCards) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.bookmarks) || "[]");
    return new Set(Array.isArray(raw)
      ? raw.filter(i => Number.isInteger(i) && i >= 0 && i < totalCards)
      : []);
  } catch {
    return new Set();
  }
}

function saveBookmarkedCards() {
  localStorage.setItem(storageKeys.bookmarks, JSON.stringify([...state.bookmarkedCards].sort((a, b) => a - b)));
}

function loadSavedNumber(key) {
  const value = Number(localStorage.getItem(key));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function shuffleIds(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function getCurrentPractice(cardData) {
  const type = pickQuestionType(cardData);
  const key = getPracticeKey(cardData, type);
  if (!state.currentPractice || state.currentPractice.key !== key) {
    state.currentPractice = {
      key,
      cardIndex: cardData._i,
      type,
      selectedChoiceIds: new Set(),
      answered: false,
      correct: false,
      question: type === "flashcard" ? null : getCachedPracticeQuestion(cardData, type),
      failed: type !== "flashcard" && state.failedPracticeQuestions.has(key)
    };
  } else if (type !== "flashcard" && !state.currentPractice.question) {
    state.currentPractice.question = getCachedPracticeQuestion(cardData, type);
    state.currentPractice.failed = state.failedPracticeQuestions.has(key);
  }
  return state.currentPractice;
}

function pickQuestionType(cardData) {
  return "flashcard";
}

function renderQuestionForm(practice) {
  els.questionFeedback.classList.add("hidden");
  els.questionFeedback.textContent = "";
  els.choiceList.innerHTML = "";
  els.questionForm.classList.add("hidden");
  els.submitQuestion.disabled = false;

  if (practice.type === "flashcard" || !practice.question || practice.failed) return;

  const inputType = practice.type === "select-all" ? "checkbox" : "radio";
  const name = `practice-${practice.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  els.choiceList.innerHTML = practice.question.choices.map(choice => {
    const selected = practice.selectedChoiceIds.has(choice.id);
    const correct = practice.question.correctChoiceIds.includes(choice.id);
    const classes = [
      "choice-option",
      practice.answered && correct ? "correct" : "",
      practice.answered && selected && !correct ? "incorrect" : ""
    ].filter(Boolean).join(" ");
    return `
      <label class="${classes}">
        <input type="${inputType}" name="${escapeHtml(name)}" value="${escapeHtml(choice.id)}" ${selected ? "checked" : ""} ${practice.answered ? "disabled" : ""}>
        <span>${escapeHtml(choice.text)}</span>
      </label>
    `;
  }).join("");
  els.questionForm.classList.remove("hidden");
  els.submitQuestion.classList.toggle("hidden", practice.answered);

  if (practice.answered) {
    els.questionFeedback.classList.remove("hidden");
    els.questionFeedback.innerHTML = `<strong>${practice.correct ? "Correct." : "Not quite."}</strong> ${escapeHtml(practice.question.explanation || "")}`;
  }
}

function renderActionState(practice, loading) {
  if (state.studyMode === "browse") {
    els.markLearning.textContent = "previous";
    els.markKnown.textContent = "next";
    els.markLearning.disabled = loading || state.currentQueue.length <= 1;
    els.markKnown.disabled = loading || state.currentQueue.length <= 1;
    els.flipBtn.disabled = loading;
    els.continuePractice.classList.add("hidden");
    return;
  }
  els.markLearning.textContent = "\u2190 still learning";
  els.markKnown.textContent = "got it \u2192";
  const generated = practice.type !== "flashcard" && !practice.failed;
  const waitingForAnswer = generated && !practice.answered;
  const waitingToContinue = generated && practice.answered;
  els.markLearning.disabled = loading || waitingForAnswer || waitingToContinue;
  els.markKnown.disabled = loading || waitingForAnswer || waitingToContinue;
  els.flipBtn.disabled = loading || (generated && !practice.answered);
  els.continuePractice.classList.toggle("hidden", !waitingToContinue);
}

function getPracticeBackText(practice) {
  if (!practice.question) return "";
  const correct = practice.question.choices
    .filter(choice => practice.question.correctChoiceIds.includes(choice.id))
    .map(choice => choice.text)
    .join("; ");
  return correct ? `Correct answer: ${correct}` : "";
}

async function loadStudyData() {
  try {
    const [deckResponse, guideResponse, supplementsResponse] = await Promise.all([
      fetch("/api/deck"),
      fetch("/api/study-guide"),
      fetch("/api/supplements")
    ]);
    if (!deckResponse.ok) throw new Error("Could not load flashcards.");

    const deckData = await deckResponse.json();
    const guideData = guideResponse.ok ? await guideResponse.json() : { markdown: "" };
    const supplementData = supplementsResponse.ok ? await supplementsResponse.json() : { items: [] };
    storageKeys = createStudyStorage(String(deckData.storageKey || "default"));
    state.allCards = Array.isArray(deckData.cards) ? deckData.cards : [];
    state.studyGuideMarkdown = String(guideData.markdown || "");
    state.dataSource = String(deckData.dataSource || "active data");
    els.supplementsLink.classList.toggle("hidden", !Array.isArray(supplementData.items) || supplementData.items.length === 0);
  } catch (error) {
    state.allCards = [];
    state.studyGuideMarkdown = "";
    state.dataSource = "active data";
    els.supplementsLink.classList.add("hidden");
    els.guideBody.innerHTML = `<div class="guide-disclaimer">${escapeHtml(error.message || "Could not load study data.")}</div>`;
  }

  loadSavedStudyState();
  renderGuide();
  applyFocus();
  rewording = createRewording();
  rebuildQueue(state, storageKeys);
  render();
}

function loadSavedStudyState() {
  const totalCards = state.allCards.length;
  state.selectedCards = loadSelectedCards(storageKeys, totalCards, { saveDefault: true });
  state.masteryByCard = loadMasteryMap(storageKeys, totalCards);
  state.variantIndexes = loadVariantIndexes(storageKeys, totalCards);
  state.generatedVariants = loadGeneratedVariants(storageKeys, totalCards);
  state.pendingRewords = new Map();
  state.failedRewords = new Set();
  state.enabledQuestionTypes = loadQuestionTypes();
  state.practiceQuestions = loadPracticeQuestions(totalCards);
  state.pendingPracticeQuestions = new Map();
  state.failedPracticeQuestions = new Set();
  state.currentPractice = null;
  state.schedulerByCard = loadScheduler(state, storageKeys);
  state.showMastered = localStorage.getItem(storageKeys.showKnowns) === "true";
  state.orderMode = loadOrderMode(storageKeys);
  state.studyMode = loadStudyMode();
  const filters = loadFilters();
  state.topicScope = filters.topicScope;
  state.masteryFilter = filters.masteryFilter;
  loadBrowseState();
  state.waveNumber = loadWaveNumber(storageKeys);
  state.studyStep = loadStudyStep(storageKeys);
  state.currentIndex = loadStudyPosition(storageKeys);
  renderQuestionTypeControls();
}

function loadQuestionTypes() {
  return new Set(["flashcard"]);
}

function saveQuestionTypes() {
  const values = QUESTION_TYPES.filter(type => state.enabledQuestionTypes.has(type));
  localStorage.setItem(storageKeys.questionTypes, JSON.stringify(values.length ? values : ["flashcard"]));
}

function renderQuestionTypeControls() {
  els.questionTypeInputs.forEach(input => {
    input.checked = state.enabledQuestionTypes.has(input.value);
  });
}

function loadPracticeQuestions(totalCards) {
  const map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.practiceQuestions) || "{}");
    Object.entries(raw).forEach(([key, value]) => {
      const cardIndex = Number(key);
      if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= totalCards) return;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const byType = {};
      GENERATED_QUESTION_TYPES.forEach(type => {
        const entry = value[type];
        if (entry && typeof entry === "object" && entry.signature && isPracticeQuestion(entry.question, type)) {
          byType[type] = entry;
        }
      });
      if (Object.keys(byType).length) map.set(cardIndex, byType);
    });
  } catch {
    return map;
  }
  return map;
}

function savePracticeQuestions() {
  const obj = {};
  state.practiceQuestions.forEach((value, key) => {
    obj[key] = value;
  });
  localStorage.setItem(storageKeys.practiceQuestions, JSON.stringify(obj));
}

function getCachedPracticeQuestion(cardData, type) {
  const entry = state.practiceQuestions.get(cardData._i)?.[type];
  if (!entry || entry.signature !== getCardSignature(cardData)) return null;
  return isPracticeQuestion(entry.question, type) ? entry.question : null;
}

function cachePracticeQuestion(cardData, type, question) {
  const byType = state.practiceQuestions.get(cardData._i) || {};
  byType[type] = {
    signature: getCardSignature(cardData),
    question
  };
  state.practiceQuestions.set(cardData._i, byType);
  savePracticeQuestions();
}

function getPracticeKey(cardData, type) {
  return `${cardData._i}:${type}:${getCardSignature(cardData)}`;
}

function getCardSignature(cardData) {
  return `${cardData.front || ""}\n${cardData.back || ""}`;
}

function queuePracticeQuestionIfNeeded(cardData, type) {
  if (!GENERATED_QUESTION_TYPES.includes(type)) return;
  const key = getPracticeKey(cardData, type);
  if (state.pendingPracticeQuestions.has(key) || state.failedPracticeQuestions.has(key)) return;

  const request = fetch("/api/practice-question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      card: {
        topic: cardData.topic,
        front: cardData.front,
        back: cardData.back
      }
    })
  })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not generate practice question.");
      if (!data.question) throw new Error("No practice question returned.");
      cachePracticeQuestion(cardData, type, data.question);
      if (state.currentPractice?.key === key) {
        state.currentPractice.question = data.question;
        state.currentPractice.failed = false;
        render();
      }
    })
    .catch(() => {
      state.failedPracticeQuestions.add(key);
      if (state.currentPractice?.key === key) {
        state.currentPractice.failed = true;
        render();
      }
    })
    .finally(() => {
      state.pendingPracticeQuestions.delete(key);
    });

  state.pendingPracticeQuestions.set(key, request);
}

function questionTypeLabel(type) {
  if (type === "multiple-choice") return "multiple choice";
  if (type === "true-false") return "true/false";
  if (type === "select-all") return "select all";
  return "flashcard";
}

function isPracticeQuestion(question, type) {
  if (!question || typeof question !== "object" || Array.isArray(question)) return false;
  if (question.type !== type || typeof question.prompt !== "string" || !question.prompt.trim()) return false;
  if (!Array.isArray(question.choices) || !Array.isArray(question.correctChoiceIds)) return false;
  const choiceIds = new Set();
  for (const choice of question.choices) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) return false;
    if (typeof choice.id !== "string" || typeof choice.text !== "string") return false;
    if (!choice.id.trim() || !choice.text.trim() || choiceIds.has(choice.id)) return false;
    choiceIds.add(choice.id);
  }
  if (!question.correctChoiceIds.every(id => choiceIds.has(id))) return false;
  if (type === "multiple-choice" || type === "true-false") return question.correctChoiceIds.length === 1;
  if (type === "select-all") return question.correctChoiceIds.length >= 2 && question.correctChoiceIds.length < question.choices.length;
  return false;
}

function markAndRender(value) {
  if (state.studyMode !== "mastery") return;
  masteryEta.recordAnswer(value);
  markCard(state, storageKeys, value, { rotateVariant: rewording.rotateVariant });
  render();
}

function undoAndRender() {
  if (state.studyMode !== "mastery") return;
  if (state.history.length) masteryEta.undoLatestAnswer();
  undoLastMark(state, storageKeys);
  render();
}

function shuffleAndRender() {
  if (state.studyMode === "browse") {
    state.browseOrder = "shuffle";
    state.browseQueue = shuffleIds(getBrowseDeck().map(cardData => cardData._i)).map(i => makeBrowseCard(i));
    state.browseIndex = 0;
    saveBrowseState();
  } else {
    shuffleCurrentQueue(state, storageKeys);
  }
  render();
}

function toggleMasteredAndRender() {
  if (state.studyMode !== "mastery") return;
  state.showMastered = !state.showMastered;
  localStorage.setItem(storageKeys.showKnowns, String(state.showMastered));
  clearCurrentQueue(storageKeys);
  rebuildQueue(state, storageKeys, true);
  render();
}

function resetProgressAndRender() {
  const message = "Reset all marks for this deck?\n\nThis clears your progress, but the app will save one undo-reset backup first.";
  if (!window.confirm(message)) return;
  saveResetBackup();
  resetStudyProgress(state, storageKeys);
  masteryEta.clear();
  rewording = createRewording();
  render();
}

function hasResetBackup() {
  return Boolean(localStorage.getItem(storageKeys.resetBackup));
}

function getResetBackupKeys() {
  return [
    storageKeys.mastery,
    storageKeys.scheduler,
    storageKeys.waveQueue,
    storageKeys.position,
    storageKeys.waveNumber,
    storageKeys.studyStep,
    storageKeys.masteryEtaTiming,
    storageKeys.masteryEtaCache,
    storageKeys.variant,
    storageKeys.generatedVariants,
    storageKeys.showKnowns,
    storageKeys.orderMode
  ];
}

function saveResetBackup() {
  const keys = Object.fromEntries(getResetBackupKeys().map(key => [key, localStorage.getItem(key)]));
  localStorage.setItem(storageKeys.resetBackup, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    keys
  }));
}

function restoreResetBackupAndRender() {
  const raw = localStorage.getItem(storageKeys.resetBackup);
  if (!raw) return;

  try {
    const backup = JSON.parse(raw);
    Object.entries(backup.keys || {}).forEach(([key, value]) => {
      if (typeof key !== "string" || !key.startsWith(`${storageKeys.prefix}_`)) return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    });
  } catch {
    window.alert("That reset backup could not be read.");
    return;
  }

  localStorage.removeItem(storageKeys.resetBackup);
  loadSavedStudyState();
  renderGuide();
  applyFocus();
  rewording = createRewording();
  rebuildQueue(state, storageKeys);
  render();
}

function regenerateRewordsAndRender() {
  if (state.studyMode !== "mastery") return;
  rewording.clearGeneratedRewords();
  render();
}

function switchToStudyOrderAndRender() {
  if (state.studyMode === "browse") {
    state.browseOrder = "guide";
    state.browseQueue = getBrowseDeck().map(cardData => makeBrowseCard(cardData._i));
    state.browseIndex = 0;
    saveBrowseState();
  } else {
    resetStudyOrder(state, storageKeys);
  }
  render();
}

function switchStudyMode(mode) {
  state.studyMode = mode === "browse" ? "browse" : "mastery";
  saveStudyMode();
  state.currentPractice = null;
  if (state.studyMode === "mastery") {
    rebuildQueue(state, storageKeys, true);
  } else {
    ensureBrowseQueue();
  }
  render();
}

function setBrowseBookmarkFilter(bookmarkOnly) {
  if (state.studyMode !== "browse") return;
  state.browseBookmarkOnly = Boolean(bookmarkOnly);
  state.browseQueue = [];
  state.browseIndex = 0;
  ensureBrowseQueue();
  saveBrowseState();
  render();
}

function toggleBookmarkAndRender() {
  if (state.studyMode !== "browse" || !state.currentQueue.length) return;
  const current = state.currentQueue[state.currentIndex];
  const removingBookmark = state.bookmarkedCards.has(current._i);
  const previousIndex = state.currentIndex;
  if (removingBookmark) state.bookmarkedCards.delete(current._i);
  else state.bookmarkedCards.add(current._i);
  saveBookmarkedCards();
  if (state.browseBookmarkOnly && removingBookmark) {
    state.browseQueue = [];
    state.browseIndex = 0;
    ensureBrowseQueue();
    if (!state.browseQueue.length && state.topicScope?.kind && state.topicScope.kind !== "all" && advanceBrowseScope(1)) return;
    state.browseIndex = Math.min(previousIndex, Math.max(state.browseQueue.length - 1, 0));
    state.currentIndex = state.browseIndex;
  }
  saveBrowseState();
  render();
}

function browseStep(delta) {
  if (state.studyMode !== "browse" || !state.currentQueue.length) return;
  const atEnd = delta > 0 && state.currentIndex >= state.currentQueue.length - 1;
  const atStart = delta < 0 && state.currentIndex <= 0;
  const scopedBrowse = state.topicScope?.kind && state.topicScope.kind !== "all";
  if ((atEnd || atStart) && scopedBrowse) {
    if (advanceBrowseScope(delta)) return;
    return;
  }
  state.browseIndex = (state.browseIndex + delta + state.currentQueue.length) % state.currentQueue.length;
  state.currentIndex = state.browseIndex;
  saveBrowseState();
  render();
}

function advanceBrowseScope(delta) {
  const nextScope = getAdjacentBrowseScope(delta);
  if (!nextScope) return false;

  state.topicScope = nextScope;
  saveFilters();
  applyFocus();
  state.browseQueue = [];
  ensureBrowseQueue();
  state.browseIndex = delta > 0 ? 0 : Math.max(state.browseQueue.length - 1, 0);
  state.currentIndex = state.browseIndex;
  saveBrowseState();
  render();
  return true;
}

function getAdjacentBrowseScope(delta) {
  const scopeKind = getBrowseScopeKind();
  if (!scopeKind) return null;
  const scopes = getBrowsableGuideScopes(scopeKind);
  const currentScope = getCurrentBrowseScope(scopeKind);
  const currentIndex = scopes.findIndex(scope => isSameFilter(scope, currentScope));
  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + (delta > 0 ? 1 : -1);
  return scopes[nextIndex] || null;
}

function getCurrentBrowseScope(scopeKind) {
  if (state.topicScope?.kind === scopeKind) return state.topicScope;
  if (state.topicScope?.kind !== "topic") return state.topicScope;
  const mapping = state.guideModel?.topicMap?.get(state.topicScope.topic);
  if (scopeKind === "item" && mapping?.itemId) {
    const item = mapping.section.items[mapping.itemIndex];
    return { kind: "item", id: mapping.itemId, label: item?.text || state.topicScope.label || "topic" };
  }
  if (scopeKind === "section" && mapping?.section?.id) {
    return { kind: "section", id: mapping.section.id, label: mapping.section.title };
  }
  return state.topicScope;
}

function getBrowseScopeKind() {
  if (state.topicScope?.kind === "section") return "section";
  if (state.topicScope?.kind === "item") return "item";
  if (state.topicScope?.kind === "topic") {
    const mapping = state.guideModel?.topicMap?.get(state.topicScope.topic);
    if (mapping?.itemId) return "item";
    if (mapping?.section?.id) return "section";
  }
  return "";
}

function getBrowsableGuideScopes(scopeKind) {
  const scopes = [];
  state.guideModel?.sections?.forEach(section => {
    if (scopeKind === "section") {
      const sectionScope = { kind: "section", id: section.id, label: section.title };
      if (hasBrowsableCards(sectionScope)) scopes.push(sectionScope);
      return;
    }
    section.items.forEach(item => {
      const itemScope = { kind: "item", id: item.id, label: item.text };
      if (hasBrowsableCards(itemScope)) scopes.push(itemScope);
    });
  });
  return scopes;
}

function hasBrowsableCards(topicScope) {
  return state.allCards.some((cardData, cardIndex) => {
    if (!state.selectedCards.has(cardIndex)) return false;
    if (state.browseBookmarkOnly && !state.bookmarkedCards.has(cardIndex)) return false;
    return cardMatchesGuideFilters(
      state.guideModel,
      cardData,
      cardIndex,
      {
        topicScope,
        masteryFilter: state.masteryFilter
      },
      index => getMastery(state, index)
    );
  });
}

function handleLeftAction() {
  if (state.studyMode === "browse") browseStep(-1);
  else markAndRender("learning");
}

function handleRightAction() {
  if (state.studyMode === "browse") browseStep(1);
  else markAndRender("known");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadSidebarWidths() {
  const left = Number(localStorage.getItem(GLOBAL_STORAGE_KEYS.leftSidebarWidth));
  const right = Number(localStorage.getItem(GLOBAL_STORAGE_KEYS.rightSidebarWidth));
  if (Number.isFinite(left)) setSidebarWidth("left", left);
  if (Number.isFinite(right)) setSidebarWidth("right", right);
}

function setSidebarWidth(side, width) {
  const max = Math.max(260, Math.floor(window.innerWidth * 0.36));
  const clamped = clamp(Math.round(width), side === "left" ? 220 : 280, max);
  els.studyShell.style.setProperty(side === "left" ? "--left-sidebar-width" : "--right-sidebar-width", `${clamped}px`);
  localStorage.setItem(side === "left" ? GLOBAL_STORAGE_KEYS.leftSidebarWidth : GLOBAL_STORAGE_KEYS.rightSidebarWidth, String(clamped));
}

function startSidebarResize(event) {
  const handle = event.currentTarget;
  const side = handle.dataset.resizeSidebar;
  if (!side || window.matchMedia("(max-width: 980px)").matches) return;
  event.preventDefault();
  handle.classList.add("dragging");
  const startX = event.clientX;
  const currentWidth = side === "left"
    ? parseFloat(getComputedStyle(els.studyShell).getPropertyValue("--left-sidebar-width"))
    : parseFloat(getComputedStyle(els.studyShell).getPropertyValue("--right-sidebar-width"));
  const move = moveEvent => {
    const delta = moveEvent.clientX - startX;
    setSidebarWidth(side, side === "left" ? currentWidth + delta : currentWidth - delta);
  };
  const stop = () => {
    handle.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function bindStudyEvents() {
  els.flipBtn.addEventListener("click", flipIfAllowed);
  els.card.addEventListener("click", event => {
    if (event.target.closest("form") || event.target.closest("button") || event.target.closest("label")) return;
    flipIfAllowed();
  });
  document.getElementById("markLearning").addEventListener("click", handleLeftAction);
  document.getElementById("markKnown").addEventListener("click", handleRightAction);
  els.masteryMode.addEventListener("click", () => switchStudyMode("mastery"));
  els.browseMode.addEventListener("click", () => switchStudyMode("browse"));
  els.browseAllCards.addEventListener("click", () => setBrowseBookmarkFilter(false));
  els.browseBookmarkedOnly.addEventListener("click", () => setBrowseBookmarkFilter(true));
  els.bookmarkCard.addEventListener("click", toggleBookmarkAndRender);
  els.continuePractice.addEventListener("click", continuePracticeAndRender);
  els.questionForm.addEventListener("submit", checkPracticeAnswer);
  els.questionTypeInputs.forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) state.enabledQuestionTypes.add(input.value);
      else state.enabledQuestionTypes.delete(input.value);
      if (!state.enabledQuestionTypes.size) {
        state.enabledQuestionTypes.add("flashcard");
        window.alert("At least one question type needs to stay on.");
      }
      saveQuestionTypes();
      renderQuestionTypeControls();
      state.currentPractice = null;
      render();
    });
  });
  document.getElementById("undo").addEventListener("click", undoAndRender);
  els.regenerateRewords.addEventListener("click", regenerateRewordsAndRender);
  els.restoreReset.addEventListener("click", restoreResetBackupAndRender);
  els.shuffleOrder.addEventListener("click", shuffleAndRender);
  els.studyGuideOrder.addEventListener("click", switchToStudyOrderAndRender);
  els.toggleKnowns.addEventListener("click", toggleMasteredAndRender);
  document.getElementById("reset").addEventListener("click", resetProgressAndRender);
  document.querySelectorAll("[data-resize-sidebar]").forEach(handle => {
    handle.addEventListener("pointerdown", startSidebarResize);
  });

  document.addEventListener("keydown", event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      flipIfAllowed();
    } else if (event.key === "ArrowLeft") {
      if (!els.markLearning.disabled) handleLeftAction();
    } else if (event.key === "ArrowRight") {
      if (!els.markKnown.disabled) handleRightAction();
    } else if (event.key.toLowerCase() === "u") {
      undoAndRender();
    } else if (event.key.toLowerCase() === "k") {
      toggleMasteredAndRender();
    } else if (event.key.toLowerCase() === "b" && state.studyMode === "browse") {
      toggleBookmarkAndRender();
    }
  });
}

function flipIfAllowed() {
  if (els.flipBtn.disabled) return;
  els.card.classList.toggle("flipped");
}

function checkPracticeAnswer(event) {
  event.preventDefault();
  const practice = state.currentPractice;
  if (!practice || practice.type === "flashcard" || !practice.question || practice.answered) return;
  const selected = new Set([...els.questionForm.querySelectorAll("input:checked")].map(input => input.value));
  if (!selected.size) {
    window.alert("Pick an answer first.");
    return;
  }
  const correct = new Set(practice.question.correctChoiceIds);
  practice.selectedChoiceIds = selected;
  practice.correct = selected.size === correct.size && [...selected].every(id => correct.has(id));
  practice.answered = true;
  els.card.classList.add("flipped");
  render();
}

function continuePracticeAndRender() {
  const practice = state.currentPractice;
  if (!practice || practice.type === "flashcard" || !practice.answered) return;
  markAndRender(practice.correct ? "known" : "learning");
}

bindStudyEvents();
loadSidebarWidths();
chat.start();
loadStudyData();
