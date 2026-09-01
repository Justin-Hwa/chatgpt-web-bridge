# ORCA Runtime Recovery

## Purpose

The Orca CLI talks to a running Orca runtime. A transport/runtime disconnect can happen before the Agent knows whether the last browser mutation actually took effect.

For ChatGPT delegation this matters most around `fill` and especially `click Send`, because blindly repeating a mutation can duplicate a prompt.

The recovery rule is therefore:

```text
runtime disconnect
  -> recover runtime
  -> reacquire the ChatGPT tab
  -> take a fresh snapshot
  -> reconcile the actual page state
  -> only then decide whether retry is safe
```

A disconnect is not proof that the browser action failed.

## Action classes

### READ

Examples:

- `orca status --json`
- `orca tab list --worktree active --json`
- `orca snapshot --worktree active --json`
- `orca wait ... --json`

READ operations may be retried after the runtime is ready again.

### MUTATION

Examples:

- `orca tab create ...`
- `orca goto ...`
- `orca fill ...`
- ordinary non-submit clicks

A mutation whose result is unknown must not be blindly repeated. Reconnect, take a fresh snapshot, and determine whether the intended state change is already visible.

### HIGH-RISK MUTATION

The important example is clicking ChatGPT **Send**.

If the runtime disconnects during or immediately after Send, treat the result as unknown until the page is re-observed.

Never infer `send failed` merely from a transport error.

## Runtime guard

Before starting a consultation, and whenever a runtime error occurs:

```bash
orca status --json
```

If the runtime is unavailable, attempt normal Orca recovery such as:

```bash
orca open --json
orca status --json
```

Do not spam mutation commands while the runtime is unavailable.

After recovery:

```bash
orca tab list --worktree active --json
orca snapshot --worktree active --json
```

Reacquire the correct ChatGPT tab/thread and use element refs only from the new snapshot.

## Element refs are disposable

Refs such as `@e12` are snapshot-scoped working handles.

Discard old refs after:

- runtime reconnect
- navigation
- tab replacement/switch
- major page rerender
- stale-element errors

Always take a fresh snapshot before a mutation after recovery.

## Reconcile a failed/unknown fill

If `orca fill` returns a runtime/transport error:

1. recover runtime;
2. reacquire the same ChatGPT tab;
3. fresh snapshot;
4. inspect the composer.

If the exact consultation prompt is already present:

```text
fill already applied
-> do not fill again
-> continue to Send
```

If a fresh snapshot clearly shows the prompt is absent:

```text
fill did not apply
-> reacquire the current composer ref
-> retry fill
```

If the state is ambiguous, observe again instead of mutating.

## Reconcile an unknown Send result

If `orca click` on ChatGPT Send returns a runtime/transport error, do not resend immediately.

Recover and inspect the same conversation.

Treat the prompt as submitted when any strong sent evidence is visible, for example:

- the user's consultation message appears in the conversation;
- ChatGPT shows thinking/streaming/generation;
- an assistant response has started or completed.

Then record:

```text
submitted = true
```

and continue the normal wait/stability loop.

Do not click Send again.

A single Send retry is allowed only when a fresh observation clearly proves all of the following:

- the consultation prompt is still present in the composer as a draft;
- the user message is not present in the conversation;
- ChatGPT is not generating;
- no assistant answer for that consultation exists.

Then reacquire the current Send ref and click once.

If the result remains ambiguous:

```text
submission result unknown
-> reobserve
-> do not resend
```

Safety is more important than forcing immediate progress.

## Recovery state sketch

```text
browser action
    |
    v
success --------------------------> continue
    |
runtime/transport disconnect
    |
    v
orca status
    |
    +-- unavailable --> normal runtime recovery --> status ready
    |
    v
reacquire same tab
    |
    v
fresh snapshot
    |
    v
reconcile actual page state
    |
    +-- action already applied --> continue without retry
    |
    +-- clearly not applied ----> safe bounded retry
    |
    +-- ambiguous --------------> observe again; no mutation
```

## Relationship to ChatGPT timeout handling

Two independent failures must not be confused:

1. ChatGPT is taking a long time to think/stream.
2. Orca runtime/CLI transport temporarily disconnects.

Both use the same core principle:

```text
unknown != failed
```

After submission, the bridge always prefers recovering and observing the same ChatGPT thread over creating a replacement consultation.

## Runtime model helper

`src/orca-runtime-recovery.mjs` provides pure decision helpers used by tests and future provider implementations:

- `classifyOrcaAction(action)`
- `reconcileAfterDisconnect(...)`

The Skill remains the behavioral contract; the module makes the retry/reconciliation rules explicit and testable.
