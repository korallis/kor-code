// The authenticated channel to the Kor daemon. `kor ui` opens `/#token=…`; the
// token is consumed from the fragment on load, kept in sessionStorage, and sent
// as the Authorization header on every /api request (including the event stream).
import { API_PREFIX, TOKEN_HEADER, type ApiError, type MissionControlApi } from '@kor-code/mission-control';

const STORAGE_KEY = 'kor.mc.token';

function consumeToken(): string | null {
  const match = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
  if (match?.[1]) {
    const token = decodeURIComponent(match[1]);
    try { window.sessionStorage.setItem(STORAGE_KEY, token); } catch { /* private mode: keep it in memory */ }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
    return token;
  }
  try { return window.sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

let token = consumeToken();

export function hasToken(): boolean { return token !== null; }
export function setToken(value: string): void {
  token = value.trim();
  try { window.sessionStorage.setItem(STORAGE_KEY, token); } catch { /* memory only */ }
}

export function authHeaders(): Record<string, string> {
  return token ? { [TOKEN_HEADER]: `Bearer ${token}` } : {};
}

/** A refused or failed API call, carrying the daemon's error code, message and hint. */
export class ApiFailure extends Error {
  constructor(readonly code: string, message: string, readonly hint: string, readonly status: number) { super(message); }
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as ApiError).error?.code === 'string';
}

type Method = 'GET' | 'POST' | 'PUT';
type Key = keyof MissionControlApi;
type PathOf<K extends Key> = K extends `${Method} ${infer P}` ? P : never;
type Success<K extends Key> = Exclude<MissionControlApi[K]['response'], ApiError>;

/** Fill `:id`-style segments, each URI-encoded as the contract requires. */
export function path<K extends Key>(_key: K, template: PathOf<K>, params: Record<string, string> = {}, query?: Record<string, string>): string {
  const filled = template.replace(/:([a-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  return `${filled}${search}`;
}

async function send<T>(method: Method, url: string, body?: unknown): Promise<T> {
  if (!url.startsWith(API_PREFIX)) throw new Error(`not an API path: ${url}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiFailure('offline', 'The Kor daemon is not reachable.', 'Start it with `kor serve`, then reopen Mission Control with `kor ui`.', 0);
  }
  const text = await response.text();
  let parsed: unknown = undefined;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON error body */ }
  // A refused override is a 409 that still carries its audited record and reason.
  if (response.status === 409 && typeof parsed === 'object' && parsed !== null && 'record' in parsed) return parsed as T;
  if (!response.ok || isApiError(parsed)) {
    if (isApiError(parsed)) throw new ApiFailure(parsed.error.code, parsed.error.message, parsed.error.hint, response.status);
    throw new ApiFailure(response.status === 401 ? 'unauthorized' : 'internal_error', `The daemon answered ${response.status}.`, response.status === 401 ? 'Open Mission Control with `kor ui` to get a fresh session.' : 'Check `kor logs` for the daemon error.', response.status);
  }
  return parsed as T;
}

export function get<K extends Key & `GET ${string}`>(_key: K, url: string): Promise<Success<K>> { return send('GET', url); }
export function post<K extends Key & `POST ${string}`>(_key: K, url: string, body: MissionControlApi[K]['request']): Promise<Success<K>> { return send('POST', url, body); }
export function put<K extends Key & `PUT ${string}`>(_key: K, url: string, body: MissionControlApi[K]['request']): Promise<Success<K>> { return send('PUT', url, body); }
