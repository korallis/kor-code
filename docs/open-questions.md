# Open questions and validation work

Resolve these questions with a compatibility test or an explicit product decision.

## Provider and gateway

- Which gateway version supports every required account type?
- Can each entitlement authenticate within provider terms?
- Which non-Claude paths support tool calls, streaming, thinking, and compaction?
- Which quota responses are safe to classify?
- Which failures are safe to retry before output?
- Does affinity work with concurrent subagents?

## Claude Code

- Which installed version exposes the required Mods and interception points?
- Can the visual layer coexist with Jev telemetry?
- Which APIs support unattended isolated sessions?
- How does the runtime report partial output and recovery?
- Which remote-control features stop working behind a custom gateway?

## Linear

- Which Agent API features are enabled for the target workspace?
- Which objects can the Jev Code agent create or update?
- What are webhook retry and rate-limit rules?
- How do projects link to repositories?
- Which status transitions are configured for each team?

## Jev

- Which decision endpoint and version will the controller use?
- Which questions belong in one batch?
- How will confidence be calibrated?
- What data must stay on the execution host?
- What is the safe fallback when Jev is unavailable?

## Product choices

- What is the first pilot project and repository?
- Which operations always require human approval?
- What concurrency limit fits the available machines and accounts?
- Which project updates are meaningful enough to publish automatically?
- Which metrics define a successful route change?
