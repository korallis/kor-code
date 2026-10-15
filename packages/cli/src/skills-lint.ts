import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const MAX_NAME_CHARS = 64;
const MAX_DESCRIPTION_CHARS = 1_024;
const MAX_BODY_LINES = 500;
const EARLY_TRIGGER_CHARS = 120;
const VITAL_RULE_LINE = 150;
const REFERENCE_TOC_LINES = 100;
const DEFAULT_BODY_BUDGET = 2_000;
const CHARS_PER_TOKEN = 3.7;
const OVERLAP_KEYWORDS = 3;
const DESCRIPTION_STOP_WORDS = new Set(["a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "when", "whenever", "use", "uses", "writes", "reviews", "creates", "editing", "writing", "reviewing"]);
const TRIGGER = /\buse (?:when|whenever|for)\b/i;
const ROUTING_TEXT = [
  /\bxhigh\b/i,
  /\b(?:claude|gpt|grok|gemini|kimi|o[134])-[a-z0-9][a-z0-9._-]*\b/i,
  /--(?:model|agents|provider|harness|effort|reasoning[-_](?:effort|level))\b/i,
  /\b(?:model|provider|harness|effort|reasoning[ _-](?:level|effort))["']?\s*[:=]/i,
  /\b(?:use|choose|select|prefer|pin|switch to|run with)\s+(?:the\s+)?(?:opus|sonnet|haiku|fable|o[134]\s+model|Claude Code|Codex|Cursor)\b/i,
  /\b(?:on|with|using|via|under)\s+(?:the\s+)?(?:model\s+)?(?:opus|sonnet|haiku|fable|o[134]\s+model|Claude Code|Codex|Cursor)\b/i,
  /\b(?:use|choose|select|prefer|pin|switch to|run with)\s+(?:the\s+)?(?:OpenAI|Anthropic|Google|xAI|Moonshot)\s+(?:model|provider|harness|for|over)\b/i,
  /\b(?:set|pin|switch)\s+(?:the\s+)?(?:model|provider|harness)\s+to\b/i,
  /\b(?:use|choose|select|prefer|pin|set|run with)\s+(?:the\s+)?(?:(?:reasoning[ -])?effort|reasoning[ -]level)\s+(?:to\s+)?(?:none|minimal|low|medium|high|xhigh|max|ultra)\b/i,
  /\b(?:use|choose|select|prefer|pin|set|run with)\s+(?:none|minimal|low|medium|high|xhigh|max|ultra)\s+(?:(?:reasoning[ -])?effort|reasoning[ -]level)\b/i,
];
const ROUTING_KEY = /^(?:model|models|effort|agent|agents|provider|harness|reasoning[-_]?level)$/i;
const PRIVATE_AUTHORING_RULES = new Set(["description-trigger", "description-third-person", "overlap-anti", "reference-toc", "nested-reference", "body-lines"]);
const STAGES = new Set(["plan", "execute", "repair", "review", "ship", "project-setup"]);

export const skillFrontmatterSchema = z.strictObject({
  name: z.string().min(1).max(MAX_NAME_CHARS).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  license: z.string().trim().min(1),
  compatibility: z.string().max(500).optional(),
  "allowed-tools": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const privateSkillMetadataSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("kor.") && typeof entry !== "string") context.addIssue({ code: "custom", path: [key], message: "Kor metadata must be a string" });
  }
}).transform(value => Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")));

const privateFrontmatterSchema = skillFrontmatterSchema.extend({
  license: z.string().optional(), metadata: privateSkillMetadataSchema.optional(),
}).loose();

export interface SkillLintDiagnostic {
  file: string;
  line: number;
  severity: "error" | "warning";
  rule: string;
  message: string;
}

export interface SkillLintReport {
  schemaVersion: 1;
  ok: boolean;
  root: string;
  tokenMethod: "characters/3.7 estimate";
  skills: { name: string; listingTokens: number; bodyTokens: number }[];
  diagnostics: SkillLintDiagnostic[];
}

function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function routingFields(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => routingFields(entry, `${path}.${index}`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(ROUTING_KEY.test(key.split(".").at(-1) ?? key) ? [`${path}${key}`] : []),
    ...routingFields(entry, `${path}${key}.`),
  ]);
}

function localLinks(text: string): string[] {
  const targets = [...text.matchAll(/!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?|`((?:references|scripts|assets)\/[^`]+)`/gm)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? "");
  return [...new Set(targets)].filter(target => target && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target));
}

export async function lintSkills(root: string, options: { private?: boolean } = {}): Promise<SkillLintReport> {
  root = resolve(root);
  const diagnostics: SkillLintDiagnostic[] = [];
  const skills: SkillLintReport["skills"] = [];
  const descriptions: { file: string; keywords: Set<string>; anti: string | undefined }[] = [];
  const add = (file: string, line: number, severity: SkillLintDiagnostic["severity"], rule: string, message: string) => {
    diagnostics.push({ file: relative(root, file) || ".", line, severity, rule, message });
  };

  async function bundleFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) add(file, 1, "error", "symlink", "Public bundles must contain files, not symlinks.");
      else if (entry.isDirectory()) files.push(...await bundleFiles(file));
      else if (entry.isFile()) files.push(file);
    }
    return files;
  }

  function checkText(file: string, text: string, startLine = 1): void {
    let fence: string | undefined;
    let upstreamQuote = false;
    for (const [index, line] of lines(text).entries()) {
      const opening = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening && !fence) {
        fence = opening[1];
        upstreamQuote = /^upstream-quote\s+https:\/\/\S+\s*$/.test(opening[2]?.trim() ?? "");
      } else if (fence && new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
        fence = undefined;
        upstreamQuote = false;
      }
      if (upstreamQuote) continue;
      const number = startLine + index;
      if (ROUTING_TEXT.some(pattern => pattern.test(line))) add(file, number, "error", "no-routing", "Remove routing text; Jev owns the per-task route decision.");
      if (/\b\d{4}-\d{2}-\d{2}\b|\b(?:currently|nowadays|as of|latest version)\b/i.test(line)) add(file, number, "warning", "time-sensitive", "Replace time-sensitive guidance with a stable condition or pinned source.");
      if (/(?:[A-Za-z]:\\|\b[\w.-]+\\[\w.-]+(?:\\[\w.-]+)*)/.test(line)) add(file, number, "error", "forward-slash-paths", "Use forward slashes in paths.");
      if (/\b(?:JEV|jev|play-book|skillset)\b/.test(line)) add(file, number, "warning", "terminology", "Use the canonical terms: Jev, playbook, skill pack.");
    }
    if (upstreamQuote) add(file, lines(text).length, "error", "upstream-quote", "Close the upstream quotation fence.");
  }

  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const directory = resolve(root, entry.name);
    if (entry.isSymbolicLink()) { add(directory, 1, "error", "symlink", "Public skills must not be symlinks."); continue; }
    if (!entry.isDirectory()) continue;
    const files = await bundleFiles(directory);
    const skillFile = resolve(directory, "SKILL.md");
    if (!files.includes(skillFile)) { add(skillFile, 1, "error", "skill-file", "Each skill directory needs SKILL.md."); continue; }
    const source = (await readFile(skillFile, "utf8")).replace(/\r\n/g, "\n");
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
    if (!frontmatter) { add(skillFile, 1, "error", "frontmatter", "Start SKILL.md with YAML frontmatter delimited by ---."); continue; }
    const header = frontmatter[1] ?? "";
    let raw: unknown;
    try { raw = parse(header, { uniqueKeys: true, maxAliasCount: 0 }); }
    catch { add(skillFile, 1, "error", "frontmatter", "Frontmatter must be valid YAML with unique keys and no aliases."); continue; }
    for (const field of routingFields(raw)) add(skillFile, 1, "error", "no-routing-field", `Remove routing field ${field}; Jev owns routing.`);
    checkText(skillFile, header, 2);
    const schema = options.private ? privateFrontmatterSchema : skillFrontmatterSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add(skillFile, 1, "error", "schema", `${issue.path.join(".") || "frontmatter"}: ${issue.message}`);
    }
    const body = source.slice(frontmatter[0].length);
    const bodyStart = lines(frontmatter[0]).length + 1;
    const bodyLines = lines(body);
    if (!body.trim()) add(skillFile, bodyStart, "error", "body-empty", "Provide actionable guidance in the body.");
    if (bodyLines.length > MAX_BODY_LINES) add(skillFile, bodyStart, "error", "body-lines", `Body has ${bodyLines.length} lines; maximum is ${MAX_BODY_LINES}.`);
    for (const [index, line] of bodyLines.entries()) {
      if (index + 1 > VITAL_RULE_LINE && /\b(?:MUST|NEVER|REQUIRED|ALWAYS)\b/.test(line)) add(skillFile, bodyStart + index, "warning", "vital-rule-late", `Put vital rules within the first ${VITAL_RULE_LINE} body lines.`);
    }
    if (parsed.success) {
      const { name, description, metadata = {} } = parsed.data;
      descriptions.push({ file: skillFile, keywords: new Set(description.toLowerCase().match(/[a-z]{3,}/g)?.filter(word => !DESCRIPTION_STOP_WORDS.has(word))), anti: metadata["kor.anti"] });
      if (name !== basename(directory)) add(skillFile, 2, "error", "directory-name", "Skill name must match its directory.");
      if (!TRIGGER.test(description)) add(skillFile, 3, "error", "description-trigger", "Say when to use the skill with 'Use when', 'Use whenever' or 'Use for'.");
      if (!/^[A-Z][a-z]+s\b/.test(description) || /\b(?:I|we|you|your)\b/i.test(description.split(TRIGGER)[0] ?? "")) add(skillFile, 3, "error", "description-third-person", "Start with a third-person action, such as 'Writes' or 'Reviews'.");
      if (!TRIGGER.test(description.slice(0, EARLY_TRIGGER_CHARS))) add(skillFile, 3, "warning", "trigger-late", `Put the use trigger within the first ${EARLY_TRIGGER_CHARS} characters.`);
      const kind = metadata["kor.kind"];
      if (kind !== undefined && !["skill", "standard", "playbook"].includes(kind)) add(skillFile, 1, "error", "metadata", "kor.kind must be skill, standard or playbook.");
      if (metadata["kor.visibility"] !== undefined && !((options.private ? ["public", "local-only"] : ["public"]).includes(metadata["kor.visibility"]))) add(skillFile, 1, "error", "metadata", "Visibility must be public, or local-only in the private tier.");
      if (metadata["kor.stages"]?.split(",").some(stage => !STAGES.has(stage.trim()))) add(skillFile, 1, "error", "metadata", "kor.stages contains an unknown stage.");
      const budget = metadata["kor.budget"] === undefined ? DEFAULT_BODY_BUDGET : Number(metadata["kor.budget"]);
      if (!Number.isInteger(budget) || budget <= 0) add(skillFile, 1, "error", "metadata", "kor.budget must be a positive integer token count.");
      const bodyTokens = tokenEstimate(body);
      if (bodyTokens > budget) add(skillFile, bodyStart, "warning", "body-budget", `Estimated body ${bodyTokens} tokens exceeds budget ${budget}.`);
      skills.push({ name, listingTokens: parsed.data["disable-model-invocation"] ? 0 : tokenEstimate(`${name}: ${description}`), bodyTokens });
    }
    for (const file of files) {
      let text = body;
      if (file !== skillFile) {
        const content = await readFile(file);
        if (content.includes(0)) continue;
        text = content.toString("utf8");
      }
      checkText(file, text, file === skillFile ? bodyStart : 1);
      if (!file.endsWith(".md")) continue;
      if (file !== skillFile && lines(text).length > REFERENCE_TOC_LINES && !/^#{1,6}\s+(?:table of )?contents\b/im.test(text)) add(file, 1, "error", "reference-toc", `References over ${REFERENCE_TOC_LINES} lines need a Contents heading.`);
      for (const target of localLinks(text)) {
        const path = target.split(/[?#]/)[0] ?? "";
        let decoded: string;
        try { decoded = decodeURIComponent(path); }
        catch { add(file, 1, "error", "reference-path", `Invalid reference URL: ${target}`); continue; }
        const destination = resolve(dirname(file), decoded);
        const within = relative(directory, destination);
        if (isAbsolute(decoded) || within === ".." || within.startsWith("../")) add(file, 1, "error", "reference-path", `Reference must stay inside its skill: ${target}`);
        else if (!files.includes(destination)) add(file, 1, "error", "reference-missing", `Reference does not exist: ${target}`);
        if (file !== skillFile && /\.md$/i.test(path)) add(file, 1, "error", "nested-reference", `Link Markdown references directly from SKILL.md: ${target}`);
      }
    }
  }
  for (const [index, skill] of descriptions.entries()) {
    for (const other of descriptions.slice(index + 1)) {
      if ([...skill.keywords].filter(word => other.keywords.has(word)).length < OVERLAP_KEYWORDS) continue;
      for (const candidate of [skill, other]) {
        if (!candidate.anti?.trim()) add(candidate.file, 1, "warning", "overlap-anti", "Descriptions share keywords; consider kor.anti to distinguish their use cases.");
      }
    }
  }
  if (!entries.some(entry => entry.isDirectory())) add(root, 1, "error", "empty-tier", "No skill directories found.");
  const findings = options.private ? diagnostics.filter(item => !PRIVATE_AUTHORING_RULES.has(item.rule)) : diagnostics;
  return { schemaVersion: 1, ok: !findings.some(item => item.severity === "error"), root, tokenMethod: "characters/3.7 estimate", skills, diagnostics: findings };
}

export function formatSkillLint(report: SkillLintReport): string {
  return [
    ...report.diagnostics.map(item => `${item.severity.toUpperCase()} ${item.file}:${item.line} [${item.rule}] ${item.message}`),
    ...report.skills.map(skill => `${skill.name}: listing ${skill.listingTokens}, body ${skill.bodyTokens} tokens (estimated)`),
    `${report.ok ? "PASS" : "FAIL"} skills lint: ${report.skills.length} skills, ${report.diagnostics.filter(item => item.severity === "error").length} errors, ${report.diagnostics.filter(item => item.severity === "warning").length} warnings`,
  ].join("\n");
}
