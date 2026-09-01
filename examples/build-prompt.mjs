import { buildConsultationPrompt } from "../src/prompt-builder.mjs";

const prompt = buildConsultationPrompt({
  goal: "Find the most likely cause of a refresh-token 401 problem.",
  projectFacts: [
    "Spring Boot backend",
    "Redis-backed session state",
    "refresh endpoint returns HTTP 200"
  ],
  observedBehavior: [
    "Business API still returns 401 after refresh",
    "Existing access token can still reach getInfo"
  ],
  hypotheses: [
    "Refresh writes a different Redis key from validation",
    "Namespace/TTL mismatch",
    "Security context not rebuilt"
  ],
  ruledOut: [
    "Frontend did receive the refresh HTTP 200"
  ],
  request: [
    "Rank the hypotheses.",
    "Give the fastest discriminating test for each.",
    "Challenge the current assumptions.",
    "Do not invent repository facts."
  ]
});

console.log(prompt);
