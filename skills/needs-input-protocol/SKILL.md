---
name: needs-input-protocol
description: "Resolves authority boundaries. Use when missing facts or authorization might require operator input."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "missing facts or authorization might require operator input"
  kor.anti: "routine decisions already covered by the task or repository policy"
  kor.visibility: "public"
  kor.budget: "1500"
---

# Handle missing input

1. Separate observable facts from decisions. Inspect source, logs, existing policy, and the real surface to answer factual questions. Use a bounded experiment for an empirical fork.
2. Proceed with reversible implementation choices covered by the task. Record assumptions and reasons. Apply an existing recorded decision rather than asking it again.
3. When available evidence cannot settle an implementation choice, return the facts, options, and tradeoffs to Kor's decision layer. Do not invent approval or choose an unauthorized default.
4. Request operator input for an unresolved product preference, an explicit approval gate, a destructive or irreversible action lacking authorization, or a missing prerequisite that prevents safe progress.
5. State the open question, relevant evidence, concrete options, recommendation, and what is blocked in the Linear ticket or structured handoff. Use the authorized channel. If no ticket tool is available, return the handoff to Kor rather than attempting a new integration.
6. Keep the question open until an explicit answer or observed prerequisite change resolves it. Resume only the work that the answer authorizes and record the resolution.
This guidance does not grant permission for external writes. Kor owns blocked state, retry, and notification handling.
