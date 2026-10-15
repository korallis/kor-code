---
name: diagnose-bug
description: "Diagnoses causal failures. Use when a bug report needs reproduction and evidence before a fix."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "a bug report needs reproduction and evidence before a fix"
  kor.anti: "implementation after a cause has already been established"
  kor.visibility: "public"
  kor.budget: "1500"
---

# Diagnose a reported bug

1. Record expected and observed behavior, the end-user entry point, and the conditions that trigger the failure. Reproduce on the actual surface before proposing a change.
2. Trace the causal chain. Distinguish the trigger, a condition that masks or reveals it, the faulty decision, and the visible symptom.
3. Compare a failing path with a proven working path. Change one condition at a time, inspect actual state, and keep disconfirming evidence.
4. Test a counterfactual that could refute the suspected mechanism. A correlation or successful workaround does not establish the cause.
5. Report the reproduction, supported cause, contradictory evidence, smallest proposed fix, and remaining uncertainty. For a diagnosis-only request, stop at the report.
If the surface is inaccessible, record the exact prerequisite and attempted path. Never label an unexecuted reproduction successful.
