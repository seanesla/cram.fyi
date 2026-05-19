import assert from "node:assert/strict";
import test from "node:test";

import { parseAcceptedRewordVariants } from "./rewording-validation.mjs";

test("accepts variants when the LLM marks the fixed back as still correct", () => {
  const reply = JSON.stringify({
    variants: [
      {
        front: "How would you explain natural selection?",
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      }
    ]
  });

  assert.deepEqual(parseAcceptedRewordVariants(reply, "What is natural selection?"), [
    "How would you explain natural selection?"
  ]);
});

test("rejects variants when the LLM says the fixed back no longer answers them", () => {
  const reply = JSON.stringify({
    variants: [
      {
        front: "What process causes helpful traits to become more common?",
        fixedBackStillAnswers: false,
        answerTargetChanged: true
      }
    ]
  });

  assert.deepEqual(parseAcceptedRewordVariants(reply, "What is natural selection?"), []);
});

test("rejects variants when the LLM says the answer target changed", () => {
  const reply = JSON.stringify({
    variants: [
      {
        front: "Which term names this evolutionary process?",
        fixedBackStillAnswers: true,
        answerTargetChanged: true
      }
    ]
  });

  assert.deepEqual(parseAcceptedRewordVariants(reply, "What is natural selection?"), []);
});

test("rejects old plain string variants", () => {
  const reply = JSON.stringify({
    variants: ["How would you explain natural selection?"]
  });

  assert.deepEqual(parseAcceptedRewordVariants(reply, "What is natural selection?"), []);
});

test("rejects duplicate, empty, too-long, and original-identical fronts", () => {
  const longFront = `${"word ".repeat(53)}?`;
  const reply = JSON.stringify({
    variants: [
      {
        front: "   ",
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      },
      {
        front: longFront,
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      },
      {
        front: "What is natural selection?",
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      },
      {
        front: "How would you explain natural selection?",
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      },
      {
        front: "how would you explain natural selection",
        fixedBackStillAnswers: true,
        answerTargetChanged: false
      }
    ]
  });

  assert.deepEqual(parseAcceptedRewordVariants(reply, "What is natural selection?"), [
    "How would you explain natural selection?"
  ]);
});
