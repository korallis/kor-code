# Jev decision core specification

## Purpose

The Jev decision core turns ambiguous engineering choices into structured decisions that software can apply and audit.

Jev answers narrow questions. Deterministic tools answer factual questions.

## Decision contract

~~~yaml
decision_id: dec_01JEV...
execution_id: exec_01KOR...
question: "Which execution strategy fits this issue?"
inputs:
  issue_id: LIN-123
  task_summary: "Investigate a performance regression"
  constraints:
    - "Reuse existing code"
    - "Add regression coverage"
  evidence_refs:
    - repo:search:42
    - linear:document:architecture
candidates:
  - id: single-agent
  - id: parallel-specialists
  - id: ask-for-clarification
choice: parallel-specialists
confidence: 0.86
reasons:
  - "The issue has independent profiling and test work."
policy_checks:
  - name: dependencies-resolved
    result: pass
~~~

The exact transport is open. These fields define the domain contract.

## Decision classes

| Class | Example | Source of truth |
| --- | --- | --- |
| Classification | What kind of work is this? | Jev plus issue evidence |
| Selection | Which model, agent, or skill fits? | Jev plus live catalogue |
| Scoring | Which context finding matters most? | Jev plus retrieval evidence |
| Guard recommendation | Does this need review? | Jev recommendation |
| Fact check | Did the test pass? | Tool or CI result |
| Policy enforcement | Can this command run? | Deterministic policy |

## Routing policy

Jev ranks routes using task complexity, capability compatibility, expected work remaining, cache locality, account health, quota, failure history, quality targets, and cost targets.

Jev keeps a session on its current route when switching would lose useful cache locality and no availability or policy condition requires a move.

## Confidence

Confidence is a routing signal, not permission.

- High confidence can select a normal path when deterministic checks pass.
- Medium confidence can request more evidence or specialist review.
- Low confidence can pause for clarification or choose a stronger route.
- A hard policy failure blocks the action regardless of confidence.

## Audit record

Record the question, inputs, candidates, result, confidence, reasons, policy checks, overrides, and observed outcome.
