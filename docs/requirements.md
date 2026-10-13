# Kor Code requirements

These requirements are implementation targets. They are not evidence that the integrations already exist.

## Linear intake

- Read authorised projects, documents, issues, sub-issues, dependencies, comments, priorities, and sessions.
- Select one project, a configured set, or all authorised projects.
- Receive a direct request from a Linear mention or issue assignment.
- Create or update one Linear agent session for every execution.
- Write progress, findings, blockers, decisions, evidence, pull-request links, and outcomes back to Linear.
- Acknowledge webhooks quickly and process work asynchronously.

## Work selection

- Exclude blocked issues or issues missing acceptance conditions.
- Have Jev evaluate readiness, priority, dependencies, risk, and expected effort.
- Use a durable queue and execution lease so two workers cannot claim the same issue.
- Pause, resume, retry, recover, and explain every execution.
- Record why the controller selected or skipped an issue.

## Execution

- Give every execution an isolated branch or worktree.
- Give every agent the issue intent, acceptance conditions, project documents, repository instructions, and bounded context.
- Support a single agent, specialist agents, and separate delegated tasks.
- Limit concurrency by repository, machine, provider capacity, account quota, and policy.
- Allow an agent to request clarification.
- Produce a report with changed files, tests, risks, and links.

## Model routing

- Select a model family and reasoning level from the live gateway catalogue.
- Include provider, model, account policy, session affinity, and retry policy in the route.
- Consider complexity, cache locality, remaining work, quota, compatibility, and failures.
- Allow manual model and routing overrides.
- Record the decision, confidence, applied route, and override.

## Gateway

- Represent multiple Claude, ChatGPT, Grok, and Devin account slots.
- Report account health, quota state, authentication state, and supported models.
- Start with fill-first account selection and session affinity.
- Rebind only on configured failover conditions.
- Retry only requests safe to retry.
- Distinguish provider failure from account-quota failure.
- Mark a model path incompatible when it fails required tool, thinking, streaming, or compaction tests.

## Context and memory

- Rank repository findings and project documents by relevance.
- Preserve user constraints, acceptance conditions, decisions, exact errors, and useful evidence.
- Remove stale tool output without rewriting critical facts.
- Store only decisions and constraints useful beyond one execution.
- Redact sensitive values before text reaches Jev or an external provider.

## Verification and safety

- Run repository-defined checks before completion.
- Treat test runners as authoritative about pass or fail.
- Require evidence for every acceptance condition.
- Require specialist or human review by risk policy.
- Protect credentials, destructive commands, migrations, branch protections, and production changes with deterministic guards.
- Keep a safe manual path when Jev is unavailable.

## Quality requirements

- A worker crash does not lose the Linear assignment.
- Webhook retries do not create duplicate executions.
- A controller restart reconciles leases and active sessions.
- Progress updates remain meaningful.
- The UI labels live, stale, illustrative, and unavailable values.
- Hosts on Windows, macOS, and Linux can share one documented configuration.

## Out of scope for the first release

- Replacing Linear with another project database.
- Building a terminal renderer from scratch.
- Treating all provider models as Claude Code-compatible without tests.
- Making Jev generate application code.
- Automatic production deployment without a separate policy.
- Silent retries after partial streamed output.
