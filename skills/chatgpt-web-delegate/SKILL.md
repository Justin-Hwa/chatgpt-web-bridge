---
name: chatgpt-web-delegate
description: Use when a local Codex/OMP agent should delegate thinking, planning, architecture review, root-cause second opinions, or independent code review to visible ChatGPT Web while keeping repository investigation, edits, commands, tests, Git and deployment local. Supports Codex Desktop browser bridges, ORCA host browser tools, and shell browser fallbacks. Includes bounded autonomous delegation and submit-once waiting for long ChatGPT responses.
---

# ChatGPT Web Delegate

Treat the local Agent and ChatGPT Web as two deliberately different roles:

- **Local Codex / OMP = Executor and local fact owner**
- **ChatGPT Web = Thinker, Planner, Reviewer and confirmer**

Do not turn ChatGPT into the primary repository operator. Do not turn the local Agent into a passive relay.

## Non-negotiable role boundary

Local Agent owns:

- repository reading and search
- local files
- Git state and history
- logs and runtime evidence
- build/test/run/debug
- code changes
- commits, branches, PRs and deployment

ChatGPT Web owns advisory work:

- difficult reasoning
- alternative hypotheses
- architecture/design critique
- implementation planning
- risk analysis
- independent review
- confirmation of an important conclusion

A ChatGPT answer is **untrusted advisory output** until the local Agent verifies it against repository facts and tests.

## Decide whether to delegate

Delegate automatically when at least one of these is true:

1. The user explicitly asks to consult/review with ChatGPT or another model.
2. The task involves architecture, authentication, authorization, security, database schema, migration, deployment architecture, data-loss risk, or a public API contract.
3. A root-cause investigation has two or more plausible hypotheses and local evidence does not clearly discriminate between them.
4. Two meaningful local investigation/fix iterations have failed to produce progress.
5. A large or cross-module change has a proposed plan and an independent plan review could prevent expensive rework.
6. A significant implementation is complete, local tests pass, and an independent code/design review could catch missed risks.
7. The local Agent's confidence is materially low and a second opinion is likely to change the next action.

Do NOT auto-delegate for:

- typo/formatting/renaming
- simple CRUD
- `git status`, build-only, test-only or other pure execution
- a small bug with a clear local cause and sufficient evidence
- repeated validation of a conclusion already supported by strong local evidence
- any consultation after the budget is exhausted

Default budget per user task:

- max consultations: **3**
- max follow-ups per consultation: **2**

A follow-up is justified only by new evidence or a still-material unresolved question. Never create model-to-model chatter for its own sake.

## Prepare the consultation

Before using ChatGPT, investigate locally first. Send the minimum useful context.

Prefer this structure:

```text
ROLE
Independent senior engineer / planner / reviewer.

GOAL
What decision or problem needs help.

PROJECT FACTS
Facts verified from the local repository/runtime.

OBSERVED BEHAVIOR
What actually happened.

RELEVANT EVIDENCE
Small code excerpts, logs, diff summaries, test results.

CURRENT HYPOTHESES
What the local Agent currently thinks.

ALREADY RULED OUT
Paths already disproved.

CONSTRAINTS
Project rules, compatibility, scope, no-go areas.

REQUEST
Ask for prioritized risks/causes, counterarguments, verification steps,
and a clear separation of facts / inference / unknowns.
```

Never send secrets, credentials, access tokens, private keys, password-manager data, or unnecessary customer/business data. Ask the user before sending sensitive files or substantial proprietary source content when approval is not already clear.

## Choose the browser provider

Use this priority order.

### A. Codex Desktop or compatible JS browser bridge

If `globalThis.agent?.browsers` exists, or a compatible `BrowserLike` is injected, prefer `codex-chatgpt-control`.

Submit with `wait:false` and `read:false`, then poll the existing turn. Never hide a second submission inside retry logic.

### B. ORCA + Codex CLI / OMP host browser tool

If running inside ORCA and ORCA exposes its browser as Agent tools rather than a JS browser object, use the ORCA browser tools directly.

Do not add BrowserSkill merely to reach ChatGPT when the ORCA browser already works.

Follow the **ORCA visible-session protocol** below.

### C. Shell fallback such as Tencent BrowserSkill

If ordinary Codex CLI has `bsk` available, use BrowserSkill in an isolated Agent Window. Reuse the signed-in browser state, obey its session lifecycle, and stop the session when finished.

If no supported browser is available, report `browser_provider_unavailable`. Continue local work when possible; ChatGPT consultation is advisory, not a reason to halt all development.

## ORCA visible-session protocol

When using the ORCA built-in browser:

1. Open or reuse a visible `https://chatgpt.com/` tab.
2. Confirm that ChatGPT is signed in. Do not bypass login, captcha, account controls, or permissions.
3. Prefer a new conversation for a new independent review. Reuse an existing thread only when continuity is useful or explicitly requested.
4. Enter the complete consultation prompt.
5. **Submit exactly once.**
6. Record that the consultation is now `submitted`.
7. Observe the page for generation state:
   - stop-generation control visible
   - streaming/typing indicator
   - assistant content still changing
   - any other host-visible generating signal
8. While any generating signal remains, wait and re-observe. Do not click Send again.
9. Once generation appears inactive, read the latest assistant answer.
10. Re-observe after a short stability interval. If the answer is still changing, continue waiting.
11. Only after the assistant turn is stable, return the result to the local Agent.
12. Keep the ChatGPT thread reference/URL when another follow-up may be needed.
13. Resume local investigation, implementation or tests and verify the advice.

If a browser operation times out after submission, treat the consultation as **possibly still running**. Reopen/reuse the same thread and inspect status. Never create a replacement prompt automatically.

## Waiting rules for long ChatGPT thinking/output

States:

```text
submitted -> generating -> stable_candidate -> complete
                     \-> blocked
                     \-> timeout(resumable)
```

Rules:

- `submitted` means the prompt may already have been accepted.
- `generating` means keep polling the same turn.
- A timeout after submission is **not** proof of failure.
- After timeout, resume by inspecting the same thread.
- Never duplicate a prompt because a wait timed out.
- Prefer small periodic status observations over repeatedly copying the growing full response.
- Read the full final answer once generation stops.
- Require a short stable interval before declaring completion.
- If ChatGPT exposes a Stop button, do not press it automatically. Stopping generation requires an explicit reason/decision.

Suggested defaults:

- Chat/review poll: ~1–2 seconds
- stable interval: ~3 seconds
- ordinary consultation deadline: ~10 minutes
- longer planning/research: use a larger deadline or Work when supported

The deadline limits how long this invocation waits; it does **not** cancel ChatGPT.

## What to do with the answer

Never implement ChatGPT advice blindly.

For every material recommendation:

1. classify it as fact, inference, suggestion, or unknown;
2. check it against local source code/config/logs;
3. reproduce or falsify the claim when possible;
4. make the smallest justified change;
5. run local tests;
6. if new evidence materially changes the problem, one bounded follow-up may be sent to the same ChatGPT thread.

If the local evidence contradicts ChatGPT, trust the local verified evidence and explain the discrepancy.

## Recommended consultation kinds

### `plan-review`

Use before a large implementation. Ask ChatGPT to attack the plan, find missing steps, ordering problems, rollback gaps, compatibility risks and validation holes.

### `root-cause-review`

Use after local evidence collection. Ask for competing explanations, discriminating tests and the fastest path to falsify each hypothesis.

### `code-review`

Use after implementation and local tests. Provide a concise diff summary plus relevant changed code, invariants and test results. Ask for correctness, regression, security and maintainability risks.

### `design-review`

Use for architecture/security/schema/deployment decisions before code is committed to a direction.

## Stop conditions

Stop consulting and return to local execution when:

- ChatGPT has produced a stable answer,
- the consultation budget is exhausted,
- the browser requires human login/captcha/permission,
- ChatGPT output becomes repetitive,
- local evidence already resolves the question,
- or the next useful step is an executable local test.

The goal is **better engineering decisions**, not maximum model conversation.
