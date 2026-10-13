import { GatewayError, record } from "./transport.js";

export class StreamFailure extends GatewayError {
  constructor(status: number, streamStarted: boolean, readonly partialText: string) { super(status, undefined, streamStarted); }
}
/** Completion framing, not socket closure, proves success. Any delivered data blocks replay. */
export async function consumeStream(response: Response, onChunk?: (chunk: string) => void): Promise<string> {
  if (!response.body) throw new StreamFailure(502, false, "");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let started = false;
  let complete = false;
  const processFrame = (frame: string): void => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { complete = true; return; }
    let value: unknown;
    try { value = JSON.parse(data); } catch { throw new StreamFailure(502, started, output); }
    if (!record(value)) throw new StreamFailure(502, started, output);
    if (value.error) {
      const status = record(value.error) && typeof value.error.code === "number" ? value.error.code : record(value.error) && typeof value.error.status === "number" ? value.error.status : 502;
      throw new StreamFailure(status, started, output);
    }
    // Includes tool/thinking/role/usage chunks, not only visible content.
    started = true;
    onChunk?.(data);
    if (Array.isArray(value.choices)) for (const choice of value.choices) {
      if (!record(choice) || !record(choice.delta)) continue;
      if (typeof choice.delta.content === "string") output += choice.delta.content;
    }
    if (output.length > 4 * 1024 * 1024) throw new StreamFailure(502, started, output);
  };
  try {
    while (!complete) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 1024 * 1024) throw new StreamFailure(502, started, output);
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) { processFrame(frame); if (complete) break; }
      if (chunk.done) {
        if (buffer) processFrame(buffer);
        if (!complete) throw new StreamFailure(502, started, output);
      }
    }
    return output;
  } catch (error) {
    if (error instanceof StreamFailure) throw error;
    throw new StreamFailure(502, started, output);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
