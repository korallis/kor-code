import { hasScreenshot, HttpLinearClient } from "@kor-code/linear";
import { issueReadinessChecks } from "@kor-code/jev";

export const linearLintUsage = "kor linear lint ISSUE-ID [--json] | kor linear lint --project PROJECT-ID [--json]";

export async function runLinearLint(reference: string, project: boolean, json: boolean): Promise<number> {
  const client = new HttpLinearClient();
  const issues = project ? await client.listProjectIssues(reference) : [await client.getIssue(reference)];
  const results = issues.map(issue => {
    const screenshot = hasScreenshot(issue);
    const checks = issueReadinessChecks({ ...issue, hasScreenshot: screenshot, dependencies: issue.dependencies.map(dependency => ({ id: dependency.id, state: dependency.stateType })) });
    const ready = checks.every(check => check.result === "pass");
    return { issueId: issue.identifier ?? issue.id, status: ready ? "ready" : "blocked", hasScreenshot: screenshot, checks };
  });
  const ready = results.every(result => result.status === "ready");
  if (json) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ready, issues: results })}\n`);
  else {
    for (const result of results) {
      process.stdout.write(`${result.issueId}: ${result.status}; hasScreenshot=${result.hasScreenshot}\n`);
      for (const check of result.checks.filter(check => check.result !== "pass")) process.stdout.write(`  ${check.name}: ${check.reason}\n`);
    }
    if (results.length === 0) process.stdout.write("No issues in this project.\n");
  }
  return ready ? 0 : 1;
}
