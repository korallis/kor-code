import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Execution, SessionProcessIdentity } from '@kor-code/core';
import { object, string, type AgentSessionRecord, type LinearWrite } from './contract.js';

export interface Assignment {
  executionId: string;
  issueId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'canceled' | 'blocked';
}
export interface ExecutionClaim { assignment: Assignment; token: string; owner: string; expiresAt: number }
export interface PendingWrite { sequence: number; write: LinearWrite }
export interface AssignmentRecord extends Assignment {
  manifest?: Execution;
  owner?: string;
  expiresAt?: number;
  sessionPid?: number;
  heartbeatAt?: number;
  cancelRequested?: boolean;
  lastError?: string;
  attempts: number;
  processIdentity?: SessionProcessIdentity;
  issueKey?: string;
  issueTitle?: string;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid durable numeric value');
  return value;
}
function parseAssignment(value: unknown): Assignment {
  const row = object(value);
  const status = string(row.status);
  if (status !== 'queued' && status !== 'running' && status !== 'complete' && status !== 'failed' && status !== 'canceled' && status !== 'blocked') throw new Error('Invalid assignment status');
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
    case 'attachment': return { kind: 'attachment', issueId: string(write.issueId), url: string(write.url), ...(write.title === undefined ? {} : { title: string(write.title) }) };
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
        status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed','canceled','blocked')), manifest TEXT,
        token TEXT, owner TEXT, expires_at INTEGER, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        session_pid INTEGER, session_boot_id TEXT, session_start_ticks TEXT, heartbeat_at INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0, last_error TEXT, issue_key TEXT, issue_title TEXT
      );
      CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS decision_audit (decision_id TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, payload TEXT NOT NULL);
      INSERT OR IGNORE INTO writer(id) VALUES (1);`);
    this.transaction(() => {
      const version = number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 3) throw new Error('Kor database schema is newer than this binary');
      if (version >= 2) return;
      const columns = new Set(this.db.prepare('PRAGMA table_info(assignments)').all().map(row => string(row.name)));
      for (const [name, definition] of [
        ['session_pid', 'INTEGER'], ['session_boot_id', 'TEXT'], ['session_start_ticks', 'TEXT'],
        ['heartbeat_at', 'INTEGER'], ['cancel_requested', 'INTEGER NOT NULL DEFAULT 0'], ['last_error', 'TEXT'],
      ]) {
        if (name && !columns.has(name)) this.db.exec(`ALTER TABLE assignments ADD COLUMN ${name} ${definition}`);
      }
      this.db.exec(`CREATE TABLE assignments_v2 (
        issue_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed','canceled','blocked')), manifest TEXT,
        token TEXT, owner TEXT, expires_at INTEGER, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        session_pid INTEGER, session_boot_id TEXT, session_start_ticks TEXT, heartbeat_at INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0, last_error TEXT, issue_key TEXT, issue_title TEXT
      );
      INSERT INTO assignments_v2 SELECT issue_id,execution_id,session_id,status,manifest,token,owner,expires_at,available_at,attempts,session_pid,session_boot_id,session_start_ticks,heartbeat_at,cancel_requested,last_error,NULL,NULL FROM assignments;
      DROP TABLE assignments;
      ALTER TABLE assignments_v2 RENAME TO assignments;
      PRAGMA user_version=2;`);
    });
    this.transaction(() => {
      const version = number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if (version < 3) {
        const columns = new Set(this.db.prepare('PRAGMA table_info(assignments)').all().map(row => string(row.name)));
        if (!columns.has('issue_key')) this.db.exec('ALTER TABLE assignments ADD COLUMN issue_key TEXT');
        if (!columns.has('issue_title')) this.db.exec('ALTER TABLE assignments ADD COLUMN issue_title TEXT');
        this.db.exec('PRAGMA user_version=3');
      }
    });
    this.db.exec('CREATE TABLE IF NOT EXISTS daemon_owner (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL, boot_id TEXT NOT NULL, start_ticks TEXT NOT NULL)');
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.close(); }

  readDecisionAudit(decisionId: string): string | undefined {
    const row = this.db.prepare('SELECT payload FROM decision_audit WHERE decision_id=?').get(decisionId) as { payload?: unknown } | undefined;
    return typeof row?.payload === 'string' ? row.payload : undefined;
  }
  writeDecisionAudit(decisionId: string, recordedAt: string, payload: string): void {
    if (!decisionId || !recordedAt || !payload) throw new Error('Decision audit fields are required');
    this.transaction(() => {
      const result = this.db.prepare('INSERT INTO decision_audit(decision_id,recorded_at,payload) VALUES(?,?,?) ON CONFLICT(decision_id) DO NOTHING').run(decisionId, recordedAt, payload);
      if (result.changes !== 1) throw new Error(`Decision audit record already exists: ${decisionId}`);
    });
  }
  updateDecisionAudit(decisionId: string, recordedAt: string, payload: string): void {
    if (!decisionId || !recordedAt || !payload) throw new Error('Decision audit fields are required');
    this.transaction(() => {
      const result = this.db.prepare('UPDATE decision_audit SET recorded_at=?,payload=? WHERE decision_id=?').run(recordedAt, payload, decisionId);
      if (result.changes !== 1) throw new Error(`Decision audit record not found: ${decisionId}`);
    });
  }

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
      const sessionPid = typeof value.session_pid === 'number' ? value.session_pid : undefined;
      const heartbeatAt = typeof value.heartbeat_at === 'number' ? value.heartbeat_at : undefined;
      const lastError = typeof value.last_error === 'string' ? value.last_error : undefined;
      const attempts = typeof value.attempts === 'number' ? value.attempts : 0;
      const bootId = typeof value.session_boot_id === 'string' ? value.session_boot_id : undefined;
      const startTicks = typeof value.session_start_ticks === 'string' ? value.session_start_ticks : undefined;
      const processIdentity = sessionPid && bootId && startTicks ? { pid: sessionPid, bootId, startTicks } : undefined;
      const issueKey = typeof value.issue_key === 'string' ? value.issue_key : undefined;
      const issueTitle = typeof value.issue_title === 'string' ? value.issue_title : undefined;
      return { ...parsed, ...(manifest ? { manifest } : {}), ...(owner ? { owner } : {}), ...(expiresAt ? { expiresAt } : {}), ...(sessionPid ? { sessionPid } : {}), ...(heartbeatAt ? { heartbeatAt } : {}), ...(value.cancel_requested === 1 ? { cancelRequested: true } : {}), ...(lastError ? { lastError } : {}), ...(processIdentity ? { processIdentity } : {}), ...(issueKey ? { issueKey } : {}), ...(issueTitle ? { issueTitle } : {}), attempts };
    });
  }
  counts(): { events: number; executions: number; pendingWrites: number } {
    return {
      events: number(this.db.prepare('SELECT count(*) AS count FROM events').get()?.count),
      executions: number(this.db.prepare('SELECT count(*) AS count FROM assignments').get()?.count),
      pendingWrites: number(this.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count),
    };
  }

  claim(owner: string, ttlMs = 60_000, issueId?: string, excludedIssueIds: readonly string[] = []): ExecutionClaim | undefined {
    this.validateTTL(ttlMs);
    return this.transaction(() => {
      const excluded = excludedIssueIds.length > 0 ? ` AND issue_id NOT IN (${excludedIssueIds.map(() => "?").join(",")})` : "";
      const row = issueId
        ? this.db.prepare(`SELECT * FROM assignments WHERE issue_id=? AND status = 'queued' AND available_at <= ? AND token IS NULL${excluded}`).get(issueId, this.now(), ...excludedIssueIds)
        : this.db.prepare(`SELECT * FROM assignments WHERE status = 'queued' AND available_at <= ? AND token IS NULL${excluded} ORDER BY available_at, rowid LIMIT 1`).get(this.now(), ...excludedIssueIds);
      if (!row) return undefined;
      const assignment = parseAssignment(row);
      const token = randomUUID();
      const expiresAt = this.now() + ttlMs;
      this.db.prepare("UPDATE assignments SET status='running',token=?,owner=?,expires_at=?,attempts=attempts+1 WHERE issue_id=?").run(token, owner, expiresAt, assignment.issueId);
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
    this.transaction(() => { this.assertLease(claim); this.db.prepare('UPDATE assignments SET expires_at=?,heartbeat_at=? WHERE issue_id=?').run(this.now() + ttlMs, this.now(), claim.assignment.issueId); });
  }
  heartbeat(claim: ExecutionClaim, ttlMs = 60_000): void { this.renew(claim, ttlMs); }
  setSessionPid(claim: ExecutionClaim, pid: number, identity?: { bootId: string; startTicks: string }): void {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Session PID must be positive');
    this.transaction(() => { this.assertLease(claim); this.db.prepare('UPDATE assignments SET session_pid=?,session_boot_id=?,session_start_ticks=?,heartbeat_at=? WHERE issue_id=?').run(pid, identity?.bootId ?? null, identity?.startTicks ?? null, this.now(), claim.assignment.issueId); });
  }
  setIssueMetadata(claim: ExecutionClaim, issueKey: string, issueTitle: string): void {
    if (!issueKey || !issueTitle) throw new Error('Issue metadata is required');
    this.transaction(() => { this.assertLease(claim); this.db.prepare('UPDATE assignments SET issue_key=?,issue_title=? WHERE issue_id=?').run(issueKey, issueTitle, claim.assignment.issueId); });
  }
  requestCancel(issueId: string): boolean {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT status FROM assignments WHERE issue_id=?').get(issueId) as { status?: unknown } | undefined;
      if (!row || (row.status !== 'queued' && row.status !== 'running')) return false;
      if (row.status === 'queued') return this.db.prepare("UPDATE assignments SET status='canceled',cancel_requested=0,token=NULL,owner=NULL,expires_at=NULL WHERE issue_id=?").run(issueId).changes === 1;
      return this.db.prepare('UPDATE assignments SET cancel_requested=1 WHERE issue_id=?').run(issueId).changes === 1;
    });
  }
  clearCancel(issueId: string): void { this.transaction(() => { this.db.prepare('UPDATE assignments SET cancel_requested=0,last_error=NULL WHERE issue_id=?').run(issueId); }); }
  isCancelRequested(issueId: string): boolean { return (this.db.prepare('SELECT cancel_requested FROM assignments WHERE issue_id=?').get(issueId) as { cancel_requested?: unknown } | undefined)?.cancel_requested === 1; }
  requeue(issueId: string, delayMs = 0, lastError?: string): boolean {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('Queue delay must be nonnegative');
    return this.transaction(() => this.db.prepare("UPDATE assignments SET status='queued',token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,cancel_requested=0,available_at=?,last_error=? WHERE issue_id=? AND status IN ('running','queued')").run(this.now() + delayMs, lastError ?? null, issueId).changes === 1);
  }
  retry(issueId: string): boolean {
    return this.transaction(() => this.db.prepare("UPDATE assignments SET status='queued',token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,cancel_requested=0,available_at=?,last_error=NULL WHERE issue_id=? AND status IN ('failed','blocked','canceled')").run(this.now(), issueId).changes === 1);
  }
  recover(issueId: string, message: string): boolean {
    return this.transaction(() => this.db.prepare("UPDATE assignments SET status='queued',token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,cancel_requested=0,available_at=?,last_error=? WHERE issue_id=? AND status IN ('running','queued')").run(this.now(), message, issueId).changes === 1);
  }
  failClaim(claim: ExecutionClaim, message: string, status: 'failed' | 'blocked' = 'failed'): void { this.finishClaim(claim, status, message); }
  cancelClaim(claim: ExecutionClaim, message = 'canceled by operator'): void { this.finishClaim(claim, 'canceled', message); }
  markRunning(claim: ExecutionClaim, manifest?: Execution): void {
    this.transaction(() => {
      this.assertLease(claim);
      const previous = this.getAssignment(claim.assignment.issueId);
      if (previous.status === 'complete') throw new Error('Cannot run a completed assignment');
      this.db.prepare("UPDATE assignments SET status='running',manifest=COALESCE(?,manifest),heartbeat_at=? WHERE issue_id=?").run(manifest ? JSON.stringify(manifest) : null, this.now(), claim.assignment.issueId);
    });
  }
  completeClaim(claim: ExecutionClaim, manifest?: Execution): void {
    this.finishClaim(claim, 'complete', undefined, manifest);
  }
  private assertOwner(claim: ExecutionClaim): void {
    const row = this.db.prepare('SELECT token FROM assignments WHERE issue_id=?').get(claim.assignment.issueId);
    if (!row || row.token !== claim.token) throw new Error('Execution lease ownership was superseded');
  }
  /** Only settle after the session and verification have stopped, even if the lease expired. */
  finishClaim(claim: ExecutionClaim, status: 'complete' | 'failed' | 'blocked' | 'canceled', message?: string, manifest?: Execution): void {
    this.transaction(() => {
      this.assertOwner(claim);
      const current = this.db.prepare('SELECT cancel_requested FROM assignments WHERE issue_id=?').get(claim.assignment.issueId) as { cancel_requested?: unknown } | undefined;
      const canceled = current?.cancel_requested === 1;
      const finalStatus = canceled ? 'canceled' : status;
      this.db.prepare('UPDATE assignments SET status=?,manifest=COALESCE(?,manifest),last_error=?,token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,cancel_requested=0 WHERE issue_id=?')
        .run(finalStatus, manifest ? JSON.stringify(manifest) : null, message ?? null, claim.assignment.issueId);
    });
  }
  daemonOwner(): { owner: string; process: SessionProcessIdentity } | undefined {
    const row = this.db.prepare('SELECT * FROM daemon_owner WHERE id=1').get();
    return row ? { owner: string(row.owner), process: { pid: number(row.pid), bootId: string(row.boot_id), startTicks: string(row.start_ticks) } } : undefined;
  }
  acquireDaemon(owner: string, identity: SessionProcessIdentity, expectedOwner?: string): boolean {
    return this.transaction(() => {
      if (this.daemonOwner()?.owner !== expectedOwner) return false;
      this.db.prepare('INSERT OR REPLACE INTO daemon_owner VALUES(1,?,?,?,?)').run(owner, identity.pid, identity.bootId, identity.startTicks);
      return true;
    });
  }
  releaseDaemon(owner: string): void { this.db.prepare('DELETE FROM daemon_owner WHERE owner=?').run(owner); }
  release(claim: ExecutionClaim, delayMs = 0): void {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('Queue delay must be nonnegative');
    this.transaction(() => {
      this.assertLease(claim);
      this.db.prepare("UPDATE assignments SET status='queued',token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,available_at=? WHERE issue_id=?").run(this.now() + delayMs, claim.assignment.issueId);
    });
  }
  reclaimExpired(issueId: string): boolean {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT expires_at FROM assignments WHERE issue_id=? AND token IS NOT NULL').get(issueId) as { expires_at?: unknown } | undefined;
      if (!row || typeof row.expires_at !== 'number' || row.expires_at > this.now()) return false;
      const result = this.db.prepare("UPDATE assignments SET status='queued',token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,available_at=? WHERE issue_id=? AND status IN ('running','queued') AND session_pid IS NULL AND expires_at<=?").run(this.now(), issueId, this.now());
      return result.changes === 1;
    });
  }
  transition(claim: ExecutionClaim, status: 'running' | 'complete' | 'failed' | 'blocked' | 'canceled', writes: LinearWrite[], manifest?: Execution): void {
    this.transaction(() => {
      this.assertLease(claim);
      const previous = this.getAssignment(claim.assignment.issueId);
      if (previous.status === 'complete' || ['complete', 'failed', 'blocked', 'canceled'].includes(status) && previous.status !== 'running') throw new Error('Invalid execution transition');
      this.db.prepare('UPDATE assignments SET status=?,manifest=COALESCE(?,manifest) WHERE issue_id=?').run(status, manifest ? JSON.stringify(manifest) : null, previous.issueId);
      for (const write of writes) this.db.prepare('INSERT INTO outbox(payload) VALUES(?)').run(JSON.stringify(write));
      if (status !== 'running') this.db.prepare('UPDATE assignments SET token=NULL,owner=NULL,expires_at=NULL,session_pid=NULL,session_boot_id=NULL,session_start_ticks=NULL,heartbeat_at=NULL,cancel_requested=0 WHERE issue_id=?').run(previous.issueId);
    });
  }
  record(claim: ExecutionClaim, writes: LinearWrite[], manifest?: Execution): void {
    this.transaction(() => {
      this.assertLease(claim);
      if (manifest) this.db.prepare('UPDATE assignments SET manifest=? WHERE issue_id=?').run(JSON.stringify(manifest), claim.assignment.issueId);
      for (const write of writes) this.db.prepare('INSERT INTO outbox(payload) VALUES(?)').run(JSON.stringify(write));
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
