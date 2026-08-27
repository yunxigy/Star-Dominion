# Webmaster and SEO Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight local webmaster generators/parsers and four safely proxied network inspection tools as independent searchable routes.

**Architecture:** Pure browser-side generators live in one tested TypeScript core and share a consistent workbench. Network inspection runs in a new loopback-only FastAPI service on port 8012 with validated DNS resolution, public-address enforcement, pinned outbound connections, strict port/protocol limits, bounded redirects, small responses, timeouts, and rate limiting. The frontend never sends credentials, cookies, or arbitrary headers to inspected targets.

**Tech Stack:** React 18, TypeScript, Vitest, FastAPI, Pydantic, Python 3.11+, pytest, standard-library sockets/http.client/ssl, existing Vite/Nginx deployment patterns

---

## File map

- Create `SD/components/tools/webmaster/core.ts`: metadata, robots, sitemap, URL, UTM, slug, and UA functions.
- Create `SD/components/tools/webmaster/core.test.ts`: generator/parser tests.
- Create `SD/components/tools/webmaster/api.ts`: typed 8012 proxy client.
- Create `SD/components/tools/webmaster/api.test.ts`: response/error mapping tests.
- Create `SD/components/tools/webmaster/WebmasterWorkbench.tsx`: shared local/network UI.
- Create `SD/components/tools/webmaster/WebmasterTools.tsx`: twelve named tool exports.
- Create `SD/components/tools/webmaster/WebmasterTools.test.tsx`: representative user flows.
- Modify `SD/tools/registry.tsx`: webmaster category and routes.
- Modify `SD/seo/categoryContent.ts`: literal webmaster category content.
- Create `webmaster-inspector/pyproject.toml`: isolated Python package and test configuration.
- Create `webmaster-inspector/requirements.txt`: pinned runtime dependencies.
- Create `webmaster-inspector/webmaster_inspector/__init__.py`: package marker.
- Create `webmaster-inspector/webmaster_inspector/models.py`: request/response models.
- Create `webmaster-inspector/webmaster_inspector/policy.py`: outbound target validation and pinning.
- Create `webmaster-inspector/webmaster_inspector/checks.py`: HTTP, DNS, TLS, and WebSocket checks.
- Create `webmaster-inspector/webmaster_inspector/app.py`: API, rate limits, and error mapping.
- Create `webmaster-inspector/tests/test_policy.py`: SSRF and redirect tests.
- Create `webmaster-inspector/tests/test_checks.py`: bounded checker tests.
- Create `webmaster-inspector/tests/test_api.py`: endpoint contracts.
- Modify `SD/vite.config.ts`: `/webmaster-api` local proxy.
- Modify `scripts/local-services.json`: port 8012 process.
- Modify `scripts/check-local.ps1`: health check.
- Modify `scripts/tests/local-services.tests.ps1`: service manifest contract.
- Modify `deploy/nginx/site-modules.conf.example`: production proxy example only.
- Modify `deploy/baota/README.md`: service installation and route merge steps.
- Modify `README.md`: architecture/port/tool coverage.

### Task 1: Implement local metadata, robots, and sitemap generators

**Files:**
- Create: `SD/components/tools/webmaster/core.ts`
- Create: `SD/components/tools/webmaster/core.test.ts`

- [ ] **Step 1: Write failing generator tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildMetaTags, buildRobotsTxt, buildSitemapXml } from './core';

describe('webmaster generators', () => {
  it('escapes metadata and emits canonical/Open Graph tags', () => {
    const html = buildMetaTags({ title: 'A & B', description: '描述 "安全"', url: 'https://example.com/page', image: 'https://example.com/cover.png' });
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).toContain('content="描述 &quot;安全&quot;"');
    expect(html).toContain('property="og:url" content="https://example.com/page"');
  });

  it('builds robots rules and an escaped sitemap', () => {
    expect(buildRobotsTxt({ sitemap: 'https://example.com/sitemap.xml', disallow: ['/private', '/tmp'] })).toBe('User-agent: *\nDisallow: /private\nDisallow: /tmp\nSitemap: https://example.com/sitemap.xml\n');
    expect(buildSitemapXml([{ url: 'https://example.com/a?x=1&y=2', changefreq: 'weekly', priority: 0.8 }])).toContain('https://example.com/a?x=1&amp;y=2');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/webmaster/core.test.ts`

Expected: FAIL because `core.ts` does not exist.

- [ ] **Step 3: Implement safe generators**

Define `escapeHtml` for HTML attributes and `escapeXml` for XML text. `buildMetaTags` validates HTTP(S) URLs with `new URL`, requires title and description, and returns title, description, canonical, `og:*`, and `twitter:*` tags. `buildRobotsTxt` rejects newline characters in every path/URL and guarantees one trailing newline. `buildSitemapXml` rejects non-HTTP(S) URLs, clamps priority to `0..1`, allows only standard changefreq values, emits the XML declaration and `<urlset>`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/webmaster/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/webmaster/core.ts SD/components/tools/webmaster/core.test.ts
git commit -m "feat: add safe webmaster metadata generators"
```

### Task 2: Implement URL, UTM, slug, and User-Agent helpers

**Files:**
- Modify: `SD/components/tools/webmaster/core.ts`
- Modify: `SD/components/tools/webmaster/core.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
import { buildUtmUrl, parseUrl, parseUserAgent, slugify } from './core';

it('parses URLs and preserves repeated query values', () => {
  expect(parseUrl('https://user:pass@example.com:8443/a?x=1&x=2#part')).toMatchObject({
    protocol: 'https:', host: 'example.com:8443', pathname: '/a', hash: '#part', query: { x: ['1', '2'] }, hasCredentials: true,
  });
});

it('builds UTM URLs without deleting existing parameters', () => {
  expect(buildUtmUrl('https://example.com/?ref=home', { source: 'wechat', medium: 'social', campaign: 'summer' })).toBe('https://example.com/?ref=home&utm_source=wechat&utm_medium=social&utm_campaign=summer');
});

it('creates Unicode-safe slugs and identifies common clients', () => {
  expect(slugify(' 你好，World 2026 ')).toBe('你好-world-2026');
  expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toMatchObject({ browser: 'Safari', os: 'iOS', device: 'Mobile' });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/webmaster/core.test.ts`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the helpers**

`parseUrl` uses `new URL`, returns protocol, hostname, port, host, pathname, hash, origin, username-present/password-present combined as `hasCredentials`, and a record of query key to all values. `buildUtmUrl` requires source/medium/campaign, sets `utm_source`, `utm_medium`, `utm_campaign`, and optional term/content. `slugify` uses Unicode NFKC normalization, lowercasing, punctuation-to-hyphen conversion, repeated-hyphen collapse, and edge trim. `parseUserAgent` reports browser from Edge/Chrome/Firefox/Safari order, OS from Windows/macOS/Android/iOS/Linux, and device Mobile/Tablet/Desktop.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/webmaster/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/webmaster/core.ts SD/components/tools/webmaster/core.test.ts
git commit -m "feat: add webmaster URL and client parsers"
```

### Task 3: Define the inspector API contract

**Files:**
- Create: `webmaster-inspector/pyproject.toml`
- Create: `webmaster-inspector/requirements.txt`
- Create: `webmaster-inspector/webmaster_inspector/__init__.py`
- Create: `webmaster-inspector/webmaster_inspector/models.py`
- Create: `webmaster-inspector/tests/test_api.py`

- [ ] **Step 1: Create package configuration**

Use project name `webmaster-inspector`, Python `>=3.11`, and the repository-aligned runtime dependencies `fastapi==0.141.1`, `uvicorn[standard]==0.52.4`, and `pydantic-settings==2.15.0`; development dependencies are `pytest==9.1.1` and `httpx==0.28.1`. Configure pytest with `pythonpath = ["."]` and `testpaths = ["tests"]`. Mirror pinned runtime lines in `requirements.txt`.

- [ ] **Step 2: Write failing endpoint contract tests**

Use FastAPI `TestClient` with dependency overrides for checker functions. Assert `/health` returns `{ "status": "ok" }`; POST endpoints `/api/v1/http`, `/api/v1/dns`, `/api/v1/ssl`, and `/api/v1/websocket` accept only their typed payloads; unknown fields produce 422; policy errors map to `{ "code": "TARGET_BLOCKED", "message": "目标地址被安全策略拦截" }` with status 400.

- [ ] **Step 3: Run tests and verify RED**

Run: `cd webmaster-inspector && python -m pytest tests/test_api.py -q`

Expected: FAIL because app and models do not exist.

- [ ] **Step 4: Implement request/response models**

Create strict Pydantic models with `ConfigDict(extra='forbid')`:

```py
class HttpCheckRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: HttpUrl

class DnsCheckRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    hostname: str = Field(min_length=1, max_length=253, pattern=r'^[A-Za-z0-9.-]+$')

class SslCheckRequest(DnsCheckRequest):
    port: Literal[443] = 443

class WebSocketCheckRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=6, max_length=2048, pattern=r'^wss?://')
```

Define explicit response models for status, resolved public addresses, elapsed milliseconds, bounded headers, TLS subject/issuer/dates/SAN count, and WebSocket handshake status.

- [ ] **Step 5: Commit the contract skeleton**

```bash
git add webmaster-inspector
git commit -m "test: define webmaster inspector API contract"
```

### Task 4: Implement SSRF-safe target validation and pinned connections

**Files:**
- Create: `webmaster-inspector/webmaster_inspector/policy.py`
- Create: `webmaster-inspector/tests/test_policy.py`

- [ ] **Step 1: Write failing policy tests**

Cover rejection of localhost, IP literals, userinfo, non-HTTP(S)/WS(S) schemes, non-80/443 ports, DNS answers containing loopback/private/link-local/multicast/reserved/unspecified addresses, and a public hostname whose redirect resolves private. Cover IDNA normalization, relative redirects, maximum three redirects, and pinning the connection to the validated address while retaining the original Host/SNI.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd webmaster-inspector && python -m pytest tests/test_policy.py -q`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement hostname and address validation**

Use `urlsplit`, `socket.getaddrinfo`, and `ipaddress.ip_address`. Reject `parsed.username`, `parsed.password`, fragments, missing host, IP-literal hosts, invalid IDNA, and ports other than 80/443. Resolve every hostname and require at least one answer and `address.is_global` for every answer. Return a frozen `ValidatedTarget` containing normalized scheme, host, port, path/query, and one selected public IP.

- [ ] **Step 4: Implement pinned HTTP/TLS connection classes**

Subclass `http.client.HTTPConnection` so `connect()` opens `socket.create_connection((validated.ip, validated.port), timeout)`. Subclass HTTPS behavior to wrap the connected socket using `ssl.create_default_context().wrap_socket(sock, server_hostname=validated.host)`. Set Host to the validated hostname, never forward request headers from the caller, disable cookies/auth, read at most 128 KiB, and close after each request.

- [ ] **Step 5: Implement redirect validation**

For status 301/302/303/307/308, resolve `Location` with `urljoin`, validate the new URL from scratch, and stop after three redirects. Reject redirects that change from HTTPS to HTTP. Record the public redirect chain without response bodies.

- [ ] **Step 6: Run policy tests and verify GREEN**

Run: `cd webmaster-inspector && python -m pytest tests/test_policy.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add webmaster-inspector/webmaster_inspector/policy.py webmaster-inspector/tests/test_policy.py
git commit -m "feat: enforce pinned outbound target policy"
```

### Task 5: Implement bounded HTTP, DNS, TLS, and WebSocket checks

**Files:**
- Create: `webmaster-inspector/webmaster_inspector/checks.py`
- Create: `webmaster-inspector/tests/test_checks.py`

- [ ] **Step 1: Write failing checker tests**

Use fake resolver/connection/socket factories. Assert HTTP uses `HEAD` first and falls back to a zero-body `GET` only for 405/501; response headers are lowercased and limited to 50 entries/8 KiB. Assert DNS returns only public A/AAAA values. Assert TLS connects to the validated IP with original hostname SNI and parses notBefore/notAfter. Assert WebSocket sends a standards-compliant upgrade request with a random key and accepts only HTTP 101 with the correct `Sec-WebSocket-Accept` value.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd webmaster-inspector && python -m pytest tests/test_checks.py -q`

Expected: FAIL because checker functions do not exist.

- [ ] **Step 3: Implement the checkers**

Implement `check_http(url, policy)`, `check_dns(hostname, resolver)`, `check_ssl(hostname, policy)`, and `check_websocket(url, policy)` with a 7-second connect timeout and 10-second total deadline. WebSocket performs only the initial handshake, sends no application data, reads no more than 16 KiB, and immediately closes the socket. Return serializable dictionaries matching the response models.

- [ ] **Step 4: Run checker tests and verify GREEN**

Run: `cd webmaster-inspector && python -m pytest tests/test_checks.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add webmaster-inspector/webmaster_inspector/checks.py webmaster-inspector/tests/test_checks.py
git commit -m "feat: add bounded webmaster network checks"
```

### Task 6: Expose the FastAPI service with rate limits

**Files:**
- Create: `webmaster-inspector/webmaster_inspector/app.py`
- Modify: `webmaster-inspector/tests/test_api.py`

- [ ] **Step 1: Add failing rate/error tests**

Assert a client receives 429 after 30 inspection requests in 60 seconds, `Retry-After` is present, timeouts map to 504 `TARGET_TIMEOUT`, connection failures map to 502 `TARGET_UNAVAILABLE`, no endpoint reflects arbitrary exception text, and responses include `Cache-Control: no-store`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `cd webmaster-inspector && python -m pytest tests/test_api.py -q`

Expected: FAIL because the app is absent.

- [ ] **Step 3: Implement the app**

Create FastAPI with no permissive CORS middleware. Add an in-memory sliding-window limiter keyed by `request.client.host`, bounded to 10,000 client keys and pruned on access. Define the four POST endpoints and `/health`. Run synchronous socket checks with `anyio.to_thread.run_sync`. Map only known policy/timeout/connection exceptions to stable Chinese messages and codes. Add `Cache-Control: no-store` to inspection responses.

- [ ] **Step 4: Run the full service tests**

Run: `cd webmaster-inspector && python -m pytest -q`

Expected: PASS with no network access.

- [ ] **Step 5: Commit**

```bash
git add webmaster-inspector/webmaster_inspector/app.py webmaster-inspector/tests/test_api.py
git commit -m "feat: expose rate-limited webmaster inspector"
```

### Task 7: Build the frontend API client and twelve tool modes

**Files:**
- Create: `SD/components/tools/webmaster/api.ts`
- Create: `SD/components/tools/webmaster/api.test.ts`
- Create: `SD/components/tools/webmaster/WebmasterWorkbench.tsx`
- Create: `SD/components/tools/webmaster/WebmasterTools.tsx`
- Create: `SD/components/tools/webmaster/WebmasterTools.test.tsx`

- [ ] **Step 1: Write the failing API client test**

Mock `fetch` and assert `inspectHttp` posts JSON to `/webmaster-api/api/v1/http`, sends only `content-type`, maps `{ code, message }` errors, treats 429 as `请求过于频繁，请稍后再试`, and treats an unreachable service as `站长检测服务未连接`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `cd SD && npm test -- components/tools/webmaster/api.test.ts`

Expected: FAIL because `api.ts` does not exist.

- [ ] **Step 3: Implement the typed client**

Export `inspectHttp`, `inspectDns`, `inspectSsl`, and `inspectWebSocket` over one private `post<T>(path, body)` helper. Use `AbortSignal.timeout(12_000)`, `credentials: 'same-origin'`, no custom target headers, and stable error messages.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/webmaster/api.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing UI export tests**

Assert named exports for `MetaTagTool`, `OpenGraphPreviewTool`, `RobotsTxtTool`, `SitemapGeneratorTool`, `UrlParserTool`, `UtmBuilderTool`, `SlugGeneratorTool`, `UserAgentParserTool`, `SslCheckerTool`, `DnsLookupTool`, `HttpStatusTool`, and `WebSocketTesterTool`. Render Meta and URL modes, enter sample values, click Generate/Parse, and assert outputs.

- [ ] **Step 6: Run UI tests and verify RED**

Run: `cd SD && npm test -- components/tools/webmaster/WebmasterTools.test.tsx`

Expected: FAIL because the UI modules do not exist.

- [ ] **Step 7: Implement shared workbench and modes**

Use labelled controls, result panels, copy/download, loading state, `<p role="alert">`, and explicit privacy copy. The Open Graph preview must render values as React text/attributes and never use `dangerouslySetInnerHTML`. Network modes show inspected host, elapsed time, redirect chain, and the stable server result; disable submit while pending.

- [ ] **Step 8: Run frontend webmaster tests**

Run: `cd SD && npm test -- components/tools/webmaster`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add SD/components/tools/webmaster
git commit -m "feat: add webmaster generator and inspector interfaces"
```

### Task 8: Register the webmaster category

**Files:**
- Modify: `SD/tools/registry.tsx`
- Modify: `SD/seo/categoryContent.ts`
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Add the failing registry contract**

Assert category `webmaster` exists with exactly these tool IDs: `meta-tag-generator`, `open-graph-preview`, `robots-txt-generator`, `sitemap-generator`, `url-parser`, `utm-builder`, `slug-generator`, `user-agent-parser`, `ssl-checker`, `dns-lookup`, `http-status-checker`, `websocket-tester`. Assert the first eight are local/stable and the last four are `third-party-api`/beta.

- [ ] **Step 2: Run the registry test and verify RED**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts`

Expected: FAIL because the category is absent.

- [ ] **Step 3: Register category and lazy tool exports**

Add `'webmaster'` to the category union. Add category `{ id: 'webmaster', name: '站长工具', description: 'SEO 元数据、网站配置与网络状态检查', icon: 'Globe2', gradient: 'from-indigo-600 to-sky-600' }`. Add twelve named lazy imports from `WebmasterTools.tsx`, independent metadata rows, and Chinese/pinyin/English intent tags.

- [ ] **Step 4: Add literal SEO content**

```ts
webmaster: {
  description: '提供 Meta、Open Graph、robots.txt、sitemap、URL、UTM、Slug 与 User-Agent 工具，并通过受控服务检查公开网站的 HTTP、DNS、SSL 和 WebSocket 状态。',
  features: ['SEO 配置生成', '网址与客户端解析', '受控网络状态检查'],
  faq: [
    { question: '网络检查可以访问内网吗？', answer: '不可以，服务会拒绝本机、私网、保留地址和非标准端口，并在每次跳转后重新校验。' },
    { question: '会向目标网站发送登录信息吗？', answer: '不会，检测请求不转发浏览器 Cookie、Authorization 或用户自定义请求头。' },
  ],
},
```

- [ ] **Step 5: Run registry/SEO/build tests**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts seo/categoryContent.test.ts seo/pageMetadata.test.ts scripts/generate-static-pages.test.ts && npm run build`

Expected: PASS and generated category/tool pages exist.

- [ ] **Step 6: Commit**

```bash
git add SD/tools/registry.tsx SD/seo/categoryContent.ts SD/tools/registryMetadata.test.ts SD/public/sitemap.xml
git commit -m "feat: register webmaster and SEO tools"
```

### Task 9: Wire local and deployment service manifests

**Files:**
- Modify: `SD/vite.config.ts`
- Modify: `scripts/local-services.json`
- Modify: `scripts/check-local.ps1`
- Modify: `scripts/tests/local-services.tests.ps1`
- Modify: `deploy/nginx/site-modules.conf.example`
- Modify: `deploy/baota/README.md`
- Modify: `README.md`

- [ ] **Step 1: Add failing service manifest tests**

Assert a service named `webmaster-inspector` uses working directory `webmaster-inspector`, port 8012, command `python -m uvicorn webmaster_inspector.app:app --host 127.0.0.1 --port 8012 --workers 1`, and health URL `http://127.0.0.1:8012/health`.

- [ ] **Step 2: Run manifest tests and verify RED**

Run: `Invoke-Pester scripts/tests/local-services.tests.ps1`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Add local service and Vite proxy**

Append the exact manifest entry from Step 1. Add `/webmaster-api` proxy to `http://127.0.0.1:8012` with prefix removal and 15-second timeout. Extend `check-local.ps1` to request `/health` and report the result without exposing request targets.

- [ ] **Step 4: Add the deployment proxy example**

```nginx
location ^~ /webmaster-api/ {
    proxy_pass http://127.0.0.1:8012/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 15s;
    proxy_send_timeout 15s;
    client_max_body_size 8k;
    add_header Cache-Control "no-store" always;
    access_log off;
}
```

Do not edit TLS certificate directives. Document that this location is merged into the existing Baota server only after `nginx -t` passes.

- [ ] **Step 5: Update deployment and architecture docs**

Add port 8012, installation `python -m pip install -e "<SITE_ROOT>/webmaster-inspector"`, one-worker Uvicorn command, proxy path, no-credential/no-private-network boundary, and offline test command. Update the root port table and tree.

- [ ] **Step 6: Run service and frontend verification**

Run: `Invoke-Pester scripts/tests/local-services.tests.ps1`

Expected: PASS.

Run: `cd webmaster-inspector && python -m pytest -q`

Expected: PASS.

Run: `cd SD && npm test -- components/tools/webmaster && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add SD/vite.config.ts scripts/local-services.json scripts/check-local.ps1 scripts/tests/local-services.tests.ps1 deploy/nginx/site-modules.conf.example deploy/baota/README.md README.md
git commit -m "chore: wire webmaster inspector deployment"
```

### Task 10: Final security and browser verification

**Files:**
- Modify: `webmaster-inspector/webmaster_inspector/policy.py`
- Modify: `webmaster-inspector/webmaster_inspector/checks.py`
- Modify: `webmaster-inspector/webmaster_inspector/app.py`
- Modify: `SD/components/tools/webmaster/api.ts`
- Modify: `SD/components/tools/webmaster/WebmasterTools.tsx`
- Modify: `SD/tools/registry.tsx`

- [ ] **Step 1: Run complete offline test suites**

Run: `cd webmaster-inspector && python -m pytest -q`

Expected: all tests pass without external network access.

Run: `cd SD && npm test && npm run lint && npm run validate && npm run build`

Expected: all commands exit 0.

- [ ] **Step 2: Start the service and frontend locally**

Run the inspector on 127.0.0.1:8012 and Vite through the existing local service script. Confirm `/health` responds and the frontend reports the service online.

- [ ] **Step 3: Verify security blocks**

From the UI or local API, submit `http://127.0.0.1`, `http://localhost`, `http://169.254.169.254`, `http://10.0.0.1`, `http://[::1]`, `ftp://example.com`, and `https://example.com:8443`. Expected: every request is rejected with the stable blocked-target message and no outbound connection attempt.

- [ ] **Step 4: Verify representative public targets with authorization**

Use only a public domain controlled by the deployer or `example.com`. Confirm HTTP, DNS, SSL, and WSS result layouts at desktop and 390×844 widths. Do not run broad scans or automated enumeration.

- [ ] **Step 5: Commit concrete verification fixes**

```bash
git add webmaster-inspector SD/components/tools/webmaster SD/tools/registry.tsx SD/seo/categoryContent.ts scripts deploy README.md
git commit -m "fix: resolve webmaster verification findings"
```

Do not create an empty commit when no fixes were required.
