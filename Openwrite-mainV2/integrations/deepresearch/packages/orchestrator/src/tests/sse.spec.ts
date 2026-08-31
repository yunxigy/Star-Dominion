import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchProvider } from "@deepresearch/contracts";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { encodeResearchSse, streamResearchToSse, type ResearchSseTarget } from "../index.js";

describe("research SSE adapter", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("encodes SSE events with safe event names and multiline data", () => {
    expect(encodeResearchSse("frame bad", "a\nb")).toBe("event: frame_bad\ndata: a\ndata: b\n\n");
  });

  it("streams research messages to a writable SSE target", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-sse-"));
    dirs.push(artifactDir);
    const target = memoryTarget();

    await streamResearchToSse(target, {
      prompt: "SSE adapter backend smoke research task",
      artifactDir,
      language: "en",
      maxCycles: 1,
      streamMode: "steps",
      llm: new EchoJsonLlm(),
      search: mockSearch(),
    });

    expect(target.statusCode).toBe(200);
    expect(target.headers?.["content-type"]).toContain("text/event-stream");
    expect(target.body).toContain(": connected\n\n");
    expect(target.body).toContain("event: frame\n");
    expect(target.body).toContain("event: result\n");
    expect(target.ended).toBe(true);
  });

  it("writes error events when streaming fails after headers", async () => {
    const target = memoryTarget();

    await streamResearchToSse(target, {
      prompt: "SSE error smoke",
      llm: new EchoJsonLlm(),
      search: mockSearch(),
      onFrame() {
        throw new Error("SSE sink failed");
      },
    });

    expect(target.body).toContain("event: error\n");
    expect(target.body).toContain("SSE sink failed");
    expect(target.ended).toBe(true);
  });
});

interface MemoryTarget extends ResearchSseTarget {
  body: string;
  ended: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
}

function memoryTarget(): MemoryTarget {
  return {
    body: "",
    ended: false,
    write(chunk: string) {
      this.body += chunk;
    },
    end() {
      this.ended = true;
    },
    writeHead(statusCode: number, headers: Record<string, string>) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
  };
}

function mockSearch(): SearchProvider {
  return {
    name: "sse-test-search",
    async search(query, topK) {
      return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
        url: `https://example.test/sse/${index + 1}`,
        title: `SSE source ${index + 1}`,
        snippet: `Evidence for ${query}`,
      }));
    },
  };
}
