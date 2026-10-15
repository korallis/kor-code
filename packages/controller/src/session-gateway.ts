import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { SessionGatewayTelemetry } from "@kor-code/calibration";

const TRACE_ID = /^\d{14}-([a-f0-9]{16})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function sessionGateway(input: { baseUrl: string; key: string; telemetry: SessionGatewayTelemetry }) {
  const upstream = new URL(input.baseUrl);
  if (!["http:", "https:"].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error("Invalid session gateway URL");
  const key = randomUUID();
  const proxy = createServer((incoming, outgoing) => {
    if (incoming.headers.authorization !== `Bearer ${key}` && incoming.headers["x-api-key"] !== key) {
      outgoing.writeHead(401).end();
      return;
    }
    let target: URL;
    try { target = new URL(incoming.url ?? "/", upstream); }
    catch { outgoing.writeHead(400).end(); return; }
    if (target.origin !== upstream.origin) { outgoing.writeHead(400).end(); return; }
    const headers: OutgoingHttpHeaders = { ...incoming.headers, host: upstream.host, authorization: `Bearer ${input.key}` };
    delete headers["x-api-key"];
    const remote = (upstream.protocol === "https:" ? httpsRequest : request)(target, { method: incoming.method, headers }, response => {
      const statusCode = response.statusCode ?? 502;
      if (incoming.method === "POST" && target.pathname === `${upstream.pathname.replace(/\/$/, "")}/v1/messages`) {
        const traceId = response.headers["x-cpa-trace-id"];
        const account = typeof traceId === "string" ? TRACE_ID.exec(traceId)?.[1] : undefined;
        input.telemetry.responses.push({ statusCode, attribution: account && typeof traceId === "string"
          ? { kind: "response_trace", traceId, accountSlot: `account-${account.toLowerCase()}` }
          : { kind: "unavailable" } });
      }
      outgoing.writeHead(statusCode, response.headers);
      response.on("error", () => outgoing.destroy());
      response.pipe(outgoing);
    });
    incoming.on("error", () => remote.destroy());
    remote.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.on("close", () => remote.destroy());
    incoming.pipe(remote);
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Session gateway has no port");
  return { baseUrl: `http://127.0.0.1:${address.port}${upstream.pathname.replace(/\/$/, "")}`, key,
    async close(): Promise<void> {
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    },
  };
}
