# Kor Code

Kor Code is the documentation project for a Linear-first engineering environment governed by Jev.

The design gives one control plane to read project intent from Linear, choose models and agents, run isolated Claude Code sessions, use an account-aware subscription gateway, and write evidence back to Linear.

This repository contains the foundation monorepo and documentation. The foundation exposes typed integration boundaries and runnable probes. Model compatibility is recorded by `pnpm kor models probe --family claude` and listed by `pnpm kor models list`.

## Read first

1. [Architecture](docs/architecture.md)
2. [Requirements](docs/requirements.md)
3. [Domain glossary](docs/GLOSSARY.md)
4. [Specifications](docs/specs/)
5. [Decision records](docs/adr/)
6. [Implementation plan](docs/implementation-plan.md)
7. [Open questions](docs/open-questions.md)
8. [Model compatibility](docs/model-compatibility.md)

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

The TypeScript pnpm workspace contains `core`, `jev`, `gateway-adapter`, `linear`, `controller`, `context`, `verification`, and `claude-plugin` packages. Run `pnpm probe` for the external contract checks and read the [Phase 0 probe record](docs/phase-0-probe.md). Use `scripts/sandbox.sh` to load the Claude Code plugin in a disposable `CLAUDE_CONFIG_DIR`; it never installs the plugin globally or changes the existing Claude Code configuration, runs offline unless `--live-model` opts in to CLIProxyAPI, and `pnpm isolation:proof` traces the sandboxed session to show it never touches the real Claude, Codex or agents homes or port 8317.

The Phase 6 cockpit (`packages/claude-plugin`) is Validated on fixture data: `pnpm cockpit` opens it in the sandboxed Claude Code (`/kor`), and `pnpm cockpit:proof` replays the fixture execution and checks every view's labels. Execution sessions are Validated locally with parsed stream-json telemetry and policy checks; `pnpm e2e:live` runs the scratch-repository hello-file check when supplied a runtime `KOR_GATEWAY_KEY` or `KOR_GATEWAY_KEY_FILE` (without a key it reports the external validation as Blocked and makes no provider call). Sessions use `acceptEdits` with an explicit repository tool allowlist, so removing `Write` produces a permission denial and a failed attempt. See the [cockpit specification](docs/specs/cockpit-mockups.md).

Verification runs each configured repository check and treats its exit code as authoritative. It collects the worktree diff, asks Jev one Noul per acceptance criterion at the configured probability threshold, and retries a blocked attempt at most twice with the failing evidence in the next prompt. Run the offline proof:

```sh
pnpm verification:proof
```

```text
verification-proof: repair: complete; launches=2; state=completed; findings=recorded
verification-proof: broken: blocked (acceptance-1=fail); launches=3; state=started; findings=recorded
```

Configure checks on a repository entry with `checks: ["pnpm typecheck", "pnpm test"]`. A failed check or unmet acceptance criterion leaves the execution blocked and records each criterion finding in the Linear comment.

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
