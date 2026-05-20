import { escapeHtml } from "./shared/html.mjs";

const els = {
  title: document.getElementById("title"),
  suppList: document.getElementById("suppList"),
  suppView: document.getElementById("suppView"),
  viewTitle: document.getElementById("viewTitle"),
  kindLabel: document.getElementById("kindLabel"),
  sourceNote: document.getElementById("sourceNote"),
  viewBody: document.getElementById("viewBody"),
  emptyNote: document.getElementById("emptyNote")
};

let supplements = [];

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function badge(label, value) {
  if (!value) return "";
  return `<span class="badge"><em>${escapeHtml(label)}</em>${escapeHtml(value)}</span>`;
}

function preview(items, limit = 5) {
  const values = asList(items).slice(0, limit);
  if (!values.length) return "";
  const extra = asList(items).length - values.length;
  return `${values.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`;
}

function renderSupplementList() {
  els.suppList.innerHTML = supplements.map((item, index) => `
    <button class="supp-item ${index === 0 ? "active" : ""}" type="button" data-supplement-id="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.kind || "supplement")}</span>
      <strong>${escapeHtml(item.title || item.id)}</strong>
      ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}
    </button>
  `).join("");
  els.suppList.querySelectorAll("[data-supplement-id]").forEach(button => {
    button.addEventListener("click", () => {
      els.suppList.querySelectorAll(".supp-item").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      loadSupplement(button.dataset.supplementId);
    });
  });
}

async function loadSupplement(id) {
  const response = await fetch(`/api/supplement?id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("That supplement could not be loaded.");
  const supplement = await response.json();
  renderSupplement(supplement.item, supplement.data);
}

function renderSupplement(item, data) {
  els.suppView.classList.remove("hidden");
  els.viewTitle.textContent = data.title || item.title || "Supplement";
  els.kindLabel.textContent = item.kind || "supplement";
  els.sourceNote.textContent = data.sourceNote || data.focusNote || "";
  if (item.kind === "hierarchy" || Array.isArray(data.roots)) {
    els.viewBody.innerHTML = renderHierarchy(data);
  } else {
    els.viewBody.innerHTML = renderGenericCards(data);
  }
}

function renderHierarchy(data) {
  return [
    renderRankOrder(data.rankOrder),
    `<div class="hierarchy-grid">${asList(data.roots).map(node => renderNode(node, 0)).join("")}</div>`,
    renderNamedCards("Scientific Names", data.scientificNames, renderScientificName),
    renderList("Reminders", data.examReminders)
  ].filter(Boolean).join("");
}

function renderRankOrder(ranks) {
  const items = asList(ranks);
  if (!items.length) return "";
  return `
    <section class="panel">
      <p class="eyebrow">broad to narrow</p>
      <div class="rank-strip">${items.map(rank => `<span>${escapeHtml(rank)}</span>`).join("")}</div>
    </section>
  `;
}

function renderNode(node, depth) {
  const children = asList(node.children);
  const traits = asList(node.traits);
  const examples = preview(node.examples, 6);
  return `
    <article class="node-card depth-${Math.min(depth, 3)}">
      <header>
        ${badge(node.rank || "Group", node.name || "Untitled")}
      </header>
      ${node.plain ? `<p>${escapeHtml(node.plain)}</p>` : ""}
      ${examples ? `<div class="examples"><strong>Examples:</strong> ${escapeHtml(examples)}</div>` : ""}
      ${traits.length ? `<ul>${traits.map(trait => `<li>${escapeHtml(trait)}</li>`).join("")}</ul>` : ""}
      ${children.length ? `<div class="child-grid">${children.map(child => renderNode(child, depth + 1)).join("")}</div>` : ""}
    </article>
  `;
}

function renderGenericCards(data) {
  const cards = asList(data.cards || data.items);
  if (!cards.length) return `<section class="panel">No displayable supplement content was found.</section>`;
  return `<div class="card-grid">${cards.map(card => `
    <article class="info-card">
      <h3>${escapeHtml(card.title || card.term || "Item")}</h3>
      ${card.body || card.text ? `<p>${escapeHtml(card.body || card.text)}</p>` : ""}
      ${renderList("", card.items)}
    </article>
  `).join("")}</div>`;
}

function renderNamedCards(title, items, renderItem) {
  const values = asList(items);
  if (!values.length) return "";
  return `
    <section class="panel">
      <p class="eyebrow">${escapeHtml(title)}</p>
      <div class="card-grid">${values.map(renderItem).join("")}</div>
    </section>
  `;
}

function renderScientificName(item) {
  return `
    <article class="info-card">
      <strong><em>${escapeHtml(item.name || "")}</em></strong>
      <span>${escapeHtml(item.common || "")}</span>
      <div>
        ${badge("Genus", item.genus)}
        ${badge("species", item.species)}
      </div>
    </article>
  `;
}

function renderList(title, items) {
  const values = asList(items);
  if (!values.length) return "";
  return `
    <section class="panel">
      ${title ? `<p class="eyebrow">${escapeHtml(title)}</p>` : ""}
      <ul class="simple-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

try {
  const response = await fetch("/api/supplements");
  if (!response.ok) throw new Error("Could not load supplements.");
  const data = await response.json();
  supplements = asList(data.items);
  els.title.textContent = supplements.length ? "Supplements" : "No Supplements";
  els.emptyNote.classList.toggle("hidden", supplements.length > 0);
  els.emptyNote.textContent = supplements.length ? "" : "No supplemental study tools are available for this data source.";
  renderSupplementList();
  if (supplements[0]) await loadSupplement(supplements[0].id);
} catch (error) {
  els.emptyNote.textContent = error.message || "Could not load supplements.";
}
