# Delegation Policy

## Objective

Use ChatGPT when independent reasoning can reduce engineering risk or improve planning quality. Keep execution local.

## Decision sequence

The local Agent should ask, in order:

1. Is this task mainly execution?
2. Do I already have sufficient local evidence?
3. Is the decision high-impact?
4. Are there multiple plausible hypotheses?
5. Have I already spent two meaningful loops without progress?
6. Would independent review materially reduce risk?
7. Is consultation budget still available?
8. Can I send only the minimum necessary non-sensitive context?

## Mandatory/strong triggers

### High-impact design

Consult before committing to a direction when the task materially changes:

- auth/authz/security
- database schema or migration
- deployment/topology
- data-loss/rollback behavior
- public API contract
- cross-module architecture

### Root-cause ambiguity

Consult when:

```text
plausible hypotheses >= 2
AND local evidence cannot discriminate
```

The consultation should focus on **tests that distinguish hypotheses**, not on asking ChatGPT to guess the answer.

### Stalled work

Two meaningful failed iterations is a default trigger.

A meaningful iteration means new local evidence was collected or a justified change was tested. Repeating the same action does not count.

### Plan review

For large changes, ask ChatGPT to attack the plan before implementation.

### Independent completion review

After significant work:

```text
implementation complete
AND local tests pass
AND change is not small
```

Ask ChatGPT for an independent review. Then validate any findings locally.

## Budget

Default:

```yaml
max_consultations: 3
max_followups_per_consultation: 2
```

A follow-up requires:

- new evidence, or
- a still-material unanswered question.

Do not use follow-ups for politeness, repetition, or asking the same question with slightly different words.

## Local truth hierarchy

When evidence conflicts:

1. reproducible local runtime/test evidence
2. local source/configuration
3. primary external documentation
4. ChatGPT inference/opinion

ChatGPT is never the repository fact source.
