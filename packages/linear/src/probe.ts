import { createHmac } from 'node:crypto';
import { AgentSessionWriter, DurableQueue, ExecutionLease, SnapshotReader, WebhookReceiver } from './runtime.js';
import { FakeLinearClient, fakeIssue } from './fake.js';
import { LinearStore } from './store.js';
import { probeLinearReadOnly } from './client.js';

if (process.argv.includes('--live')) {
  const result = await probeLinearReadOnly();
  console.log(JSON.stringify({ viewerCount: result.viewer === '1' ? 1 : 0, teamCount: result.teams.length, workflowStateCount: result.workflowStates.length, issueCount: result.issueCount }));
  process.exit(0);
}
const issue = fakeIssue(); const client = new FakeLinearClient([issue]);
const store = new LinearStore(':memory:'); const queue = new DurableQueue(store); const webhook = new WebhookReceiver({ secret: 'fixture-secret', store });
const event = JSON.stringify({ id: 'event-1', type: 'Issue', action: 'update', data: { id: issue.id } }); const signature = createHmac('sha256', 'fixture-secret').update(event).digest('hex');
const first = webhook.receive(event, signature); const duplicate = webhook.receive(event, signature); if (!first.accepted || duplicate.accepted) throw new Error('webhook deduplication failed');
const lease = new ExecutionLease(store); const claim = lease.claim('fixture-worker'); if (!claim) throw new Error('queue did not lease');
const execution = { id: claim.assignment.executionId, issueId: issue.id, repository: 'fixture', worktree: '/tmp/fixture', branch: 'fixture', status: 'running' as const };
const writer = new AgentSessionWriter(store, client, { queued: 'queued', running: 'running', complete: 'complete' }); writer.start(claim, execution); await writer.flush();
const running = await new SnapshotReader(client).read(issue.id); if (running.issue.stateType !== 'running') throw new Error('running state was not flushed');
writer.complete(claim, { summary: 'fixture completed', evidence: [{ id: 'probe', kind: 'test', summary: 'lifecycle probe passed', status: 'pass' }] }); await writer.flush();
const snapshot = await new SnapshotReader(client).read(issue.id); if (snapshot.issue.stateType !== 'complete' || store.counts().executions !== 1) throw new Error('lifecycle did not complete');
console.log(`Linear fake lifecycle: queued -> running -> complete; execution=1; duplicateWebhook=ignored; snapshot=${snapshot.snapshotId.slice(0, 12)}`); store.close();
