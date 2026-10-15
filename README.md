# Kor Code

**Kor turns Linear issues into verified pull requests, and you run it from
Mission Control.** You write an issue with acceptance criteria. Kor plans it, runs
[Claude Code](https://code.claude.com/docs/en/overview) on it in an isolated git
worktree, checks the result against your tests and your acceptance criteria, and
reports progress back to the Linear issue. Mission Control, a web app served by the
Kor daemon on your own machine, is where you start work, answer questions, review
the result and ship it. Kor never merges anything; you do.

![Mission Control's Command Centre: three verified runs waiting for approval, Ask Jev's answer, and the pool and spend panels](docs/images/mc-command-centre.webp)

*Mission Control's Command Centre (`kor ui`). Everything in this README, including
every screenshot, comes from running Kor for real; see [What was run](#what-was-run).*

## What to expect

```text
Linear issue (Todo)
   │  Start / Queue in Mission Control   (or kor run LEE-123, or label the issue "kor")
   ▼
Plan       Jev (a TypeSafe decision service) judges readiness, risk and the model to use
   ▼
Work       Claude Code runs in a git worktree, through your CLIProxyAPI gateway,
           with only the tools you allow
   ▼
Verify     your repository checks run, then Jev judges each acceptance criterion;
           a failure goes back to the session, up to two repair attempts
   ▼
Approve    you review the diff and the evidence, then Approve and ship,
           Request changes, or override a Jev decision      (repository setting ship: approve)
   ▼
Ship       commit on kor/LEE-123, your repository's delivery gate, pull request
   ▼
Linear     comments and state changes all the way; In Review when the PR is open,
           Done after you merge
```

In practice:

- **It runs on your machine** as a small daemon (`kor serve`) that also serves
  Mission Control on `127.0.0.1`. There is a CLI (`kor`) for scripts and a
  Claude Code status line as secondary routes. It was built and exercised on Linux
  (Ubuntu under WSL2).
- **A small change takes about a minute** from queue to verified with a Haiku-class
  model, and costs cents.
- **It is cautious.** Sessions can only use the tools on your allowlist, work in a
  worktree and never touch your checkout, and any failed check, unmet acceptance
  criterion or permission denial leaves the run `blocked` with a reason, waiting
  for you. With `ship: approve` even a verified run waits for your go-ahead.
- **It needs a few things around it:** a CLIProxyAPI gateway for your model
  accounts, a Linear API key, a TypeSafe API key, and, for the pull-request step,
  a GitHub `origin`, `gh-axi` and a `no-mistakes` daemon.
- **Be aware of the edge of the evidence.** Queue, plan, work, verify, request
  changes, override and undo, retry and stop were all run live for this README.
  The final step, **Approve and ship to GitHub, was not**: the sandbox never
  published, so no pull request was opened. That path is covered by an offline
  replay and a written specification, not a live capture. The
  [user guide](docs/user-guide.md#what-happens-after-the-checks-pass) has the details.

Direct pull requests use `type(scope): outcome` titles and the bundled
[PR standard](skills/pr-standard/SKILL.md), with recorded checks, acceptance
checkboxes, and public screenshot evidence. A committed repository PR template
takes precedence. See [shipping templates](docs/specs/shipping.md#pull-request-format)
for supported locations and optional placeholders.

## Install

Requirements: Linux with Node 24+, Corepack and Git; Claude Code 2.1.299 or newer; a
browser; a running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI); a
Linear personal API key; a TypeSafe API key. (Where each key goes is in
[Credentials](docs/user-guide.md#credentials-and-the-gateway).)

Install Kor Code and Mission Control with one command:

```sh
curl -fsSL https://raw.githubusercontent.com/korallis/kor-code/main/scripts/install.sh | bash
```

The script asks for a standalone Git checkout of the project you want Kor to
work on. To supply it directly (or on a machine without a terminal):

```sh
curl -fsSL https://raw.githubusercontent.com/korallis/kor-code/main/scripts/install.sh | bash -s -- --pilot ~/code/my-project
```

It checks Linux, Node 24+, Git, Corepack, Claude Code 2.1.299+ and a reachable
CLIProxyAPI, then clones into `~/.local/share/kor-code`, installs the pinned pnpm
with Corepack, and builds the CLI, daemon and web app. Install Corepack with
`npm install -g corepack` if needed. Set `KOR_HOME` to an absolute Linux path to
move the checkout; `KOR_GATEWAY_URL` selects a proxy other than
`http://127.0.0.1:8317`. Export these variables before the command so the script
receives them. A missing systemd user manager is handled automatically;
`--no-systemd` also opts out explicitly.

If `~/.local/bin` is absent from your PATH, the installer prints this line to run
and add to your shell profile:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

On a fresh install it prints a new gateway key. **Add that line to CLIProxyAPI's
`api-keys` list yourself** and reload the proxy. Kor never edits the proxy.
Keep the Kor checkout on disk: the installed command and web app run from it.
Rerun the same one-liner to update; it preserves your configuration, credentials
and uninstall backups, refreshes the cockpit plugin and stops the old daemon.
Run `kor ui` afterwards. Local checkout edits or divergent commits stop the update
with a fix-it message. `kor uninstall` removes the integration; `kor uninstall
--purge` also removes Kor's own data. The downloaded checkout is kept.

For a private fork or mirror, authenticate with `gh auth login`, then use the
GitHub API route:

```sh
gh api repos/korallis/kor-code/contents/scripts/install.sh -H "Accept: application/vnd.github.raw" | bash
```

For a fork, export `KOR_REPOSITORY=https://github.com/OWNER/REPO.git` and replace
`korallis/kor-code` in the API or raw URL. `KOR_REF` selects a branch (default `main`).
Alternatively, export `GH_TOKEN` with repository read access and use
`curl -fsSL -H "Authorization: Bearer $GH_TOKEN"` with the raw URL above.
The clone uses the same exported token, or your existing `gh` login.
The [manual installation appendix](#manual-installation) keeps the clone/build route.

## Quick start

**1. Describe your project** in `~/.config/kor/config.yaml`. The installer scaffolds
it with empty `checks` and `toolAllowlist`, which are yours to fill in. The file
used for the screenshots below (a scratch clone of this repository):

```yaml
repos:
  kor-code:
    path: /tmp/kor-demo/pilot
    linearTeam: LEE
    linearProject: 743496b4-29be-4be5-8cd6-68b3bc39dbbc
    remote: https://github.com/korallis/kor-code.git
    defaultBranch: main
    ship: approve        # a verified run waits for your approval; "auto" (the default) ships by itself
    checks:
      - git diff --check
    toolAllowlist: [Read, Write, Edit, "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(ls*)", "Bash(cat*)", "Bash(grep*)", "Bash(test*)"]
limits: { total: 2, perRepository: 1 }
defaultRoute: { provider: anthropic, model: claude-haiku-5-5, accountPolicy: fill-first, sessionAffinity: true, reasoningLevel: medium }
pollIntervalSeconds: 120
intakeLabel: kor
```

`checks` decide whether a result is accepted. `toolAllowlist` is everything a
session may do; one denied tool fails the attempt, so list the commands your
project's tests use. Every field is explained in the
[user guide](docs/user-guide.md#configure-a-repository).

**2. Run `kor doctor`.** It prints one `PASS` or `FAIL` per check:

```text
$ kor doctor
PASS Kor config: <sandbox>/home/.config/kor/config.yaml
PASS Linear key: available
PASS TypeSafe key: available
PASS CLIProxyAPI with Kor key: reachable
PASS CLIProxyAPI management access: available
PASS quota-axi: available
PASS Claude Code: 2.1.300 (Claude Code)
FAIL no-mistakes daemon: not running
PASS repo kor-code: <sandbox>/pilot (main)
FAIL doctor: one or more checks failed. Hint: fix the reported checks and rerun `kor doctor`
```

The one `FAIL` is the `no-mistakes` daemon, which only the shipping step needs, so
a run still verifies without it. [The guide](docs/user-guide.md#check-your-setup-with-kor-doctor)
says what each line is for.

**3. Start the daemon and open Mission Control:**

```sh
kor ui    # starts the daemon if needed and opens Mission Control, already signed in
```

`kor ui` starts the installed user service, or a background daemon on hosts without
a user manager. It waits for live status, finds the daemon's port, adds a one-time session token to the URL
fragment (it never prints it) and opens your default browser, including the Windows
browser under WSL. It always prints the local URL; if a browser cannot open, visit
that URL and connect with the token file below. A browser without a
session, for example one you opened by hand, shows the connect screen; paste the
token from `~/.local/state/kor/ui-token`:

![Mission Control's connect screen](docs/images/mc-connect.webp)

**4. Connect Linear, GitHub, the gateway and Jev** under **Settings**. Keys you
paste there are write-only: the daemon stores them privately in
`~/.local/state/kor/connections.json` and never sends one back to the browser. If
you already keep them in `~/.config/linear/env`, `~/.config/typesafe/env` and
`~/.config/kor/gateway.env` the connections show as connected with nothing to
paste. GitHub connects through `gh-axi` (`gh auth login`) or a token.

![Settings: Linear, GitHub, Gateway and Jev connections, with the gateway form open](docs/images/mc-settings.webp)

**5. Probe the models you want** on the **Models** screen (**Probe a model**), or
with `kor models probe --model claude-haiku-5-5`. Kor only routes to a model that
passes streaming, tool calls, thinking and structured output.

## Work in Mission Control

The sidebar is the whole app: **Home**, **Projects**, **Linear**, **Agents**,
**Models**, **Jev Brain**, **Terminal** and **Settings**. ⌘K (or Ctrl+K) opens
**Ask Jev** from anywhere. The footer always shows pool health, slots in use,
today's spend and whether the daemon is live.

**Start work.** On **Home**, **Next up** lists Todo issues labelled `kor` with a
**Start** button; **Queue an issue** (on Agents) and a project's **Queue for Kor**
take any open issue. Jev checks readiness before anything starts, and a Todo issue
carrying the `kor` label is also picked up by the daemon on its own.

![The Queue an issue dialog](docs/images/mc-queue.webp)

**Answer a question.** A run that needs input lands in **Needs you** on Home with
Jev's question and an answer box. **Send and retry** writes the answer to the Linear
issue as a comment and queues the run again.

![Home with a run needing input: Jev's question, the answer box, and two runs working](docs/images/mc-needs-input.webp)

**Follow a project.** **Projects** shows each configured repository: its Linear
issues with their Kor run, progress, health, pull requests and the repository's own
settings, including `ship`.

![The kor-code project workspace](docs/images/mc-project.webp)

**Watch the agents.** **Agents** (and **Terminal**, Ctrl+Backtick) streams each
run's actual output, its seven stages, tokens and cost, and has **Stop run**,
**Retry** and a **Note for Jev** box.

![Agents: a live run with its terminal output, stages, tokens and cost](docs/images/mc-agents.webp)

**Decide.** **Linear** is the decision workspace for a run: the issue, Jev's
reasoning, the real diff, the checks and each acceptance judgement, and the panel
on the right with **Approve and ship**, **Request changes** (`R`) and **Explore
alternatives** (`E`). A run that failed or blocked offers **Retry the run**, and the
chevron beside Approve has **Open the pull request** (once there is one) and **Cancel the run**.

![The decision workspace for a verified run waiting for approval](docs/images/mc-decision.webp)

**Override a Jev decision, and undo it.** **Explore alternatives** lists every
decision Jev made with its other candidates. Pick one and Kor applies it from the
next attempt if policy allows (a refusal is recorded with its reason); **Revert**
puts Jev's choice back.

![Explore alternatives after switching the route, with Revert available](docs/images/mc-override.webp)

**Models and accounts.** Every account slot and its health, quota resets, the
verified-model table with **Probe**, and the routing policy.

![Models and accounts](docs/images/mc-models.webp)

**See what Jev learned.** **Jev Brain** shows the decision audit and the
calibration report: cost per verified run, Jev against the baseline route,
overrides.

![Jev Brain](docs/images/mc-brain.webp)

Each job, step by step, is in the
[user guide](docs/user-guide.md#work-in-mission-control).

Measure context with `kor calibrate report --context`. Run `pnpm context:proof`
for the recorded-stream proof, or `pnpm context:bench --revision COMMIT --routes FILE`
for live legacy sessions at a pinned revision. See [Measure session context](docs/context-bench.md)
for Jev route input, fixed cases, token definitions, and private capture artifacts.

## The CLI and the Claude Code status line

Secondary routes to the same daemon. Every command prints JSON for scripts with
`--json`; the [CLI contract](docs/cli-contract.md) is the stable schema.

| You want to | Run |
| --- | --- |
| Queue an issue | `kor run LEE-123` (`--dry-run` previews it) |
| See every execution, or one | `kor status --json`, `kor status --json LEE-123` |
| Read an execution's timeline | `kor logs EXECUTION-ID` |
| Try a blocked or failed execution again | `kor retry LEE-123` |
| Stop an execution | `kor cancel LEE-123` (this does not move the Linear issue) |
| Preview Jev's plan | `kor plan LEE-123` |
| Check your setup | `kor doctor` |
| Validate public skills | `kor skills lint` (`[DIRECTORY] [--json]`) |
| Open Mission Control | `kor ui` |

A real timeline, from the run in the screenshots above (it was blocked once, retried
from Mission Control, verified, then waited at the approval gate where an override
was applied and reverted):

```text
$ kor logs 82d80c5d-5ad3-477f-8a96-2ed5c16245b2
2026-10-15T00:18:00.749Z execution started
2026-10-15T00:18:44.640Z execution blocked: acceptance-3: fail — acceptance-3: Jev Noul probability 0.020; threshold 0.700
2026-10-15T00:19:05.410Z retry accepted from Mission Control
2026-10-15T00:19:55.373Z execution started
2026-10-15T00:20:20.353Z execution waiting
2026-10-15T00:20:44.954Z override ovr_3a13daf9 applied: route -> claude-sonnet-5-5 (Applies from the next attempt; the running session keeps its model.)
2026-10-15T00:20:57.944Z override ovr_3a13daf9 reverted
```

(The first block was my own doing: I had put a sentence about the issue being
disposable under the acceptance list, and Kor read it as a third criterion that the
work could not meet. Fixing the issue and retrying cleared it.)

Claude Code shows a one-line Kor status line under the prompt, and `/kor` draws a
view of the same daemon's status, once the installer's `kor-cockpit` plugin is
active. See [the status line](docs/user-guide.md#the-claude-code-status-line).

## When something stops

Kor's queue is durable: I killed the daemon (`SIGKILL`) in the middle of a run and
started it again, and the execution was re-queued automatically with nothing lost.
Missing acceptance criteria, unfinished dependencies and healthy Jev readiness
rejections block a run before a model session starts; Kor writes a clarification
comment and adds `kor:blocked` on Linear, which you clear by answering in Mission
Control (or fixing the issue) and retrying. If Linear is unreachable when you act in
Mission Control, the action still applies and Kor writes to Linear again on its next
poll; do not repeat the action.

The [user guide](docs/user-guide.md#recover-from-a-restart-a-crash-or-a-block) walks
through restart, crash and block recovery, and has a
[troubleshooting table](docs/user-guide.md#troubleshooting). Every command failure is
one line, `FAIL <command>: <message>. Hint: <what to do next>`, and `--json` gives
the same as an object.

## Documentation

- [Public skills](docs/skills.md): bundled code and PR standards, authoring schema,
  `kor skills lint`, routing guardrails and token estimates. Lint runs locally
  without credentials or a daemon; session selection and delivery are separate work.

- [User guide](docs/user-guide.md): install, credentials, configuration, Linear
  setup, Mission Control job by job, the CLI and status line, recovery,
  troubleshooting, uninstall.
- [CLI contract](docs/cli-contract.md): the JSON that `kor run --json` and
  `kor status --json` print, and the error format, for scripts and other tools.
- [Mission Control daemon API](docs/mission-control-api.md): the authenticated
  `/api` routes and live event stream the web app uses.
- [Configuration](docs/configuration.md): the config schema and install details.
- [Model compatibility](docs/model-compatibility.md).
- Design: [architecture](docs/architecture.md), [requirements](docs/requirements.md),
  [glossary](docs/GLOSSARY.md), [specifications](docs/specs/),
  [decision records](docs/adr/), [implementation plan](docs/implementation-plan.md),
  [threat model](docs/threat-model.md), [open questions](docs/open-questions.md).
- [Development and validation](docs/development.md): the workspace and the proof
  commands.

| System | Owns |
| --- | --- |
| Linear | Projects, issues, intent, dependencies, progress, and delivery history |
| Jev | Selection, routing, readiness and acceptance judgments |
| Claude Code | Repository work, tools, coding, tests, and reviews |
| CLIProxyAPI | Credentials, account selection, quotas, retries, and failover |
| GitHub | Repositories, branches, pull requests, checks, and review state |

## What was run

Every command, output and screenshot here was produced by running Kor for real: a
real daemon in a throwaway `HOME` (so no real Claude, Codex or agents configuration
was touched), a scratch clone of this repository as the pilot project (paths under
`/tmp/kor-demo/…` and `<sandbox>` are that sandbox), real Linear issues, a live
CLIProxyAPI gateway and real model calls. The three issues on screen
(LEE-1126, LEE-1127, LEE-1128, titled `[throwaway] README capture: …`) are disposable
issues that were created for the captures and canceled afterwards. The Models screen
shows the author's real gateway pool, with Kor's opaque slot ids. Four models were
probed (about thirty cents); the runs used `claude-haiku-5-5` and cost about five cents.

What was not run live: Approve and ship against GitHub (the sandbox never
published), entering a new key in Settings (the fields are shown empty), a Linear
outage with synchronization pending, the systemd service lifecycle, for those original screenshots. The one-line installer and `kor ui` launch flow
have since been exercised separately in an isolated home. Each is marked where it
comes up. The screenshots are 1600-pixel captures of the real page in Chrome,
saved as WebP.


## Manual installation

```sh
git clone https://github.com/korallis/kor-code.git
cd kor-code
corepack pnpm install --frozen-lockfile
corepack pnpm -r --if-present build
node packages/cli/dist/cli.js install --pilot ~/code/my-project --no-systemd
export PATH="$HOME/.local/bin:$PATH"
kor ui
```

Omit `--no-systemd` to install a systemd user unit when a user manager is available.
For a manual update, pull, repeat the install/build commands and run the same
`node … install` command. Reinstalling with the same pilot refreshes the plugin
and keeps the original uninstall backups. To change pilot or scope, uninstall first.

## License

[MIT License](LICENSE).
