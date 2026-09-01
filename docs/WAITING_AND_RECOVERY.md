# Waiting and Recovery

## Problem

Visible ChatGPT can spend substantial time:

- thinking before output,
- streaming a long answer,
- generating after a browser call times out,
- producing content whose DOM is still changing.

A naive bridge often treats a timeout as send failure and submits again. That creates duplicate turns and destroys thread identity.

## Rule: submit once

After the user prompt is submitted, the bridge must record:

```json
{
  "submitted": true,
  "thread": "<known thread reference if available>",
  "resumable": true
}
```

No retry path may call Send again unless the bridge can prove the original prompt was not submitted.

v0.1 uses the simpler safer rule:

> after any ambiguous post-submit failure, never automatically resubmit.

## State machine

```text
not_submitted
    │ Send
    ▼
submitted
    │
    ├─ blocker before acceptance -> blocked
    │
    ▼
generating
    │
    ├─ generation signal active -> keep waiting
    ├─ invocation deadline -> timeout(resumable)
    │
    ▼
stable_candidate
    │
    ├─ text changes -> generating/stable_candidate
    └─ unchanged for stable interval
    ▼
complete
```

## Generation signals

Depending on provider, use one or more:

- stop-generation button/control
- explicit generating state from SDK
- typing/streaming indicator
- latest assistant text still changing
- completion state from semantic ChatGPT control layer

Do not depend on a single brittle CSS selector if a semantic status API exists.

## Polling

Recommended defaults:

```yaml
poll_ms: 1500
stable_ms: 3000
ordinary_timeout_ms: 600000
```

While generating, prefer metadata/preview reads over repeatedly copying the full growing answer.

## Timeout

Timeout means:

> this invocation stopped waiting.

It does **not** mean:

> ChatGPT stopped working.

Return:

```json
{
  "state": "timeout",
  "submitted": true,
  "resumable": true,
  "instruction": "Inspect the same thread; do not resubmit."
}
```

## Resume

Resume flow:

1. recover/reopen the known ChatGPT thread;
2. inspect current generation state;
3. if still generating, continue polling;
4. if inactive, read latest assistant turn;
5. require stable interval;
6. return final answer.

## Stop generation

Do not stop automatically just because a timeout occurred.

Stopping changes a visible ChatGPT turn and should require an explicit Agent/user decision, preferably using the upstream confirmation-gated stop operation when SDK mode is active.
