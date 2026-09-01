---
name: chatgpt-web-delegate
description: Use when a local Codex/OMP agent should delegate thinking, planning, architecture review, root-cause second opinions, or independent code review to visible ChatGPT Web while keeping repository investigation, edits, commands, tests, Git and deployment local. In ORCA, a positive delegation decision MUST trigger the built-in browser through the Orca CLI instead of stopping at a recommendation to consult ChatGPT. Supports Codex Desktop browser bridges, ORCA built-in browser commands with runtime disconnect recovery, and shell browser fallbacks. Includes bounded autonomous delegation and submit-once waiting for long ChatGPT responses.
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

## Mandatory action after a positive delegation decision

A positive delegation decision is an **action trigger**, not merely advice to the user.

When this Skill decides `delegate = true`:

1. prepare the consultation prompt;
2. select the best available browser provider;
3. actually open/reuse ChatGPT Web;
4. submit the consultation exactly once;
5. wait for a stable answer;
6. return the answer to the local execution loop;
7. verify the advice against local facts before changing code.

In ORCA, **do not stop after saying** things such as:

- "This should be reviewed by ChatGPT."
- "I recommend consulting ChatGPT."
- "ORCA Browser could be used here."

If ORCA is available and the user has not prohibited browser/external consultation, proceed to the ORCA browser commands below.

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

### B. ORCA + Codex CLI / OMP: use Orca built-in browser through the `orca` CLI

For ORCA, the preferred executable path is the Orca CLI because Orca exposes typed commands for its embedded browser.

Before claiming that the ORCA browser is unavailable, execute:

```bash
command -v orca
orca status --json
```

On Windows shells where `command -v` is unavailable, use the shell's normal executable lookup such as `where.exe orca` or `Get-Command orca`.

If `orca status --json` succeeds, treat the ORCA built-in browser as available and proceed. Do not install BrowserSkill just to reach ChatGPT.

If the version-matched Orca skill is available, it is useful but not required because the commands are defined here:

```bash
orca skills get orca-cli
```

A one-time installation may be performed when appropriate:

```bash
orca skills install --skill orca-cli
```

Do not make installation of `orca-cli` a prerequisite for using the typed `orca` browser commands if those commands already work.

### C. Shell fallback such as Tencent BrowserSkill

Only when the ORCA built-in browser is not usable and ordinary shell browser automation is needed, use BrowserSkill if `bsk` is available.

If no supported browser is available, report `browser_provider_unavailable`. Continue local work when possible; ChatGPT consultation is advisory, not a reason to halt all development.

## ORCA executable browser protocol

This protocol is mandatory when running under ORCA and `orca status --json` succeeds.

### Runtime guard before browser work

Before the first browser mutation, confirm the runtime is reachable:

```bash
orca status --json
```

If a command reports a runtime/transport disconnect, do not spam retries. Recover the runtime first, for example:

```bash
orca open --json
orca status --json
```

Then reacquire the ChatGPT tab and take a **fresh snapshot** before deciding what to do next.

Treat browser actions as three risk classes:

```text
READ
  status / tab list / snapshot / wait
  -> safe to retry after runtime recovery

MUTATION
  tab create / goto / fill / ordinary click
  -> result may already have applied
  -> reobserve before retry

HIGH-RISK MUTATION
  click ChatGPT Send
  -> result may already have submitted the prompt
  -> NEVER blindly retry
```

After any runtime reconnect, navigation, tab replacement/switch, major rerender, or stale-ref error, discard all old element refs such as `@e12`. Use refs only from a new `orca snapshot`.

The governing rule is:

```text
unknown != failed
```

Detailed rationale is in `docs/ORCA_RUNTIME_RECOVERY.md`.

### 1. Open the embedded browser

First inspect existing tabs:

```bash
orca tab list --worktree active --json
```

If a suitable ChatGPT tab is already present, switch to it. Otherwise create one:

```bash
orca tab create --url https://chatgpt.com/ --worktree active --json
```

If tab creation is not appropriate for the current state, navigate the active embedded tab:

```bash
orca goto --url https://chatgpt.com/ --worktree active --json
```

The `orca tab create` / `orca goto` command is the step that **actually opens Orca's built-in browser**. Do not replace it with a prose recommendation.

If runtime disconnects during `tab create` or `goto`, recover runtime, list tabs, and snapshot before retrying. The navigation may already have happened.

### 2. Inspect before acting

Always snapshot before interacting:

```bash
orca snapshot --worktree active --json
```

Use element refs such as `@e1`, `@e2`, ... from the **latest** snapshot. Re-snapshot after navigation, tab changes, significant clicks, runtime reconnect, or stale-ref errors.

If the snapshot shows login, captcha, OTP, workspace/account selection, or another human-only blocker, stop and ask the user to complete it. Do not bypass it.

### 3. Fill the ChatGPT composer

Identify the visible ChatGPT prompt/composer element from the latest snapshot and fill its ref:

```bash
orca fill --element @eN --value "<consultation prompt>" --worktree active --json
```

Use correct shell quoting for multiline prompts. Do not expose secrets through shell history when the prompt contains sensitive material; sensitive material should normally not be delegated at all.

Re-snapshot after filling if necessary:

```bash
orca snapshot --worktree active --json
```

If runtime/transport disconnects during `fill`:

1. recover runtime;
2. reacquire the same ChatGPT tab;
3. take a fresh snapshot;
4. inspect the composer.

If the full prompt is already present, **do not fill again**. Continue to Send using a fresh element ref.

Only retry `fill` when a fresh snapshot clearly shows the prompt is absent. If the state is ambiguous, observe again instead of mutating.

### 4. Submit exactly once

Identify the visible Send control from the latest snapshot and click it:

```bash
orca click --element @eM --worktree active --json
```

After this succeeds, record:

```text
submitted = true
```

From this point onward, **never automatically fill/click Send again for the same consultation**.

#### If runtime disconnects during or immediately after Send

A transport error does **not** prove Send failed.

Do not click Send again immediately. Instead:

```text
recover runtime
-> reacquire same ChatGPT tab/thread
-> fresh snapshot
-> reconcile actual page state
```

Treat the consultation as submitted if any strong sent evidence is visible:

- the user's consultation message is present in the conversation;
- ChatGPT is thinking/streaming/generating;
- an assistant answer has started or completed.

Then record:

```text
submitted = true
```

and continue waiting. Never resend.

A single Send retry is allowed only when a **fresh** observation clearly proves all of the following:

- the consultation prompt is still present in the composer as a draft;
- the user message is not present in the conversation;
- ChatGPT is not generating;
- no assistant answer for that consultation exists.

Reacquire the current Send ref and click once.

If the result is ambiguous:

```text
submission_result = unknown
```

Reobserve. Do not resend.

### 5. Wait for ChatGPT thinking / streaming

After submission, use a snapshot -> wait -> snapshot loop against the same tab/thread:

```bash
orca snapshot --worktree active --json
# wait briefly using the local shell/runtime
orca snapshot --worktree active --json
```

Treat any of the following as generating signals:

- a Stop / Stop generating control
- a thinking/streaming indicator
- assistant answer content changing between snapshots
- any other clear visible generation state

While generation is active, continue waiting. Do not click Send.

`orca wait --text "..." --worktree active --json` may be used only when there is a concrete expected text condition. For open-ended ChatGPT answers, repeated snapshots are safer than guessing the final text.

If a READ command such as `snapshot` or `wait` disconnects, recover the runtime and safely retry the READ operation against the same tab. Do not change submission state merely because the transport dropped.

### 6. Determine completion by stability

When generation controls disappear, read the latest assistant output from the snapshot. Wait about 2–3 seconds and snapshot again.

Only declare `complete` when:

- no generating signal is visible; and
- the latest assistant answer is unchanged across the stability interval.

Otherwise remain in `generating` / `stable_candidate` and keep waiting.

### 7. Preserve the same thread for recovery/follow-up

After submission, retain enough tab/thread identity to find the same conversation again. Use:

```bash
orca tab list --worktree active --json
```

If a wait/browser command times out or the Orca runtime disconnects after submission:

1. recover runtime;
2. list tabs;
3. return to the same ChatGPT tab/thread;
4. take a fresh snapshot;
5. continue observing that same consultation.

**Do not create a replacement consultation automatically.**

### 8. Return to local execution

Once the answer is stable:

1. summarize/capture the ChatGPT advice;
2. mark it as advisory/unverified;
3. return to the repository;
4. run discriminating tests or inspect local evidence;
5. implement only the parts justified by local facts.

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
- An Orca runtime disconnect after a mutation is **not** proof that the mutation failed.
- After timeout/disconnect, resume by inspecting the same thread.
- Never duplicate a prompt because a wait timed out or a runtime transport dropped.
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
