export interface WebUrlParts {
  protocol: string;
  hostname: string;
  port: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  username: string;
  password: string;
}

export type QueryPair = [string, string];

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

export function parseWebUrl(value: string): WebUrlParts {
  const input = value.trim();
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/iu.exec(input);
  if (!match) throw new Error('请输入有效的网络地址');

  const protocol = `${match[1].toLocaleLowerCase()}:`;
  const authority = match[2];
  const pathname = match[3] || '/';
  const search = match[4] === undefined ? '' : `?${match[4]}`;
  const hash = match[5] === undefined ? '' : `#${match[5]}`;
  if (!authority || /\s/u.test(authority) || !pathname.startsWith('/')) throw new Error('请输入有效的网络地址');

  let hostPort = authority;
  let username = '';
  let password = '';
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    const credentials = authority.slice(0, at);
    hostPort = authority.slice(at + 1);
    const separator = credentials.indexOf(':');
    username = separator < 0 ? credentials : credentials.slice(0, separator);
    password = separator < 0 ? '' : credentials.slice(separator + 1);
  }

  let hostname = '';
  let port = '';
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close < 0) throw new Error('请输入有效的网络地址');
    hostname = hostPort.slice(1, close);
    const remainder = hostPort.slice(close + 1);
    if (remainder && !/^:\d+$/u.test(remainder)) throw new Error('请输入有效的网络地址');
    port = remainder ? remainder.slice(1) : '';
  } else {
    const separator = hostPort.lastIndexOf(':');
    if (separator >= 0) {
      const possiblePort = hostPort.slice(separator + 1);
      if (!/^\d+$/u.test(possiblePort) || hostPort.slice(0, separator).includes(':')) throw new Error('请输入有效的网络地址');
      hostname = hostPort.slice(0, separator);
      port = possiblePort;
    } else {
      hostname = hostPort;
    }
  }

  if (!hostname || /[\[\]?#/\s]/u.test(hostname) || (port && Number(port) > 65535)) throw new Error('请输入有效的网络地址');
  const normalizedHostname = hostname.toLocaleLowerCase();
  const host = `${hostPort.startsWith('[') ? `[${normalizedHostname}]` : normalizedHostname}${port ? `:${port}` : ''}`;
  return {
    protocol,
    hostname: normalizedHostname,
    port,
    host,
    pathname,
    search,
    hash,
    origin: `${protocol}//${host}`,
    username,
    password,
  };
}

export function serializeWebUrl(parts: WebUrlParts, query = parts.search.slice(1)): string {
  const credentials = parts.username || parts.password ? `${parts.username}${parts.password ? `:${parts.password}` : ''}@` : '';
  const search = query ? `?${query}` : '';
  return `${parts.protocol}//${credentials}${parts.host}${parts.pathname}${search}${parts.hash}`;
}

export function parseQuery(search: string): QueryPair[] {
  const raw = search.replace(/^\?/u, '');
  if (!raw) return [];
  return raw.split('&').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator < 0
      ? [decodePart(part), '']
      : [decodePart(part.slice(0, separator)), decodePart(part.slice(separator + 1))];
  });
}

export function serializeQuery(pairs: QueryPair[]): string {
  return pairs.map(([key, value]) => `${encodePart(key)}=${encodePart(value)}`).join('&');
}

export function queryRecord(search: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  parseQuery(search).forEach(([key, value]) => {
    (result[key] ??= []).push(value);
  });
  return result;
}

export function setQueryParameter(search: string, key: string, value: string): string {
  const pairs = parseQuery(search).filter(([currentKey]) => currentKey !== key);
  pairs.push([key, value]);
  return serializeQuery(pairs);
}
