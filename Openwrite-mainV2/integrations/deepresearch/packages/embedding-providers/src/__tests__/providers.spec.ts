import { describe, expect, it } from "vitest";
import { FeatureHashEmbedding } from "../providers/feature-hash-embedding.js";
import { DeepSeekChat } from "../providers/deepseek-chat.js";
import { OpenAICompatibleChat } from "../providers/openai-compatible-chat.js";
import { featureHash, cosine, fnv1a, tokenize, stableId } from "../internal/feature-hash.js";
import { createEmbeddingProvider, createLlmChat, createLlmChatFromEnv } from "../index.js";

describe("feature-hash utility", () => {
  it("fnv1a 稳定", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
  });
  it("tokenize 切英文 + 中文", () => {
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
    expect(tokenize("RL 方法")).toContain("rl");
    expect(tokenize("RL 方法").filter((t) => t.length === 1).length).toBeGreaterThan(0);
  });
  it("featureHash L2 归一", () => {
    const v = featureHash("RL DPO PPO", 64);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
  it("stableId 同文本同 id", () => {
    expect(stableId("emb", "DPO")).toBe(stableId("emb", "DPO"));
    expect(stableId("emb", "DPO")).not.toBe(stableId("emb", "PPO"));
  });
});

describe("FeatureHashEmbedding", () => {
  it("embed 返回带 id 的 vector", async () => {
    const p = new FeatureHashEmbedding({ dim: 64 });
    const r = await p.embed({ text: "DPO 比 PPO 简单" });
    expect(r.id).toMatch(/^emb_/);
    expect(r.vector.length).toBe(64);
    expect(r.dim).toBe(64);
    expect(r.model).toBe("feature-hash");
  });
  it("显式 id 优先", async () => {
    const p = new FeatureHashEmbedding();
    const r = await p.embed({ text: "x", id: "my_id" });
    expect(r.id).toBe("my_id");
  });
  it("embedBatch 一次性返回", async () => {
    const p = new FeatureHashEmbedding({ dim: 32 });
    const rs = await p.embedBatch([{ text: "A" }, { text: "B" }, { text: "A" }]);
    expect(rs.length).toBe(3);
    // 同 text 同 id（稳定 hash）
    expect(rs[0]!.id).toBe(rs[2]!.id);
  });
  it("同主题 cosine 高于异主题", async () => {
    const p = new FeatureHashEmbedding({ dim: 256 });
    const a = await p.embed({ text: "RLHF DPO PPO IPO preference optimization" });
    const b = await p.embed({ text: "DPO IPO KTO preference optimization method" });
    const c = await p.embed({ text: "图像分类 ImageNet CNN ResNet" });
    const sAB = p.cosine(a.vector, b.vector);
    const sAC = p.cosine(a.vector, c.vector);
    expect(sAB).toBeGreaterThan(sAC);
  });
  it("cosine 范围 [-1, 1]", () => {
    const p = new FeatureHashEmbedding();
    const v = featureHash("test", 16);
    expect(p.cosine(v, v)).toBeCloseTo(1, 5);
  });
});

describe("createEmbeddingProvider 工厂", () => {
  it("kind=feature-hash 返回 FeatureHashEmbedding", () => {
    const p = createEmbeddingProvider({ kind: "feature-hash" });
    expect(p.name).toBe("feature-hash");
  });
  it("kind=openai-compatible 返回 OpenAICompatible", () => {
    const p = createEmbeddingProvider({
      kind: "openai-compatible",
      options: { baseUrl: "http://localhost:8080/v1", apiKey: "k", model: "m" },
    });
    expect(p.name).toBe("openai-compatible");
  });
  it("kind=llm-rerank 返回 LlmRerank", () => {
    const p = createEmbeddingProvider({
      kind: "llm-rerank",
      options: { scoreFn: async () => 0.5 },
    });
    expect(p.name).toBe("llm-rerank");
  });
  it("非法 kind 走 never 分支", () => {
    expect(() =>
      createEmbeddingProvider({ kind: "unknown" as never, options: undefined as never })
    ).toThrow();
  });
});

describe("OpenAICompatibleChat", () => {
  it("calls chat/completions without temperature by default", async () => {
    let captured: unknown;
    const llm = new OpenAICompatibleChat({
      apiKey: "test-key",
      baseUrl: "https://proxy.example/v1",
      model: "gpt-5.5",
      reasoningEffort: "low",
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }));
      },
    });

    const res = await llm.chat({ system: "sys", user: "user", json: true, temperature: 0.2, maxTokens: 128 });

    expect(res.content).toBe("ok");
    expect(captured).toMatchObject({
      model: "gpt-5.5",
      max_completion_tokens: 128,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    });
    expect(captured).not.toHaveProperty("temperature");
  });
  it("can call BigModel-compatible chat/completions with max_tokens", async () => {
    let captured: unknown;
    let calledUrl = "";
    const llm = new OpenAICompatibleChat({
      apiKey: "test-key",
      providerName: "bigmodel",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.7-flash",
      includeReasoningEffort: false,
      includeTemperature: true,
      chatCompletionsMaxTokensParam: "max_tokens",
      chatCompletionsExtraBody: { thinking: { type: "disabled" } },
      fetchImpl: async (url, init) => {
        calledUrl = String(url);
        captured = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }));
      },
    });

    const res = await llm.chat({ user: "user", json: true, temperature: 0.2, maxTokens: 128 });

    expect(llm.name).toBe("bigmodel");
    expect(res.content).toBe("ok");
    expect(calledUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(captured).toMatchObject({
      model: "glm-4.7-flash",
      max_tokens: 128,
      temperature: 0.2,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    });
    expect(captured).not.toHaveProperty("max_completion_tokens");
    expect(captured).not.toHaveProperty("reasoning_effort");
  });
});

describe("DeepSeekChat", () => {
  it("passes JSON response_format when json mode is requested", async () => {
    let captured: unknown;
    const llm = new DeepSeekChat({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test/v1",
      model: "deepseek-chat",
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }));
      },
    });

    const res = await llm.chat({ system: "sys", user: "user", json: true, temperature: 0.2, maxTokens: 128 });

    expect(res.content).toBe("{\"ok\":true}");
    expect(captured).toMatchObject({
      model: "deepseek-chat",
      max_tokens: 128,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
  });

  it("retries once with fallback max_tokens when DeepSeek rejects a larger report budget", async () => {
    const captured: unknown[] = [];
    const llm = new DeepSeekChat({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test/v1",
      model: "deepseek-chat",
      maxTokensFallback: 8192,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        captured.push(body);
        if (captured.length === 1) {
          return new Response(JSON.stringify({ error: { message: "max_tokens exceeds model limit" } }), { status: 400 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }));
      },
    });

    const res = await llm.chat({ user: "long report", maxTokens: 16384 });

    expect(res.content).toBe("ok");
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({ max_tokens: 16384 });
    expect(captured[1]).toMatchObject({ max_tokens: 8192 });
  });

  it("retries transient DeepSeek-compatible HTTP failures", async () => {
    let calls = 0;
    const llm = new DeepSeekChat({
      apiKey: "test-key",
      baseUrl: "https://relay.deepseek.test/v1",
      model: "deepseek-v4-flash",
      retry: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { message: "bad gateway" } }), { status: 502 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }));
      },
    });

    const res = await llm.chat({ user: "hello" });

    expect(res.content).toBe("ok");
    expect(calls).toBe(2);
  });

  it("preserves network cause details when a DeepSeek request fails", async () => {
    const llm = new DeepSeekChat({
      apiKey: "test-key",
      baseUrl: "https://relay.deepseek.test/v1",
      retry: 0,
      fetchImpl: async () => {
        const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
        error.cause = Object.assign(new Error("socket disconnected"), { code: "ECONNRESET", syscall: "read", hostname: "relay.deepseek.test" });
        throw error;
      },
    });

    await expect(llm.chat({ user: "hello" })).rejects.toThrow(
      "DeepSeek API fetch failed: TypeError: fetch failed; cause=ECONNRESET read relay.deepseek.test socket disconnected",
    );
  });
});

describe("createLlmChat 工厂", () => {
  it("provider=echo 返回 EchoLlmChat", () => {
    const llm = createLlmChat({ provider: "echo" });
    expect(llm.name).toBe("echo");
  });
  it("provider=deepseek 返回 DeepSeekChat", () => {
    const llm = createLlmChat({ provider: "deepseek", options: { apiKey: "sk-test" } });
    expect(llm.name).toBe("deepseek");
  });
  it("provider=bigmodel 返回 BigModel-compatible chat", () => {
    const llm = createLlmChat({ provider: "bigmodel", options: { apiKey: "sk-test" } });
    expect(llm.name).toBe("bigmodel");
  });
  it("provider=openai 返回 OpenAICompatibleChat", () => {
    const llm = createLlmChat({ provider: "openai", options: { apiKey: "sk-test" } });
    expect(llm.name).toBe("openai-compatible");
  });
  it("非法 provider 走 never 分支", () => {
    expect(() =>
      createLlmChat({ provider: "unknown" as never, options: undefined as never })
    ).toThrow();
  });
});

describe("createLlmChatFromEnv 工厂", () => {
  it("缺省 provider 读 BIGMODEL_API_KEY", () => {
    const llm = createLlmChatFromEnv({
      env: { BIGMODEL_API_KEY: "sk-test" } as NodeJS.ProcessEnv,
    });
    expect(llm.name).toBe("bigmodel");
  });
  it("provider=deepseek 显式读 DEEPSEEK_API_KEY", () => {
    const llm = createLlmChatFromEnv({
      env: { DEEPSEEK_API_KEY: "sk-test" } as NodeJS.ProcessEnv,
      providerOverride: "deepseek",
    });
    expect(llm.name).toBe("deepseek");
  });
  it("缺省 provider 可从 AGENT_PROVIDER 选择 DeepSeek-compatible", () => {
    const llm = createLlmChatFromEnv({
      env: {
        AGENT_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "sk-test",
        DEEPSEEK_BASE_URL: "https://relay.deepseek.test/v1",
        DEEPSEEK_MODEL: "deepseek-v4-flash",
        DEEPSEEK_RETRY: "5",
      } as NodeJS.ProcessEnv,
    });
    expect(llm.name).toBe("deepseek");
  });
  it("provider=openai 读 OPENAI_API_KEY", () => {
    const llm = createLlmChatFromEnv({
      env: { OPENAI_API_KEY: "sk-test" } as NodeJS.ProcessEnv,
      providerOverride: "openai",
    });
    expect(llm.name).toBe("openai-compatible");
  });
  it("provider=echo 不需要 API key", () => {
    const llm = createLlmChatFromEnv({
      env: {} as NodeJS.ProcessEnv,
      providerOverride: "echo",
    });
    expect(llm.name).toBe("echo");
  });
  it("缺 BIGMODEL_API_KEY 时抛错", () => {
    expect(() =>
      createLlmChatFromEnv({ env: {} as NodeJS.ProcessEnv })
    ).toThrow("BIGMODEL_API_KEY is required");
  });
  it("provider=deepseek 缺 DEEPSEEK_API_KEY 时抛错", () => {
    expect(() =>
      createLlmChatFromEnv({ env: {} as NodeJS.ProcessEnv, providerOverride: "deepseek" })
    ).toThrow("DEEPSEEK_API_KEY is required");
  });
  it("provider=openai 缺 OPENAI_API_KEY 时抛错", () => {
    expect(() =>
      createLlmChatFromEnv({ env: {} as NodeJS.ProcessEnv, providerOverride: "openai" })
    ).toThrow("OPENAI_API_KEY is required");
  });
  it("cwd 中的 .env.local 会补充并覆盖旧环境变量", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "dr-env-"));
    try {
      await writeFile(join(dir, ".env.local"), "BIGMODEL_API_KEY=test-from-file\nBIGMODEL_MODEL=glm-4.7-flash\n");
      const llm = createLlmChatFromEnv({
        env: { BIGMODEL_API_KEY: "sk-old", BIGMODEL_MODEL: "glm-5.2" } as NodeJS.ProcessEnv,
        cwd: dir,
      });
      expect(llm.name).toBe("bigmodel");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("allows callers with a pre-merged environment to skip local env loading", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "dr-env-skip-"));
    try {
      await writeFile(join(dir, ".env.local"), "BIGMODEL_API_KEY=test-from-file\n");
      expect(() => createLlmChatFromEnv({ env: {}, cwd: dir, loadEnvFile: false })).toThrow("BIGMODEL_API_KEY is required");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
