# Kor Code

**Kor turns Linear issues into verified pull requests.** You write an issue with
acceptance criteria. Kor plans it, runs [Claude Code](https://code.claude.com/docs/en/overview)
on it in an isolated git worktree, checks the result against your tests and your
acceptance criteria, and reports progress back to the Linear issue. Kor never
merges anything; you do.

![The Kor cockpit inside Claude Code, showing a live execution](docs/images/cockpit-live.png)

*The Kor cockpit (`/kor` in Claude Code) showing a real run. Everything in this
README, including every screenshot, comes from running Kor for real; see
[What was run](#what-was-run).*

## What to expect

```text
Linear issue (Todo)
   │  kor run LEE-123          (or the daemon polls for issues labelled "kor")
   ▼
Plan       Jev (a TypeSafe decision service) judges readiness, risk and the model to use
   ▼
Work       Claude Code runs in a git worktree, through your CLIProxyAPI gateway,
           with only the tools you allow
   ▼
Verify     your repository checks run, then Jev judges each acceptance criterion;
           a failure goes back to the session, up to two repair attempts
   ▼
Ship       commit on kor/LEE-123, your repository's delivery gate, pull request
   ▼
Linear     comments and state changes all the way; In Review when the PR is open,
           Done after you merge
```

In practice:

- **It runs on your machine** as a small daemon (`kor serve`) plus a CLI (`kor`).
  It was built and exercised on Linux (Ubuntu under WSL2).
- **A small change took about 30 seconds** from queue to verified with a Haiku-class
  model in the captures below, and cost cents.
- **It is cautious.** Sessions can only use the tools on your allowlist, work in a
  worktree and never touch your checkout, and any failed check, unmet acceptance
  criterion or permission denial leaves the run `blocked` with a reason, waiting
  for you. You get `kor retry`, `kor cancel` and a log.
- **It needs a few things around it:** a CLIProxyAPI gateway for your model
  accounts, a Linear API key, a TypeSafe API key, and, for the pull-request step,
  a GitHub `origin`, `gh-axi` and a `no-mistakes` daemon.
- **Be aware of the edge of the evidence.** Queue, plan, work, verify, restart and
  retry were all run live for this README. The final pull-request step was *not*:
  the demo project had no GitHub remote, so every run stopped at shipping with
  `git failed (2): error: No such remote 'origin'`, its verified work intact in its
  worktree. That path is covered by an offline replay and a written specification,
  not a live capture. The [user guide](docs/user-guide.md#what-happens-after-the-checks-pass)
  has the details.

## Install

Requirements: Linux with Node 24+, pnpm and Git; Claude Code 2.1.299 or newer;
a running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI); a Linear
personal API key; a TypeSafe API key. (Where each key goes is in
[Credentials](docs/user-guide.md#credentials-and-the-gateway).)

```sh
git clone https://github.com/korallis/kor-code.git
cd kor-code
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/cli.js install --pilot ~/code/my-project
export PATH="$HOME/.local/bin:$PATH"
```

`--pilot` is a standalone Git clone of the project you want Kor to work on. Keep
the `kor-code` checkout on disk: the installed `kor` command points into it. On a
machine with no Kor files, install prints a new gateway key that you add to
CLIProxyAPI's `api-keys` list yourself (Kor never edits the proxy). Real output on
a fresh home, key redacted:

![kor install](docs/images/install.png)

Add `--no-systemd` on a host without a systemd user manager. To remove everything
again, run `kor uninstall` (`kor uninstall --purge` also removes Kor's own data);
on a fresh home the pair left no files behind. See
[Update and uninstall](docs/user-guide.md#update-and-uninstall).

## Set up and check

Describe your project in `~/.config/kor/config.yaml`, then run `kor doctor`:

```yaml
repos:
  demo-app:
    path: /tmp/kor-t15/demo-app
    linearTeam: LEE
    defaultBranch: main
    checks:
      - node --test
    toolAllowlist:
      - Read
      - Write
      - Edit
      - "Bash(git status*)"
      - "Bash(git add*)"
      - "Bash(git commit*)"
      - "Bash(node --test*)"
      - "Bash(npm test*)"
defaultRoute: { provider: anthropic, model: claude-haiku-5-5, accountPolicy: fill-first, sessionAffinity: true, reasoningLevel: medium }
```

(Trimmed from the real file; the user guide has the whole thing and explains each
field.) `checks` decide whether a result is accepted. `toolAllowlist` is everything
a session may do; one denied tool fails the attempt, so list the commands your
project's tests use.

![kor doctor](docs/images/doctor.png)

```text
$ kor doctor
PASS Kor config: /tmp/kor-t15/home/.config/kor/config.yaml
PASS Linear key: available
PASS TypeSafe key: available
PASS CLIProxyAPI with Kor key: reachable
FAIL CLIProxyAPI management access: management key missing
FAIL quota-axi: unavailable
PASS Claude Code: 2.1.299 (Claude Code)
FAIL no-mistakes daemon: not running
PASS repo demo-app: /tmp/kor-t15/demo-app (main)
FAIL doctor: one or more checks failed. Hint: fix the reported checks and rerun `kor doctor`
```

Those three `FAIL`s did not stop a run from being verified: the management key and
`quota-axi` only feed the cockpit's account panel, and the `no-mistakes` daemon is
needed for the shipping step. [The guide](docs/user-guide.md#check-your-setup-with-kor-doctor)
says what each line is for.

Next, probe the models you want to use. Kor only routes to a model that passes
streaming, tool calls, thinking and structured output:

![kor models probe and list](docs/images/models.png)

```text
$ kor models probe --model claude-haiku-5-5
MODEL	STREAMING	TOOL_CALLS	THINKING	STRUCTURED_OUTPUT	COST_USD	DURATION_MS
claude-haiku-5-5	pass	pass	pass	pass	0.004153385	6064

$ kor models list
MODEL	FAMILY	CAPABILITIES	COST_USD	DURATION_MS
claude-haiku-5-5	claude	streaming,tool_calls,thinking,structured_output	0.004153385	6064
```

(`claude-sonnet-5-5` failed the thinking check through this gateway, so it is not
routable there. Probe what you intend to use.)

## Run your first issue

Write the Linear issue with an `Acceptance criteria` section:

```markdown
## Outcome

Add a `question(name)` function to `src/greeting.js`.

## Acceptance criteria

- [ ] `question("Ada")` returns `How are you, Ada?`.
- [ ] `greeting.test.js` has a test for `question` and `node --test` passes.
```

Start the daemon (`systemctl --user enable --now kor`, or `kor serve` from the
`kor-code` checkout), then queue the issue from another terminal:

```text
$ kor serve
kor daemon listening on http://127.0.0.1:8327/status
```

![kor run --dry-run](docs/images/dry-run.png)

```text
$ kor run LEE-1117
{
  "schemaVersion": 1,
  "issueId": "LEE-1117",
  "canonicalIssueId": "bfbb1847-7f14-469d-8ef8-4efcbf8e80fd",
  "executionId": "426f3560-10cf-4ad2-86d6-98765f331b39",
  "status": "queued",
  "queued": true
}
```

`kor run LEE-1117 --dry-run` previews the same thing and queues nothing (screenshot
above). Watch the run (the `jq` is only for tidy output):

```sh
kor status --json LEE-1117 | jq -c '{state: .run.state, attempts: .run.attempts}'
kor logs 426f3560-10cf-4ad2-86d6-98765f331b39
```

![polling kor status through to shipping](docs/images/run.png)

```text
$ kor logs 426f3560-10cf-4ad2-86d6-98765f331b39
2026-10-14T18:06:09.952Z execution started
2026-10-14T18:06:37.756Z execution blocked: Session failed: 1 permission denial
2026-10-14T18:10:24.075Z execution started
2026-10-14T18:10:39.371Z execution shipping
2026-10-14T18:11:21.807Z shipping blocked: git failed (2): error: No such remote 'origin'
```

This is a real, unedited log, and it shows two things you will meet. The first
attempt was blocked by a **permission denial**: the session used a tool that was not
on the allowlist (re-running the same prompt by hand showed it was `npm test`). After adding `"Bash(npm test*)"` and restarting
`kor serve`, `kor retry LEE-1117` ran it again; the checks and both acceptance
criteria passed, and the execution moved on to **shipping**. There it stopped,
because the demo project has no GitHub `origin`. The verified change is waiting in
the worktree:

```text
$ git -C ~/.local/share/kor/worktrees/426f3560-10cf-4ad2-86d6-98765f331b39 diff
diff --git a/src/greeting.js b/src/greeting.js
index a106507..9327ef1 100644
--- a/src/greeting.js
+++ b/src/greeting.js
@@ -1,3 +1,7 @@
 export function greet(name) {
   return `Hello, ${name}!`;
 }
+
+export function question(name) {
+  return `How are you, ${name}?`;
+}
```

(`greeting.test.js` changed too; the guide has the whole diff.) With a GitHub
`origin`, `gh-axi` and a running `no-mistakes` daemon, shipping continues: Kor
commits the verified files on `kor/LEE-1117`, runs your repository's gate, opens
the pull request, and moves the issue to In Review.

## The cockpit

Type `/kor` in Claude Code to see the daemon's state: the execution and its stage,
the route, the current issue, and the stream of Jev decisions. Every row is labelled
`[LIVE]`, `[STALE]` (last known, with its age) or `[UNAVAILABLE]`. Stop the daemon
and the same view shows what it last knew:

![The cockpit with the daemon stopped](docs/images/cockpit-stale.png)

Try it without installing anything, from the `kor-code` checkout with the daemon
running: `pnpm cockpit`. More in [the cockpit guide](docs/user-guide.md#the-cockpit),
including overrides.

## When something stops

Kor's queue is durable. I killed the daemon (`SIGKILL`) in the middle of a run and
started it again; the execution was re-queued automatically (`attempts` went from
1 to 2) and nothing was lost:

```text
$ kor logs 5520bb1e-3b82-4063-8e92-98cdb7fc1fa2
2026-10-14T18:03:44.420Z execution started
2026-10-14T18:03:53.315Z daemon restarted; previous session stopped; re-queued
2026-10-14T18:03:53.338Z execution started
2026-10-14T18:04:20.106Z execution blocked: Session failed: 1 permission denial
```

| You want to | Run |
| --- | --- |
| See every execution | `kor status --json` |
| See one execution | `kor status --json LEE-123` (or its execution ID) |
| Read an execution's timeline | `kor logs EXECUTION-ID` |
| Try a blocked or failed execution again | `kor retry LEE-123` |
| Stop an execution | `kor cancel LEE-123` (this does not move the Linear issue) |
| Check your setup | `kor doctor` |

The [user guide](docs/user-guide.md#recover-from-a-restart-a-crash-or-a-block) walks
through restart, crash and block recovery, and has a
[troubleshooting table](docs/user-guide.md#troubleshooting). Every command failure is
one line, `FAIL <command>: <message>. Hint: <what to do next>`, and `--json` gives
the same as an object; see the [CLI contract](docs/cli-contract.md).

## Documentation

- [User guide](docs/user-guide.md): install, credentials, configuration, Linear
  setup, running, the cockpit, recovery, troubleshooting, uninstall.
- [CLI contract](docs/cli-contract.md): the JSON that `kor run --json` and
  `kor status --json` print, and the error format, for scripts and other tools.
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

Every command, output and screenshot here was produced by running Kor for real in a
throwaway `HOME` (so no real Claude, Codex or agents configuration was touched),
against a small demo project, real Linear issues, a live CLIProxyAPI gateway and
real model calls. Paths such as `/tmp/kor-t15/…` are from that sandbox. The
screenshots are renderings of real terminal and Claude Code sessions captured with
tmux and a browser. What was not run live: the systemd service lifecycle, polling by
the `kor` label, and the GitHub pull-request step; each is marked where it comes up.
