import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AcceptanceFinding, Execution } from '@kor-code/core';
import { stableId, type Completion, type LinearClient, type LinearIssue, type LinearWrite, type WorkflowMapping } from './contract.js';
import { LinearStore, sessionRecord, type ExecutionClaim } from './store.js';

export class SnapshotReader {
  constructor(private readonly client: LinearClient) {}
  async read(issueId: string): Promise<{ snapshotId: string; observedAt: string; issue: LinearIssue }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const issue = await this.client.getIssue(issueId);
      const snapshotId = this.digest(issue);
      if (snapshotId === this.digest(await this.client.getIssue(issueId))) return { snapshotId, observedAt: new Date().toISOString(), issue };
    }
    throw new Error('Linear snapshot changed during discovery; retry reconciliation');
  }
  private digest(issue: LinearIssue): string { return createHash('sha256').update(JSON.stringify(issue)).digest('hex'); }
}

export class DurableQueue {
  constructor(readonly store: LinearStore) {}
  enqueue(issueId: string) { return this.store.enqueue(issueId); }
}
export class ExecutionLease {
  constructor(private readonly store: LinearStore) {}
  claim(owner: string, ttlMs?: number, issueId?: string) { return this.store.claim(owner, ttlMs, issueId); }
  renew(claim: ExecutionClaim, ttlMs?: number): void { this.store.renew(claim, ttlMs); }
  release(claim: ExecutionClaim, delayMs?: number): void { this.store.release(claim, delayMs); }
  reclaimExpired(issueId: string): boolean { return this.store.reclaimExpired(issueId); }
}

// No policy decisions or execution launcher here: Phase 2 supplies the manifest
// and Phase 3 authorizes dispatch. This boundary records only explicit changes.
export class AgentSessionWriter {
  constructor(private readonly store: LinearStore, private readonly client: LinearClient, private readonly states: WorkflowMapping) {}

  start(claim: ExecutionClaim, manifest: Execution): void {
    const assignment = claim.assignment;
    if (manifest.id !== assignment.executionId || manifest.issueId !== assignment.issueId || manifest.status !== 'running') throw new Error('Manifest does not match the claimed execution');
    this.store.transition(claim, 'running', startWrites(assignment, this.states, this.client), manifest);
  }

  complete(claim: ExecutionClaim, completion: Completion): void {
    if (!completion.summary.trim() || completion.evidence.length === 0 || completion.evidence.some(evidence => evidence.status !== 'pass')) throw new Error('Completion requires passing evidence and a summary');
    const assignment = claim.assignment;
    const body = [completion.summary, ...completion.evidence.map(evidence => `${evidence.kind}: ${evidence.summary}${evidence.source ? ` (${evidence.source})` : ''}`), completion.pullRequestUrl ?? ''].filter(Boolean).join('\n');
    const writes: LinearWrite[] = [
      { kind: 'comment', id: stableId('kor-progress', `${assignment.executionId}:complete`), issueId: assignment.issueId, body },
      { kind: 'state', issueId: assignment.issueId, stateId: completion.pullRequestUrl && this.states.review ? this.states.review.id : this.states.complete.id },
    ];
    if (completion.pullRequestUrl) writes.push({ kind: 'attachment', issueId: assignment.issueId, url: completion.pullRequestUrl, title: 'GitHub pull request' });
    if (this.client.capabilities?.agentSessions) {
      writes.unshift(
        { kind: 'summary', sessionId: assignment.sessionId, summary: body },
        { kind: 'activity', id: stableId('kor-activity', `${assignment.executionId}:complete`), sessionId: assignment.sessionId, activity: 'response', body },
      );
    }
    this.store.transition(claim, 'complete', writes);
  }

  cancel(claim: ExecutionClaim, reason = 'Execution canceled by operator'): void {
    const state = this.states.queued;
    this.store.record(claim, [
      { kind: 'comment', id: stableId('kor-progress', `${claim.assignment.executionId}:cancel`), issueId: claim.assignment.issueId, body: `Kor canceled execution ${claim.assignment.executionId}: ${reason}` },
      { kind: 'state', issueId: claim.assignment.issueId, stateId: state.id },
    ]);
    this.store.release(claim);
  }

  recordVerificationBlock(claim: ExecutionClaim, execution: Execution, findings: readonly AcceptanceFinding[], blockers: readonly string[] = []): void {
    const body = [`Execution ${execution.id} blocked: acceptance evidence is incomplete`, ...(blockers.length > 0 ? ['Blockers:', ...blockers.map(blocker => `- ${blocker}`)] : []), ...findings.map(finding => `${finding.conditionId}: ${finding.status}${finding.evidenceIds.length > 0 ? ` (${finding.evidenceIds.join(', ')})` : ''}${finding.note ? ` — ${finding.note}` : ''}`)].join('\n');
    const writes: LinearWrite[] = [{ kind: 'comment', id: stableId('kor-progress', `${claim.assignment.executionId}:blocked:${body}`), issueId: claim.assignment.issueId, body }];
    if (this.client.capabilities?.agentSessions) writes.unshift(
      { kind: 'summary', sessionId: claim.assignment.sessionId, summary: body },
      { kind: 'activity', id: stableId('kor-activity', `${claim.assignment.executionId}:blocked:${body}`), sessionId: claim.assignment.sessionId, activity: 'error', body },
    );
    this.store.record(claim, writes, execution);
  }

  async flush(maximum = 100): Promise<number> {
    return flushLinearWrites(this.store, this.client, maximum);
  }
}

/** Flush already-authorized outbox writes even when no execution is running. */
export async function flushLinearWrites(store: LinearStore, client: LinearClient, maximum = 100): Promise<number> {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Write batch limit must be positive');
    const token = store.claimWriter();
    if (!token) return 0;
    let count = 0;
    let sequence = 0;
    let failure: unknown;
    const blocked = new Set<string>();
    const issues = new Map(store.listAssignments().map(assignment => [assignment.sessionId, assignment.issueId]));
    try {
      const lastSequence = store.lastWriteSequence(token);
      while (count < maximum) {
        const pending = store.nextWrite(token, sequence);
        if (!pending || pending.sequence > lastSequence) break;
        sequence = pending.sequence;
        const write = pending.write;
        const issue = write.kind === 'session' ? write.session.issueId : 'issueId' in write ? write.issueId : issues.get(write.sessionId) ?? write.sessionId;
        if (blocked.has(issue)) continue;
        try {
          await client.apply(write);
          store.acknowledgeWrite(token, pending.sequence);
          count++;
        } catch (error) { blocked.add(issue); failure ??= error; }
      }
      if (blocked.size) throw failure;
      return count;
    } finally { store.releaseWriter(token); }
}

export function startWrites(assignment: ExecutionClaim['assignment'], states: WorkflowMapping, client?: LinearClient): LinearWrite[] {
  const writes: LinearWrite[] = [
    { kind: 'state', issueId: assignment.issueId, stateId: states.running.id },
    { kind: 'comment', id: stableId('kor-progress', `${assignment.executionId}:start`), issueId: assignment.issueId, body: `Kor started execution ${assignment.executionId}; state → ${states.running.name ?? 'In Progress'}` },
  ];
  if (client?.capabilities?.agentSessions) writes.push(
    { kind: 'session', session: sessionRecord(assignment) },
    { kind: 'summary', sessionId: assignment.sessionId, summary: `Execution ${assignment.executionId} running` },
    { kind: 'activity', id: stableId('kor-activity', `${assignment.executionId}:start`), sessionId: assignment.sessionId, activity: 'thought', body: `Execution ${assignment.executionId} started` },
  );
  return writes;
}

export interface WebhookReceiverOptions { secret: string; store: LinearStore; now?: () => number }
export class WebhookError extends Error { constructor(readonly status: 400 | 401 | 409, message: string) { super(message); } }
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean { const expected = createHmac('sha256', secret).update(rawBody).digest('hex'); const provided = signature.replace(/^sha256=/, ''); const expectedBytes = Buffer.from(expected); const providedBytes = Buffer.from(provided); return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes); }
function timestampMs(value: unknown): number {
  const timestamp = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? (Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)) : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new WebhookError(400, 'invalid webhook timestamp');
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}
export class WebhookReceiver {
  constructor(private readonly options: WebhookReceiverOptions) {}
  receive(rawBody: string, signature: string, deliveryId?: string): { accepted: boolean } {
    if (!verifyWebhookSignature(rawBody, signature, this.options.secret)) throw new WebhookError(401, 'invalid webhook signature');
    let value: unknown;
    try { value = JSON.parse(rawBody); } catch { throw new WebhookError(400, 'invalid webhook payload'); }
    if (typeof value !== 'object' || value === null) throw new WebhookError(400, 'invalid webhook payload');
    const event = value as { id?: unknown; type?: unknown; action?: unknown; data?: unknown; webhookTimestamp?: unknown };
    if (typeof event.type !== 'string' || typeof event.action !== 'string') throw new WebhookError(400, 'invalid webhook event');
    const eventId = deliveryId ?? (typeof event.id === 'string' ? event.id : undefined);
    if (!eventId) throw new WebhookError(400, 'missing Linear-Delivery header');
    const age = Math.abs((this.options.now ?? Date.now)() - timestampMs(event.webhookTimestamp));
    if (age > 60_000) throw new WebhookError(400, 'stale webhook timestamp');
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {};
    const issueId = event.type === 'Issue' && typeof data.id === 'string' ? data.id : event.type === 'Comment' && typeof data.issueId === 'string' ? data.issueId : undefined;
    const digest = createHash('sha256').update(rawBody).digest('hex');
    try { return { accepted: this.options.store.acceptEvent({ id: eventId, digest, ...(issueId ? { issueId } : {}) }) === 'accepted' }; }
    catch (error) {
      if (error instanceof Error && error.message === 'Webhook delivery ID conflicts with its stored payload') throw new WebhookError(409, 'webhook delivery conflicts with a previous payload');
      throw error;
    }
  }
}

export interface WebhookServerOptions extends WebhookReceiverOptions {
  port: number;
  host?: string;
  maxBodyBytes?: number;
}

/** Bind only the caller-selected Kor port; 8317 belongs to CLIProxyAPI. */
export async function startWebhookServer(options: WebhookServerOptions): Promise<Server> {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535 || options.port === 8317) throw new Error('Webhook port must be a valid non-8317 port');
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('Webhook body limit must be positive');
  const receiver = new WebhookReceiver(options);
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/webhooks/linear') { response.writeHead(404).end(); return; }
    const signature = request.headers['linear-signature'];
    const deliveryId = request.headers['linear-delivery'];
    if (typeof signature !== 'string') { response.writeHead(401).end(); request.resume(); return; }
    if (typeof deliveryId !== 'string') { response.writeHead(400).end(); request.resume(); return; }
    const chunks: Buffer[] = []; let size = 0; let rejected = false;
    request.on('data', (chunk: Buffer) => { size += chunk.byteLength; if (size > maxBodyBytes) rejected = true; else chunks.push(chunk); });
    request.on('error', () => { if (!response.headersSent) response.writeHead(400).end(); });
    request.on('end', async () => {
      if (rejected) { if (!response.headersSent) response.writeHead(413).end(); return; }
      try { receiver.receive(Buffer.concat(chunks).toString('utf8'), signature, deliveryId); response.writeHead(200).end(); }
      catch (error) { const status = error instanceof WebhookError ? error.status : 400; if (!response.headersSent) response.writeHead(status).end(); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return server;
}
