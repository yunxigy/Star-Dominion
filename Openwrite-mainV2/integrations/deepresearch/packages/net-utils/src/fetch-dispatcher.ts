import type { Dispatcher } from "undici";

type UndiciFetch = (typeof import("undici"))["fetch"];
type UndiciRequestInit = NonNullable<Parameters<UndiciFetch>[1]>;

/**
 * Returns a fetch-shaped function backed by undici with the given dispatcher
 * (e.g. a ProxyAgent or an Agent composed with interceptors). The dispatcher
 * is typed through undici's own RequestInit, so no `as any` is needed; the
 * only assertion adapts undici's fetch signature to the DOM `typeof fetch`.
 */
export function fetchWithDispatcher(dispatcher: Dispatcher): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const undici = await import("undici");
    return await undici.fetch(input, { ...init, dispatcher } as UndiciRequestInit);
  }) as unknown as typeof fetch;
}

/** Fetch-shaped function routing requests through an HTTP proxy URL. */
export async function createProxyFetch(proxy: string): Promise<typeof fetch> {
  const undici = await import("undici");
  return fetchWithDispatcher(new undici.ProxyAgent({ uri: proxy }));
}
