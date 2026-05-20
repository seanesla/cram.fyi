import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePracticeQuestion,
  parsePracticeQuestion,
  parsePracticeQuestionJudgment
} from "./practice-question-validation.mjs";

test("accepts valid multiple choice practice questions", () => {
  const question = normalizePracticeQuestion({
    type: "multiple-choice",
    prompt: "What does fitness mean in evolution?",
    choices: [
      { id: "a", text: "Reproductive success in a particular environment." },
      { id: "b", text: "Physical strength only." },
      { id: "c", text: "The age of an organism." },
      { id: "d", text: "The size of a population." }
    ],
    correctChoiceIds: ["a"],
    explanation: "Fitness is about reproductive success."
  });

  assert.equal(question.type, "multiple-choice");
  assert.deepEqual(question.correctChoiceIds, ["a"]);
});

test("rejects multiple choice with more than one correct answer", () => {
  assert.equal(normalizePracticeQuestion({
    type: "multiple-choice",
    prompt: "What does fitness mean in evolution?",
    choices: [
      { id: "a", text: "Reproductive success." },
      { id: "b", text: "Physical strength." },
      { id: "c", text: "A trait." }
    ],
    correctChoiceIds: ["a", "c"]
  }), null);
});

test("accepts valid select-all questions", () => {
  const question = parsePracticeQuestion(JSON.stringify({
    type: "select-all",
    prompt: "Select all that apply: which are mechanisms of evolution?",
    choices: [
      { id: "a", text: "Mutation" },
      { id: "b", text: "Genetic drift" },
      { id: "c", text: "Migration" },
      { id: "d", text: "Natural selection" },
      { id: "e", text: "Photosynthesis" }
    ],
    correctChoiceIds: ["a", "b", "c", "d"],
    explanation: "The lecture listed four mechanisms."
  }));

  assert.equal(question.type, "select-all");
  assert.deepEqual(question.correctChoiceIds, ["a", "b", "c", "d"]);
});

test("rejects select-all questions where every choice is correct", () => {
  assert.equal(normalizePracticeQuestion({
    type: "select-all",
    prompt: "Select all that apply.",
    choices: [
      { id: "a", text: "Mutation" },
      { id: "b", text: "Genetic drift" },
      { id: "c", text: "Migration" },
      { id: "d", text: "Natural selection" }
    ],
    correctChoiceIds: ["a", "b", "c", "d"]
  }), null);
});

test("accepts true false questions only with true and false choices", () => {
  const question = normalizePracticeQuestion({
    type: "true-false",
    prompt: "Individuals are the smallest unit that can evolve.",
    choices: [
      { id: "true", text: "True" },
      { id: "false", text: "False" }
    ],
    correctChoiceIds: ["false"]
  });

  assert.equal(question.type, "true-false");
  assert.deepEqual(question.correctChoiceIds, ["false"]);
});

test("rejects unsafe judge responses", () => {
  const question = normalizePracticeQuestion({
    type: "true-false",
    prompt: "Individuals are the smallest unit that can evolve.",
    choices: [
      { id: "true", text: "True" },
      { id: "false", text: "False" }
    ],
    correctChoiceIds: ["false"]
  });
  const reply = JSON.stringify({
    supportedByCard: true,
    answerableWithStudyContext: true,
    correctAnswersValid: true,
    distractorsPlausible: true,
    beginnerSafe: true,
    ambiguous: true
  });

  assert.equal(parsePracticeQuestionJudgment(reply, question), false);
});
