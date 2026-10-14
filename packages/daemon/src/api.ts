import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { parseKorConfig, repositorySchema } from "@kor-code/config";
import { redact, runtimeSecrets } from "@kor-code/jev";
import type { ApiError, ApiErrorCode, ConfigResponse, PoolResponse, ProjectsResponse, RunsResponse } from "@kor-code/mission-control";
import type { KorDaemon } from "./index.js";
import { acceptsUiToken } from "./ui-token.js";
import { atomicPrivateFile, unavailable } from "./mission-services.js";

const id = z.string().trim().min(1).max(256);
const message = z.strictObject({ message: z.string().trim().min(1).max(16_000) });
const empty = z.strictObject({});
const connect = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("linear"), apiKey: id.max(8192) }),
  z.strictObject({ provider: z.literal("github"), token: id.max(8192) }),
  z.strictObject({ provider: z.literal("jev"), apiKey: id.max(8192) }),
  z.strictObject({ provider: z.literal("gateway"), baseUrl: z.string().url().refine(value => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search; }), apiKey: id.max(8192), managementKey: id.max(8192).optional() }),
]);
export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string, readonly hint = "Check the request and retry") { super(message); }
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw new ApiFailure(415, "invalid_request", "Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 65_536) throw new ApiFailure(413, "invalid_request", "JSON body exceeds 64 KiB");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new ApiFailure(400, "invalid_request", "Invalid JSON"); }
}
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".avif": "image/avif", ".webp": "image/webp", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".ico": "image/x-icon" };

/** Authenticates all data routes, keeping the static bootstrap free of secrets. */
export class MissionApi {
  private configWrite: Promise<void> = Promise.resolve();
  constructor(private readonly daemon: KorDaemon, private readonly token: string, private readonly webRoot: string | undefined) {}
  async handle(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("cache-control", "no-store");
    const send = (status: number, body: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      // Match loaded credentials even when they occur inside error strings or logs.
      response.end(`${redact(JSON.stringify(body), [this.token, ...runtimeSecrets(), ...this.daemon.mission.secrets()])}\n`);
    };
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") { await this.staticFile(request, response, url.pathname); return; }
      if (!acceptsUiToken(request.headers.authorization, this.token)) throw new ApiFailure(401, "unauthorized", "Kor UI token required", "Open the browser with kor ui");
      const origin = request.headers.origin;
      if (origin !== undefined && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin) || request.headers["sec-fetch-site"] === "cross-site") throw new ApiFailure(403, "forbidden", "Cross-origin requests are refused");
      const path = url.pathname;
      const method = request.method;
      const services = this.daemon.mission;
      if (method === "GET") {
        if (path === "/api/status") { send(200, this.daemon.response()); return; }
        if (path === "/api/events") {
          const lastId = request.headers["last-event-id"];
          if (Array.isArray(lastId) || lastId && lastId.length > 128) throw new ApiFailure(400, "invalid_request", "Invalid Last-Event-ID");
          this.daemon.events.subscribe(response, lastId, { kind: "snapshot", status: this.daemon.response(), runs: this.daemon.missionRuns() }); return;
        }
        if (path === "/api/runs") { send(200, { schemaVersion: 1, runs: this.daemon.missionRuns() } satisfies RunsResponse); return; }
        if (path === "/api/projects") {
          send(200, { schemaVersion: 1, projects: Object.entries(this.daemon.config.repos).map(([key, repository]) => ({ id: key, name: key, repository, runs: this.daemon.missionRuns().filter(run => run.repository === key) })) } satisfies ProjectsResponse); return;
        }
        const runPath = /^\/api\/runs\/([^/]+)(?:\/(terminal))?$/.exec(path);
        if (runPath?.[1]) {
          const run = this.daemon.missionRun(decodeURIComponent(runPath[1]));
          if (runPath[2]) { send(200, { schemaVersion: 1, executionId: run.executionId, ...await this.daemon.readTerminal(run.executionId) }); }
          else send(200, { schemaVersion: 1, run });
          return;
        }
        if (path === "/api/linear/issues") { send(200, await this.daemon.missionIssues(url.searchParams.get("project"))); return; }
        if (path === "/api/github/pulls") {
          const repository = this.daemon.config.repos[url.searchParams.get("repo") ?? ""];
          if (!repository) throw new ApiFailure(404, "not_found", "Configured repository not found");
          send(200, await services.pulls(repository)); return;
        }
        if (path === "/api/models") { send(200, await services.models()); return; }
        if (path === "/api/brain") { send(200, services.brain(this.daemon.status())); return; }
        if (path === "/api/connections") { send(200, await services.connections()); return; }
        if (path === "/api/config") { send(200, { schemaVersion: 1, config: this.daemon.config, restartRequired: false } satisfies ConfigResponse); return; }
        if (path === "/api/quota" || path === "/api/pool") {
          const quota = await this.daemon.refreshQuota();
          if (path === "/api/quota") send(200, quota);
          else send(200, { schemaVersion: 1, accounts: this.daemon.status().accounts ?? unavailable([], "Gateway pool unavailable"), quota } satisfies PoolResponse);
          return;
        }
      }
      if (method === "POST" || method === "PUT") {
        const input = await jsonBody(request);
        if (method === "PUT" && (path === "/api/config" || path.startsWith("/api/projects/"))) {
          const operation = async () => {
            let config;
            if (path === "/api/config") config = parseKorConfig(input, { home: this.daemon.paths.home });
            else {
              const project = decodeURIComponent(path.slice("/api/projects/".length));
              id.parse(project);
              config = parseKorConfig({ ...this.daemon.config, repos: { ...this.daemon.config.repos, [project]: repositorySchema.parse(input) } }, { home: this.daemon.paths.home });
            }
            await this.daemon.configure(config);
            this.daemon.events.publish({ kind: "config", restartRequired: false });
            send(200, { schemaVersion: 1, config, restartRequired: false } satisfies ConfigResponse);
          };
          const write = this.configWrite.then(operation);
          this.configWrite = write.catch(() => undefined);
          await write; return;
        }
        if (method !== "POST") throw new ApiFailure(404, "not_found", "API endpoint not found");
        if (path === "/api/runs") {
          const body = z.strictObject({ issueIds: z.array(id).min(1).max(100) }).parse(input);
          send(202, { schemaVersion: 1, runs: await this.daemon.queueIssues(body.issueIds) }); return;
        }
        const actionPath = /^\/api\/runs\/([^/]+)\/(cancel|retry|answer|approve|request-changes|note)$/.exec(path);
        if (actionPath?.[1] && actionPath[2]) {
          const executionId = this.daemon.missionRun(decodeURIComponent(actionPath[1])).executionId;
          const action = z.enum(["cancel", "retry", "answer", "approve", "request-changes", "note"]).parse(actionPath[2]);
          const body = ["answer", "request-changes", "note"].includes(action) ? message.parse(input) : (empty.parse(input), undefined);
          await this.daemon.runAction(executionId, action, body?.message);
          send(200, { schemaVersion: 1, executionId, accepted: true, run: this.daemon.missionRun(executionId) }); return;
        }
        if (path === "/api/overrides") {
          const body = z.strictObject({ executionId: id, target: id, choice: id, decisionId: id.optional() }).parse(input);
          const answer = await this.daemon.override({ executionId: body.executionId, target: body.target, choice: body.choice, ...(body.decisionId ? { decisionId: body.decisionId } : {}), origin: "Mission Control" });
          if (!answer.record) throw new ApiFailure(answer.status, "not_found", "Execution or decision not found");
          send(answer.status, { schemaVersion: 1, record: answer.record }); return;
        }
        const revert = /^\/api\/overrides\/([^/]+)\/revert$/.exec(path);
        if (revert?.[1]) {
          empty.parse(input);
          const answer = await this.daemon.revertOverride(decodeURIComponent(revert[1]), "Mission Control");
          if (!answer.record) throw new ApiFailure(answer.status, "conflict", "Override cannot be reverted");
          send(answer.status, { schemaVersion: 1, record: answer.record }); return;
        }
        if (path === "/api/ask") {
          const body = z.strictObject({ message: message.shape.message, executionId: id.optional() }).parse(input);
          const answer = await services.ask({ message: body.message, ...(body.executionId ? { executionId: body.executionId } : {}) }, this.daemon.status());
          this.daemon.events.publish({ kind: "ask", response: answer }); send(200, answer); return;
        }
        if (path === "/api/connections") {
          const body = connect.parse(input);
          send(200, await services.connect(body));
          await this.daemon.connectionsChanged(body.provider); return;
        }
        const probe = /^\/api\/models\/([^/]+)\/probe$/.exec(path);
        if (probe?.[1]) { empty.parse(input); const model = decodeURIComponent(probe[1]); send(200, { schemaVersion: 1, model, verified: await services.probeModel(model) }); return; }
        const account = /^\/api\/accounts\/([^/]+)\/(pause|resume)$/.exec(path);
        if (account?.[1]) {
          empty.parse(input); const accountId = decodeURIComponent(account[1]); const paused = account[2] === "pause";
          await (await services.gateway()).setAccountPaused(accountId, paused);
          await this.daemon.connectionsChanged("gateway");
          send(200, { schemaVersion: 1, accountId, paused }); return;
        }
      }
      throw new ApiFailure(404, "not_found", "API endpoint not found");
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : error instanceof z.ZodError || error instanceof URIError || error instanceof Error && error.message.startsWith("Invalid Kor config")
        ? new ApiFailure(400, "invalid_request", "Request does not match the Mission Control schema")
        : new ApiFailure(503, "unavailable", "Action or upstream service unavailable", "Check provider connections and daemon logs, then retry");
      send(failure.status, { schemaVersion: 1, error: { code: failure.code, message: failure.message, hint: failure.hint } } satisfies ApiError);
    }
  }
  private async staticFile(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") throw new ApiFailure(404, "not_found", "Endpoint not found");
    if (!this.webRoot) throw new ApiFailure(503, "unavailable", "Mission Control web build unavailable", "Build the web package or start kor serve with --ui-dir DIST");
    const root = await realpath(this.webRoot);
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0") || decoded.split("/").some(segment => segment.startsWith("."))) throw new ApiFailure(404, "not_found", "Asset not found");
    const candidate = resolve(root, `.${decoded}`);
    const inside = (path: string) => { const rel = relative(root, path); return rel !== ".." && !rel.startsWith(`..${sep}`) && !resolve(path).startsWith(`${root}${sep}..`); };
    if (!inside(candidate)) throw new ApiFailure(404, "not_found", "Asset not found");
    let file = candidate;
    try { if (!(await stat(file)).isFile()) file = join(root, "index.html"); }
    catch { if (extname(decoded)) throw new ApiFailure(404, "not_found", "Asset not found"); file = join(root, "index.html"); }
    if (!inside(await realpath(file))) throw new ApiFailure(404, "not_found", "Asset not found");
    const size = (await stat(file)).size;
    if (size > 30_000_000) throw new ApiFailure(413, "invalid_request", "Asset exceeds serving limit");
    response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "content-length": size });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  }
}
