import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGuideProgress,
  buildStudyGuideModel,
  cardMatchesGuideFilters,
  parseStudyGuide
} from "./shared/study-guide-model.mjs";

test("topic comments attach to the next guide item without rendering as content", () => {
  const sections = parseStudyGuide(`
# Guide

Evolution

<!-- topics: Natural Selection; Population Genetics -->
Understand selection and allele changes.
  `);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].items.length, 1);
  assert.deepEqual(sections[0].items[0].topics, ["Natural Selection", "Population Genetics"]);
  assert.doesNotMatch(sections[0].items[0].text, /topics:/);
});

test("explicit tags map card topics to guide sections and items", () => {
  const cards = [
    { topic: "Natural Selection", front: "a", back: "b" },
    { topic: "Population Genetics", front: "c", back: "d" }
  ];
  const model = buildStudyGuideModel(`
Evolution

<!-- topics: Natural Selection -->
Describe natural selection.
<!-- topics: Population Genetics -->
Describe population genetics.
  `, cards);

  assert.equal(model.topicMap.get("Natural Selection").section.title, "Evolution");
  assert.match(model.topicMap.get("Natural Selection").itemId, /item-0$/);
  assert.match(model.topicMap.get("Population Genetics").itemId, /item-1$/);
});

test("fallback matching keeps unmatched topics visible instead of silent", () => {
  const cards = [
    { topic: "Hardy-Weinberg", front: "a", back: "b" },
    { topic: "Totally New Topic", front: "c", back: "d" }
  ];
  const model = buildStudyGuideModel(`
Evolution

Understand the Hardy-Weinberg equilibrium.
  `, cards);

  assert.equal(model.topicMap.get("Hardy-Weinberg").section.title, "Evolution");
  assert.equal(model.topicMap.get("Totally New Topic").section.title, "Unmapped topics");
});

test("guide progress counts mastery by mapped section", () => {
  const cards = [
    { topic: "Natural Selection", front: "a", back: "b" },
    { topic: "Natural Selection", front: "c", back: "d" },
    { topic: "Population Genetics", front: "e", back: "f" }
  ];
  const model = buildStudyGuideModel(`
Evolution

<!-- topics: Natural Selection; Population Genetics -->
Understand evolution mechanisms.
  `, cards);
  const progress = buildGuideProgress(
    model,
    cards,
    new Set([0, 1, 2]),
    index => index === 0 ? "mastered" : "unfamiliar"
  );

  const stats = progress.sectionStats.get(model.sections[0].id);
  assert.equal(stats.total, 3);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.unfamiliar, 2);
});

test("guide filters combine topic scope and mastery filter", () => {
  const cards = [
    { topic: "Natural Selection", front: "a", back: "b" },
    { topic: "Population Genetics", front: "c", back: "d" }
  ];
  const model = buildStudyGuideModel(`
Evolution

<!-- topics: Natural Selection -->
Describe natural selection.

Genetics

<!-- topics: Population Genetics -->
Describe population genetics.
  `, cards);

  const evolution = model.topicMap.get("Natural Selection").section;
  assert.equal(cardMatchesGuideFilters(
    model,
    cards[0],
    0,
    { topicScope: { kind: "section", id: evolution.id }, masteryFilter: { kind: "all" } },
    () => "unfamiliar"
  ), true);
  assert.equal(cardMatchesGuideFilters(
    model,
    cards[1],
    1,
    { topicScope: { kind: "section", id: evolution.id }, masteryFilter: { kind: "all" } },
    () => "unfamiliar"
  ), false);
  assert.equal(cardMatchesGuideFilters(
    model,
    cards[0],
    0,
    { topicScope: { kind: "all" }, masteryFilter: { kind: "needs-work" } },
    () => "mastered"
  ), false);
  assert.equal(cardMatchesGuideFilters(
    model,
    cards[0],
    0,
    { topicScope: { kind: "section", id: evolution.id }, masteryFilter: { kind: "tier", tier: "unfamiliar" } },
    () => "unfamiliar"
  ), true);
  assert.equal(cardMatchesGuideFilters(
    model,
    cards[0],
    0,
    { topicScope: { kind: "section", id: evolution.id }, masteryFilter: { kind: "tier", tier: "mastered" } },
    () => "unfamiliar"
  ), false);
});
