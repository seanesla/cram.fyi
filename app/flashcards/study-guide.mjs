import { escapeHtml } from "../shared/html.mjs";

export function renderStudyGuide({ markdown, dataSource, allCards, guideBody }) {
  const sections = parseStudyGuide(markdown);
  const topicSections = {};
  const uniqueTopics = [...new Set(allCards.map(cardData => cardData.topic))];
  uniqueTopics.forEach(topic => {
    topicSections[topic] = sections.find(section => section.title === topic)?.title || topic;
  });

  if (!sections.length) {
    guideBody.innerHTML = `<div class="guide-disclaimer">No study guide found for ${escapeHtml(dataSource)}.</div>`;
  } else {
    const first = sections[0];
    const disclaimer = first.disclaimer
      ? `<div class="guide-disclaimer">${escapeHtml(first.disclaimer)}</div>`
      : `<div class="guide-disclaimer">Active data source: ${escapeHtml(dataSource)}</div>`;
    guideBody.innerHTML = disclaimer + sections.map(section => `
      <section class="guide-section" data-guide-section="${escapeHtml(section.title)}">
        <div class="guide-section-title">${escapeHtml(section.title)}</div>
        <ul class="guide-list">
          ${section.items.map(item => `<li data-guide-topics="${escapeHtml(section.title)}">${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `).join("");
  }

  return {
    topicSections,
    guideSections: [...document.querySelectorAll(".guide-section")],
    guideItems: [...document.querySelectorAll("[data-guide-topics]")]
  };
}

export function updateStudyGuideTree({ topic, topicSections, guideSections, guideItems, guideBody }) {
  const sectionName = topicSections[topic] || "";
  guideSections.forEach(section => {
    section.classList.toggle("active", section.dataset.guideSection === sectionName);
  });

  let activeItem = null;
  guideItems.forEach(item => {
    const topics = item.dataset.guideTopics.split(",").map(value => value.trim());
    const active = topics.includes(topic);
    item.classList.toggle("active", active);
    if (active && !activeItem) activeItem = item;
  });

  if (activeItem && guideBody) {
    activeItem.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function parseStudyGuide(markdown) {
  const lines = markdown.split(/\r?\n/).map(line => line.trim());
  const sections = [];
  let disclaimer = "";
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (/^#\s+/.test(line)) continue;

    const heading = line.match(/^#{2,6}\s+(.+)$/);
    const plainHeading = !heading && isPlainSectionHeading(line, lines[i + 1] || "");
    if (heading || plainHeading) {
      current = {
        title: heading ? heading[1].trim() : line,
        items: [],
        disclaimer: sections.length === 0 ? disclaimer.trim() : ""
      };
      sections.push(current);
      continue;
    }

    const item = line.replace(/^[-*]\s+/, "");
    if (current) current.items.push(item);
    else disclaimer += `${item} `;
  }

  return sections.filter(section => section.title && section.items.length);
}

function isPlainSectionHeading(line, nextLine) {
  if (!line || /^[-*]/.test(line)) return false;
  if (!nextLine || /^[-*]/.test(nextLine)) return true;
  if (line.length > 60) return false;
  return !/[.!?]$/.test(line);
}
