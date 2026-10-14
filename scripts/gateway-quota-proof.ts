import { GatewayAdapter } from "../packages/gateway-adapter/src/index.js";
import type { RouteTelemetry } from "@kor-code/core";

type FixtureAccount = { id: string; name: string; status: string; email: string; cooldowns?: unknown[]; quota?: { signals: Record<string, boolean> } };

let failedOnce = false;
const calls: Array<{ url: string; session: string | null }> = [];
const accounts: FixtureAccount[] = [
  { id: "two@example.invalid", name: "two@example.invalid", status: "active", email: "two@example.invalid" },
  { id: "one@example.invalid", name: "one@example.invalid", status: "active", email: "one@example.invalid" },
];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  calls.push({ url, session: headers.get("x-session-id") });
  if (url.endsWith("/v1/models")) {
    return new Response(JSON.stringify({ data: [{ id: "claude/fixture", owned_by: "claude", capabilities: { streaming: true } }] }), { headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/v0/management/auth-files")) {
    if (headers.has("x-management-key") || headers.get("authorization") !== "Bearer management-fixture") throw new Error("management credentials crossed boundary");
    return new Response(JSON.stringify({ files: accounts.map((account) => ({ ...account, cooldowns: [], quota: { signals: {} } })) }), { headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/v0/management/config")) {
    if (headers.get("authorization") !== "Bearer management-fixture") throw new Error("wrong management authorization");
    return new Response(JSON.stringify({ "api-keys": ["client-secret-fixture"], account: { email: "one@example.invalid", path: "/private/auth.json" } }), { headers: { "content-type": "application/json" } });
  }
  if (url.includes("/v0/management/")) return new Response("not found", { status: 404 });
  if (url.endsWith("/v1/chat/completions")) {
    if (!failedOnce) {
      failedOnce = true;
      const [first] = accounts;
      if (first) accounts[0] = { ...first, status: "error", quota: { signals: { exhausted: true } } };
      return new Response("quota exhausted; bearer secret must never appear", { status: 429 });
    }
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"ready\"}}]}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  return new Response("missing fake route", { status: 404 });
};

const telemetry: RouteTelemetry[] = [];
const gateway = new GatewayAdapter({ baseUrl: "http://fake", managementKey: "management-fixture", fetch: fakeFetch, modelCapabilities: { "claude/fixture": { streaming: true } }, telemetry: (event) => telemetry.push(event) });
const result = await gateway.stream({ model: "claude/fixture", sessionId: "session-fixture", requestId: "request-fixture", prompt: "ready", idempotent: true });
if (result.text !== "ready") throw new Error(`expected ready, got ${result.text}`);
if (telemetry.length !== 2 || telemetry[0]?.failoverReason !== "quota" || telemetry[0].streamStarted || telemetry[1]?.streamStarted !== true) throw new Error(`unexpected telemetry: ${JSON.stringify(telemetry)}`);
if (!telemetry[0]?.accountSlot || !telemetry[1]?.accountSlot || telemetry[0].accountSlot === telemetry[1].accountSlot) throw new Error(`expected a new health slot after quota, got ${JSON.stringify(telemetry)}`);
const completionCalls = calls.filter((call) => call.url.endsWith("/v1/chat/completions"));
if (completionCalls.length !== 2 || completionCalls.some((call) => call.session !== "session-fixture")) throw new Error(`session was not retained across failover: ${JSON.stringify(completionCalls)}`);
console.log(`quota-proof: session-fixture ${telemetry[0]?.accountSlot} -> ${telemetry[1]?.accountSlot}; retries=${telemetry[1]?.retryCount}; streamStartedOnQuota=${telemetry[0]?.streamStarted}; completionCalls=${completionCalls.length}`);

const publicManagement = await gateway.readManagement();
const publicManagementText = JSON.stringify(publicManagement);
if (publicManagementText.includes("example.invalid") || publicManagementText.includes("client-secret-fixture") || publicManagementText.includes("/private/auth.json")) throw new Error("facts boundary leaked a management secret");

async function proveNoReplay(body: string, contentType: string): Promise<number> {
  let completionAttempts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "claude/fixture", capabilities: { streaming: true } }] }));
    if (url.endsWith("/v0/management/auth-files")) return new Response(JSON.stringify({ files: [{ id: "safe-slot", status: "active" }] }));
    if (url.includes("/v0/management/")) return new Response("not found", { status: 404 });
    if (url.endsWith("/v1/chat/completions")) { completionAttempts += 1; return new Response(body, { headers: { "content-type": contentType } }); }
    return new Response("missing", { status: 404 });
  };
  const probe = new GatewayAdapter({ baseUrl: "http://fake", managementKey: "management-fixture", fetch: fetcher, modelCapabilities: { "claude/fixture": { streaming: true } } });
  try { await probe.stream({ model: "claude/fixture", idempotent: true }); } catch { /* expected terminal failure */ }
  return completionAttempts;
}

const plainAttempts = await proveNoReplay("{\"choices\":[{\"message\":{\"content\":\"ready\"}}]}", "application/json");
if (plainAttempts !== 1) throw new Error(`plain completion replayed ${plainAttempts} times`);
const partialAttempts = await proveNoReplay("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"error\":{\"code\":429}}\n\n", "text/event-stream");
if (partialAttempts !== 1) throw new Error(`partial stream replayed ${partialAttempts} times`);
console.log(`quota-proof: no-replay plain=${plainAttempts}; partial=${partialAttempts}; facts=redacted`);
