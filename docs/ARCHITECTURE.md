# Architecture

## Layering

```text
┌─────────────────────────────────────────────┐
│ Local Agent: Codex / OMP                    │
│ repository facts + execution                │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ chatgpt-web-delegate Skill                  │
│ - decide when to delegate                   │
│ - consultation budget                       │
│ - prompt protocol                           │
│ - role boundary                             │
│ - verify returned advice                    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Provider selection                          │
│ A. codex-chatgpt-control SDK                │
│ B. ORCA host browser tools                  │
│ C. BrowserSkill / shell fallback            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ Visible ChatGPT Web                         │
│ Thinker / Planner / Reviewer                │
└─────────────────────────────────────────────┘
```

## Why the Skill owns delegation policy

The browser layer should not decide when engineering judgment deserves a second opinion. Provider code only transports the consultation.

The Skill owns:

- when to ask
- what context to send
- what role ChatGPT should play
- how many consultations are allowed
- what to do with returned advice

## Why `codex-chatgpt-control` remains valuable

It centralizes ChatGPT-specific semantics:

- Chat/Work detection
- thread handling
- message submit/read
- generation status
- response capture
- blockers
- file/artifact behavior
- selector drift handling

This project should avoid reimplementing those semantics whenever the SDK can be used.

## Host-neutral design

The upstream SDK already accepts an injected `browser` in addition to `agent`. That creates a clean extension seam for future ORCA or BrowserSkill adapters.

Until a host exposes a stable compatible JS API, the Skill can still operate through host-native browser tools while preserving the same consultation protocol.
