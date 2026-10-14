# Kor Code

Kor Code is the documentation project for a Linear-first engineering environment governed by Jev.

The design gives one control plane to read project intent from Linear, choose models and agents, run isolated Claude Code sessions, use an account-aware subscription gateway, and write evidence back to Linear.

This repository contains the foundation monorepo and documentation. The foundation exposes typed integration boundaries and runnable Phase 0 probes; later phases remain unimplemented until their contracts are validated.

## Read first

1. [Architecture](docs/architecture.md)
2. [Requirements](docs/requirements.md)
3. [Domain glossary](docs/GLOSSARY.md)
4. [Specifications](docs/specs/)
5. [Decision records](docs/adr/)
6. [Implementation plan](docs/implementation-plan.md)
7. [Open questions](docs/open-questions.md)
8. [Configuration and doctor](docs/configuration.md)

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

## Foundation

The TypeScript pnpm workspace contains `core`, `jev`, `gateway-adapter`, `linear`, `controller`, `context`, `verification`, `config`, `cli`, and `claude-plugin` packages. Run `pnpm probe` for the external contract checks and read the [Phase 0 probe record](docs/phase-0-probe.md). Use `scripts/sandbox.sh` to load the Claude Code plugin in a disposable `CLAUDE_CONFIG_DIR`; it never installs the plugin globally or changes the existing Claude Code configuration, runs offline unless `--live-model` opts in to CLIProxyAPI, and `pnpm isolation:proof` traces the sandboxed session to show it never touches the real Claude, Codex or agents homes or port 8317.

The Phase 6 cockpit (`packages/claude-plugin`) is Validated on fixture data: `pnpm cockpit` opens it in the sandboxed Claude Code (`/kor`), and `pnpm cockpit:proof` replays the fixture execution and checks every view's labels. See the [cockpit specification](docs/specs/cockpit-mockups.md).

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
