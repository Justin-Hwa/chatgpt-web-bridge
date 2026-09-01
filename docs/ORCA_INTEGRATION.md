# ORCA Integration

## Goal

Support:

```text
ORCA
  ├─ Codex CLI or OMP  -> local executor
  └─ built-in browser  -> visible ChatGPT consultation channel
```

without requiring Codex Desktop.

## What changed in v0.1.1

The first version described ORCA's browser conceptually, but that was not enough to make OMP actually open it. A positive delegation decision must now become an executable ORCA action.

In ORCA, when the Skill decides that ChatGPT consultation is warranted, OMP should run the typed Orca CLI browser commands rather than stop after recommending a review.

## What changed in v0.1.2

v0.1.2 adds a runtime recovery contract for intermittent Orca runtime/CLI disconnects.

The key rule is:

```text
unknown != failed
```

A transport error after a browser mutation does not prove that the mutation failed. The Agent must recover the runtime, reacquire the same ChatGPT tab, take a fresh snapshot, and reconcile the actual page state before retrying anything.

Browser operations are treated as:

```text
READ
  status / tab list / snapshot / wait
  -> safe to retry after runtime recovery

MUTATION
  tab create / goto / fill / ordinary click
  -> may already have applied
  -> reobserve before retry

HIGH-RISK MUTATION
  ChatGPT Send
  -> may already have submitted the prompt
  -> never blindly retry
```

See [`ORCA_RUNTIME_RECOVERY.md`](ORCA_RUNTIME_RECOVERY.md) for the complete protocol.

Official Orca provides browser commands such as:

```bash
orca status --json
orca tab list --worktree active --json
orca tab create --url https://chatgpt.com/ --worktree active --json
orca goto --url https://chatgpt.com/ --worktree active --json
orca snapshot --worktree active --json
orca fill --element @e1 --value "..." --worktree active --json
orca click --element @e2 --worktree active --json
orca wait --text "..." --worktree active --json
```

These commands control Orca's embedded browser for the selected worktree.

## Runtime prerequisite and guard

Verify that the Orca CLI can reach the running desktop runtime:

```bash
orca status --json
```

If the command is not registered, enable/register the Orca CLI in Orca Settings first.

If the runtime becomes unavailable during a consultation, recover it before further browser mutations. A normal recovery attempt may include:

```bash
orca open --json
orca status --json
```

After recovery, reacquire the same ChatGPT tab and always take a new snapshot:

```bash
orca tab list --worktree active --json
orca snapshot --worktree active --json
```

Element refs from before the disconnect are no longer trusted.

The version-matched `orca-cli` skill is useful and can be inspected or installed with:

```bash
orca skills get orca-cli
orca skills install --skill orca-cli
```

However, `chatgpt-web-delegate` includes the core browser command protocol itself, so an already-working `orca` CLI is enough to attempt the ChatGPT flow.

## Mandatory ORCA browser flow

```text
local investigate
  -> delegation decision = true
  -> build consultation prompt
  -> orca status
  -> list/create/switch ChatGPT tab
  -> snapshot
  -> fill prompt
  -> snapshot
  -> click Send exactly once
  -> submitted=true
  -> snapshot/wait/snapshot same conversation
  -> generation inactive
  -> stable snapshot interval
  -> read stable answer
  -> return to local repository
  -> verify / implement / test
```

If a runtime disconnect occurs anywhere in this flow:

```text
runtime disconnect
  -> recover runtime
  -> reacquire same ChatGPT tab
  -> fresh snapshot
  -> reconcile actual state
  -> continue or bounded retry
```

Do not restart the entire consultation from the beginning.

### Open the browser

Inspect current tabs:

```bash
orca tab list --worktree active --json
```

Create ChatGPT when needed:

```bash
orca tab create --url https://chatgpt.com/ --worktree active --json
```

or navigate the active embedded browser:

```bash
orca goto --url https://chatgpt.com/ --worktree active --json
```

This is the explicit action that opens Orca's built-in browser. The Agent must not replace it with prose such as "you should consult ChatGPT".

If `tab create` or `goto` disconnects, list tabs and snapshot after runtime recovery before issuing another navigation command. The first mutation may already have worked.

### Snapshot -> act -> snapshot

Use:

```bash
orca snapshot --worktree active --json
```

then refs from that snapshot:

```bash
orca fill --element @eN --value "<consultation prompt>" --worktree active --json
orca snapshot --worktree active --json
orca click --element @eM --worktree active --json
```

Re-snapshot after navigation, tab switches, state-changing clicks, runtime reconnects, or stale-ref errors.

### Recovering a fill disconnect

If `fill` disconnects:

1. recover runtime;
2. return to the same ChatGPT tab;
3. fresh snapshot;
4. inspect the composer.

If the intended prompt is already present, do not fill again. If a fresh observation proves the prompt is absent, reacquire the current composer ref and retry the fill. If ambiguous, observe again.

### Recovering an unknown Send result

If clicking Send returns a runtime/transport error, do not assume the click failed.

Recover and inspect the same conversation. Treat the prompt as submitted if the user message is visible, ChatGPT is generating, or an assistant response has started.

Then:

```text
submitted = true
```

and continue waiting without resending.

A single Send retry is allowed only when a fresh snapshot clearly proves the consultation remains a draft and no sent/generating/answer evidence exists.

If the state is ambiguous, reobserve rather than resend.

### Login/captcha

If the ChatGPT snapshot shows login, captcha, OTP, account/workspace selection, or another human-only gate, stop and request user action. Never bypass those controls.

## Waiting after submission

Once Send succeeds, or recovery finds strong evidence that it already succeeded:

```text
submitted = true
```

Never automatically submit the same consultation again.

Poll the same tab/thread with repeated snapshots. Treat visible Stop/Stop generating controls, thinking indicators, streaming indicators, or changing assistant content as evidence that generation is still active.

For an open-ended answer, prefer snapshot polling over `orca wait --text` because the final response text is not known in advance.

When generation appears inactive, wait roughly 2–3 seconds and snapshot again. Only mark complete when the assistant response is unchanged across that stability interval.

A timeout after submission means only that the local wait ended. A runtime disconnect means only that transport state was lost. Neither proves ChatGPT failed. Re-find the same ChatGPT tab/conversation and continue inspection.

## Important distinction from `codex-chatgpt-control`

`codex-chatgpt-control` can directly use:

- `globalThis.agent`,
- an injected compatible `BrowserLike`,
- or another host-provided JavaScript browser object.

ORCA may expose its browser to OMP primarily through the `orca` CLI/tool surface instead. Therefore this project does not fake `globalThis.agent`.

If ORCA later exposes a stable compatible JavaScript API, a `BrowserLike` adapter can be added so ChatGPT-specific DOM semantics remain centralized in `codex-chatgpt-control`.

## BrowserSkill fallback

Do not add BrowserSkill merely because the Agent cannot find `globalThis.agent`.

When:

```bash
orca status --json
```

works and the typed browser commands are available, ORCA's own embedded browser is the preferred provider.

BrowserSkill remains a fallback for ordinary Codex CLI or other shell environments without a usable ORCA/Codex browser provider.
