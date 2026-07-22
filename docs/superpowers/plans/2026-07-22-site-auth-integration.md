# Unified Site Authentication and Module Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally verify one secure site-wide login shared by SD, ShouAnRen, and the stock module while normalizing backend ports, repairing plagiarism checking, and consolidating the stock upstreams under the root Git repository.

**Architecture:** A standalone FastAPI service on port 8000 owns users and opaque server-side sessions. Browser credentials live in HttpOnly cookies; ShouAnRen and the stock API validate those sessions through a localhost-only authenticated introspection endpoint. Public site and market-data reads remain anonymous, while private operations derive their owner ID from the authenticated site user.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy, Argon2id, HTTPX, Pytest, React 18/19, TypeScript, Vite, Nginx.

---

## File map

New authentication service:

- `site-auth/pyproject.toml`: runtime, test dependencies, CLI entry point.
- `site-auth/site_auth/config.py`: validated environment configuration with no secret defaults.
- `site-auth/site_auth/database.py`: SQLite engine/session construction.
- `site-auth/site_auth/models.py`: `User` and `Session` persistence models.
- `site-auth/site_auth/passwords.py`: Argon2id hash and verify boundary.
- `site-auth/site_auth/session_service.py`: opaque session creation, validation, CSRF, revocation.
- `site-auth/site_auth/schemas.py`: public request/response contracts.
- `site-auth/site_auth/dependencies.py`: browser and administrator dependencies.
- `site-auth/site_auth/routes.py`: login/logout/me and administrator APIs.
- `site-auth/site_auth/internal.py`: service-key-protected session introspection.
- `site-auth/site_auth/main.py`: application factory and port-8000 entry point.
- `site-auth/site_auth/cli.py`: interactive administrator creation/reset.
- `site-auth/tests/*`: auth behavior and security regression tests.

Consumers and deployment:

- `SD/lib/siteAuth.ts`, `SD/context/AuthContext.tsx`, `SD/pages/LoginPage.tsx`: browser session client and login UI.
- `SD/App.tsx`, `SD/index.tsx`, `SD/layouts/AppLayout.tsx`, `SD/vite.config.ts`: route, provider, status UI, proxies.
- `守岸人3.0/server/middleware/auth.py`: central-session adapter and compatible site-user type.
- `守岸人3.0/server/routers/auth.py`: legacy auth redirects/retirement behavior.
- `守岸人3.0/server/main.py`, `守岸人3.0/server/config.py`: remove default administrator bootstrap and move to 8006.
- `守岸人3.0/frontend/js/auth.js`, login/register HTML: unified-login redirect and cookie-based requests.
- `守岸人3.0/tests/*`: central-session adapter and protected-route tests.
- `stock-research-package/stock-module/backend/app/security/site_auth.py`: central-session dependency.
- `stock-research-package/stock-module/backend/app/main.py`, `gateway_main.py`: authenticated owner IDs and public/private split.
- `stock-research-package/stock-module/backend/tests/*`: authorization and owner-isolation tests.
- `stock-research-package/stock-module/frontend/src/api.ts`, `App.tsx`: credentials and login redirect handling.
- `plagiarism/main.py`, `plagiarism/tests/test_api.py`: port, contract and upload validation.
- `SD/components/tools/document/PlagiarismCheck.tsx`: matching upload/response contract.
- `4G/4G.py`, `SD/pages/Stm32Window.tsx`: ports 8007/8008 and WebSocket path.
- `nginx.conf`: local/reference routing only; never blindly overwrite BaoTa production config.
- `scripts/start-local.ps1`, `scripts/check-local.ps1`: deterministic local orchestration and health checks.

### Task 1: Scaffold site-auth configuration and persistence

**Files:**
- Create: `site-auth/pyproject.toml`
- Create: `site-auth/site_auth/__init__.py`
- Create: `site-auth/site_auth/config.py`
- Create: `site-auth/site_auth/database.py`
- Create: `site-auth/site_auth/models.py`
- Create: `site-auth/site_auth/passwords.py`
- Create: `site-auth/tests/test_config_and_passwords.py`

- [ ] **Step 1: Write failing configuration and password tests**

```python
def test_internal_key_has_no_default(monkeypatch):
    monkeypatch.delenv("SITE_AUTH_INTERNAL_KEY", raising=False)
    with pytest.raises(ValueError, match="SITE_AUTH_INTERNAL_KEY"):
        Settings.from_env()

def test_password_hash_uses_argon2id():
    encoded = hash_password("correct horse battery staple")
    assert encoded.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong", encoded)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest site-auth/tests/test_config_and_passwords.py -q`

Expected: collection fails because `site_auth.config` and `site_auth.passwords` do not exist.

- [ ] **Step 3: Add minimal package and secure settings**

`Settings.from_env()` must require `SITE_AUTH_INTERNAL_KEY`, accept `SITE_AUTH_DATA_DIR`, `SITE_AUTH_ALLOWED_ORIGINS`, `SITE_AUTH_COOKIE_SECURE`, and create no hard-coded production secret. `passwords.py` must wrap `argon2.PasswordHasher` and translate mismatch errors to `False`.

- [ ] **Step 4: Add SQLAlchemy models**

Define `User(id, email, username, password_hash, role, is_active, created_at, updated_at)` and `Session(id, user_id, token_hash, csrf_hash, expires_at, revoked_at, created_at)`. Store only SHA-256 digests of opaque tokens and declare indexes for email, username, token hash, and user ID.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `python -m pytest site-auth/tests/test_config_and_passwords.py -q`

Expected: all tests pass.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- site-auth/pyproject.toml site-auth/site_auth site-auth/tests/test_config_and_passwords.py
git commit -m "feat(auth): add secure identity persistence"
```

### Task 2: Implement opaque sessions, CSRF, and internal introspection

**Files:**
- Create: `site-auth/site_auth/session_service.py`
- Create: `site-auth/site_auth/schemas.py`
- Create: `site-auth/site_auth/dependencies.py`
- Create: `site-auth/site_auth/routes.py`
- Create: `site-auth/site_auth/internal.py`
- Create: `site-auth/site_auth/main.py`
- Create: `site-auth/tests/conftest.py`
- Create: `site-auth/tests/test_sessions.py`
- Create: `site-auth/tests/test_internal_verify.py`

- [ ] **Step 1: Write failing login/session tests**

Tests must assert that successful login sets `sd_session` as HttpOnly and `sd_csrf` as non-HttpOnly, `/me` returns the user, logout revokes the session, incorrect passwords return the same 401 shape as unknown users, and no `/register` route exists.

```python
response = client.post("/api/v1/session/login", json={"identity": "admin", "password": "secret-pass"})
assert response.status_code == 204
assert "HttpOnly" in response.headers.get_list("set-cookie")[0]
assert client.get("/api/v1/session/me").json()["username"] == "admin"
assert client.post("/api/v1/register", json={}).status_code == 404
```

- [ ] **Step 2: Run session tests and verify RED**

Run: `python -m pytest site-auth/tests/test_sessions.py -q`

Expected: endpoints are missing.

- [ ] **Step 3: Implement the minimal session service and browser routes**

Generate tokens with `secrets.token_urlsafe(32)`, persist only `sha256(token)`, expire sessions server-side, set cookie path `/`, and use `Secure` according to settings. Require the CSRF header/cookie pair and allowed `Origin` for unsafe authenticated requests. Normalize all failed-login responses to `{"detail":"用户名或密码错误"}`.

- [ ] **Step 4: Write failing internal-verification tests**

```python
assert client.post("/internal/v1/session/verify").status_code == 401
assert client.post(
    "/internal/v1/session/verify",
    headers={"X-Site-Service-Key": "wrong"},
).status_code == 401
```

The valid request must return exactly `id`, `email`, `username`, and `role`; unsafe methods must also validate forwarded origin and CSRF values.

- [ ] **Step 5: Implement internal verification and run all auth tests**

Run: `python -m pytest site-auth/tests -q`

Expected: all tests pass with no warnings caused by application code.

- [ ] **Step 6: Commit only Task 2 files**

```powershell
git add -- site-auth/site_auth site-auth/tests
git commit -m "feat(auth): add secure site sessions"
```

### Task 3: Add administrator CLI and admin APIs

**Files:**
- Create: `site-auth/site_auth/cli.py`
- Create: `site-auth/tests/test_admin_cli.py`
- Create: `site-auth/tests/test_admin_api.py`
- Modify: `site-auth/pyproject.toml`

- [ ] **Step 1: Write failing CLI tests**

Patch `getpass.getpass` and verify that `create-admin` creates one administrator, a second run explicitly resets the password, stdout never contains the password, and no default username/password is accepted.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest site-auth/tests/test_admin_cli.py -q`

Expected: CLI entry point is missing.

- [ ] **Step 3: Implement interactive CLI**

Expose `site-auth-admin = "site_auth.cli:main"`. Require `--email` and `--username`; read and confirm passwords with `getpass`; reject passwords shorter than 12 characters; never log secrets.

- [ ] **Step 4: Add failing admin API tests, then implement**

Cover list/create/disable/enable/role/reset-password. A normal user must receive 403. Disabling a user must revoke all sessions. Resetting a password must revoke all sessions and never return a hash.

- [ ] **Step 5: Run auth suite and commit**

Run: `python -m pytest site-auth/tests -q`

```powershell
git add -- site-auth
git commit -m "feat(auth): add administrator lifecycle"
```

### Task 4: Integrate the unified login into SD

**Files:**
- Create: `SD/lib/siteAuth.ts`
- Create: `SD/context/AuthContext.tsx`
- Create: `SD/pages/LoginPage.tsx`
- Create: `SD/components/AccountMenu.tsx`
- Create: `SD/lib/siteAuth.test.ts`
- Modify: `SD/App.tsx`
- Modify: `SD/index.tsx`
- Modify: `SD/layouts/AppLayout.tsx`
- Modify: `SD/vite.config.ts`
- Modify: `SD/package.json`

- [ ] **Step 1: Add Vitest and write failing auth-client tests**

Test `safeNextPath()` with `/stock/analysis/abc`, `https://evil.example`, `//evil.example`, and malformed input. Only a single-leading-slash same-origin path may be returned.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- --run lib/siteAuth.test.ts` from `SD` after adding the test script/dependencies.

Expected: `safeNextPath` is missing.

- [ ] **Step 3: Implement session client and context**

All calls target `/auth-api/api/v1`, include credentials, read `sd_csrf` only for unsafe requests, and convert 401 to an unauthenticated state without retaining a stale user.

- [ ] **Step 4: Implement `/auth/login` and account menu**

The page submits identity/password, refreshes `/me`, and navigates to `safeNextPath(searchParams.get("next"))`. The layout shows login for anonymous users and username/logout for authenticated users. Public pages never redirect automatically.

- [ ] **Step 5: Add local proxies and run checks**

Add `/auth-api -> http://127.0.0.1:8000`; retain existing stock rules if present and do not overload `/api`.

Run: `npm.cmd run lint` and `npm.cmd run build` from `SD`.

Expected: both exit 0.

- [ ] **Step 6: Commit SD integration files**

```powershell
git add -- SD/App.tsx SD/index.tsx SD/layouts/AppLayout.tsx SD/vite.config.ts SD/package.json SD/package-lock.json SD/lib/siteAuth.ts SD/lib/siteAuth.test.ts SD/context/AuthContext.tsx SD/pages/LoginPage.tsx SD/components/AccountMenu.tsx
git commit -m "feat(sd): add unified site login"
```

### Task 5: Replace ShouAnRen authentication and move it to 8006

**Files:**
- Create: `守岸人3.0/server/middleware/site_auth_client.py`
- Create: `守岸人3.0/tests/test_site_auth.py`
- Modify: `守岸人3.0/server/middleware/auth.py`
- Modify: `守岸人3.0/server/routers/auth.py`
- Modify: `守岸人3.0/server/routers/admin.py`
- Modify: `守岸人3.0/server/main.py`
- Modify: `守岸人3.0/server/config.py`
- Modify: `守岸人3.0/frontend/js/auth.js`
- Modify: `守岸人3.0/frontend/login.html`
- Modify: `守岸人3.0/frontend/register.html`
- Modify: `守岸人3.0/create_admin.py`

- [ ] **Step 1: Write a failing central-session dependency test**

Use an injected fake introspection transport. Assert missing cookies return 401, valid introspection produces an immutable `SiteUser(id, email, username, role, is_active=True)`, and admin dependency rejects role `user`.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest '守岸人3.0/tests/test_site_auth.py' -q`

Expected: the adapter does not exist.

- [ ] **Step 3: Implement the adapter while preserving router compatibility**

Replace the SQLAlchemy lookup in `get_current_user` with localhost introspection. Return a `SiteUser` object exposing the attributes existing routers use. Forward `sd_session`, `sd_csrf`, method, origin, and CSRF header. Require `SITE_AUTH_URL` and `SITE_AUTH_INTERNAL_KEY` without insecure defaults.

- [ ] **Step 4: Remove local credential issuance and default admin bootstrap**

Do not include the old auth router in `main.py`. Make old login/register HTML perform a same-origin redirect to `/auth/login?next=/wuwa/`. Replace `create_admin.py` with a clear instruction to run the site-auth CLI; it must not contain a password default.

- [ ] **Step 5: Preserve business user IDs without preserving old credentials**

Business tables continue storing the global site user UUID in their existing `user_id` columns. Remove old user-management endpoints from ShouAnRen admin routing or proxy the UI to `/auth-api/api/v1/admin/users`; never query the obsolete local users table for authentication decisions.

- [ ] **Step 6: Move the service to 8006 and run regression checks**

Set the default server port to 8006. Run the new tests plus Python AST/compile checks for the server package. Start with test data and verify `/api/health` is public while a chat endpoint returns 401 without the site cookie.

- [ ] **Step 7: Commit ShouAnRen integration files only**

```powershell
git add -- '守岸人3.0/server' '守岸人3.0/frontend/js/auth.js' '守岸人3.0/frontend/login.html' '守岸人3.0/frontend/register.html' '守岸人3.0/create_admin.py' '守岸人3.0/tests'
git commit -m "feat(shouanren): use unified site authentication"
```

### Task 6: Protect stock analysis and isolate data by site user

**Files:**
- Create: `stock-research-package/stock-module/backend/app/security/site_auth.py`
- Create: `stock-research-package/stock-module/backend/tests/test_site_auth.py`
- Create: `stock-research-package/stock-module/backend/tests/test_owner_isolation.py`
- Modify: `stock-research-package/stock-module/backend/app/config.py`
- Modify: `stock-research-package/stock-module/backend/app/main.py`
- Modify: `stock-research-package/stock-module/backend/app/gateway_main.py`
- Modify: `stock-research-package/stock-module/frontend/src/api.ts`
- Modify: `stock-research-package/stock-module/frontend/src/App.tsx`

- [ ] **Step 1: Write failing public/private authorization tests**

Assert health, stock search, candidates, current morning report, and report history remain public. Assert analysis creation/report retrieval and model-profile CRUD/catalog/test return 401 without a valid site session.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest tests/test_site_auth.py -q` from `stock-module/backend`.

Expected: protected routes currently accept anonymous requests.

- [ ] **Step 3: Implement `SiteIdentity` dependency**

Forward the browser session to `site-auth` internal verification using required `SITE_AUTH_URL` and `SITE_AUTH_INTERNAL_KEY`. Keep health and market reads dependency-free. Apply authentication dependencies to private routes at the route definition, not only in frontend code.

- [ ] **Step 4: Write failing owner-isolation tests**

Create model profiles and analysis tasks as user A, then introspect as user B. B must receive 404 for A's private resources and must not see A's profiles in list responses.

- [ ] **Step 5: Replace fixed owner IDs**

Construct request-scoped `ModelProfileService` and analysis access with `identity.id`. The internal gateway must receive an owner claim through the already signed route token; it must not revert to `local`. Platform profiles remain selectable but are not silently selected.

- [ ] **Step 6: Update frontend authentication behavior**

Private API failures with 401 navigate to `/auth/login?next=` plus the current `/stock/` path. Requests remain same-origin and include credentials. Public panels continue rendering anonymously.

- [ ] **Step 7: Run backend and frontend suites**

Run from backend: `python -m pytest -q`.

Run from frontend: `npm.cmd test` then `npm.cmd run build`.

Expected: all tests pass and production build exits 0.

- [ ] **Step 8: Commit stock authentication files**

```powershell
git add -- stock-research-package/stock-module/backend stock-research-package/stock-module/frontend/src stock-research-package/stock-module/frontend/package.json stock-research-package/stock-module/frontend/package-lock.json
git commit -m "feat(stock): isolate private research by site user"
```

### Task 7: Repair plagiarism contract and move it to 8005

**Files:**
- Create: `plagiarism/tests/test_api.py`
- Modify: `plagiarism/main.py`
- Modify: `SD/components/tools/document/PlagiarismCheck.tsx`
- Modify: `SD/vite.config.ts`

- [ ] **Step 1: Write failing API contract tests**

Use `file1` and `file2` multipart fields. Expect `similarity`, `matches`, and camelCase stats matching the current React type. Add rejection tests for unsupported extensions and files larger than `PLAGIARISM_MAX_FILE_BYTES`.

- [ ] **Step 2: Verify RED**

Run: `python -m pytest plagiarism/tests/test_api.py -q`

Expected: field names and response schema do not match.

- [ ] **Step 3: Implement the minimal compatible and bounded API**

Expose `/api/v1/health` and `/api/v1/compare`; stream/read at most the configured byte limit plus one byte; reject overflow with 413; reject non-TXT/DOCX/PDF with 415; return a generic 500 message while logging the exception server-side.

- [ ] **Step 4: Update the React caller and local proxy**

POST to `/plagiarism-api/api/v1/compare`, retain `file1/file2`, and consume the matching camelCase result. Proxy `/plagiarism-api` to `127.0.0.1:8005`.

- [ ] **Step 5: Run API tests and SD build**

Run: `python -m pytest plagiarism/tests/test_api.py -q`.

Run from `SD`: `npm.cmd run lint` and `npm.cmd run build`.

- [ ] **Step 6: Commit plagiarism fix**

```powershell
git add -- plagiarism SD/components/tools/document/PlagiarismCheck.tsx SD/vite.config.ts
git commit -m "fix(plagiarism): align API contract and port"
```

### Task 8: Normalize STM32 ports and local reverse proxies

**Files:**
- Create: `4G/tests/test_config.py`
- Modify: `4G/4G.py`
- Modify: `SD/pages/Stm32Window.tsx`
- Modify: `SD/vite.config.ts`
- Modify: `nginx.conf`

- [ ] **Step 1: Write failing environment-port tests**

Import configuration without starting servers and assert defaults `HTTP_PORT=8007`, `DEVICE_TCP_PORT=8008`, with environment overrides accepted.

- [ ] **Step 2: Verify RED, then extract configuration**

Run: `python -m pytest 4G/tests/test_config.py -q`.

Expected: constants/config loader do not exist.

Move startup under a callable `main()` and read `STM32_HTTP_PORT`/`STM32_TCP_PORT`. Importing `4G.py` in tests must not open sockets.

- [ ] **Step 3: Align HTTP and WebSocket URLs**

Use `/stm32/api/data`, `/stm32/api/send_cmd`, and `/stm32/api/ws` consistently. Configure Vite and Nginx to strip `/stm32/api/` and forward HTTP/WebSocket to 8007.

- [ ] **Step 4: Update reference Nginx routes without overwriting stock routes**

Add `/auth-api/ -> 8000`, `/plagiarism-api/ -> 8005`, move ShouAnRen to 8006, and STM32 to 8007. Preserve or clearly mark the server's existing `/stock/` and `/stock-api/` rules as production-owned configuration to merge during deployment.

- [ ] **Step 5: Run tests and syntax checks, then commit**

Run: `python -m pytest 4G/tests/test_config.py -q` and `npm.cmd run build` from `SD`.

```powershell
git add -- 4G/4G.py 4G/tests SD/pages/Stm32Window.tsx SD/vite.config.ts nginx.conf
git commit -m "chore(ports): normalize local backend services"
```

### Task 9: Add deterministic local orchestration and smoke checks

**Files:**
- Create: `scripts/start-local.ps1`
- Create: `scripts/stop-local.ps1`
- Create: `scripts/check-local.ps1`
- Create: `.env.local.example`
- Modify: `.gitignore`

- [ ] **Step 1: Define configuration without secrets**

`.env.local.example` lists required variable names and safe localhost URLs but contains no real API key, password, cookie, database credential, or reusable service key.

- [ ] **Step 2: Implement process startup**

The script validates that each configured executable and directory exists, starts services hidden, writes PID metadata under an ignored `.runtime/` directory, and refuses to replace an unrelated listener. It must never print secret environment values.

- [ ] **Step 3: Implement safe stop behavior**

Resolve every PID from `.runtime/`, confirm its recorded working directory is under `E:\AI\gp`, stop only those processes, and remove only the explicit PID files. Do not kill by broad process name.

- [ ] **Step 4: Implement health and permission smoke checks**

Check ports 8000-8008, public endpoints, anonymous 401 responses for stock analysis and ShouAnRen chat, authenticated `/me`, authenticated private endpoints, and plagiarism health. Report PASS/FAIL per service and exit nonzero on any failure.

- [ ] **Step 5: Run the full local stack and commit scripts**

Run `scripts/start-local.ps1`, then `scripts/check-local.ps1`, then `scripts/stop-local.ps1`.

Expected: all configured services pass; stopped processes match only recorded PIDs.

```powershell
git add -- scripts .env.local.example .gitignore
git commit -m "chore(dev): add local service orchestration"
```

### Task 10: Remove nested upstream Git metadata

**Files:**
- Delete directories only:
  - `stock-research-package/upstreams/a-share-us-catalyst/.git`
  - `stock-research-package/upstreams/mom-index/.git`
  - `stock-research-package/upstreams/daily_stock_analysis/.git`

- [ ] **Step 1: Resolve and validate exact targets**

Use `Resolve-Path -LiteralPath` for all three targets and for `stock-research-package/upstreams`. Refuse deletion unless each target parent resolves under that exact upstream root and none equals `E:\AI\gp\.git`.

- [ ] **Step 2: Record upstream commit IDs for provenance**

Before removal, run `git -C <upstream> rev-parse HEAD` and save repository URL/commit information in `stock-research-package/UPSTREAMS.md`. Do not copy credentials or local remote headers.

- [ ] **Step 3: Delete only the validated `.git` directories**

Use PowerShell `Remove-Item -LiteralPath <validated-absolute-path> -Recurse -Force` separately for each exact target.

- [ ] **Step 4: Verify root repository integrity**

Run `git rev-parse --show-toplevel`, verify it returns `E:/AI/gp`, verify all three nested `.git` paths are absent, and verify upstream source files remain present.

- [ ] **Step 5: Commit provenance and vendored sources intentionally**

Review size and licensing first. Stage `UPSTREAMS.md` and intended source files explicitly; do not use a blind `git add .`.

### Task 11: Full verification checkpoint

**Files:**
- Update test files only if a verified test defect exists; do not weaken assertions to force green.

- [ ] **Step 1: Run all backend suites**

Run site-auth, stock backend, plagiarism, STM32, and ShouAnRen tests in their configured environments. Record exact pass/fail counts.

- [ ] **Step 2: Run all frontend checks**

Run SD lint/build, stock test/build, and Openwrite lint/build. Existing Openwrite lint failures must be reported truthfully unless explicitly fixed in scope; successful build does not erase lint failures.

- [ ] **Step 3: Run local cross-module smoke tests**

Create a disposable administrator in a disposable auth database. Verify anonymous browsing, login, refresh, logout, ShouAnRen chat authorization, stock analysis authorization and user isolation, model-profile isolation, administrator denial for normal users, and plagiarism comparison.

- [ ] **Step 4: Security scan**

Search tracked files for default passwords, fixed JWT secrets, copied service keys, real API keys, `localStorage` auth tokens, and unexpected `.git` directories. Never print matching secret values; report file and variable names only.

- [ ] **Step 5: Review working tree and commit only planned changes**

Compare against the pre-existing dirty status. Do not stage the user's unrelated Openwrite novel data or pre-existing STM32 edits unless the same lines were intentionally required and reviewed.

### Task 12: BaoTa deployment and final README gate

**Files:**
- Create after server inspection: `deploy/baota-site.conf.example`
- Create after server inspection: `deploy/DEPLOY-CHECKLIST.md`
- Modify only after online success: `README.md`
- Modify only after online success: `DEPLOY.md`

- [ ] **Step 1: Obtain/read the live BaoTa vhost and service configuration**

Back up the live vhost and databases. Confirm current `/stock/` and `/stock-api/` behavior before preparing a diff. If server access is unavailable, stop at this checkpoint with deployment artifacts only.

- [ ] **Step 2: Validate and reload safely**

Deploy services, run `nginx -t`, and reload only on exit 0. Verify ports are bound to the intended interfaces and 8003/8004 remain private.

- [ ] **Step 3: Run production smoke tests**

Verify public pages, unified login, ShouAnRen, stock detail analysis, user API configuration, admin authorization, plagiarism, logout, and logs. Do not expose credentials in test output.

- [ ] **Step 4: Rewrite root documentation only after success**

Document the actual live directory map, port map, public routes, startup commands, environment-variable names, backup/rollback steps, upstream provenance/licenses, and verification date. Do not claim unavailable Mom Index or Cat scheduling features are active.

- [ ] **Step 5: Final verification and documentation commit**

Re-run local and production health checks, inspect the README against live configuration, and commit documentation separately.
