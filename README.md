# chatgpt-web-bridge

**English** | [简体中文](README.zh-CN.md)

A universal Agent Skill/runtime for delegating **thinking, planning, architecture review, root-cause second opinions, and independent review** to visible ChatGPT Web while keeping **local Codex / OMP as the executor and repository fact owner**.

The target environments are:

- Codex Desktop
- Codex CLI
- ORCA + Codex CLI
- ORCA + OMP
- other shell-capable agents with a compatible browser bridge

## Core role split

```text
Local Codex / OMP
  = Executor
  = local repository fact owner
  = investigate / edit / build / test / debug / Git / deploy

ChatGPT Web
  = Thinker
  = Planner
  = Reviewer
  = confirmer / second opinion
```

The local repository, Git state, logs, runtime behavior, and tests remain the source of truth. ChatGPT output is advisory until the local Agent verifies it.

## Why this project exists

Projects such as `adamallcock/codex-chatgpt-control` already provide a strong semantic control layer for visible ChatGPT Chat/Work sessions. This project adds a more general **agent delegation policy** above that layer and removes the assumption that only Codex Desktop can host the workflow.

```text
Codex Desktop ───────────────┐
Codex CLI ───────────────────┤
ORCA + Codex/OMP ────────────┼─> chatgpt-web-delegate Skill
Other shell agents ──────────┘             │
                                           ├─ Codex browser bridge / SDK
                                           ├─ ORCA host browser tools
                                           └─ BrowserSkill fallback
                                                      │
                                                      ▼
                                                ChatGPT Web
```

## v0.1 goals

- [x] universal `chatgpt-web-delegate` Skill
- [x] explicit Executor vs Thinker/Planner/Reviewer role boundary
- [x] autonomous but bounded delegation policy
- [x] standard consultation prompt
- [x] consultation budget
- [x] submit-once waiting state machine
- [x] timeout/resume semantics that never blindly resubmit
- [x] Codex Desktop / compatible `BrowserLike` SDK path
- [x] ORCA host-browser-tool protocol
- [x] BrowserSkill fallback policy
- [x] unit tests + GitHub Actions CI
- [ ] ORCA-specific JavaScript `BrowserLike` adapter, once ORCA exposes a stable JS browser API
- [ ] BrowserSkill-to-`BrowserLike` adapter
- [ ] file upload/download
- [ ] ChatGPT Work / Deep Research
- [ ] full E2E matrix

## When the Agent should autonomously consult ChatGPT

Good automatic delegation triggers:

- architecture, authentication, authorization, security, schema, migration, deployment, data-loss, public API decisions
- complex root-cause investigation with multiple plausible hypotheses
- two meaningful local investigation/fix loops with no progress
- large/cross-module change before implementation, for plan review
- significant implementation after local tests pass, for independent review
- materially low confidence where a second opinion may change the next action
- explicit user request to ask/review with ChatGPT

Do not automatically delegate:

- typo/formatting/renaming
- simple CRUD
- `git status`, build-only, test-only work
- clear small bugs with sufficient local evidence
- repeated confirmation of a conclusion already supported by strong evidence

Default task budget:

```yaml
max_consultations: 3
max_followups_per_consultation: 2
```

See [`docs/DELEGATION_POLICY.md`](docs/DELEGATION_POLICY.md).

## Long ChatGPT thinking/output

The bridge must treat “submitted” and “completed” as different states:

```text
submit once
    │
    ▼
submitted
    │
    ▼
generating ──────────────┐
    │                    │ poll same turn
    └────────────────────┘
    │ generation inactive
    ▼
stable_candidate
    │ response remains unchanged
    ▼
complete
    │
    ▼
read final answer
```

If waiting times out after submission:

```text
timeout
  submitted: true
  resumable: true
  action: inspect the SAME thread again
  forbidden: automatic resubmit
```

See [`docs/WAITING_AND_RECOVERY.md`](docs/WAITING_AND_RECOVERY.md).

## Install

Node 20+:

```bash
npm install
npm test
```

Install the Skill into Codex:

### Linux/macOS

```bash
mkdir -p ~/.codex/skills/chatgpt-web-delegate
cp -R skills/chatgpt-web-delegate/* ~/.codex/skills/chatgpt-web-delegate/
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$HOME\.codex\skills\chatgpt-web-delegate"
Copy-Item -Recurse -Force ".\skills\chatgpt-web-delegate\*" "$HOME\.codex\skills\chatgpt-web-delegate\"
```

For ORCA/OMP, install the same Skill folder into the host's skill search path. Keep one policy source instead of maintaining separate ORCA and Codex variants.

## SDK mode

When a compatible Codex browser bridge or custom `BrowserLike` is available, use `codex-chatgpt-control`:

```js
import { consultWithSdk } from "./src/sdk-consult.mjs";

const result = await consultWithSdk({
  prompt: "Review this implementation plan...",
  timeoutMs: 10 * 60_000
});
```

The helper intentionally submits once with `wait:false` and `read:false`, then polls the same assistant turn.

## ORCA mode

When ORCA exposes the browser as Agent tools rather than a JavaScript object, the Skill uses the host browser directly. It follows the same submit-once, wait, stability, and resume protocol without pretending that ORCA exposes `globalThis.agent`.

See [`docs/ORCA_INTEGRATION.md`](docs/ORCA_INTEGRATION.md).

## Security

Do not send secrets or unnecessary sensitive source/data to ChatGPT. The included prompt builder rejects several obvious token/private-key patterns as a basic guardrail, but this is not a complete DLP solution.

See [`docs/SECURITY.md`](docs/SECURITY.md).

## Upstream inspiration

This project is designed to complement rather than replace:

- `adamallcock/codex-chatgpt-control`
- `Tencent/BrowserSkill`

`codex-chatgpt-control` remains the preferred visible ChatGPT semantic layer when its browser runtime is available.

## License

MIT
