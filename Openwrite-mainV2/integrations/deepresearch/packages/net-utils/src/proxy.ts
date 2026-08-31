import { execFileSync } from "node:child_process";

/** Proxy URL from the conventional environment variables, if any. */
export function envProxy(): string | undefined {
  return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
}

/** macOS system proxy from `scutil --proxy`; undefined elsewhere or on failure. */
export function macosSystemProxy(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const output = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 1000 });
    const httpsEnabled = /\n\s*HTTPSEnable\s*:\s*1\b/.test(output);
    const httpEnabled = /\n\s*HTTPEnable\s*:\s*1\b/.test(output);
    const host = valueFor(output, httpsEnabled ? "HTTPSProxy" : "HTTPProxy");
    const port = valueFor(output, httpsEnabled ? "HTTPSPort" : "HTTPPort");
    if ((httpsEnabled || httpEnabled) && host && port) return `http://${host}:${port}`;
  } catch {
    return undefined;
  }
  return undefined;
}

function valueFor(output: string, key: string): string | undefined {
  return output.match(new RegExp(`\\n\\s*${key}\\s*:\\s*(.+)`))?.[1]?.trim();
}
