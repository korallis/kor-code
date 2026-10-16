import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TrackerStore } from '@kor-code/tracker';
export * from '@kor-code/tracker';
export { flushTrackerWrites as flushLinearWrites } from '@kor-code/tracker';

export interface WebhookReceiverOptions { secret: string; store: TrackerStore; now?: () => number }
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
