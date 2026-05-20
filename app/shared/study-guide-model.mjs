export const GUIDE_PROGRESS_LEVELS = ["unfamiliar", "somewhat familiar", "familiar", "mastered"];

export function buildStudyGuideModel(markdown, allCards = []) {
  const sections = parseStudyGuide(markdown);
  const cardTopics = [...new Set(allCards.map(cardData => normalizeTopic(cardData.topic)))];
  const topicToCardIndexes = buildTopicCardIndex(allCards);
  const topicMap = new Map();

  sections.forEach(section => {
    section.topics.forEach(topic => mapTopic(topicMap, topic, section, null));
    section.items.forEach((item, itemIndex) => {
      item.topics.forEach(topic => mapTopic(topicMap, topic, section, itemIndex));
    });
  });

  cardTopics.forEach(topic => {
    if (!topicMap.has(topic)) {
      const fallback = findFallbackMatch(topic, sections);
      if (fallback) mapTopic(topicMap, topic, fallback.section, fallback.itemIndex);
    }
  });

  const unmappedTopics = cardTopics.filter(topic => !topicMap.has(topic));
  if (unmappedTopics.length) {
    const section = makeSection(`guide-unmapped`, "Unmapped topics", [], sections.length);
    section.virtual = true;
    section.items = unmappedTopics.map((topic, itemIndex) => ({
      id: `${section.id}-item-${itemIndex}`,
      text: topic,
      topics: [topic],
      virtual: true
    }));
    sections.push(section);
    unmappedTopics.forEach((topic, itemIndex) => mapTopic(topicMap, topic, section, itemIndex));
  }

  sections.forEach(section => {
    const topics = new Set(section.topics);
    section.items.forEach(item => item.topics.forEach(topic => topics.add(topic)));
    section.topics = [...topics].filter(topic => cardTopics.includes(topic));
  });

  return {
    sections,
    topicMap,
    topicToCardIndexes,
    cardTopics
  };
}

export function parseStudyGuide(markdown) {
  const rawLines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let disclaimer = "";
  let current = null;
  let pendingTopics = [];

  rawLines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const commentTopics = parseTopicComment(line);
    if (commentTopics) {
      pendingTopics = commentTopics;
      return;
    }

    if (/^#\s+/.test(line)) return;

    const heading = line.match(/^#{2,6}\s+(.+)$/);
    const plainHeading = !heading && isPlainSectionHeading(line, rawLines[index + 1] || "");
    if (heading || plainHeading) {
      current = makeSection(
        `guide-section-${sections.length}`,
        heading ? heading[1].trim() : line,
        pendingTopics,
        sections.length,
        sections.length === 0 ? disclaimer.trim() : ""
      );
      pendingTopics = [];
      sections.push(current);
      return;
    }

    const item = line.replace(/^[-*]\s+/, "");
    if (current) {
      current.items.push({
        id: `${current.id}-item-${current.items.length}`,
        text: item,
        topics: pendingTopics
      });
    } else {
      disclaimer += `${item} `;
    }
    pendingTopics = [];
  });

  return sections.filter(section => section.title && section.items.length);
}

export function buildGuideProgress(model, allCards, selectedCards, masteryForCard) {
  const sectionStats = new Map();
  const itemStats = new Map();
  const topicStats = new Map();

  model.sections.forEach(section => {
    sectionStats.set(section.id, emptyStats());
    section.items.forEach(item => itemStats.set(item.id, emptyStats()));
  });
  model.cardTopics.forEach(topic => topicStats.set(topic, emptyStats()));

  allCards.forEach((cardData, cardIndex) => {
    if (!selectedCards.has(cardIndex)) return;
    const topic = normalizeTopic(cardData.topic);
    const level = normalizeMastery(masteryForCard(cardIndex));
    const mapping = model.topicMap.get(topic);
    increment(topicStats.get(topic), level);
    if (!mapping) return;
    increment(sectionStats.get(mapping.section.id), level);
    if (mapping.itemId) increment(itemStats.get(mapping.itemId), level);
  });

  return { sectionStats, itemStats, topicStats };
}

export function cardMatchesGuideFilters(model, cardData, cardIndex, filters, masteryForCard) {
  const value = filters && typeof filters === "object" ? filters : {};
  return cardMatchesTopicScope(model, cardData, value.topicScope)
    && cardMatchesMasteryFilter(cardIndex, value.masteryFilter, masteryForCard);
}

export function describeGuideFilters(filters) {
  const value = filters && typeof filters === "object" ? filters : {};
  return `${describeTopicScope(value.topicScope)} · ${describeMasteryFilter(value.masteryFilter)}`;
}

export function cardMatchesTopicScope(model, cardData, topicScope) {
  if (!topicScope || topicScope.kind === "all") return true;
  const topic = normalizeTopic(cardData.topic);
  const mapping = model.topicMap.get(topic);
  if (topicScope.kind === "section") return mapping?.section.id === topicScope.id;
  if (topicScope.kind === "item") return mapping?.itemId === topicScope.id;
  if (topicScope.kind === "topic") return topic === topicScope.topic;
  return true;
}

export function cardMatchesMasteryFilter(cardIndex, masteryFilter, masteryForCard) {
  if (!masteryFilter || masteryFilter.kind === "all") return true;
  const level = normalizeMastery(masteryForCard(cardIndex));
  if (masteryFilter.kind === "tier") return level === masteryFilter.tier;
  if (masteryFilter.kind === "needs-work") {
    return level === "unfamiliar" || level === "somewhat familiar";
  }
  return true;
}

export function describeTopicScope(topicScope) {
  if (!topicScope || topicScope.kind === "all") return "all topics";
  return topicScope.label || "selected topics";
}

export function describeMasteryFilter(masteryFilter) {
  if (!masteryFilter || masteryFilter.kind === "all") return "all levels";
  if (masteryFilter.kind === "needs-work") return "needs work";
  if (masteryFilter.kind === "tier") return masteryFilter.label || masteryFilter.tier;
  return "all levels";
}

export function percentMastered(stats) {
  if (!stats || !stats.total) return 0;
  return Math.round((stats.mastered / stats.total) * 100);
}

export function weakCount(stats) {
  if (!stats) return 0;
  return stats.unfamiliar + stats.somewhat;
}

export function normalizeTopic(topic) {
  return String(topic || "General").trim() || "General";
}

function makeSection(id, title, topics, order, disclaimer = "") {
  return {
    id,
    title,
    topics: topics.map(normalizeTopic),
    items: [],
    order,
    disclaimer
  };
}

function mapTopic(topicMap, topic, section, itemIndex) {
  const cleanTopic = normalizeTopic(topic);
  if (!cleanTopic || topicMap.has(cleanTopic)) return;
  const item = Number.isInteger(itemIndex) ? section.items[itemIndex] : null;
  topicMap.set(cleanTopic, {
    section,
    itemId: item?.id || "",
    itemIndex: Number.isInteger(itemIndex) ? itemIndex : -1
  });
}

function parseTopicComment(line) {
  const match = line.match(/^<!--\s*topics:\s*([\s\S]*?)\s*-->$/i);
  if (!match) return null;
  return match[1]
    .split(";")
    .map(normalizeTopic)
    .filter(Boolean);
}

function isPlainSectionHeading(line, nextRawLine) {
  if (!line || /^[-*]/.test(line)) return false;
  if (line.length > 80) return false;
  if (/[.!?]$/.test(line)) return false;
  return String(nextRawLine || "").trim() === "";
}

function buildTopicCardIndex(allCards) {
  const map = new Map();
  allCards.forEach((cardData, cardIndex) => {
    const topic = normalizeTopic(cardData.topic);
    if (!map.has(topic)) map.set(topic, []);
    map.get(topic).push(cardIndex);
  });
  return map;
}

function findFallbackMatch(topic, sections) {
  const normalizedTopic = normalizeText(topic);
  if (!normalizedTopic) return null;
  let best = null;
  sections.forEach(section => {
    const sectionScore = matchScore(normalizedTopic, normalizeText(section.title));
    if (sectionScore > (best?.score || 0)) best = { score: sectionScore, section, itemIndex: null };
    section.items.forEach((item, itemIndex) => {
      const score = matchScore(normalizedTopic, normalizeText(item.text));
      if (score > (best?.score || 0)) best = { score, section, itemIndex };
    });
  });
  return best?.score >= 2 ? best : null;
}

function matchScore(topic, text) {
  if (!topic || !text) return 0;
  if (topic === text) return 5;
  if (text.includes(topic)) return 4;
  if (topic.includes(text) && text.length >= 5) return 3;
  return 0;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function emptyStats() {
  return {
    unfamiliar: 0,
    somewhat: 0,
    familiar: 0,
    mastered: 0,
    total: 0
  };
}

function increment(stats, level) {
  if (!stats) return;
  stats.total += 1;
  if (level === "mastered") stats.mastered += 1;
  else if (level === "familiar") stats.familiar += 1;
  else if (level === "somewhat familiar") stats.somewhat += 1;
  else stats.unfamiliar += 1;
}

function normalizeMastery(level) {
  return GUIDE_PROGRESS_LEVELS.includes(level) ? level : "unfamiliar";
}
