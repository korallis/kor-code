---
name: hard-problem-resolution
description: "Resolves technical uncertainty. Use when accuracy, speed, competing approaches or models, or a blocker needs research and independent challenge."
license: MIT
metadata:
  kor.kind: "playbook"
  kor.stages: "plan,execute,repair"
  kor.triggers: "accuracy; speed; competing approaches; model choice; technical blocker"
  kor.anti: "routine implementation with an established approach; diagnosis-only reports; unresolved product scope"
  kor.visibility: "public"
  kor.budget: "1500"
---

# Resolve a hard technical problem

Continue within the authorized task and existing time, tool and spend caps. Technical uncertainty starts this procedure rather than a question to the user. Jev owns every per-task execution setting.

1. **Research.** State the failing target and success criterion. Measure a baseline on the real code and representative data: accuracy and error cases, latency and workload, or the blocker reproduction. Record commands, environment, sample size and results. Survey plausible options using primary sources and small experiments. Return a report with measurements, alternatives, tradeoffs, costs, risks and unresolved facts; separate observations from estimates.
2. **Challenge.** Request an independent review through Kor with the research report and original evidence. Apply Kor's reviewer independence rule: the challenger must come from a different model family than the research pass; Jev chooses the actual participants. Ask for counterexamples, flawed assumptions, missing options and the cheapest experiment that could reverse the recommendation. Record the challenge and the independence evidence. A second opinion from the same family does not complete this step.
3. **Decide.** Give Jev the original goal, constraints, baseline, source references, all options, research and challenge, including disagreements. Ask one concrete choice question with explicit success criteria. Record the exact question, evidence references, answer and full probability distribution. Apply the answer only when its probability is at least 0.9 and it respects authorization and caps. Below 0.9, make one narrower re-ask about the decisive uncertainty, supplying any new evidence; retain both questions and distributions. Do not substitute personal confidence for Jev's probability.
4. **Resolve remaining uncertainty.** If the narrower answer is still below 0.9, keep the implementation decision unapplied. Perform the recommended discriminating experiment within existing caps and return its evidence to Kor for the next bounded research pass. If a required capability is unavailable or a cap prevents further work, record the exact missing capability or limit and a structured handoff to Kor. Never claim an unperformed review, decision or measurement.
5. **Implement and re-measure.** Implement the supported choice, then repeat the baseline commands on comparable code, data and conditions. Report before/after values, regressions, relevant existing checks and whether the success criterion passed. If it failed, retain the negative result and return it to research within the remaining caps.

Escalate to the user only for destructive or irreversible acts requiring authorization, credentials only they hold, or spend beyond existing caps. Prepare the concrete action and evidence first. Ordinary technical choices stay in the research, challenge and Jev loop. Use only available authorized tools; when a separate pass or Jev call cannot be made in-session, hand the request and evidence to Kor's decision layer. This procedure grants no new permissions.
