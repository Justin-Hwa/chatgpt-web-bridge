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

## Runtime prerequisite

Verify that the Orca CLI can reach the running desktop runtime:

```bash
orca status --json
```

If the command is not registered, enable/register the Orca CLI in Orca Settings first.

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

Re-snapshot after navigation, tab switches, state-changing clicks, or stale-ref errors.

### Login/captcha

If the ChatGPT snapshot shows login, captcha, OTP, account/workspace selection, or another human-only gate, stop and request user action. Never bypass those controls.

## Waiting after submission

Once Send succeeds:

```text
submitted = true
```

Never automatically submit the same consultation again.

Poll the same tab/thread with repeated snapshots. Treat visible Stop/Stop generating controls, thinking indicators, streaming indicators, or changing assistant content as evidence that generation is still active.

For an open-ended answer, prefer snapshot polling over `orca wait --text` because the final response text is not known in advance.

When generation appears inactive, wait roughly 2–3 seconds and snapshot again. Only mark complete when the assistant response is unchanged across that stability interval.

A timeout after submission means only that the local wait ended. It does not mean ChatGPT failed. Re-find the same ChatGPT tab/conversation and continue inspection.

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
