/**
 * 在 Node.js 中强制所有 fetch 请求走 HTTP 代理。
 * 用法：node --import ./proxy-loader.ts your-script.ts
 * 或者：GLOBAL_AGENT_HTTP_PROXY=http://127.0.0.1:7892 node -r ./proxy-loader.ts ...
 */
import { setGlobalDispatcher, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
if (proxyUrl) {
  console.log(`[proxy-loader] Using proxy: ${proxyUrl}`);
  setGlobalDispatcher(new ProxyAgent({
    uri: proxyUrl,
    connect: { timeout: 30000 },
  }));
}
