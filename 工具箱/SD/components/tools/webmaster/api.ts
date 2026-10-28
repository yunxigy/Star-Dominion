export type HttpInspection = {
  status: number;
  elapsed_ms: number;
  resolved_addresses: string[];
  headers: Record<string, string>;
  redirect_chain: string[];
  detail?: string | null;
};
export type DnsInspection = { hostname: string; addresses: string[]; elapsed_ms: number };
export type SslInspection = { hostname: string; port: number; protocol: string; cipher?: string | null; subject?: string | null; issuer?: string | null; not_before?: string | null; not_after?: string | null; san_count: number; elapsed_ms: number; resolved_addresses: string[] };
export type WebSocketInspection = { status: string; handshake_ok: boolean; elapsed_ms: number; resolved_addresses: string[]; detail?: string | null };

const timeoutSignal = (milliseconds: number): AbortSignal | undefined => {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) return AbortSignal.timeout(milliseconds);
  return undefined;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/webmaster-api/api/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      ...(timeoutSignal(12_000) ? { signal: timeoutSignal(12_000) } : {}),
    });
  } catch {
    throw new Error('站长检测服务未连接');
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error('请求过于频繁，请稍后再试');
    try {
      const payload = await response.json() as { message?: string; detail?: string };
      throw new Error(payload.message || payload.detail || '站长检测失败');
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
      throw new Error('站长检测失败，请稍后重试');
    }
  }
  return response.json() as Promise<T>;
}

export const inspectHttp = (url: string) => post<HttpInspection>('http', { url });
export const inspectDns = (hostname: string) => post<DnsInspection>('dns', { hostname });
export const inspectSsl = (hostname: string) => post<SslInspection>('ssl', { hostname });
export const inspectWebSocket = (url: string) => post<WebSocketInspection>('websocket', { url });
