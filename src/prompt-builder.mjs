const SECTION_ORDER = [
  ["ROLE", "role"],
  ["GOAL", "goal"],
  ["PROJECT FACTS", "projectFacts"],
  ["OBSERVED BEHAVIOR", "observedBehavior"],
  ["RELEVANT EVIDENCE", "evidence"],
  ["CURRENT HYPOTHESES", "hypotheses"],
  ["ALREADY RULED OUT", "ruledOut"],
  ["CONSTRAINTS", "constraints"],
  ["REQUEST", "request"]
];

export function buildConsultationPrompt(input = {}) {
  const normalized = {
    role:
      input.role ??
      "Act as an independent senior engineer, planner and reviewer. Challenge assumptions. Do not pretend missing facts are known.",
    goal: input.goal,
    projectFacts: input.projectFacts,
    observedBehavior: input.observedBehavior,
    evidence: input.evidence,
    hypotheses: input.hypotheses,
    ruledOut: input.ruledOut,
    constraints: input.constraints,
    request:
      input.request ??
      [
        "1. Identify the most important risks or likely causes.",
        "2. Challenge the current assumptions and name counter-evidence to look for.",
        "3. Give a prioritized verification or implementation plan.",
        "4. Clearly separate facts, inferences, suggestions and unknowns.",
        "5. Do not propose edits that are not justified by the supplied evidence."
      ]
  };

  const parts = [];
  for (const [title, key] of SECTION_ORDER) {
    const value = normalized[key];
    if (
      value == null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }
    parts.push(`## ${title}\n${format(value)}`);
  }

  const prompt = parts.join("\n\n").trim() + "\n";
  assertNoObviousSecrets(prompt);
  return prompt;
}

function format(value) {
  if (Array.isArray(value)) {
    return value.map((v) => `- ${String(v)}`).join("\n");
  }
  if (typeof value === "object") {
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
  }
  return String(value);
}

export function assertNoObviousSecrets(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/
  ];

  if (patterns.some((pattern) => pattern.test(text))) {
    const error = new Error(
      "Prompt appears to contain a secret. Redact it or obtain explicit approval before delegation."
    );
    error.code = "possible_secret";
    throw error;
  }
  return true;
}
