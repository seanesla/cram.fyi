import { escapeHtml } from "../shared/html.mjs";
import {
  buildGuideProgress,
  buildStudyGuideModel,
  describeGuideFilters,
  percentMastered,
  weakCount
} from "../shared/study-guide-model.mjs";

export function renderStudyGuide({
  markdown,
  dataSource,
  allCards,
  guideBody,
  selectedCards,
  masteryForCard,
  topicScope,
  masteryFilter,
  onFilterChange
}) {
  const model = buildStudyGuideModel(markdown, allCards);
  const progress = buildGuideProgress(model, allCards, selectedCards, masteryForCard);

  if (!model.sections.length) {
    guideBody.innerHTML = `<div class="guide-disclaimer">No study guide found for ${escapeHtml(dataSource)}.</div>`;
  } else {
    const first = model.sections[0];
    const disclaimer = first.disclaimer
      ? `<div class="guide-disclaimer">${escapeHtml(first.disclaimer)}</div>`
      : `<div class="guide-disclaimer">Active data source: ${escapeHtml(dataSource)}</div>`;
    guideBody.innerHTML = `
      ${disclaimer}
      <div class="guide-controls" aria-label="Study filters">
        <div class="guide-control-group">
          <div class="guide-control-label">topic scope</div>
          ${renderTopicScopeButton({ kind: "all", label: "all topics" }, topicScope)}
        </div>
        <div class="guide-control-group">
          <div class="guide-control-label">mastery</div>
          ${renderMasteryFilterButton({ kind: "all", label: "all levels" }, masteryFilter)}
          ${renderMasteryFilterButton({ kind: "needs-work", label: "needs work" }, masteryFilter)}
          ${renderMasteryFilterButton({ kind: "tier", tier: "unfamiliar", label: "unfamiliar" }, masteryFilter)}
          ${renderMasteryFilterButton({ kind: "tier", tier: "somewhat familiar", label: "somewhat" }, masteryFilter)}
          ${renderMasteryFilterButton({ kind: "tier", tier: "familiar", label: "familiar" }, masteryFilter)}
          ${renderMasteryFilterButton({ kind: "tier", tier: "mastered", label: "mastered" }, masteryFilter)}
        </div>
      </div>
      <div class="guide-focus-note">Studying: ${escapeHtml(describeGuideFilters({ topicScope, masteryFilter }))}</div>
      ${model.sections.map(section => renderSection(section, progress, topicScope)).join("")}
    `;
  }

  guideBody.querySelectorAll("[data-filter-type]").forEach(button => {
    button.addEventListener("click", () => {
      if (!onFilterChange) return;
      onFilterChange(readFilterButton(button));
    });
  });

  return {
    model,
    progress,
    guideSections: [...guideBody.querySelectorAll(".guide-section")],
    guideItems: [...guideBody.querySelectorAll("[data-guide-item]")]
  };
}

export function updateStudyGuideTree({ topic, model, guideSections, guideItems, guideBody }) {
  const mapping = model?.topicMap?.get(topic);
  const sectionId = mapping?.section?.id || "";
  const itemId = mapping?.itemId || "";

  guideSections.forEach(section => {
    section.classList.toggle("active", section.dataset.guideSection === sectionId);
  });

  let activeItem = null;
  guideItems.forEach(item => {
    const active = item.dataset.guideItem === itemId || (!itemId && item.dataset.guideTopics.split(";").includes(topic));
    item.classList.toggle("active", active);
    if (active && !activeItem) activeItem = item;
  });

  const activeTarget = activeItem || guideSections.find(section => section.dataset.guideSection === sectionId);
  if (activeTarget && guideBody) {
    activeTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function renderSection(section, progress, topicScope) {
  const stats = progress.sectionStats.get(section.id);
  const classes = [
    "guide-section",
    section.virtual ? "virtual" : "",
    topicScope?.kind === "section" && topicScope.id === section.id ? "focused" : ""
  ].filter(Boolean).join(" ");
  return `
    <section class="${classes}" data-guide-section="${escapeHtml(section.id)}">
      <button class="guide-section-header" type="button" ${filterAttrs("topic-scope", { kind: "section", id: section.id, label: section.title })}>
        <span>
          <span class="guide-section-title">${escapeHtml(section.title)}</span>
          <span class="guide-section-subtitle">${renderStatsText(stats)}</span>
        </span>
        ${renderMeter(stats)}
      </button>
      <ul class="guide-list">
        ${section.items.map(item => renderItem(item, progress, topicScope)).join("")}
      </ul>
    </section>
  `;
}

function renderItem(item, progress, topicScope) {
  const stats = progress.itemStats.get(item.id);
  const topics = item.topics.join(";");
  const classes = [
    topicScope?.kind === "item" && topicScope.id === item.id ? "focused" : ""
  ].filter(Boolean).join(" ");
  return `
    <li class="${classes}" data-guide-item="${escapeHtml(item.id)}" data-guide-topics="${escapeHtml(topics)}">
      <button type="button" class="guide-item-button" ${filterAttrs("topic-scope", { kind: "item", id: item.id, label: item.text })}>
        <span class="guide-item-text">${escapeHtml(item.text)}</span>
        ${stats?.total ? `<span class="guide-item-meta">${renderStatsText(stats)}</span>` : ""}
      </button>
    </li>
  `;
}

function renderStatsText(stats) {
  if (!stats || !stats.total) return "no linked cards";
  const weak = weakCount(stats);
  const mastered = percentMastered(stats);
  return `${stats.total} cards · ${weak} weak · ${mastered}% mastered`;
}

function renderMeter(stats) {
  if (!stats || !stats.total) return `<span class="guide-meter empty" aria-hidden="true"></span>`;
  const unfamiliar = percent(stats.unfamiliar, stats.total);
  const somewhat = percent(stats.somewhat, stats.total);
  const familiar = percent(stats.familiar, stats.total);
  const mastered = Math.max(0, 100 - unfamiliar - somewhat - familiar);
  return `
    <span class="guide-meter" aria-hidden="true">
      <span class="meter-unfamiliar" style="width:${unfamiliar}%"></span>
      <span class="meter-somewhat" style="width:${somewhat}%"></span>
      <span class="meter-familiar" style="width:${familiar}%"></span>
      <span class="meter-mastered" style="width:${mastered}%"></span>
    </span>
  `;
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function renderTopicScopeButton(topicScope, activeTopicScope) {
  const active = isSameFilter(topicScope, activeTopicScope) ? " active" : "";
  return `<button class="guide-filter${active}" type="button" ${filterAttrs("topic-scope", topicScope)}>${escapeHtml(topicScope.label)}</button>`;
}

function renderMasteryFilterButton(masteryFilter, activeMasteryFilter) {
  const active = isSameFilter(masteryFilter, activeMasteryFilter) ? " active" : "";
  return `<button class="guide-filter${active}" type="button" ${filterAttrs("mastery-filter", masteryFilter)}>${escapeHtml(masteryFilter.label)}</button>`;
}

function filterAttrs(type, value) {
  return [
    `data-filter-type="${escapeHtml(type)}"`,
    `data-filter-kind="${escapeHtml(value.kind)}"`,
    value.id ? `data-filter-id="${escapeHtml(value.id)}"` : "",
    value.tier ? `data-filter-tier="${escapeHtml(value.tier)}"` : "",
    value.topic ? `data-filter-topic="${escapeHtml(value.topic)}"` : "",
    value.label ? `data-filter-label="${escapeHtml(value.label)}"` : ""
  ].filter(Boolean).join(" ");
}

function readFilterButton(button) {
  const value = {
    kind: button.dataset.filterKind || "all",
    id: button.dataset.filterId || "",
    tier: button.dataset.filterTier || "",
    topic: button.dataset.filterTopic || "",
    label: button.dataset.filterLabel || ""
  };
  return { type: button.dataset.filterType || "topic-scope", value };
}

function isSameFilter(left, right) {
  if (!right) return left.kind === "all";
  return left.kind === right.kind
    && (left.id || "") === (right.id || "")
    && (left.tier || "") === (right.tier || "")
    && (left.topic || "") === (right.topic || "");
}
