# Core Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛本地服务编排、跨服务认证和 SQLite 迁移逻辑，同时保持现有业务行为与同花顺依赖不变。

**Architecture:** 以 `scripts/local-services.json` 作为本地服务编排单一事实来源；以一个不依赖业务实现的认证契约模块提供 Cookie/CSRF/Origin 常量；每个 SQLite 服务使用独立、版本化、幂等的迁移步骤，迁移失败即回滚。

**Tech Stack:** PowerShell 7/Windows PowerShell、Python 3、FastAPI、SQLAlchemy、SQLite、pytest。

---

### Task 1: 建立本地服务清单读取器

**Files:**
- Create: `scripts/local-services.json`
- Create: `scripts/local-services.ps1`
- Create: `scripts/tests/local-services.tests.ps1`

- [ ] **Step 1: Write the failing test**

```powershell
Describe 'local service manifest' {
    It 'contains every managed port exactly once' {
        $manifest = Get-LocalServiceManifest -Path "$PSScriptRoot/../local-services.json"
        $ports = @($manifest.services | ForEach-Object { $_.ports })
        @($ports | Sort-Object | Get-Unique).Count | Should -Be $ports.Count
        $ports | Should -Contain 8000
        $ports | Should -Contain 5175
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/local-services.tests.ps1"`
Expected: FAIL because `Get-LocalServiceManifest` and the manifest do not exist.

- [ ] **Step 3: Write minimal implementation**

Define `services` entries for the nine backends and three frontends currently in `start-local.ps1`; use relative working directories, existing arguments, existing ports, and health URLs where available. `local-services.ps1` must resolve the JSON path under the workspace, parse it, validate unique names/ports and resolve relative paths without starting processes.

- [ ] **Step 4: Run it to verify it passes**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/local-services.tests.ps1"`
Expected: PASS with one test.

### Task 2: Make startup, stop and smoke checks consume the manifest

**Files:**
- Modify: `scripts/start-local.ps1`
- Modify: `scripts/stop-local.ps1`
- Modify: `scripts/check-local.ps1`
- Modify: `scripts/tests/local-services.tests.ps1`

- [ ] **Step 1: Write the failing test**

Add a test that loads the three scripts as text and asserts the hard-coded service port list is absent, while the manifest loader is referenced by each script. Add a health-contract test asserting every manifest entry has either `health_url` or `tcp_only: true`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/local-services.tests.ps1"`
Expected: FAIL because the scripts currently define services inline and front-end health checks are absent.

- [ ] **Step 3: Write minimal implementation**

Replace inline `$services` construction with `Get-LocalServiceManifest`; filter frontend entries when `-WithoutFrontends` is set. Keep environment-variable defaults and ShouAnRen directory discovery as preprocessing that updates the matching manifest working directory. Extend runtime metadata with `command_fingerprint` and `health_url`. Update stop validation to compare recorded command fingerprint. Update smoke checks to iterate manifest TCP ports and issue HTTP requests for every declared health URL, then keep existing auth-specific assertions.

- [ ] **Step 4: Run focused verification**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/local-services.tests.ps1"` and `pwsh -NoProfile -File scripts/check-local.ps1`.
Expected: all manifest tests pass and the script ends with `All local smoke checks passed.`

### Task 3: Add a shared Python authentication contract

**Files:**
- Create: `shared/site_auth_contract.py`
- Create: `research-reports/tests/test_site_auth_contract.py`
- Modify: `research-reports/research_reports/site_auth.py`
- Modify: `stock-research-package/stock-module/backend/app/security/site_auth.py`

- [ ] **Step 1: Write the failing test**

```python
def test_contract_builds_forwarded_context() -> None:
    from shared.site_auth_contract import build_forwarded_context
    headers, cookies = build_forwarded_context(
        origin="http://127.0.0.1:5173", csrf="csrf-value", session="session-value"
    )
    assert headers["X-Site-Request-Origin"] == "http://127.0.0.1:5173"
    assert headers["X-Site-CSRF"] == "csrf-value"
    assert cookies == {"sd_session": "session-value", "sd_csrf": "csrf-value"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest -q research-reports/tests/test_site_auth_contract.py`
Expected: FAIL with `ModuleNotFoundError` because the contract module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create the constants and `build_forwarded_context` helper. Add a repository-root import path in the two service launch contexts without packaging or installing a new dependency; adapters import only constants/helper. Preserve current optional-header behavior by omitting absent values.

- [ ] **Step 4: Run it to verify it passes**

Run: `pytest -q research-reports/tests/test_site_auth_contract.py research-reports/tests/test_site_auth.py stock-research-package/stock-module/backend/tests/test_site_auth.py`
Expected: all selected authentication tests pass.

### Task 4: Version research-reports migrations

**Files:**
- Create: `research-reports/research_reports/migrations.py`
- Create: `research-reports/tests/test_migrations.py`
- Modify: `research-reports/research_reports/database.py`

- [ ] **Step 1: Write the failing test**

Add tests that create a legacy `ai_reports` table without `events_json`/`risks_json`, run `create_database`, assert both columns and `schema_metadata.version == 1`, then run `create_database` again and assert no duplicate migration effects.

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest -q research-reports/tests/test_migrations.py`
Expected: FAIL because no schema metadata table or versioned runner exists.

- [ ] **Step 3: Write minimal implementation**

Implement `run_migrations(engine)` with a `schema_metadata` table and a single version-1 additive migration. Call it before `Base.metadata.create_all` for legacy databases, then call `create_all` for missing tables; keep `_migrate_existing_schema` as a compatibility wrapper delegating to the runner.

- [ ] **Step 4: Run it to verify it passes**

Run: `pytest -q research-reports/tests/test_migrations.py research-reports/tests/test_config_and_models.py`
Expected: all migration and model tests pass.

### Task 5: Version site-auth and ShouAnRen initialization without changing schema behavior

**Files:**
- Create: `site-auth/site_auth/migrations.py`
- Create: `site-auth/tests/test_migrations.py`
- Modify: `site-auth/site_auth/database.py`
- Modify: `守岸人3.0/server/database.py`
- Create: `守岸人3.0/server/tests/test_database_migrations.py`

- [ ] **Step 1: Write the failing test**

For site-auth, assert a fresh database records version 0 and can be reopened. For ShouAnRen, assert `init_db()` can run twice against a temporary SQLite database and the existing chat graph migration does not add duplicate columns or branches.

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest -q site-auth/tests/test_migrations.py 守岸人3.0/server/tests/test_database_migrations.py`
Expected: FAIL because neither service exposes a version record or an idempotent migration entrypoint.

- [ ] **Step 3: Write minimal implementation**

Add a shared local migration helper per service (no cross-service database dependency). Site-auth records version 0 after `create_all`. ShouAnRen wraps existing `_migrate_existing_tables` in a version check and leaves `_ensure_column`/`migrate_chat_graph` behavior intact; repeated runs must short-circuit after the recorded version.

- [ ] **Step 4: Run it to verify it passes**

Run: `pytest -q site-auth/tests/test_migrations.py 守岸人3.0/server/tests/test_database_migrations.py site-auth/tests stock-research-package/stock-module/backend/tests`
Expected: selected migration tests and existing auth/stock tests pass.

### Task 6: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/local-development.md` (create if the existing operations docs use this path)

- [ ] **Step 1: Run backend tests**

Run the existing full suites for site-auth, research-reports, stock backend, stock analysis, OpenWrite, ShouAnRen and SD. Expected: zero failures; warnings may be reported separately.

- [ ] **Step 2: Run builds and smoke checks**

Run SD/OpenWrite/stock frontend TypeScript checks and builds, then `scripts/check-local.ps1`. Expected: exit code 0 and all declared services report healthy.

- [ ] **Step 3: Update docs**

Document the manifest path, `-WithoutFrontends`, migration behavior, and the commands for starting/stopping/checking. Do not include secrets or local database paths that contain user data.

- [ ] **Step 4: Review the diff**

Run `git diff --check` and `git status --short`; verify only the files listed in this plan are changed by this hardening pass, leaving unrelated OpenWrite/stock/守岸人 user changes untouched.
