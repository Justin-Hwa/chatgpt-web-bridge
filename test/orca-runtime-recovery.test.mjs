import test from "node:test";
import assert from "node:assert/strict";
import {
  OrcaActionClass,
  classifyOrcaAction,
  reconcileAfterDisconnect
} from "../src/orca-runtime-recovery.mjs";

test("classifies ORCA browser actions by retry risk", () => {
  assert.equal(classifyOrcaAction("snapshot"), OrcaActionClass.READ);
  assert.equal(classifyOrcaAction("fill"), OrcaActionClass.MUTATION);
  assert.equal(classifyOrcaAction("click-send"), OrcaActionClass.HIGH_RISK_MUTATION);
});

test("read operations can be retried after runtime recovery", () => {
  const plan = reconcileAfterDisconnect({ action: "snapshot" });
  assert.equal(plan.decision, "retry_read_after_runtime_ready");
  assert.equal(plan.retryAllowed, true);
  assert.equal(plan.requiresFreshSnapshot, true);
});

test("fill is not repeated when the prompt is already visible in the composer", () => {
  const plan = reconcileAfterDisconnect({
    action: "fill",
    observation: { composerContainsPrompt: true }
  });
  assert.equal(plan.decision, "mutation_already_applied_continue");
  assert.equal(plan.retryAllowed, false);
});

test("send disconnect with visible sent evidence becomes submitted without retry", () => {
  const plan = reconcileAfterDisconnect({
    action: "click-send",
    observation: {
      userMessageVisible: true,
      generationActive: true
    }
  });
  assert.equal(plan.decision, "treat_as_submitted_continue_waiting");
  assert.equal(plan.submitted, true);
  assert.equal(plan.retryAllowed, false);
});

test("send can be retried once only when a fresh observation proves it stayed a draft", () => {
  const plan = reconcileAfterDisconnect({
    action: "click-send",
    observation: {
      composerContainsPrompt: true,
      userMessageVisible: false,
      generationActive: false,
      assistantAnswerVisible: false
    }
  });
  assert.equal(plan.decision, "retry_send_once_after_fresh_snapshot");
  assert.equal(plan.submitted, false);
  assert.equal(plan.retryAllowed, true);
});

test("ambiguous send result never permits blind resubmission", () => {
  const plan = reconcileAfterDisconnect({
    action: "click-send",
    observation: {}
  });
  assert.equal(plan.decision, "submission_result_unknown_reobserve");
  assert.equal(plan.retryAllowed, false);
  assert.equal(plan.requiresFreshSnapshot, true);
  assert.equal(plan.discardOldElementRefs, true);
});
