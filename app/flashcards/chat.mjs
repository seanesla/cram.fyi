import { escapeHtml } from "../shared/html.mjs";
import { GLOBAL_STORAGE_KEYS } from "../shared/storage.mjs";

export function createChatHelper({ elements, getCurrentCard, getOriginalCard, getMastery }) {
  const {
    chatLog,
    chatForm,
    chatInput,
    commandMenu,
    helperStatus,
    helperHint,
    helperExplain,
    helperWhy,
    helperNewChat,
    modelChip,
    effortChip,
    modelValue,
    effortValue,
    contextValue,
    queueValue
  } = elements;

  let helperSessionId = loadHelperSessionId();
  let helperModel = localStorage.getItem(GLOBAL_STORAGE_KEYS.chatModel) || "";
  let helperEffort = localStorage.getItem(GLOBAL_STORAGE_KEYS.chatEffort) || "";
  let cachedModels = null;
  let commandState = { type: "closed", items: [], index: 0 };
  let chatBusy = false;
  let chatQueue = [];
  let latestTokenUsage = null;

  const baseCommands = [
    { label: "/model", description: "choose model and reasoning effort", action: () => openModelMenu() },
    { label: "/models", description: "show available models", action: () => openModelMenu() },
    { label: "/effort", description: "change reasoning effort for current model", action: () => openEffortMenu(getSelectedModel()) },
    { label: "/compact", description: "compact Codex context for this chat", action: () => compactLiveHelper() },
    { label: "/new", description: "start a fresh Codex context", action: () => runResetCommand("new") },
    { label: "/clear", description: "clear visible chat and reset Codex context", action: () => runResetCommand("clear") },
    { label: "/resume", description: "explain saved chat behavior", action: () => addBotMessage("Resume is already on. This browser reloads the visible chat after refresh and keeps the same Codex thread while the local server stays running. Type /new or /clear to reset it.") },
    { label: "/help", description: "show slash command help", action: () => addBotMessage("Type / to open commands. Use arrow keys to move, Enter to choose, and Esc to close. /model lets you choose both model and reasoning effort.") }
  ];

  function start() {
    restoreChatMessages();
    updateChatSettings();
    bindEvents();
    checkCodexStatus();
    refreshSessionStatus();
    setInterval(refreshSessionStatus, 8000);
  }

  function renderContextHint() {
    if (!chatLog || chatLog.children.length) return;
    addBotMessage("Quick buttons can help immediately. Typed chat talks to Codex when you open this page from the local flashcard server. Type /help for chat commands.");
  }

  function bindEvents() {
    helperHint.addEventListener("click", () => addBotMessage(answerHelper("hint")));
    helperExplain.addEventListener("click", () => addBotMessage(answerHelper("explain")));
    helperWhy.addEventListener("click", () => addBotMessage(answerHelper("why")));
    helperNewChat.addEventListener("click", startNewHelperChat);
    modelChip.addEventListener("click", openModelMenu);
    effortChip.addEventListener("click", () => openEffortMenu(getSelectedModel()));

    chatInput.addEventListener("input", () => {
      if (chatInput.value.trim().startsWith("/")) openCommandMenu(chatInput.value);
      else closeCommandMenu();
    });

    chatInput.addEventListener("keydown", event => {
      if (event.key === "Escape" && commandState.items.length) {
        event.preventDefault();
        closeCommandMenu();
        return;
      }
      if (!commandState.items.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCommandSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCommandSelection(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        chooseCommandItem();
      }
    });

    chatForm.addEventListener("submit", event => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = "";
      closeCommandMenu();
      if (handleSlashCommand(text, true)) return;
      enqueueChatMessage(text);
    });
  }

  function addUserMessage(text) {
    return addMessage(text, "user");
  }

  function addBotMessage(text) {
    return addMessage(text, "bot");
  }

  function addMessage(text, type) {
    const div = document.createElement("div");
    div.className = `msg ${type}`;
    setMessageText(div, text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    saveChatMessages();
    return div;
  }

  function setMessageText(element, text) {
    const raw = String(text || "");
    element.dataset.rawText = raw;
    if (element.classList.contains("bot")) {
      element.innerHTML = renderMarkdown(raw);
    } else {
      element.textContent = raw;
      element.dataset.rawText = raw;
    }
  }

  function getMessageText(element) {
    return element.dataset.rawText || element.textContent || "";
  }

  function renderInlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function renderMarkdown(text) {
    const lines = String(text || "").split(/\n/);
    const blocks = [];
    let paragraph = [];
    let list = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };

    const flushList = () => {
      if (!list.length) return;
      blocks.push(`<ul>${list.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    };

    lines.forEach(line => {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        list.push(bullet[1]);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }
      flushList();
      paragraph.push(line.trim());
    });

    flushParagraph();
    flushList();
    return blocks.join("") || "";
  }

  function showThinkingMessage(element) {
    element.dataset.rawText = "";
    element.dataset.reasoningSummary = "";
    element.innerHTML = [
      `<div class="reasoning-summary hidden">`,
      `<div class="reasoning-summary-label">thinking summary</div>`,
      `<div class="reasoning-summary-text"></div>`,
      `</div>`,
      `<div class="thinking-indicator">thinking</div>`,
      `<div class="answer-body"></div>`
    ].join("");
  }

  function updateReasoningSummary(element, text) {
    element.dataset.reasoningSummary = text;
    const panel = element.querySelector(".reasoning-summary");
    const body = element.querySelector(".reasoning-summary-text");
    if (!panel || !body) return;
    panel.classList.toggle("hidden", !text.trim());
    body.innerHTML = renderMarkdown(text);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function updateStreamingAnswer(element, answer, reasoningSummary = "") {
    element.dataset.rawText = answer;
    const thinking = element.querySelector(".thinking-indicator");
    const body = element.querySelector(".answer-body");
    if (thinking) thinking.remove();
    if (reasoningSummary) updateReasoningSummary(element, reasoningSummary);
    if (body) {
      body.innerHTML = renderMarkdown(answer);
    } else {
      setMessageText(element, answer);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function loadHelperSessionId() {
    const saved = localStorage.getItem(GLOBAL_STORAGE_KEYS.chatSession);
    if (saved) return saved;
    return createHelperSessionId();
  }

  function createHelperSessionId() {
    const id = `agentic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(GLOBAL_STORAGE_KEYS.chatSession, id);
    return id;
  }

  function saveChatMessages() {
    const messages = [...chatLog.querySelectorAll(".msg")].slice(-100).map(el => ({
      type: el.classList.contains("user") ? "user" : "bot",
      text: getMessageText(el)
    }));
    localStorage.setItem(GLOBAL_STORAGE_KEYS.chatMessages, JSON.stringify(messages));
  }

  function restoreChatMessages() {
    try {
      const messages = JSON.parse(localStorage.getItem(GLOBAL_STORAGE_KEYS.chatMessages) || "[]");
      messages.forEach(message => {
        if (!message || (message.type !== "user" && message.type !== "bot")) return;
        const div = document.createElement("div");
        div.className = `msg ${message.type}`;
        setMessageText(div, String(message.text || ""));
        chatLog.appendChild(div);
      });
      chatLog.scrollTop = chatLog.scrollHeight;
    } catch {
      localStorage.removeItem(GLOBAL_STORAGE_KEYS.chatMessages);
    }
  }

  function clearSavedChatMessages() {
    localStorage.removeItem(GLOBAL_STORAGE_KEYS.chatMessages);
  }

  function setHelperStatus(text, state = "") {
    helperStatus.textContent = text;
    helperStatus.className = `helper-status ${state}`;
  }

  function updateChatSettings() {
    modelValue.textContent = helperModel || "Codex default";
    effortValue.textContent = helperEffort || "model default";
    queueValue.textContent = chatQueue.length === 1 ? "1 waiting" : `${chatQueue.length} waiting`;
    if (!latestTokenUsage || !latestTokenUsage.modelContextWindow) {
      contextValue.textContent = latestTokenUsage ? `${latestTokenUsage.last?.inputTokens || 0} input tokens` : "not used yet";
      return;
    }
    const used = latestTokenUsage.last?.inputTokens || 0;
    const limit = latestTokenUsage.modelContextWindow;
    const pct = Math.min(100, ((used / limit) * 100));
    contextValue.textContent = `${pct.toFixed(1)}% (${formatTokenCount(used)}/${formatTokenCount(limit)})`;
  }

  function formatTokenCount(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
  }

  async function refreshSessionStatus() {
    try {
      const response = await fetch(`/api/codex-session-status?sessionId=${encodeURIComponent(helperSessionId)}`);
      if (!response.ok) return;
      const data = await response.json();
      latestTokenUsage = data.tokenUsage || null;
      updateChatSettings();
    } catch {
      // The main status line already explains server connection issues.
    }
  }

  function handleSlashCommand(text, fromSubmit = false) {
    const command = text.trim().toLowerCase();
    if (!command.startsWith("/")) return false;
    if ((command === "/" || command === "") && fromSubmit) {
      openCommandMenu("/");
      return true;
    }
    if (command === "/help") {
      baseCommands.find(item => item.label === "/help").action();
      return true;
    }
    if (command === "/models" || command === "/model") {
      openModelMenu();
      return true;
    }
    if (command === "/compact") {
      compactLiveHelper();
      return true;
    }
    if (command === "/effort") {
      openEffortMenu(getSelectedModel());
      return true;
    }
    if (command.startsWith("/model ")) {
      setHelperModel(text.trim().slice(7).trim(), null);
      return true;
    }
    if (command === "/new" || command === "/clear") {
      runResetCommand(command.slice(1));
      return true;
    }
    if (command === "/resume") {
      baseCommands.find(item => item.label === "/resume").action();
      return true;
    }
    addBotMessage("Unknown command. Type /help to see available commands.");
    return true;
  }

  function runResetCommand(kind) {
    helperSessionId = createHelperSessionId();
    chatQueue = [];
    chatBusy = false;
    latestTokenUsage = null;
    chatLog.innerHTML = "";
    clearSavedChatMessages();
    updateChatSettings();
    resetLiveHelper(kind === "new" ? "Started a fresh Codex chat." : "Cleared the chat and reset Codex context.");
  }

  async function fetchModels() {
    if (cachedModels) return cachedModels;
    const response = await fetch("/api/codex-models");
    if (!response.ok) throw new Error("Could not load models.");
    const data = await response.json();
    cachedModels = Array.isArray(data.models) ? data.models : [];
    return cachedModels;
  }

  function getSelectedModel() {
    if (!cachedModels) return null;
    return cachedModels.find(model => helperModel && (model.id === helperModel || model.model === helperModel))
      || cachedModels.find(model => model.isDefault)
      || cachedModels[0]
      || null;
  }

  async function openModelMenu() {
    openMenu([{ label: "Loading models...", description: "asking Codex App Server", action: () => {} }], "models");
    try {
      const models = await fetchModels();
      openMenu(models.map(model => {
        const current = helperModel && (helperModel === model.id || helperModel === model.model);
        const fallback = !helperModel && model.isDefault;
        return {
          label: `${model.id}${current ? " current" : fallback ? " default" : ""}`,
          description: model.description || model.displayName || "Codex model",
          action: () => {
            helperModel = model.id;
            localStorage.setItem(GLOBAL_STORAGE_KEYS.chatModel, helperModel);
            openEffortMenu(model);
          }
        };
      }).concat({
        label: "Codex default",
        description: "let Codex choose your default model",
        action: () => {
          helperModel = "";
          localStorage.removeItem(GLOBAL_STORAGE_KEYS.chatModel);
          openEffortMenu(models.find(model => model.isDefault) || models[0] || null);
        }
      }), "models");
    } catch (error) {
      openMenu([{ label: "Could not load models", description: error.message || "local Codex server unavailable", action: closeCommandMenu }], "models");
    }
  }

  function openEffortMenu(model) {
    const effortOptions = (model && Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [])
      .map(option => ({
        effort: option.reasoningEffort,
        description: option.description || "Reasoning effort"
      }));
    const fallbacks = ["low", "medium", "high"].map(effort => ({ effort, description: "Reasoning effort" }));
    const unique = [...effortOptions, ...fallbacks].filter((item, i, list) =>
      item.effort && list.findIndex(other => other.effort === item.effort) === i
    );
    const defaultEffort = model ? model.defaultReasoningEffort : "";
    openMenu([
      {
        label: `model default${defaultEffort ? ` (${defaultEffort})` : ""}`,
        description: "use the default reasoning effort for this model",
        action: () => setHelperEffort("")
      },
      ...unique.map(item => ({
        label: `${item.effort}${helperEffort === item.effort ? " current" : ""}`,
        description: item.description,
        action: () => setHelperEffort(item.effort)
      }))
    ], "efforts");
  }

  function setHelperEffort(effort) {
    helperEffort = effort || "";
    if (helperEffort) localStorage.setItem(GLOBAL_STORAGE_KEYS.chatEffort, helperEffort);
    else localStorage.removeItem(GLOBAL_STORAGE_KEYS.chatEffort);
    const modelText = helperModel || "Codex default";
    const effortText = helperEffort || "model default";
    addBotMessage(`Model settings updated: ${modelText}, reasoning effort: ${effortText}.`);
    updateChatSettings();
    closeCommandMenu();
  }

  function setHelperModel(model, effort) {
    const normalized = model.trim();
    if (!normalized || normalized.toLowerCase() === "default") {
      helperModel = "";
      localStorage.removeItem(GLOBAL_STORAGE_KEYS.chatModel);
    } else {
      helperModel = normalized;
      localStorage.setItem(GLOBAL_STORAGE_KEYS.chatModel, helperModel);
    }
    if (effort !== null) setHelperEffort(effort || "");
    else {
      addBotMessage(`Model set to ${helperModel || "Codex default"} for future chat messages.`);
      updateChatSettings();
    }
  }

  function openCommandMenu(filter = chatInput.value) {
    const query = filter.trim().toLowerCase();
    const items = baseCommands.filter(item => item.label.startsWith(query) || query === "/");
    openMenu(items.length ? items : baseCommands, "commands");
  }

  function openMenu(items, type) {
    commandState = { type, items, index: 0 };
    renderCommandMenu();
  }

  function renderCommandMenu() {
    commandMenu.innerHTML = "";
    commandMenu.classList.toggle("hidden", !commandState.items.length);
    commandState.items.forEach((item, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `command-item${i === commandState.index ? " active" : ""}`;
      button.innerHTML = `<span class="command-name"></span><span class="command-desc"></span>`;
      button.querySelector(".command-name").textContent = item.label;
      button.querySelector(".command-desc").textContent = item.description || "";
      button.addEventListener("mousedown", event => {
        event.preventDefault();
        chooseCommandItem(i);
      });
      commandMenu.appendChild(button);
    });
  }

  function chooseCommandItem(indexOverride = commandState.index) {
    const item = commandState.items[indexOverride];
    if (!item) return;
    closeCommandMenu();
    chatInput.value = "";
    item.action();
  }

  function closeCommandMenu() {
    commandState = { type: "closed", items: [], index: 0 };
    commandMenu.classList.add("hidden");
    commandMenu.innerHTML = "";
  }

  function moveCommandSelection(delta) {
    if (!commandState.items.length) return;
    commandState.index = (commandState.index + delta + commandState.items.length) % commandState.items.length;
    renderCommandMenu();
  }

  function answerHelper(kind) {
    const current = getCurrentCard();
    if (!current) return "There is no active card right now.";
    const original = getOriginalCard(current);
    const level = getMastery(current._i);
    if (kind === "hint") {
      return `Hint: this card is in ${original.topic}. Try recalling the main phrase before flipping. Current tier: ${level}.`;
    }
    if (kind === "why") {
      return `Why it matters: ${original.topic} is part of the study guide, so this card is here to check that specific concept.`;
    }
    if (kind === "explain") {
      return `Plain answer: ${original.back}`;
    }
    return "Use the quick buttons for local help, or connect a local AI backend for real chat.";
  }

  async function askLiveHelper(userText) {
    const current = getCurrentCard();
    if (!current) return "There is no active card right now.";
    const response = await fetch("/api/flashcard-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: helperSessionId,
        model: helperModel,
        effort: helperEffort,
        message: userText,
        card: getOriginalCard(current),
        mastery: getMastery(current._i)
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Codex helper is unavailable.");
    }
    return response;
  }

  async function streamLiveHelper(userText, target) {
    const response = await askLiveHelper(userText);
    if (!response.body) {
      setMessageText(target, await response.text());
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    let reasoningSummary = "";
    let buffer = "";
    showThinkingMessage(target);

    const handleEventLine = line => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        answer += line;
        updateStreamingAnswer(target, answer, reasoningSummary);
        return;
      }
      const value = String(event.value || "");
      if (event.type === "reasoning_summary_delta") {
        reasoningSummary += value;
        updateReasoningSummary(target, reasoningSummary);
        return;
      }
      if (event.type === "answer_delta") {
        answer += value;
        updateStreamingAnswer(target, answer, reasoningSummary);
        return;
      }
      if (event.type === "error") {
        answer = value;
        updateStreamingAnswer(target, answer, reasoningSummary);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(handleEventLine);
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleEventLine(buffer);
    if (!answer.trim()) {
      answer = "Codex finished without returning visible text.";
      updateStreamingAnswer(target, answer, reasoningSummary);
    }
    saveChatMessages();
    refreshSessionStatus();
  }

  async function compactLiveHelper() {
    const target = addBotMessage("Compacting Codex context...");
    try {
      const response = await fetch("/api/flashcard-chat/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: helperSessionId })
      });
      if (!response.ok) throw new Error(await response.text());
      setMessageText(target, "Codex context compaction started. Keep studying; the next answer will use the compacted thread when it is ready.");
    } catch (error) {
      setMessageText(target, error.message || "Could not compact Codex context.");
    }
    saveChatMessages();
    refreshSessionStatus();
  }

  async function checkCodexStatus() {
    try {
      const response = await fetch("/api/codex-status");
      if (!response.ok) throw new Error("Open this page through `npm start` to use Codex chat.");
      const data = await response.json();
      setHelperStatus(data.detail || "Codex helper is ready.", data.ok ? "ready" : "error");
    } catch {
      setHelperStatus("Codex chat needs the local flashcard server. Run `npm start` from the cram.fyi repo and open the localhost URL.", "error");
    }
  }

  async function resetLiveHelper(successMessage = "Started a fresh Codex chat for this flashcard session.") {
    try {
      await fetch("/api/flashcard-chat/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: helperSessionId })
      });
      addBotMessage(successMessage);
    } catch {
      addBotMessage("Could not reset Codex chat. Make sure the local flashcard server is running.");
    }
  }

  function startNewHelperChat() {
    helperSessionId = createHelperSessionId();
    chatQueue = [];
    chatBusy = false;
    latestTokenUsage = null;
    chatLog.innerHTML = "";
    clearSavedChatMessages();
    updateChatSettings();
    resetLiveHelper("Started a fresh Codex chat.");
  }

  function enqueueChatMessage(text) {
    const pending = addUserMessage(text);
    pending.classList.add("pending");
    chatQueue.push({ text, pending });
    updateChatSettings();
    if (!chatBusy) processChatQueue();
  }

  async function processChatQueue() {
    if (chatBusy || !chatQueue.length) return;
    chatBusy = true;
    updateChatSettings();
    const item = chatQueue.shift();
    item.pending.classList.remove("pending");
    const reply = addBotMessage("");
    showThinkingMessage(reply);
    try {
      await streamLiveHelper(item.text, reply);
    } catch (error) {
      setMessageText(reply, error.message || "Codex helper is unavailable.");
      saveChatMessages();
      setHelperStatus(isContextErrorText(getMessageText(reply))
        ? "Codex hit the context limit. Try /compact or /new."
        : "Codex chat is not connected.", "error");
    } finally {
      chatBusy = false;
      updateChatSettings();
      chatInput.focus();
      processChatQueue();
    }
  }

  function isContextErrorText(text) {
    return /context limit|context window|too many tokens|contextWindowExceeded/i.test(text);
  }

  return {
    start,
    renderContextHint
  };
}
