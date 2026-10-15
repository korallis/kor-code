#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const auditPath = join("docs", "claim-audit.md");
const claimPattern = /CLM-[0-9]+/g;

async function documentPaths(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await documentPaths(path));
    else if (entry.isFile() && entry.name.endsWith(".md") && path !== auditPath) paths.push(path);
  }
  return paths;
}

const paths = ["README.md", ...await documentPaths("docs")];
const documents = await Promise.all(paths.map(path => readFile(path, "utf8")));
const documentIds = new Set(documents.flatMap(text => text.match(claimPattern) ?? []));
const audit = await readFile(auditPath, "utf8");
const retainedIds = new Set();
const removedIds = new Set();
for (const line of audit.split("\n")) {
  const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
  const id = cells[0]?.replace(/[`*]/g, "");
  if (!id || !/^CLM-[0-9]+$/.test(id)) continue;
  if (/^removed(?:[^a-z]|$)/i.test(cells.at(-1))) removedIds.add(id);
  else retainedIds.add(id);
}

const withoutRow = [...documentIds].filter(id => !retainedIds.has(id));
const withoutDocument = [...retainedIds].filter(id => !documentIds.has(id));
const removedStillPresent = [...removedIds].filter(id => documentIds.has(id));
const ok = documentIds.size > 0 && retainedIds.size > 0
  && withoutRow.length === 0 && withoutDocument.length === 0 && removedStillPresent.length === 0;
console.log(JSON.stringify({ ok, documentIds: documentIds.size, retainedRows: retainedIds.size,
  withoutRow, withoutDocument, removedStillPresent }, null, 2));
process.exitCode = ok ? 0 : 1;
