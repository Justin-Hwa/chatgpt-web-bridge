import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skillUrl = new URL(
  "../skills/chatgpt-web-delegate/SKILL.md",
  import.meta.url
);

test("ORCA delegation contract contains executable built-in browser commands", async () => {
  const skill = await readFile(skillUrl, "utf8");

  for (const required of [
    "orca status --json",
    "orca tab create --url https://chatgpt.com/",
    "orca snapshot --worktree active --json",
    "orca fill --element",
    "orca click --element",
    "submitted = true"
  ]) {
    assert.ok(
      skill.includes(required),
      `SKILL.md must retain executable ORCA browser contract: ${required}`
    );
  }
});

test("positive delegation is an action trigger, not a recommendation only", async () => {
  const skill = await readFile(skillUrl, "utf8");
  assert.match(skill, /positive delegation decision is an \*\*action trigger\*\*/i);
  assert.match(skill, /actually open\/reuse ChatGPT Web/i);
  assert.match(skill, /do not stop after saying/i);
});

test("ORCA runtime recovery contract forbids blind mutation retries", async () => {
  const skill = await readFile(skillUrl, "utf8");

  for (const required of [
    "unknown != failed",
    "HIGH-RISK MUTATION",
    "discard all old element refs",
    "do not fill again",
    "A transport error does **not** prove Send failed",
    "submission_result = unknown",
    "Do not resend"
  ]) {
    assert.ok(
      skill.includes(required),
      `SKILL.md must retain runtime recovery rule: ${required}`
    );
  }
});
