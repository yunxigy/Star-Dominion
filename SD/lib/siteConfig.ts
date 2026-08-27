export const SITE = {
  name: '逐梦工具箱',
  origin: 'https://zhumenggy.top',
  locale: 'zh_CN',
  language: 'zh-CN',
} as const;

export function absoluteSiteUrl(pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(path, `${SITE.origin}/`).toString();
  return pathname === '/' ? `${SITE.origin}/` : url.replace(/\/$/, '');
}
