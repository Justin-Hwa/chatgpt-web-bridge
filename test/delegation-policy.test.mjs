import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUDGET,
  canFollowUp,
  shouldDelegate
} from "../src/delegation-policy.mjs";

test("explicit request delegates", () => {
  const result = shouldDelegate({ explicitUserRequest: true });
  assert.equal(result.delegate, true);
  assert.equal(result.reason, "explicit_user_request");
});

test("trivial task does not delegate", () => {
  const result = shouldDelegate({ taskKind: "typo" });
  assert.equal(result.delegate, false);
  assert.equal(result.reason, "trivial_local_task");
});

test("high-impact auth delegates", () => {
  const result = shouldDelegate({ taskKind: "authentication" });
  assert.equal(result.delegate, true);
  assert.equal(result.consultationKind, "design-review");
});

test("multiple hypotheses delegate", () => {
  const result = shouldDelegate({ competingHypotheses: 3, confidence: 0.6 });
  assert.equal(result.delegate, true);
  assert.equal(result.consultationKind, "root-cause-review");
});

test("budget blocks delegation", () => {
  const result = shouldDelegate({
    explicitUserRequest: true,
    consultationCount: DEFAULT_BUDGET.maxConsultations
  });
  assert.equal(result.delegate, false);
  assert.equal(result.reason, "budget_exhausted");
});

test("follow-up requires evidence or unresolved material question", () => {
  assert.equal(canFollowUp({ followupCount: 0 }), false);
  assert.equal(canFollowUp({ followupCount: 0, newEvidence: true }), true);
});
