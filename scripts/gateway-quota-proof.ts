import { GatewayAdapter } from "../packages/gateway-adapter/src/index.js";
import type { RouteTelemetry } from "@kor-code/core";

let failedOnce = false;
const calls: Array<{ url: string; session: string | null }> = [];
const accounts = [
  { id: "account-01", status: "active" },
  { id: "account-02", status: "active" },
];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  calls.push({ url, session: headers.get("x-session-id") });
  if (url.endsWith("/v1/models")) {
    return new Response(JSON.stringify({ data: [{ id: "claude/fixture", owned_by: "claude", capabilities: { streaming: true } }] }), { headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/v0/management/auth-files")) {
    return new Response(JSON.stringify({ data: accounts }), { headers: { "content-type": "application/json" } });
  }
  if (url.includes("/v0/management/")) return new Response("not found", { status: 404 });
  if (url.endsWith("/v1/chat/completions")) {
    if (!failedOnce) {
      failedOnce = true;
      accounts[0] = { id: "account-01", status: "quota" };
      return new Response("quota exhausted; bearer secret must never appear", { status: 429 });
    }
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"ready\"}}]}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  return new Response("missing fake route", { status: 404 });
};

const telemetry: RouteTelemetry[] = [];
const gateway = new GatewayAdapter({ baseUrl: "http://fake", fetch: fakeFetch, telemetry: (event) => telemetry.push(event) });
const result = await gateway.stream({ model: "claude/fixture", sessionId: "session-fixture", requestId: "request-fixture", prompt: "ready", idempotent: true });
if (result.text !== "ready") throw new Error(`expected ready, got ${result.text}`);
if (telemetry.length !== 2 || telemetry[0]?.failoverReason !== "quota" || telemetry[0].streamStarted || telemetry[1]?.streamStarted !== true) throw new Error(`unexpected telemetry: ${JSON.stringify(telemetry)}`);
if (telemetry[0]?.accountSlot !== "account-01" || telemetry[1]?.accountSlot !== "account-02") throw new Error(`expected account-01 -> account-02, got ${JSON.stringify(telemetry)}`);
const completionCalls = calls.filter((call) => call.url.endsWith("/v1/chat/completions"));
if (completionCalls.length !== 2 || completionCalls.some((call) => call.session !== "session-fixture")) throw new Error(`session was not retained across failover: ${JSON.stringify(completionCalls)}`);
console.log(`quota-proof: session-fixture account-01 -> account-02; retries=${telemetry[1]?.retryCount}; streamStartedOnQuota=${telemetry[0]?.streamStarted}; completionCalls=${completionCalls.length}`);
