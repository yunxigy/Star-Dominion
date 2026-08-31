import { fileURLToPath } from "node:url";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import { runDeepResearchBenchIICli } from "../deepresearch-bench-ii.js";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  console.log(`[proxy] Using: ${proxyUrl}`);
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl, connect: { timeout: 30000 } }));
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

await runDeepResearchBenchIICli({
  argv: process.argv,
  env: process.env,
  repoRoot,
  workspaceRoot,
});
