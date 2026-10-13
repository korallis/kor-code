import { createHmac } from 'node:crypto';
import { AgentSessionWriter, ExecutionLease, SnapshotReader, startWebhookServer } from './runtime.js';
import { FakeLinearClient } from './fake.js';
import { fixtureFetcher, linearIssueFixture, workflowMappingFixture } from './fixture.js';
import { LinearStore } from './store.js';
import { HttpLinearClient, probeLinearReadOnly } from './client.js';

if (process.argv.includes('--live')) {
  const result = await probeLinearReadOnly();
  console.log(JSON.stringify({ viewerCount: result.viewer === '1' ? 1 : 0, teamCount: result.teams.length, workflowStateCount: result.workflowStates.length, issueCount: result.issueCount }));
  process.exit(0);
}
const issue = structuredClone(linearIssueFixture);
const client = new FakeLinearClient([issue]);
const store = new LinearStore(':memory:');
const server = await startWebhookServer({ secret: 'fixture-secret', store, port: 0, maxBodyBytes: 8_192 });
const address = server.address();
if (!address || typeof address === 'string') throw new Error('webhook server did not expose a TCP address');
const event = JSON.stringify({ action: 'update', type: 'Issue', actor: { id: 'actor-1' }, createdAt: new Date().toISOString(), data: { id: issue.id, identifier: 'LEE-1' }, url: 'https://linear.app/acme/issue/LEE-1', updatedFrom: {}, webhookTimestamp: Date.now(), webhookId: 'webhook-1', organizationId: 'org-1' });
const signature = createHmac('sha256', 'fixture-secret').update(event).digest('hex');
const endpoint = `http://127.0.0.1:${address.port}/webhooks/linear`;
const headers = { 'content-type': 'application/json', 'linear-signature': signature, 'linear-delivery': 'delivery-1' };
const first = await fetch(endpoint, { method: 'POST', headers, body: event });
const duplicate = await fetch(endpoint, { method: 'POST', headers, body: event });
if (first.status !== 200 || duplicate.status !== 200 || store.counts().events !== 1) throw new Error(`Linear webhook contract failed: ${first.status}/${duplicate.status}`);
await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
const lease = new ExecutionLease(store); const claim = lease.claim('fixture-worker'); if (!claim) throw new Error('queue did not lease');
const execution = { id: claim.assignment.executionId, issueId: issue.id, repository: 'fixture', worktree: '/tmp/fixture', branch: 'fixture', status: 'running' as const };
const writer = new AgentSessionWriter(store, client, workflowMappingFixture); writer.start(claim, execution); await writer.flush();
const running = await new SnapshotReader(client).read(issue.id); if (running.issue.stateId !== workflowMappingFixture.running.id || running.issue.stateType !== workflowMappingFixture.running.type) throw new Error('running state was not flushed');
writer.complete(claim, { summary: 'fixture completed', evidence: [{ id: 'probe', kind: 'test', summary: 'lifecycle probe passed', status: 'pass' }] }); await writer.flush();
const snapshot = await new SnapshotReader(client).read(issue.id); if (snapshot.issue.stateId !== workflowMappingFixture.complete.id || snapshot.issue.stateType !== workflowMappingFixture.complete.type || store.counts().executions !== 1) throw new Error('lifecycle did not complete');
const httpFixture = new HttpLinearClient({ apiKey: 'fixture', fetcher: fixtureFetcher() }); const conformanceIssue = await httpFixture.getIssue(issue.id); if (conformanceIssue.teamId !== issue.teamId || conformanceIssue.teamKey !== issue.teamKey) throw new Error('fixture adapter contract failed');
console.log(`Linear fake lifecycle: Linear webhook 200/200; queued -> running -> complete; execution=1; duplicateWebhook=ignored; snapshot=${snapshot.snapshotId.slice(0, 12)}`); store.close();
