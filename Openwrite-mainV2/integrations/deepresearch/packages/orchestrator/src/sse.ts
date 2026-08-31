import { streamResearch, type ResearchRunInput, type ResearchStreamMessage } from "./research-api.js";

export interface ResearchSseTarget {
  write(chunk: string): unknown;
  end(): unknown;
  writeHead?(statusCode: number, headers: Record<string, string>): unknown;
}

export interface ResearchSseOptions {
  writeHeaders?: boolean;
  connectedComment?: string;
  end?: boolean;
  suppressAbortErrors?: boolean;
  throwOnError?: boolean;
  onMessage?: (message: ResearchStreamMessage) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
}

export const researchSseHeaders: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export async function streamResearchToSse(
  target: ResearchSseTarget,
  input: ResearchRunInput,
  opts: ResearchSseOptions = {},
): Promise<void> {
  if (opts.writeHeaders !== false) target.writeHead?.(200, researchSseHeaders);
  const connectedComment = opts.connectedComment ?? "connected";
  if (connectedComment) target.write(`: ${connectedComment}\n\n`);

  try {
    for await (const message of streamResearch(input)) {
      await opts.onMessage?.(message);
      writeResearchSseMessage(target, message.type, message);
    }
  } catch (err) {
    if (input.signal?.aborted && opts.suppressAbortErrors !== false) return;
    await opts.onError?.(err);
    writeResearchSseMessage(target, "error", { error: messageOf(err) });
    if (opts.throwOnError) throw err;
  } finally {
    if (opts.end !== false) target.end();
  }
}

export function writeResearchSseMessage(target: Pick<ResearchSseTarget, "write">, event: string, data: unknown): void {
  target.write(encodeResearchSse(event, data));
}

export function encodeResearchSse(event: string, data: unknown): string {
  const name = event.replace(/[^\w.-]/g, "_") || "message";
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload.split(/\r?\n/).map((line) => `data: ${line}`).join("\n");
  return `event: ${name}\n${lines}\n\n`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
