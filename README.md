# Kor Code

Kor Code is the documentation project for a Linear-first engineering environment governed by Jev.

The design gives one control plane to read project intent from Linear, choose models and agents, run isolated Claude Code sessions, use an account-aware subscription gateway, and write evidence back to Linear.

This repository contains the foundation monorepo and documentation. The foundation exposes typed integration boundaries and runnable probes. Model compatibility is recorded by `pnpm kor models probe --family claude` and listed by `pnpm kor models list`. `kor plan LEE-57` runs one Jev preflight for readiness, complexity, risk, route, skill, and agent choices, then records the decisions in SQLite.

## Read first

1. [Architecture](docs/architecture.md)
2. [Requirements](docs/requirements.md)
3. [Domain glossary](docs/GLOSSARY.md)
4. [Specifications](docs/specs/)
5. [Decision records](docs/adr/)
6. [Implementation plan](docs/implementation-plan.md)
7. [Open questions](docs/open-questions.md)
8. [Model compatibility](docs/model-compatibility.md)
9. [Configuration and doctor](docs/configuration.md)

## Responsibility split

| System | Owns |
| --- | --- |
| Linear | Projects, issues, intent, dependencies, sessions, progress, and delivery history |
| Jev Code | Selection, decomposition, routing, context, policy, supervision, verification, and escalation |
| Claude Code | Repository work, tools, coding, tests, and reviews |
| Provider gateway | Credentials, account selection, quotas, retries, and failover |
| GitHub | Repositories, branches, pull requests, checks, and review state |

Linear is the source of truth for intent. GitHub is the source of truth for versioned code. Jev is the decision plane between them.

## Design status

- **Proposed** means the conversation selected the direction, but no implementation evidence exists here.
- **Validated** means a local or integration check supports the statement.
- **Blocked** means an external account, provider, or product behaviour prevents validation.
- **Illustrative** means a mock value or UI state, not live telemetry.
- **Verified** means a model passed the recorded sandbox compatibility probe and is routable.

## Foundation

The TypeScript pnpm workspace contains `core`, `jev`, `gateway-adapter`, `linear`, `controller`, `context`, `verification`, `config`, `cli`, and `claude-plugin` packages. Run `pnpm probe` for the external contract checks and read the [Phase 0 probe record](docs/phase-0-probe.md). Use `scripts/sandbox.sh` to load the Claude Code plugin in a disposable `CLAUDE_CONFIG_DIR`; it never installs the plugin globally or changes the existing Claude Code configuration, runs offline unless `--live-model` opts in to CLIProxyAPI, and `pnpm isolation:proof` traces the sandboxed session to show it never touches the real Claude, Codex or agents homes or port 8317.

The Phase 6 cockpit (`packages/claude-plugin`) is Validated on fixture data: `pnpm cockpit` opens it in the sandboxed Claude Code (`/kor`), and `pnpm cockpit:proof` replays the fixture execution and checks every view's labels. Execution sessions are Validated locally with parsed stream-json telemetry and policy checks; `pnpm e2e:live` runs the scratch-repository hello-file check when supplied a runtime `KOR_GATEWAY_KEY` or `KOR_GATEWAY_KEY_FILE` (without a key it reports the external validation as Blocked and makes no provider call). With `dontAsk`, removing `Write` from the repository allowlist is a failed attempt with a permission denial. See the [cockpit specification](docs/specs/cockpit-mockups.md).

For the live scratch run, the script's repository allowlist contains `Read,Write,Edit` and the three `git` commands needed to commit the hello file. To prove a policy failure, remove `Write` from `KOR_E2E_ALLOWED_TOOLS` and set `KOR_E2E_EXPECT_FAILURE=1`; the command reports the provider's permission denial and failed attempt. A launcher with no repository allowlist defaults to `Read`, so mutation is opt-in. Credentials are runtime-only and are never written to the repository or printed.

### Run a live execution

Load the gateway settings into the current shell, then run the disposable hello-file session:

```sh
set -a
source ~/.config/kor/gateway.env
set +a
KOR_E2E_DIR=/tmp/kor-t1-live-success pnpm e2e:live
```

The command creates a scratch repository, creates a `kor/e2e-*` branch, commits `hello.txt`, and prints the selected model and cost. A successful run produced:

```text
e2e:live passed; branch=kor/e2e-1791974354926; hello=yes; committed=yes; model=claude-haiku-4-5-20251001; cost_usd=0.04701935; duration_ms=5450; permission_denials=0
```

Remove `Write` from the allowlist to check the failure path:

```sh
KOR_E2E_DIR=/tmp/kor-t1-live-denial \
KOR_E2E_ALLOWED_TOOLS='Read,Edit,Bash(git status *),Bash(git add *),Bash(git commit *)' \
KOR_E2E_EXPECT_FAILURE=1 pnpm e2e:live
```

The session then reports permission denials and does not report success:

```text
e2e:live failed; branch=kor/e2e-1791974375194; hello=no; committed=no; model=claude-haiku-4-5-20251001; cost_usd=0.05174289999999999; duration_ms=8983; permission_denials=2
e2e:live failure=2 permission denials
```

## Check model compatibility

Install the workspace before using the `kor` commands:

```sh
pnpm install
```

Run a probe with a gateway key supplied at runtime. The probe discovers models from the gateway's `/v1/models` response, starts one isolated sandbox session per selected model, and writes verified results to `~/.local/state/kor/models.json`.

```sh
export KOR_GATEWAY_KEY="<your runtime gateway key>"
pnpm kor models probe --model claude-haiku-5-5
```

The table reports each capability independently. A model is routable only when streaming, tool calls, thinking, and structured output all pass.

```text
MODEL	STREAMING	TOOL_CALLS	THINKING	STRUCTURED_OUTPUT	COST_USD	DURATION_MS
claude-haiku-5-5	pass	pass	pass	pass	0.004184965	5118
```

Use `--family claude` to probe every Claude model returned by the gateway. Use `--dry-run` to list the selected models without starting sessions. To inspect the verified models later, run:

```sh
pnpm kor models list
```

```text
MODEL	FAMILY	CAPABILITIES	COST_USD	DURATION_MS
claude-haiku-5-5	claude	streaming,tool_calls,thinking,structured_output	0.004184965	5118
```

Set `KOR_MODEL_REGISTRY` when you need a disposable registry for a proof or a CI job. The gateway key is never written to the registry or printed by these commands.

## Kor configuration and doctor

Kor reads `~/.config/kor/config.yaml` (or `XDG_CONFIG_HOME/kor/config.yaml`) and keeps runtime state under `~/.local/state/kor` and execution data under `~/.local/share/kor`. A minimal configuration is:

```yaml
repos:
  kor-code:
    path: /home/lee/Projects/kor-code
    remote: https://github.com/korallis/kor-code.git
    defaultBranch: main
    checks: [pnpm typecheck]
    toolAllowlist: [Read, Write, Edit, "Bash(git status*)"]
limits: { total: 2, perRepository: 1 }
defaultRoute: { provider: anthropic, model: claude-sonnet-5-5, accountPolicy: fill-first, sessionAffinity: true, reasoningLevel: medium }
pollIntervalSeconds: 60
intakeLabel: kor
```

Put the Kor client credential in `~/.config/kor/gateway.env` with mode `0600`, for example `KOR_GATEWAY_KEY=...`; environment variables take precedence. `pnpm kor doctor` prints bounded `PASS`/`FAIL` lines for credentials, CLIProxyAPI, management, quota-axi, Claude Code, no-mistakes, and every configured repository. When the Kor key is absent it prints one generated key-list item, such as `CLIProxyAPI addition: - kor-<generated-value>`. Add that exact item to CLIProxyAPI's `api-keys` list and store the same value in `gateway.env`. The doctor never edits the proxy or any user configuration.

With a pilot config and the runtime key loaded, the command exits zero:

```text
$ pnpm kor doctor
PASS Kor config: /tmp/kor-t2-proof/config/kor/config.yaml
PASS Linear key: available
PASS TypeSafe key: available
PASS CLIProxyAPI with Kor key: reachable
PASS CLIProxyAPI management access: available
PASS quota-axi: available
PASS Claude Code: 2.1.299 (Claude Code)
PASS no-mistakes daemon: available
PASS repo kor-code: /home/lee/.treehouse/kor-code-bb1e5c/3/kor-code (main)
```

With the key removed, the gateway line is red and the command exits one:

```text
FAIL CLIProxyAPI with Kor key: missing; CLIProxyAPI addition: - kor-<generated-value>
```

## Plan a Linear issue

Run a preflight for an issue identifier that you can read with the configured personal Linear key:

```sh
pnpm kor plan LEE-1101
```

The command prints the route, each decision, and its confidence. It writes redacted decision records to `~/.local/state/kor/kor.db`. A missing or invalid TypeSafe response keeps readiness `blocked` and marks the configured route `fallback`. A healthy but uncertain or non-applicable response keeps the route `escalated`, which is distinct from an outage. When a decision needs captain input, Kor writes one stable-ID clarification comment to the Linear issue. The command exits one while readiness is blocked, a decision is escalated, or a fallback route is in use.

```text
PLAN plan-<uuid>
route: anthropic/claude-sonnet-5-5 [fallback]
fallback: true
jev: unavailable (TypeSafe API key not found ...)
readiness: blocked (0.00); confidence=0.00; status=blocked
complexity: escalate (0.00); confidence=0.00; status=blocked
risk: escalate (0.00); confidence=0.00; status=blocked
route: claude-sonnet-5-5; confidence=0.00; status=blocked
skill: escalate; confidence=0.00; status=blocked
agent: escalate; confidence=0.00; status=blocked
linear: clarification comment written
```
