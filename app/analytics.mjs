import { escapeHtml } from "./shared/html.mjs";
import { createStudyStorage, getMastery, loadMasteryMap, loadSelectedCards } from "./shared/storage.mjs";

let storageKeys = createStudyStorage("examples", [
  "status_v1",
  "mastery_v1",
  "selected_v1",
  "size_v1"
]);

let allCards = [];
let totalCards = 0;
let selected = new Set();
let mastery = new Map();
let rows = [];
let sectionRows = [];
let total = {unfamiliar: 0, somewhat: 0, familiar: 0, mastered: 0, total: 0};

loadAnalyticsData();

async function loadAnalyticsData() {
  try {
    const response = await fetch("/api/deck");
    if (!response.ok) throw new Error("Could not load flashcards.");
    const data = await response.json();
    storageKeys = createStudyStorage(String(data.storageKey || "default"), [
      "status_v1",
      "mastery_v1",
      "selected_v1",
      "size_v1"
    ]);
    allCards = Array.isArray(data.cards) ? data.cards : [];
    totalCards = allCards.length;
    selected = loadSelectedCards(storageKeys, totalCards);
    mastery = loadMasteryMap(storageKeys, totalCards);
    rows = buildTopicRows();
    sectionRows = buildSectionRows(rows);
    total = sumRows(rows);
    renderStats();
    renderTable(rows);
    renderCharts();
  } catch (error) {
    document.getElementById("offline").textContent = error.message || "Could not load analytics data.";
  }
}

function renderStats() {
  document.getElementById("totalStat").textContent = total.total;
  document.getElementById("unfamiliarStat").textContent = total.unfamiliar;
  document.getElementById("somewhatStat").textContent = total.somewhat;
  document.getElementById("familiarStat").textContent = total.familiar;
  document.getElementById("masteredStat").textContent = total.mastered;
}

function buildTopicRows() {
  const map = new Map();
  allCards.forEach((cardData, i) => {
    if (!selected.has(i)) return;
    const topic = cardData.topic || "General";
    if (!map.has(topic)) map.set(topic, {section: topic, topic, unfamiliar: 0, somewhat: 0, familiar: 0, mastered: 0, total: 0});
    const row = map.get(topic);
    row.total += 1;
    const cardStatus = getMastery(mastery, i);
    if (cardStatus === "mastered") row.mastered += 1;
    else if (cardStatus === "familiar") row.familiar += 1;
    else if (cardStatus === "somewhat familiar") row.somewhat += 1;
    else row.unfamiliar += 1;
  });
  return [...map.values()];
}

function buildSectionRows(topicRows) {
  const map = new Map();
  topicRows.forEach(row => {
    if (!map.has(row.section)) map.set(row.section, {label: row.section, unfamiliar: 0, somewhat: 0, familiar: 0, mastered: 0, total: 0});
    const section = map.get(row.section);
    section.unfamiliar += row.unfamiliar;
    section.somewhat += row.somewhat;
    section.familiar += row.familiar;
    section.mastered += row.mastered;
    section.total += row.total;
  });
  return [...map.values()];
}

function sumRows(topicRows) {
  return topicRows.reduce((sum, row) => ({
    unfamiliar: sum.unfamiliar + row.unfamiliar,
    somewhat: sum.somewhat + row.somewhat,
    familiar: sum.familiar + row.familiar,
    mastered: sum.mastered + row.mastered,
    total: sum.total + row.total
  }), {unfamiliar: 0, somewhat: 0, familiar: 0, mastered: 0, total: 0});
}

function renderTable(topicRows) {
  document.getElementById("topicTable").innerHTML = topicRows.map(row => `
    <tr>
      <td>${escapeHtml(row.section)}</td>
      <td>${escapeHtml(row.topic)}</td>
      <td class="unfamiliar">${row.unfamiliar}</td>
      <td class="somewhat">${row.somewhat}</td>
      <td class="familiar">${row.familiar}</td>
      <td class="mastered">${row.mastered}</td>
      <td>${row.total}</td>
    </tr>
  `).join("");
}

function renderCharts() {
  if (!window.Chart) {
    document.getElementById("offline").textContent = "Chart.js did not load. The table still shows your progress.";
    return;
  }

  const chartColor = "#d7dde4";
  const gridColor = "rgba(157,168,179,0.12)";
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {labels: {color: chartColor}},
      tooltip: {callbacks: {afterLabel: context => {
        const row = context.chart.data._rows && context.chart.data._rows[context.dataIndex];
        return row ? `Total cards: ${row.total}` : "";
      }}}
    },
    scales: {
      x: {stacked: true, ticks: {color: "#9da8b3"}, grid: {color: gridColor}},
      y: {stacked: true, beginAtZero: true, ticks: {color: "#9da8b3", precision: 0}, grid: {color: gridColor}}
    }
  };

  const sectionData = {
    labels: sectionRows.map(row => row.label),
    datasets: [
      {label: "Unfamiliar", data: sectionRows.map(row => row.unfamiliar), backgroundColor: "#ff8377"},
      {label: "Somewhat familiar", data: sectionRows.map(row => row.somewhat), backgroundColor: "#ffcf70"},
      {label: "Familiar", data: sectionRows.map(row => row.familiar), backgroundColor: "#8bd3ff"},
      {label: "Mastered", data: sectionRows.map(row => row.mastered), backgroundColor: "#63d471"}
    ],
    _rows: sectionRows
  };

  const weakRows = [...rows]
    .sort((a, b) => ((b.unfamiliar + b.somewhat) / b.total) - ((a.unfamiliar + a.somewhat) / a.total))
    .slice(0, 10);

  const weaknessData = {
    labels: weakRows.map(row => row.topic),
    datasets: [
      {label: "Unfamiliar", data: weakRows.map(row => row.unfamiliar), backgroundColor: "#ff8377"},
      {label: "Somewhat familiar", data: weakRows.map(row => row.somewhat), backgroundColor: "#ffcf70"},
      {label: "Familiar", data: weakRows.map(row => row.familiar), backgroundColor: "#8bd3ff"},
      {label: "Mastered", data: weakRows.map(row => row.mastered), backgroundColor: "#63d471"}
    ],
    _rows: weakRows
  };

  new Chart(document.getElementById("sectionChart"), {
    type: "bar",
    data: sectionData,
    options: {...common, plugins: {...common.plugins, title: {display: true, text: "Study Guide Sections", color: "#eef3f7"}}}
  });

  new Chart(document.getElementById("weaknessChart"), {
    type: "bar",
    data: weaknessData,
    options: {...common, indexAxis: "y", plugins: {...common.plugins, title: {display: true, text: "Weakest Topics First", color: "#eef3f7"}}}
  });

  new Chart(document.getElementById("overallChart"), {
    type: "doughnut",
    data: {
      labels: ["Unfamiliar", "Somewhat familiar", "Familiar", "Mastered"],
      datasets: [{data: [total.unfamiliar, total.somewhat, total.familiar, total.mastered], backgroundColor: ["#ff8377", "#ffcf70", "#8bd3ff", "#63d471"]}]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {position: "bottom", labels: {color: chartColor}},
        title: {display: true, text: "Overall Progress", color: "#eef3f7"}
      }
    }
  });
}
