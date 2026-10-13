import { z } from "zod";

const probability = z.number().min(0).max(1);
const instructions = z.json();
const criteria = z.record(z.string(), instructions);
export const questionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), instructions, criteria: criteria.refine(value => Object.keys(value).length >= 2 && Object.keys(value).length <= 255, "Choice requires 2–255 candidates") }),
  z.object({ type: z.literal("noul"), instructions, criteria: z.object({ true: instructions.optional(), false: instructions.optional() }).optional() }),
  z.object({ type: z.literal("score"), instructions, criteria: z.array(instructions).min(2).max(10) }),
]);
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: probability, probabilities: z.record(z.string(), probability) }),
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({ type: z.literal("score"), score: z.number().nonnegative(), confidence: probability, probabilities: z.record(z.string(), probability), legend: z.record(z.string(), z.string()) }),
]);
export const responseSchema = z.object({
  model: z.string().min(1), answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).optional(),
});
export type JevQuestion = z.infer<typeof questionSchema>;
export type ChoiceQuestion = Extract<JevQuestion, { type: "choice" }>;
export type NoulQuestion = Extract<JevQuestion, { type: "noul" }>;
export type ScoreQuestion = Extract<JevQuestion, { type: "score" }>;
export type JevAnswer = z.infer<typeof answerSchema>;
export type ChoiceAnswer = Extract<JevAnswer, { type: "choice" }>;
export type NoulAnswer = Extract<JevAnswer, { type: "noul" }>;
export type ScoreAnswer = Extract<JevAnswer, { type: "score" }>;
export type JevResponse = z.infer<typeof responseSchema>;
export type JevChoiceResponse = JevResponse;
export type JevState = unknown;

/** Validate against the original questions, not just the API envelope. */
export function parseResponse(raw: unknown, questions: Record<string, JevQuestion>): JevResponse {
  const response = responseSchema.parse(raw);
  const expected = Object.keys(questions).sort();
  if (JSON.stringify(Object.keys(response.answers).sort()) !== JSON.stringify(expected)) throw new Error("Jev answer IDs do not match the request");
  for (const [id, question] of Object.entries(questions)) {
    const answer = response.answers[id];
    if (!answer || answer.type !== question.type) throw new Error(`Jev answer kind mismatch for ${id}`);
    if (answer.type === "noul") continue;
    const keys = question.type === "choice" ? Object.keys(question.criteria).sort() : question.type === "score" ? question.criteria.map((_, index) => String(index)).sort() : [];
    if (JSON.stringify(Object.keys(answer.probabilities).sort()) !== JSON.stringify(keys)) throw new Error(`Jev probability keys mismatch for ${id}`);
    const sum = Object.values(answer.probabilities).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 0.01) throw new Error(`Jev probabilities do not sum to 1 for ${id}`);
    if (answer.type === "choice") {
      const selected = answer.probabilities[answer.choice];
      if (selected === undefined || selected < Math.max(...Object.values(answer.probabilities))) throw new Error(`Jev chose an invalid candidate for ${id}`);
    }
    if (answer.type === "score" && question.type === "score") {
      if (answer.score > question.criteria.length - 1 || JSON.stringify(Object.keys(answer.legend).sort()) !== JSON.stringify(keys)) throw new Error(`Jev score levels mismatch for ${id}`);
      const weighted = Object.entries(answer.probabilities).reduce((total, [level, value]) => total + Number(level) * value, 0);
      if (Math.abs(answer.score - weighted) > 0.01) throw new Error(`Jev score differs from its distribution for ${id}`);
    }
  }
  return response;
}
