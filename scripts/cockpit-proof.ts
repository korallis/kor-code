// Phase 6 completion check: runs the fixture execution and every cockpit view
// through the sandboxed Claude Code (scripts/sandbox.sh) and checks that the
// execution is visible end to end and that every non-live value is labelled.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const timeout = Number(process.env.KOR_SANDBOX_TIMEOUT_MS ?? 120_000);
const VIEWS = ["cockpit", "issue", "project", "decisions", "decision dec_fx_route", "agents", "agent frontend", "accounts", "context", "linear", "overrides"];
const TAGS = /^\s{2}\[(FIXTURE|LIVE|STALE|UNAVAILABLE)\]/;
const failures: string[] = [];

async function cockpit(prompt: string): Promise<string> {
  const result = await execFileAsync("bash", [join(repoRoot, "scripts", "sandbox.sh"), prompt], { cwd: repoRoot, timeout, maxBuffer: 4_000_000 });
  return result.stdout;
}

/** Every row of a view is indented two spaces and leads with its provenance label; only session facts may be LIVE. */
function checkRows(name: string, text: string): { rows: number; live: number } {
  let rows = 0;
  let live = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("  ") || line.startsWith("   ")) continue;
    rows += 1;
    const match = TAGS.exec(line);
    if (!match) failures.push(`${name}: unlabelled row: ${line.trim()}`);
    if (match?.[1] === "LIVE") {
      live += 1;
      if (!line.includes("Claude Code")) failures.push(`${name}: LIVE label on a value this session does not report: ${line.trim()}`);
    }
  }
  if (rows === 0) failures.push(`${name}: no rows drawn`);
  return { rows, live };
}

const replay = await cockpit("/kor replay");
const frames = replay.split("\n").filter((line) => line.includes("status line:"));
console.log(`replay: ${frames.length} frames`);
for (const frame of frames) {
  console.log(`  ${frame.trim().replace("status line: ", "")}`);
  if (!frame.includes("[FIXTURE]")) failures.push(`replay frame without a FIXTURE label: ${frame.trim()}`);
}
const stages = ["discover", "preflight", "context", "execute", "supervise", "verify", "synchronise"];
for (const stage of stages) if (!frames.some((frame) => frame.includes(` ${stage} `))) failures.push(`replay never reached ${stage}`);
if (!frames.at(-1)?.includes("complete")) failures.push("replay did not end complete");
checkRows("replay final cockpit", replay.slice(replay.indexOf("JEV CODE cockpit")));

for (const view of VIEWS) {
  const { rows, live } = checkRows(view, await cockpit(`/kor ${view}`));
  console.log(`view ${view}: ${rows} rows labelled, ${live} live`);
}

if (failures.length) {
  console.log(`\ncockpit proof: FAILED\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`\ncockpit proof: Validated — fixture execution visible through ${stages.length} stages in ${frames.length} frames; every row in ${VIEWS.length} views carries a provenance label; LIVE only on session facts`);
