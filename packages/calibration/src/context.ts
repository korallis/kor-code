import { z } from "zod";

const tokens = z.number().int().nonnegative();
export const turnSchema = z.object({
  messageId: z.string(),
  inputTokens: tokens,
  cacheReadTokens: tokens,
  cacheCreationTokens: tokens,
  outputTokens: tokens,
  contextTokens: tokens,
});
export type SessionTurn = z.infer<typeof turnSchema>;
export const loadEventSchema = z.object({
  kind: z.enum(["tool", "skill"]),
  name: z.string(),
  toolUseId: z.string(),
  turn: tokens.positive(),
  status: z.enum(["requested", "succeeded", "failed"]),
  source: z.literal("armed").optional(),
  hash: z.string().optional(),
  trigger: z.string().optional(),
  firedAt: z.iso.datetime().optional(),
});
export type SessionLoadEvent = z.infer<typeof loadEventSchema>;

export const gatewayTelemetrySchema = z.object({
  desiredAccountPolicy: z.enum(["fill-first", "manual", "least-used"]).nullable(),
  strategy: z.object({ value: z.string(), observedAt: z.string().datetime() }).nullable(),
  responses: z.array(z.object({
    statusCode: z.number().int(),
    attribution: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("response_trace"), traceId: z.string(), accountSlot: z.string() }),
      z.object({ kind: z.literal("unavailable") }),
    ]),
  })),
});
export type SessionGatewayTelemetry = z.infer<typeof gatewayTelemetrySchema>;

export const skillPackSchema = z.object({
  catalogueHash: z.string(),
  skills: z.array(z.object({ name: z.string(), tier: z.enum(["pinned", "listed", "armed"]), tokens, source: z.enum(["jev", "override", "repository"]) })),
  playbook: z.object({ name: z.string(), tokens }).nullable(),
  tokens: z.object({ pinned: tokens, listed: tokens, tool: tokens, total: tokens }),
});
