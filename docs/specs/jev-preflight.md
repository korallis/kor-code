# Jev preflight

`kor plan` asks Jev six independent questions in one request:

- a Noul for readiness;
- a Score for complexity;
- a Score for risk;
- a Choice over verified gateway models;
- a Choice for the configured skill roster;
- a Choice for the configured agent roster.

The CLI supplies the issue, acceptance criteria, dependency states, and verified model catalogue as structured state. Code keeps policy checks deterministic. A missing acceptance section, incomplete dependency, or empty verified catalogue fails readiness even when Jev's probability is high.

Each applied response is redacted and stored in the `decision_audit` table in the configured Kor SQLite database. The audit has the request, answer, probability data, confidence, and applied decision. A stable UUID derived from the canonical Linear issue ID makes clarification comments safe to retry.

If the TypeSafe request cannot return a valid typed response, Kor records six blocked decisions, uses the configured route with the `fallback` label, and leaves readiness `blocked`. The fallback route is visible for diagnosis. It does not authorize execution. The CLI writes a clarification comment when a decision is blocked and exits with status one.

The design was checked with Jev before implementation. Jev selected the separate SQLite audit, configured rosters, explicit thresholds, and the labelled fallback policy. The catalogue proposal scored 0.68 confidence because live gateway model capability data can be incomplete. The implementation therefore requires the verified registry and treats an empty registry as blocked.
