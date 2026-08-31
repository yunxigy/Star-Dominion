import { fileURLToPath } from "node:url";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import { runDeepResearchBenchCli } from "../deepresearch-bench.js";

// ┌──────────────────────────────────────────────────────────────┐
// │  DEPRECATED — deepresearch-bench (v1) 已停用                  │
// │  请使用 deepresearch-bench-ii 代替                              │
// │  如果确实需要运行 v1，请添加 --confirm 标志                      │
// └──────────────────────────────────────────────────────────────┘
if (!process.argv.includes("--confirm")) {
  console.error("\x1b[31m%s\x1b[0m", "❌  DEPRECATED: deepresearch-bench (v1) 已停用！");
  console.error("");
  console.error("  你要跑的大概率是 DeepResearch Bench II (v2)，命令是：");
  console.error("");
  console.error("    pnpm deepresearch-bench-ii --ids <任务ID> [选项]");
  console.error("");
  console.error("  如果确实需要运行 v1，请添加 --confirm 标志：");
  console.error("");
  console.error("    pnpm deepresearch-bench --confirm --ids <任务ID>");
  console.error("");
  process.exit(1);
}

// 去掉 --confirm 参数，不干扰下游解析
process.argv = process.argv.filter(a => a !== "--confirm");

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  console.log(`[proxy] Using: ${proxyUrl}`);
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl, connect: { timeout: 30000 } }));
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

await runDeepResearchBenchCli({
  argv: process.argv,
  env: process.env,
  repoRoot,
  workspaceRoot,
});
