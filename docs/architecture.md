# Kor Code architecture

## Purpose

Kor Code coordinates engineering work from Linear while keeping execution in repositories and coding runtimes. Each system has one clear owner.

## System boundary

~~~mermaid
flowchart LR
    L[Linear<br/>intent and delivery record]
    J[Jev decision core<br/>selection and policy]
    C[Claude Code runtime<br/>engineering execution]
    G[Provider gateway<br/>accounts and failover]
    H[GitHub<br/>code and CI]
    V[Verification<br/>tests and review evidence]
    L <--> J
    J --> C
    C <--> G
    C <--> H
    H --> V
    C --> V
    V --> J
    J --> L
~~~

The controller keeps the loop running. It reads eligible work, asks Jev for decisions, dispatches execution, collects evidence, and writes meaningful updates to Linear.

## Responsibility boundaries

### Linear owns intent

Linear stores projects, documents, issues, dependencies, priorities, agent sessions, milestones, and project updates. Linear does not choose models or coding strategies.

### Jev owns decisions

Jev evaluates task type, complexity, parallelism, model route, agent and skill selection, context relevance, reuse opportunities, risk, verification depth, retry, escalation, and clarification.

Jev does not replace deterministic checks. Git, test runners, policy guards, and provider responses remain authoritative for facts.

### Claude Code owns execution

Sessions inspect repositories, read instructions, change files, run tools and tests, create branches, and open pull requests. Sessions do not create a competing project-management record.

### The gateway owns provider access

The gateway stores credentials outside the repository, exposes a model catalogue, tracks account health and quotas, applies session affinity, retries safe pre-stream failures, and reports provider facts to Jev.

### GitHub owns versioned code

GitHub stores branches, commits, pull requests, checks, review comments, and merge state. Jev links GitHub evidence to the Linear issue that requested the work.

## Control loop

~~~mermaid
sequenceDiagram
    participant Linear
    participant Controller as Kor controller
    participant Jev
    participant Runtime as Claude Code
    participant Gateway
    participant GitHub
    Linear->>Controller: Issue ready or webhook event
    Controller->>Linear: Read issue, project, docs, dependencies
    Controller->>Jev: Classify and choose execution plan
    Jev-->>Controller: Decision bundle
    Controller->>Runtime: Start isolated session
    Runtime->>Gateway: Request selected route
    Gateway-->>Runtime: Account and provider response
    Runtime->>GitHub: Commit, branch, or pull request
    Runtime->>Controller: Events, findings, tests, blockers
    Controller->>Jev: Assess evidence and next action
    Jev-->>Controller: Continue, retry, review, escalate, or complete
    Controller->>Linear: Write progress and outcome
~~~

## Invariants

1. Every substantive execution has one Linear issue.
2. Every worker has an execution ID, issue ID, repository, and worktree.
3. Every completion claim has evidence.
4. Every route comes from the live gateway catalogue.
5. Every failover has a reason.
6. Every destructive or policy-sensitive operation passes deterministic guards.
7. Linear remains the only project and issue management system.
8. A Jev outage leaves a safe, explicit fallback path.

## Tracker boundary (LEE-1323)

`@kor-code/tracker` owns shared issue/workflow contracts, the queue and durable
outbox, and repository routing. Linear and GitHub implement that contract.
GitHub uses paged Issues and Project v2 APIs; plain Issues use status labels.
The controller, daemon and Mission Control use the selected tracker for the same
execution lifecycle. Legacy Linear exports retain source compatibility without
creating a second queue or changing existing stored assignments.
