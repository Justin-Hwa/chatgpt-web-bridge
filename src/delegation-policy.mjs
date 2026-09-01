export const DEFAULT_BUDGET = Object.freeze({
  maxConsultations: 3,
  maxFollowupsPerConsultation: 2
});

const HIGH_IMPACT = new Set([
  "architecture",
  "authentication",
  "authorization",
  "security",
  "database-schema",
  "migration",
  "deployment",
  "data-loss-risk",
  "public-api"
]);

const TRIVIAL = new Set([
  "typo",
  "formatting",
  "rename",
  "git-status",
  "build-only",
  "test-only",
  "simple-crud"
]);

export function shouldDelegate(context = {}) {
  const {
    explicitUserRequest = false,
    taskKind = "unknown",
    stalledIterations = 0,
    competingHypotheses = 0,
    confidence = 1,
    changeSize = "small",
    localTestsPassed = false,
    implementationComplete = false,
    planReady = false,
    consultationCount = 0,
    budget = DEFAULT_BUDGET,
    sensitiveContextRequired = false,
    sensitiveContextApproved = false
  } = context;

  if (consultationCount >= budget.maxConsultations) {
    return decision(false, "budget_exhausted", "none");
  }

  if (sensitiveContextRequired && !sensitiveContextApproved) {
    return decision(false, "sensitive_context_not_approved", "none");
  }

  if (explicitUserRequest) {
    return decision(true, "explicit_user_request", inferKind(context));
  }

  if (TRIVIAL.has(taskKind)) {
    return decision(false, "trivial_local_task", "none");
  }

  if (HIGH_IMPACT.has(taskKind)) {
    return decision(
      true,
      "high_impact_decision",
      planReady ? "plan-review" : "design-review"
    );
  }

  if (competingHypotheses >= 2 && confidence < 0.8) {
    return decision(
      true,
      "multiple_plausible_hypotheses",
      "root-cause-review"
    );
  }

  if (stalledIterations >= 2) {
    return decision(
      true,
      "stalled_local_investigation",
      "root-cause-review"
    );
  }

  if (changeSize === "large" && planReady && !implementationComplete) {
    return decision(true, "large_change_plan_ready", "plan-review");
  }

  if (
    implementationComplete &&
    localTestsPassed &&
    changeSize !== "small"
  ) {
    return decision(
      true,
      "significant_change_ready_for_independent_review",
      "code-review"
    );
  }

  if (confidence < 0.55) {
    return decision(true, "low_confidence", inferKind(context));
  }

  return decision(
    false,
    "local_executor_has_sufficient_evidence",
    "none"
  );
}

export function canFollowUp({
  followupCount = 0,
  budget = DEFAULT_BUDGET,
  newEvidence = false,
  unresolvedMaterialQuestion = false
} = {}) {
  if (followupCount >= budget.maxFollowupsPerConsultation) return false;
  return newEvidence || unresolvedMaterialQuestion;
}

function inferKind(context) {
  if (context.implementationComplete) return "code-review";
  if (context.planReady) return "plan-review";
  if ((context.competingHypotheses ?? 0) >= 2) {
    return "root-cause-review";
  }
  return "consult";
}

function decision(delegate, reason, consultationKind) {
  return Object.freeze({ delegate, reason, consultationKind });
}
