import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Execution } from '@kor-code/core';
import { object, string, type AgentSessionRecord, type LinearWrite } from './contract.js';

export interface Assignment {
  executionId: string;
  issueId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'complete';
}
export interface ExecutionClaim { assignment: Assignment; token: string; owner: string; expiresAt: number }
export interface PendingWrite { sequence: number; write: LinearWrite }
export interface AssignmentRecord extends Assignment { manifest?: Execution; owner?: string; expiresAt?: number }

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid durable numeric value');
  return value;
}
function parseAssignment(value: unknown): Assignment {
  const row = object(value);
  const status = string(row.status);
  if (status !== 'queued' && status !== 'running' && status !== 'complete') throw new Error('Invalid assignment status');
  return { issueId: string(row.issue_id), executionId: string(row.execution_id), sessionId: string(row.session_id), status };
}
function parseWrite(value: unknown): LinearWrite {
  const write = object(value);
  switch (write.kind) {
    case 'session': {
      const session = object(write.session);
      return { kind: 'session', session: { id: string(session.id), executionId: string(session.executionId), issueId: string(session.issueId) } };
    }
    case 'state': return { kind: 'state', issueId: string(write.issueId), stateId: string(write.stateId) };
    case 'summary': return { kind: 'summary', sessionId: string(write.sessionId), summary: string(write.summary) };
    case 'comment': return { kind: 'comment', id: string(write.id), issueId: string(write.issueId), body: string(write.body) };
    case 'activity': {
      const activity = string(write.activity);
      if (activity !== 'thought' && activity !== 'response' && activity !== 'error') throw new Error('Invalid activity type');
      return { kind: 'activity', id: string(write.id), sessionId: string(write.sessionId), body: string(write.body), activity };
    }
    default: throw new Error('Invalid durable write');
  }
}

// SQLite WAL + BEGIN IMMEDIATE serialize independent processes, not just callers
// sharing this instance. Events, assignments and pending writes commit together.
export class LinearStore {
  private readonly db: DatabaseSync;
  constructor(file: string, private readonly now: () => number = Date.now) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, digest TEXT NOT NULL, issue_id TEXT, received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assignments (
        issue_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('queued','running','complete')), manifest TEXT,
        token TEXT, owner TEXT, expires_at INTEGER, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, expires_at INTEGER);
      INSERT OR IGNORE INTO writer(id) VALUES (1);`);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.close(); }

  acceptEvent(event: { id: string; digest: string; issueId?: string }): 'accepted' | 'duplicate' {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT digest FROM events WHERE id=?').get(event.id);
      if (previous) {
        if (previous.digest !== event.digest) throw new Error('Webhook delivery ID conflicts with its stored payload');
        return 'duplicate';
      }
      this.db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(event.id, event.digest, event.issueId ?? null, this.now());
      if (event.issueId) this.enqueueInTransaction(event.issueId);
      return 'accepted';
    });
  }

  enqueue(issueId: string): Assignment { return this.transaction(() => this.enqueueInTransaction(issueId)); }
  private enqueueInTransaction(issueId: string): Assignment {
    this.db.prepare(`INSERT OR IGNORE INTO assignments(issue_id,execution_id,session_id,status,available_at) VALUES(?,?,?,'queued',?)`).run(issueId, randomUUID(), randomUUID(), this.now());
    return this.getAssignment(issueId);
  }
  getAssignment(issueId: string): Assignment {
    return parseAssignment(this.db.prepare('SELECT * FROM assignments WHERE issue_id=?').get(issueId));
  }
  listAssignments(): AssignmentRecord[] {
    return (this.db.prepare('SELECT * FROM assignments ORDER BY rowid').all() as unknown[]).map(row => {
      const parsed = parseAssignment(row);
      const value = row as Record<string, unknown>;
      const manifest = typeof value.manifest === 'string' ? JSON.parse(value.manifest) as Execution : undefined;
      const owner = typeof value.owner === 'string' ? value.owner : undefined;
      const expiresAt = typeof value.expires_at === 'number' ? value.expires_at : undefined;
      return { ...parsed, ...(manifest ? { manifest } : {}), ...(owner ? { owner } : {}), ...(expiresAt ? { expiresAt } : {}) };
    });
  }
  counts(): { events: number; executions: number; pendingWrites: number } {
    return {
      events: number(this.db.prepare('SELECT count(*) AS count FROM events').get()?.count),
      executions: number(this.db.prepare('SELECT count(*) AS count FROM assignments').get()?.count),
      pendingWrites: number(this.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count),
    };
  }

  claim(owner: string, ttlMs = 60_000, issueId?: string): ExecutionClaim | undefined {
    this.validateTTL(ttlMs);
    return this.transaction(() => {
      const row = issueId
        ? this.db.prepare(`SELECT * FROM assignments WHERE issue_id=? AND status != 'complete' AND available_at <= ? AND (token IS NULL OR expires_at <= ?)`).get(issueId, this.now(), this.now())
        : this.db.prepare(`SELECT * FROM assignments WHERE status != 'complete' AND available_at <= ? AND (token IS NULL OR expires_at <= ?) ORDER BY available_at, rowid LIMIT 1`).get(this.now(), this.now());
      if (!row) return undefined;
      const assignment = parseAssignment(row);
      const token = randomUUID();
      const expiresAt = this.now() + ttlMs;
      this.db.prepare('UPDATE assignments SET token=?,owner=?,expires_at=?,attempts=attempts+1 WHERE issue_id=?').run(token, owner, expiresAt, assignment.issueId);
      return { assignment, token, owner, expiresAt };
    });
  }
  private validateTTL(ttlMs: number): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Lease TTL must be positive');
  }
  private assertLease(claim: ExecutionClaim): void {
    const row = this.db.prepare('SELECT token, expires_at FROM assignments WHERE issue_id=?').get(claim.assignment.issueId);
    if (!row || row.token !== claim.token || number(row.expires_at) <= this.now()) throw new Error('Execution lease absent, expired or superseded');
  }
  renew(claim: ExecutionClaim, ttlMs = 60_000): void {
    this.validateTTL(ttlMs);
    this.transaction(() => { this.assertLease(claim); this.db.prepare('UPDATE assignments SET expires_at=? WHERE issue_id=?').run(this.now() + ttlMs, claim.assignment.issueId); });
  }
  release(claim: ExecutionClaim, delayMs = 0): void {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('Queue delay must be nonnegative');
    this.transaction(() => {
      this.assertLease(claim);
      this.db.prepare('UPDATE assignments SET token=NULL,owner=NULL,expires_at=NULL,available_at=? WHERE issue_id=?').run(this.now() + delayMs, claim.assignment.issueId);
    });
  }
  reclaimExpired(issueId: string): boolean {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT expires_at FROM assignments WHERE issue_id=? AND token IS NOT NULL').get(issueId) as { expires_at?: unknown } | undefined;
      if (!row || typeof row.expires_at !== 'number' || row.expires_at > this.now()) return false;
      const result = this.db.prepare('UPDATE assignments SET token=NULL,owner=NULL,expires_at=NULL,available_at=? WHERE issue_id=? AND expires_at<=?').run(this.now(), issueId, this.now());
      return result.changes === 1;
    });
  }
  transition(claim: ExecutionClaim, status: 'running' | 'complete', writes: LinearWrite[], manifest?: Execution): void {
    this.transaction(() => {
      this.assertLease(claim);
      const previous = this.getAssignment(claim.assignment.issueId);
      if (previous.status === status) return;
      if (previous.status === 'complete' || (status === 'complete' && previous.status !== 'running')) throw new Error('Invalid execution transition');
      this.db.prepare('UPDATE assignments SET status=?,manifest=COALESCE(?,manifest) WHERE issue_id=?').run(status, manifest ? JSON.stringify(manifest) : null, previous.issueId);
      for (const write of writes) this.db.prepare('INSERT INTO outbox(payload) VALUES(?)').run(JSON.stringify(write));
      if (status === 'complete') this.db.prepare('UPDATE assignments SET token=NULL,owner=NULL,expires_at=NULL WHERE issue_id=?').run(previous.issueId);
    });
  }

  claimWriter(ttlMs = 120_000): string | undefined {
    return this.transaction(() => {
      const token = randomUUID();
      const result = this.db.prepare('UPDATE writer SET token=?,expires_at=? WHERE id=1 AND (token IS NULL OR expires_at<=?)').run(token, this.now() + ttlMs, this.now());
      return result.changes === 1 ? token : undefined;
    });
  }
  private assertWriter(token: string): void {
    const row = this.db.prepare('SELECT token,expires_at FROM writer WHERE id=1').get();
    if (!row || row.token !== token || number(row.expires_at) <= this.now()) throw new Error('Update writer lease absent, expired or superseded');
  }
  nextWrite(token: string): PendingWrite | undefined {
    return this.transaction(() => {
      this.assertWriter(token);
      this.db.prepare('UPDATE writer SET expires_at=? WHERE id=1').run(this.now() + 120_000);
      const row = this.db.prepare('SELECT * FROM outbox ORDER BY sequence LIMIT 1').get();
      if (!row) return undefined;
      return { sequence: number(row.sequence), write: parseWrite(JSON.parse(string(row.payload))) };
    });
  }
  acknowledgeWrite(token: string, sequence: number): void {
    this.transaction(() => { this.assertWriter(token); this.db.prepare('DELETE FROM outbox WHERE sequence=?').run(sequence); });
  }
  releaseWriter(token: string): void { this.db.prepare('UPDATE writer SET token=NULL,expires_at=NULL WHERE id=1 AND token=?').run(token); }
}

export function sessionRecord(assignment: Assignment): AgentSessionRecord {
  return { id: assignment.sessionId, executionId: assignment.executionId, issueId: assignment.issueId };
}
