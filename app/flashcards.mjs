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
  GLOBAL_STORAGE_KEYS,
  createStudyStorage,
  loadMasteryMap,
  loadSelectedCards,
  migrateGlobalStorageKeys
} from "./shared/storage.mjs";

migrateGlobalStorageKeys();

let storageKeys = createStudyStorage("examples");

const state = {
  allCards: [],
  selectedCards: new Set(),
  masteryByCard: new Map(),
  variantIndexes: new Map(),
  generatedVariants: new Map(),
  pendingRewords: new Map(),
  failedRewords: new Set(),
  schedulerByCard: new Map(),
  showMastered: false,
  currentQueue: [],
  sourceDeck: [],
  history: [],
  currentIndex: 0,
  orderMode: "study",
  waveNumber: 1,
  studyStep: 0,
  topicSections: {},
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
  toggleKnowns: document.getElementById("toggleKnowns"),
  studyGuideOrder: document.getElementById("studyGuideOrder"),
  shuffleOrder: document.getElementById("shuffleOrder"),
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
  state.sourceDeck = getActiveCards(state);
  const selectedCards = state.allCards
    .map((cardData, i) => ({ ...cardData, _i: i }))
    .filter(cardData => state.selectedCards.has(cardData._i));

  els.unfamiliarCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "unfamiliar").length;
  els.somewhatCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "somewhat familiar").length;
  els.familiarCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "familiar").length;
  els.masteredCount.textContent = selectedCards.filter(cardData => getMastery(state, cardData._i) === "mastered").length;
  els.leftCount.textContent = state.orderMode === "study" ? state.sourceDeck.length : state.currentQueue.length;
  els.totalCount.textContent = selectedCards.length;
  els.toggleKnowns.textContent = state.showMastered ? "hide mastered" : "show mastered";
  els.undoBtn.disabled = state.history.length === 0;
  els.studyGuideOrder.classList.toggle("active", state.orderMode === "study");
  els.shuffleOrder.classList.toggle("active", state.orderMode === "shuffle");
  els.waveNote.textContent = getQueueNote(state);
  masteryEta.render();

  if (state.currentQueue.length === 0) {
    els.cardWrap.classList.add("hidden");
    els.empty.classList.remove("hidden");
    els.counter.textContent = "0 of 0";
    return;
  }

  els.cardWrap.classList.remove("hidden");
  els.empty.classList.add("hidden");
  els.card.classList.remove("flipped");

  const current = state.currentQueue[state.currentIndex];
  rewording.queueRewordIfNeeded(current, { priority: true });
  const text = rewording.getCardText(current);
  els.card.classList.toggle("rewording", Boolean(text.loading));
  els.counter.textContent = state.orderMode === "study"
    ? `card ${state.currentIndex + 1} of ${state.currentQueue.length} in this study queue`
    : `card ${state.currentIndex + 1} of ${state.currentQueue.length} in this shuffled queue`;
  els.frontText.textContent = text.front;
  els.backText.textContent = text.back;
  els.frontTopic.textContent = current.topic;
  els.backTopic.textContent = current.topic;

  const cardStatus = getMastery(state, current._i);
  const className = getCardMasteryClass(state, current._i);
  [els.frontStatus, els.backStatus].forEach(statusEl => {
    statusEl.classList.toggle("hidden", !cardStatus);
    statusEl.textContent = `${cardStatus || "unfamiliar"} · ${current.waveReason || getCardReason(state, current._i)}`;
    statusEl.className = `status ${className || "hidden"}`;
  });

  chat.renderContextHint();
  updateStudyGuideTree({
    topic: current.topic,
    topicSections: state.topicSections,
    guideSections: state.guideSections,
    guideItems: state.guideItems,
    guideBody: els.guideBody
  });
  rewording.prefetchUpcomingRewords();
}

async function loadStudyData() {
  try {
    const [deckResponse, guideResponse] = await Promise.all([
      fetch("/api/deck"),
      fetch("/api/study-guide")
    ]);
    if (!deckResponse.ok) throw new Error("Could not load flashcards.");

    const deckData = await deckResponse.json();
    const guideData = guideResponse.ok ? await guideResponse.json() : { markdown: "" };
    storageKeys = createStudyStorage(String(deckData.storageKey || "default"));
    state.allCards = Array.isArray(deckData.cards) ? deckData.cards : [];

    const guideView = renderStudyGuide({
      markdown: String(guideData.markdown || ""),
      dataSource: String(deckData.dataSource || "active data"),
      allCards: state.allCards,
      guideBody: els.guideBody
    });
    state.topicSections = guideView.topicSections;
    state.guideSections = guideView.guideSections;
    state.guideItems = guideView.guideItems;
  } catch (error) {
    state.allCards = [];
    els.guideBody.innerHTML = `<div class="guide-disclaimer">${escapeHtml(error.message || "Could not load study data.")}</div>`;
  }

  loadSavedStudyState();
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
  state.schedulerByCard = loadScheduler(state, storageKeys);
  state.showMastered = localStorage.getItem(storageKeys.showKnowns) === "true";
  state.orderMode = loadOrderMode(storageKeys);
  state.waveNumber = loadWaveNumber(storageKeys);
  state.studyStep = loadStudyStep(storageKeys);
  state.currentIndex = loadStudyPosition(storageKeys);
}

function markAndRender(value) {
  masteryEta.recordAnswer(value);
  markCard(state, storageKeys, value, { rotateVariant: rewording.rotateVariant });
  render();
}

function undoAndRender() {
  if (state.history.length) masteryEta.undoLatestAnswer();
  undoLastMark(state, storageKeys);
  render();
}

function shuffleAndRender() {
  shuffleCurrentQueue(state, storageKeys);
  render();
}

function toggleMasteredAndRender() {
  state.showMastered = !state.showMastered;
  localStorage.setItem(storageKeys.showKnowns, String(state.showMastered));
  clearCurrentQueue(storageKeys);
  rebuildQueue(state, storageKeys, true);
  render();
}

function resetProgressAndRender() {
  resetStudyProgress(state, storageKeys);
  masteryEta.clear();
  rewording = createRewording();
  render();
}

function regenerateRewordsAndRender() {
  rewording.clearGeneratedRewords();
  render();
}

function switchToStudyOrderAndRender() {
  resetStudyOrder(state, storageKeys);
  render();
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
  document.getElementById("flip").addEventListener("click", () => els.card.classList.toggle("flipped"));
  els.card.addEventListener("click", () => els.card.classList.toggle("flipped"));
  document.getElementById("markLearning").addEventListener("click", () => markAndRender("learning"));
  document.getElementById("markKnown").addEventListener("click", () => markAndRender("known"));
  document.getElementById("undo").addEventListener("click", undoAndRender);
  document.getElementById("shuffle").addEventListener("click", shuffleAndRender);
  els.regenerateRewords.addEventListener("click", regenerateRewordsAndRender);
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
      els.card.classList.toggle("flipped");
    } else if (event.key === "ArrowLeft") {
      markAndRender("learning");
    } else if (event.key === "ArrowRight") {
      markAndRender("known");
    } else if (event.key.toLowerCase() === "u") {
      undoAndRender();
    } else if (event.key.toLowerCase() === "k") {
      toggleMasteredAndRender();
    }
  });
}

bindStudyEvents();
loadSidebarWidths();
chat.start();
loadStudyData();
