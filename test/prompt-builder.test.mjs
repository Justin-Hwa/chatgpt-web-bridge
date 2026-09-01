import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoObviousSecrets,
  buildConsultationPrompt
} from "../src/prompt-builder.mjs";

test("builds structured prompt", () => {
  const prompt = buildConsultationPrompt({
    goal: "Review a plan",
    projectFacts: ["Fact A"],
    hypotheses: ["Hypothesis A"]
  });

  assert.match(prompt, /## ROLE/);
  assert.match(prompt, /## GOAL/);
  assert.match(prompt, /Review a plan/);
  assert.match(prompt, /## PROJECT FACTS/);
});

test("rejects obvious private key", () => {
  assert.throws(
    () => assertNoObviousSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nabc"),
    /secret/i
  );
});
