# Jev preflight

`kor plan`, daemon intake and direct controller dispatch use the same ticket-level
preflight on Jev `jev-1.14.0`. Each decision receives scoped state containing the
complete issue description, acceptance conditions, dependencies and relevant
checks or assessments. Route candidate criteria contain versioned model profiles;
audit inputs retain the complete routing fingerprint without presenting
out-of-class models as competing choices. Each question is evaluated in its
own request. Independent readiness, complexity, risk and agent questions run
concurrently; reasoning class consumes the complexity/risk assessments, then the
model question consumes the selected class.

## Readiness

Missing acceptance, incomplete dependencies, a missing screenshot on a UI-labelled
issue, or no compatible profiled model blocks dispatch deterministically.
When those checks pass, readiness uses an asymmetric scope veto: a healthy
`P(ready) <= 0.10` blocks because `P(missing essential scope) >= 0.90`.
An uncertain but valid answer permits bounded implementation and investigation.
It does not establish acceptance or waive repository policy. An unavailable or
invalid answer is recorded as unavailable, never as a successful readiness answer.
The daemon may use an explicitly labelled route fallback during an outage;
unavailable acceptance judgment still prevents completion.

## Model routing

`packages/jev/src/routing.ts` owns the versioned operator policy. Jev first picks
the least sufficient class: routine mechanical work, implementation within an
established design, or deep research/review/interacting-system work. Both class
and conditional model Choice retain their 0.70 confidence thresholds. If class
confidence is low, code uses the deep class, records that conservative fallback,
and asks the model question within that class. If model confidence is low, code
uses a verified, profiled conservative route and preserves the reason.
It first retains the selected class when a compatible model remains available;
otherwise the effective class and effort follow the fallback model.

Candidates contain explicit strengths, exclusions, reasoning class, qualitative
cost/speed policy, verified streaming/tool/structured-output capabilities, and
observed probe cost/latency. Probe observations are not workload prices, reasoning
benchmarks or context measurements. Context limits remain explicitly unknown.
Unknown model identities require a maintained profile before automatic routing.
Guarded merge review uses verified deep-class models from a different writer
family. Reviewer profiles describe review responsibilities separately from writer roles.
A singleton class still includes a no-suitable-route alternative: its confidence
measures suitability, not superiority over absent models.

The route records its effective class, effort and fallback reason. Mission Control
shows the class and route fallback reason; the activity feed includes reasons for
all escalated decisions. Raw class and model distributions remain separately
available. Neither is an end-to-end success probability.

## Durable decisions

The SQLite `decision_audit` records exact state, questions, criteria, thresholds,
raw answers, model version, policy checks and outcomes. Successful independent
answers survive a partial outage; only missing decisions receive fallback records.
Errors also receive audit records. Retries replay immutable answers without
calling Jev. The routing policy and profiles participate in the input fingerprint;
changed issue scope, model eligibility or routing policy creates a new revision.
Historical readiness answers keep their original symmetric policy on replay.

## Tools, context and guidance

Each tools Noul includes task text, capability and eligible tools, including after
partial replay. A yes needs `P(yes) >= 0.80`; a no is an applied negative at
`P(yes) <= 0.20`. The middle range keeps the lean tool set with an auditable
uncertainty reason. Repository permissions and the tool ceiling remain absolute.
Shell permission never expands because of Jev's judgment. A capability with no
permitted tools records a deterministic no without a Jev call, fabricated
confidence or an outage warning.

Context candidates carry their path and purpose; relevance is advisory (threshold
zero). A context outage retains deterministic ordering and records the fallback.
Skills retain two independently shuffled Choices with averaged probabilities,
per-skill thresholds and token budgets. Playbook selection retains one Choice.
Private guidance stays private. Neither guidance decision changes the task route.

Acceptance asks one evidence-grounded Noul per criterion and retains its positive
0.70 gate. Merge retains its positive 0.90 gate, independent review and check
policies. Readiness uncertainty never relaxes those gates.

See [the decision audit](../jev-decision-audit.md) for production measurements,
design research, live replay and verification limits.
