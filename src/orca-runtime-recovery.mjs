export const OrcaActionClass = Object.freeze({
  READ: "read",
  MUTATION: "mutation",
  HIGH_RISK_MUTATION: "high_risk_mutation"
});

const READ_ACTIONS = new Set([
  "status",
  "tab-list",
  "snapshot",
  "wait"
]);

const MUTATION_ACTIONS = new Set([
  "tab-create",
  "goto",
  "fill",
  "click"
]);

export function classifyOrcaAction(action) {
  if (action === "click-send") return OrcaActionClass.HIGH_RISK_MUTATION;
  if (READ_ACTIONS.has(action)) return OrcaActionClass.READ;
  if (MUTATION_ACTIONS.has(action)) return OrcaActionClass.MUTATION;
  throw new Error(`Unknown ORCA action: ${action}`);
}

export function reconcileAfterDisconnect({
  action,
  observation = {},
  submitted = false
}) {
  const actionClass = classifyOrcaAction(action);
  const base = {
    action,
    actionClass,
    requiresRuntimeReady: true,
    requiresFreshSnapshot: true,
    discardOldElementRefs: true,
    submitted: Boolean(submitted),
    retryAllowed: false
  };

  if (actionClass === OrcaActionClass.READ) {
    return {
      ...base,
      decision: "retry_read_after_runtime_ready",
      retryAllowed: true
    };
  }

  if (action === "fill") {
    if (observation.composerContainsPrompt === true) {
      return {
        ...base,
        decision: "mutation_already_applied_continue"
      };
    }

    if (observation.composerContainsPrompt === false) {
      return {
        ...base,
        decision: "retry_mutation_after_fresh_snapshot",
        retryAllowed: true
      };
    }

    return {
      ...base,
      decision: "reobserve_before_mutation_retry"
    };
  }

  if (action === "click-send") {
    const sentEvidence =
      observation.userMessageVisible === true ||
      observation.generationActive === true ||
      observation.assistantAnswerVisible === true;

    if (sentEvidence) {
      return {
        ...base,
        decision: "treat_as_submitted_continue_waiting",
        submitted: true
      };
    }

    if (
      observation.composerContainsPrompt === true &&
      observation.userMessageVisible === false &&
      observation.generationActive === false &&
      observation.assistantAnswerVisible === false
    ) {
      return {
        ...base,
        decision: "retry_send_once_after_fresh_snapshot",
        retryAllowed: true,
        submitted: false
      };
    }

    return {
      ...base,
      decision: "submission_result_unknown_reobserve",
      submitted: false
    };
  }

  return {
    ...base,
    decision: "reobserve_before_mutation_retry"
  };
}
