import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const MAX_INJECTIONS = 2;
const MAX_BODY_CHARACTERS = 5_550;
const root = fileURLToPath(new URL(".", import.meta.url));
const lock = join(root, ".armed-lock");
const stateFile = join(root, "armed-firings.json");

function matchingTrigger(skill, event) {
  const input = event.tool_input;
  for (const trigger of skill.triggers) {
    if (typeof trigger !== "string") continue;
    if (trigger === `tool:${event.tool_name}`) return trigger;
    if (trigger.startsWith("command:") && event.tool_name === "Bash" && typeof input.command === "string") {
      const prefix = trigger.slice("command:".length).trim();
      const command = input.command.trimStart();
      if (prefix && (command === prefix || command.startsWith(`${prefix} `))) return trigger;
    }
    if (trigger.startsWith("file:") && ["Read", "Write", "Edit", "Glob", "Grep"].includes(event.tool_name)) {
      const path = input.file_path ?? input.path;
      if (typeof path !== "string") continue;
      const local = relative(event.cwd, resolve(event.cwd, path));
      if (isAbsolute(local) || local === ".." || local.startsWith("../")) continue;
      const pattern = trigger.slice("file:".length);
      if (pattern && matchesGlob(local, pattern)) return trigger;
    }
  }
}

async function run() {
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  const event = JSON.parse(source);
  if (event.hook_event_name !== "PostToolUse" || typeof event.tool_name !== "string" ||
      typeof event.tool_use_id !== "string" || typeof event.cwd !== "string" ||
      !event.tool_input || typeof event.tool_input !== "object" || Array.isArray(event.tool_input)) return;
  const plan = JSON.parse(await readFile(join(root, "armed.json"), "utf8"));
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.skills)) throw new Error("Invalid armed skill plan");
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) { if (error.code !== "EEXIST") throw error; await setTimeout(20); }
  }
  if (!acquired) throw new Error("Armed skill state is locked");
  try {
    const firings = JSON.parse(await readFile(stateFile, "utf8"));
    if (!Array.isArray(firings)) throw new Error("Invalid armed skill firings");
    if (firings.length >= MAX_INJECTIONS) return;
    for (const skill of plan.skills) {
      if (firings.some(firing => firing.name === skill.name)) continue;
      const trigger = matchingTrigger(skill, event);
      if (!trigger) continue;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || typeof skill.body !== "string" ||
          skill.body.length > MAX_BODY_CHARACTERS || createHash("sha256").update(skill.body).digest("hex") !== skill.bodyHash) {
        throw new Error("Armed skill snapshot is invalid");
      }
      const firing = { kind: "skill", source: "armed", name: skill.name, hash: skill.hash,
        trigger, toolUseId: event.tool_use_id, firedAt: new Date().toISOString(), status: "succeeded" };
      firings.push(firing);
      const temporary = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(firings, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, stateFile);
      const additionalContext = `Project convention from the Kor skill '${skill.name}', selected for this task and activated by a matching tool event.\nSource directory: ${skill.path}\n\n${skill.body}`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }));
      return;
    }
  } finally { await rm(lock, { recursive: true }); }
}

run().catch(() => { process.stderr.write("Kor armed skill hook could not load guidance.\n"); process.exitCode = 1; });
