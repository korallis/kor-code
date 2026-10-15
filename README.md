# Kor Code

**Kor turns Linear issues into verified pull requests.** You write an issue with
acceptance criteria. Kor plans it, runs [Claude Code](https://code.claude.com/docs/en/overview)
on it in an isolated git worktree, checks the result against your repository's
checks and your acceptance criteria, and reports progress on the Linear issue.
You run it from Mission Control, a web app the Kor daemon serves on your own
machine. Kor never merges anything; you do.

![Mission Control's Command Centre: one run needing an answer, two verified runs ready to ship, and the Jev learned card](docs/images/mc-command-centre.webp)

```text
Linear issue (Todo)
   │  Start or Queue in Mission Control, kor run LEE-123, or the label "kor"
   ▼
Plan      Jev judges readiness, risk, the model, the skills and the tools
   ▼
Work      Claude Code runs in a git worktree through your CLIProxyAPI gateway,
          with only the permissions you allow
   ▼
Verify    your repository checks run, then Jev judges each acceptance criterion;
          a failure goes back to the session, up to two repair attempts
   ▼
Approve   you review the diff and the evidence (with ship: approve)
   ▼
Ship      commit on kor/LEE-123, your delivery gate, a pull request
   ▼
Linear    comments throughout; In Review when the PR opens, Done after you merge
```

Jev is the decision service Kor calls through the TypeSafe API. It makes every
per-task choice: whether the issue is ready, which verified model runs it, which
skills and playbook the session gets, and whether each acceptance criterion is met.

In the runs behind these screenshots, each attempt at a small documentation
change took 14 to 18 seconds from start to verified and cost under one cent.
Any failed check, unmet criterion or permission denial stops the run as
`blocked` with a reason.

## Requirements

- Linux (built and tested on Ubuntu under WSL2) with Node 24+, Corepack and Git.
- Claude Code 2.1.299 or newer, and a browser.
- A running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) gateway
  holding your model accounts. Kor expects it at `http://127.0.0.1:8317`.
- A Linear personal API key. Kor reaches Linear only through its API: there is no
  webhook or Linear app to install.
- A TypeSafe API key, for Jev.
- To ship: a GitHub `origin`, Git `user.name` and `user.email`, GitHub write
  access through GitHub CLI (`gh auth login`) or `GH_TOKEN` / `GITHUB_TOKEN`,
  and a running `no-mistakes` daemon, which tells Kor whether the repository has
  a delivery pipeline. `gh-axi` is
  optional: GitHub connections, pull request lists and PR creation use the API.
  Tokens need repository contents write and pull request write access.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/korallis/kor-code/main/scripts/install.sh | bash
```

The installer checks the requirements, clones Kor into `~/.local/share/kor-code`,
builds the CLI, daemon and Mission Control, and installs `kor` into
`~/.local/bin`. It asks for the Git checkout of the project you want Kor to work
on and its Linear team key. To answer up front, or without a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/korallis/kor-code/main/scripts/install.sh | bash -s -- --pilot ~/code/my-project --linear-team APP
```

If `~/.local/bin` is not on your `PATH`, add `export PATH="$HOME/.local/bin:$PATH"`
to your shell profile. On a machine with no gateway key, the installer prints a
new one as an `api-keys` line: **add that line to CLIProxyAPI's config yourself**
and reload the proxy. Kor never edits the proxy. Keep the checkout on disk; the
`kor` command and Mission Control run from it.

`--no-systemd` skips the systemd user unit, `KOR_HOME` moves the checkout and
`KOR_GATEWAY_URL` points at another gateway. The [user guide](docs/user-guide.md#install)
covers forks, private mirrors and a manual build.

## First run

**1. Set your repository policy** in `~/.config/kor/config.yaml`. The installer
writes a scaffold with your checkout, team key and default branch; add the checks
that decide whether work is accepted and the tools sessions may use:

```yaml
repos:
  my-project:
    path: /home/you/code/my-project
    linearTeam: APP
    defaultBranch: main
    ship: approve          # verified runs wait for you; auto ships straight away
    checks:
      - pnpm test
    toolAllowlist:
      - Read
      - Write
      - Edit
      - "Bash(pnpm test*)"
      - "Bash(git diff*)"
limits:
  total: 2
  perRepository: 1
launchProfile: lean
pollIntervalSeconds: 60
intakeLabel: kor
```

Sessions get only what `toolAllowlist` allows, and an unscoped `Read` also allows
file search. See [Configure a repository](docs/user-guide.md#configure-a-repository).

**2. Check the setup.** This is `kor doctor` in the throwaway home used for
these docs:

```text
$ kor doctor
PASS Kor config: /tmp/kor-rf/home/.config/kor/config.yaml
PASS Linear key: available
PASS TypeSafe key: available
PASS CLIProxyAPI with Kor key: reachable
FAIL CLIProxyAPI management access: management key missing
FAIL quota-axi: unavailable
PASS Claude Code: 2.1.300 (Claude Code)
FAIL no-mistakes daemon: not running
PASS repo pilot: /tmp/kor-rf/pilot (main)
PASS repo pilot shipping target: github.com
PASS repo pilot git identity: user.name and user.email configured
PASS repo pilot GitHub API: authenticated with repository write access; PR publication uses the API
PASS repo pilot push access: push dry run passed; no remote refs changed
PASS repo pilot tools: Bash, Edit, Glob, Grep, Read, Write (effective permission base names; automatic search requires unscoped Read); Jev selects optional tools per task; availability does not grant command permissions
FAIL doctor: one or more checks failed. Hint: fix the reported checks and rerun `kor doctor`
```

The management key and `quota-axi` are optional: without them Mission Control
cannot show the gateway's account slots and quota windows. `no-mistakes` is
needed only to ship, so runs still verify without it. Everything else must pass.
[What each line means](docs/user-guide.md#check-your-setup-with-kor-doctor).

**3. Open Mission Control:**

```sh
kor ui
```

This starts the daemon if it is not running and opens Mission Control in your
browser, already signed in (under WSL, in the Windows browser). If the browser
cannot open, it prints the address; paste the token from
`~/.local/state/kor/ui-token` into the connect screen.

**4. Connect.** **Settings** shows Linear, GitHub, the gateway and Jev. Keys in
`~/.config/linear/env`, `~/.config/typesafe/env` and `~/.config/kor/gateway.env`
show as connected already; otherwise paste a key there. Saved keys are
write-only and never sent back to the browser.

![Settings: Linear, GitHub, Gateway and Jev connected](docs/images/mc-settings.webp)

**5. Probe models.** Kor only uses models that pass a short compatibility probe
(streaming, tool calls and a final JSON answer). Probe from **Models → Probe a
model**, or:

```sh
kor models probe --dry-run           # list the chat and coding models the gateway offers
kor models probe --model MODEL-ID    # probe one; a few cents
kor models list                      # the verified models
```

Verified models are the candidates Jev chooses from for each task.

## Daily use

### Write and start an issue

Put acceptance criteria in the issue description under a heading named
`Acceptance criteria` (or `Acceptance`), one bullet per criterion. Every line
under that heading counts as a criterion, so keep notes above it. Check a ticket
before you queue it:

```text
$ kor linear lint LEE-1166
LEE-1166: blocked; hasScreenshot=false
  acceptance-criteria: Add explicit acceptance criteria to the issue.
```

Issues labelled `UI` also need a screenshot or mockup; `kor linear attach-image`
uploads one. Then start the work in one of three ways: **Start** on Home's
**Next up**, **Queue an issue** on Agents (or **Queue for Kor** in a project), or
label a Todo issue `kor` and let the daemon pick it up on its next poll.

![The Queue an issue dialog](docs/images/mc-queue.webp)

### Work in Mission Control

**Home** shows what needs you, what is ready to ship, running agents, spend and
**Next up**. A run that needs an answer lands in **Needs you**: type the answer
and **Send and retry** writes it to the Linear issue and runs again. Ctrl+K (⌘K)
opens **Ask Jev** anywhere.

**Agents** streams each run's real output, its seven stages, tokens and cost,
with **Stop run**, **Retry** and a **Note for Jev**.

![Agents: a verified run's live output, stages, acceptance and cost](docs/images/mc-agents.webp)

**Linear** is the decision workspace for a run: the issue, Jev's reasoning, the
diff, the checks and each acceptance judgement, with **Approve and ship**,
**Request changes** (`R`) and **Explore alternatives** (`E`).

![The decision workspace for a verified run waiting for approval](docs/images/mc-decision.webp)

**Projects** shows each repository's Linear issues with their runs, health and
pull requests, and its repository settings. **Models** shows verified models,
the gateway's account slots and the routing policy. **Jev Brain** shows the
decision audit, calibration and what Jev has learned about skills.

### Skills and your private pack

Kor ships skills (coding and PR standards, Linear and ticket guidance, project
setup, principles) and playbooks (procedures such as `fix-bug` or
`change-docs`). Before each session Jev picks the skills and at most one
playbook within a token budget; the run's **Plan** tab shows what each attempt
received. Keep your own guidance in a private pack outside the repository:

```sh
kor skills init                                         # creates ~/.config/kor/skills
kor skills import --from ./my-skills --dry-run --skip-invalid
kor skills import --from ./my-skills --skip-invalid
kor skills doctor                                       # the merged catalogue and its token costs
```

Private skills are `local-only` by default: Jev sees only their names, never
their content. `kor skills guard` checks that no private name leaks into the
public tier. More in [Skills](docs/skills.md).

### Override Jev

**Explore alternatives** lists every decision Jev made with its other
candidates. Pick one, such as a different verified model, and Kor applies it from
the next attempt if policy allows. The same dialog edits the next session's
skills, playbook and tools, showing the per-turn token cost of each change.
Every override is audited, commented on the Linear issue and can be reverted.
Repository deny lists and tool policy always win.

![Explore alternatives: a route override, then the next session's skills, playbook and tools](docs/images/mc-override.webp)

Linear labels do the same per issue: `kor:skill/NAME`, `kor:skill/-NAME`,
`kor:playbook/NAME`, `kor:tool/NAME`, `kor:tool/-NAME`.

### Ship

With `ship: approve`, **Approve and ship** commits the verified files on
`kor/<issue>`, runs the repository's delivery gate, and opens a pull request
written to the [PR standard](skills/pr-standard/SKILL.md) (or your repository's
PR template). Linear moves to In Review. When you merge on GitHub, Kor moves the
issue to Done. See [what happens after approval](docs/user-guide.md#what-happens-after-approval).

## Configuration

Everything Mission Control's **Settings** and **Repository settings** change
lives in `~/.config/kor/config.yaml`; Mission Control validates it and keeps the
previous file as `config.yaml.bak`. The [configuration reference](docs/configuration.md)
has the full schema: `linearProject` mappings, `tools` caps, skill pins and
budgets, run limits, calibration and the session launch profile.

The CLI reaches the same daemon. Every command takes `--json`; the
[CLI contract](docs/cli-contract.md) is the stable schema.

| You want to | Run |
| --- | --- |
| Preview Jev's plan | `kor plan LEE-123` |
| Queue an issue | `kor run LEE-123` (`--dry-run` previews) |
| See runs | `kor status --json [LEE-123]` |
| Read a run's timeline | `kor logs EXECUTION-ID` |
| Retry or stop a run | `kor retry LEE-123`, `kor cancel LEE-123` |
| Report routing calibration | `kor calibrate report` |

Inside Claude Code in your project, the installer's plugin adds a Kor status line
and a `/kor` view of the daemon.

## Update and uninstall

Rerun the install one-liner to update, then `kor ui`. It keeps your
configuration, keys and state.

`kor uninstall` stops the daemon and removes the integration but keeps your
configuration and state. `kor uninstall --purge` also removes Kor's data and its
installer cache. The Kor checkout, your external key files and the gateway's key
entry stay; remove them yourself.

## Troubleshooting

- **`FAIL <command>: … Hint: …`.** Every failure is one line with the next step.
- **`HTTP 401` from the gateway.** CLIProxyAPI does not have Kor's key in `api-keys` yet.
- **`route: no-verified-route`.** No model has passed `kor models probe`.
- **`Session failed: 1 permission denial`.** The session needed a command outside
  `toolAllowlist`. Add it and retry.
- **A run is `blocked` with a `kor:blocked` label.** Missing criteria, an
  unfinished dependency or a readiness refusal; the Linear comment says which.
  Fix the issue, then retry.
- **Mission Control shows the connect screen or `OFFLINE`.** Run `kor ui`.

The [troubleshooting table](docs/user-guide.md#troubleshooting) has the rest.

## Documentation

- [User guide](docs/user-guide.md): everything above in full.
- [Skills](docs/skills.md) and [principles and playbooks](docs/pstack-playbooks.md).
- [Project setup](docs/project-setup.md): briefs, documentation and ticket mockups for a new project.
- [Configuration](docs/configuration.md), [CLI contract](docs/cli-contract.md),
  [Mission Control API](docs/mission-control-api.md), [model compatibility](docs/model-compatibility.md).
- Design: [architecture](docs/architecture.md), [requirements](docs/requirements.md),
  [glossary](docs/GLOSSARY.md), [specifications](docs/specs/), [decision records](docs/adr/),
  [threat model](docs/threat-model.md), [implementation plan](docs/implementation-plan.md),
  [open questions](docs/open-questions.md), [review follow-ups](docs/review-followups.md).
- [Development and validation](docs/development.md) and
  [measuring session context](docs/context-bench.md): building from source and the proof commands.

## License

[MIT License](LICENSE).
