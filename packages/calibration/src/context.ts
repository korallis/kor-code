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
