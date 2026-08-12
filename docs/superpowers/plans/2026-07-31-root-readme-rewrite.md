# Root README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized root README with a concise, developer-first guide for understanding, starting, verifying, and extending the complete monorepo.

**Architecture:** The root README becomes the repository entry point and delegates exhaustive module details to existing module documentation. All operational claims are derived from checked-in scripts and implementation files, with the full local workflow centered on the three PowerShell orchestration scripts.

**Tech Stack:** Markdown, Mermaid, PowerShell, Git

---

### Task 1: Establish the canonical documentation map

**Files:**
- Read: `scripts/start-local.ps1`
- Read: `scripts/check-local.ps1`
- Read: `scripts/stop-local.ps1`
- Read: `.env.local.example`
- Read: `site-auth/site_auth/cli.py`
- Read: `stock-research-package/stock-module/README.md`
- Read: `DEPLOY.md`

- [x] **Step 1: Confirm full-system commands**

Run:

```powershell
rg -n "param|WithoutFrontends|800[0-8]|517[3-5]" scripts/start-local.ps1 scripts/check-local.ps1 scripts/stop-local.ps1
```

Expected: startup definitions for backend/device ports `8000`–`8008`, frontend ports `5173`–`5175` by default, and a `-WithoutFrontends` switch for backend-only startup.

- [x] **Step 2: Confirm administrator workflow**

Run:

```powershell
rg -n "create-admin|recreate-admin|reset-admin|password" site-auth/site_auth/cli.py
```

Expected: interactive password input, a minimum length of 12 characters, and explicit destructive confirmation for `recreate-admin`.

- [x] **Step 3: Confirm stock and Xiaohongshu claims**

Run:

```powershell
rg -n "K.?线|同花顺|东方财富|小红书|Playwright|08:30|手动刷新|登录态" stock-research-package/stock-module/README.md stock-research-package/stock-module/backend stock-research-package/stock-module/frontend
```

Expected: real-data integrations, the read-only Xiaohongshu MCP, daily collection time, administrator refresh, and QR login-state management.

### Task 2: Rewrite the root developer guide

**Files:**
- Modify: `README.md`

- [x] **Step 1: Replace the current heading structure**

Use exactly this top-level structure:

```markdown
# Star Dominion · 逐梦工具箱
## 核心模块
## 五分钟快速启动
## 本地服务与访问地址
## 首次创建管理员
## 股票研究与宝妈指数
## 项目架构
## 仓库目录
## 配置与敏感信息
## 测试与检查
## 生产部署
## 子项目文档
## 许可证与第三方项目
```

- [x] **Step 2: Make the quick-start path executable**

Document this workflow near the top:

```powershell
git clone https://github.com/yunxigy/Star-Dominion.git
cd Star-Dominion
Copy-Item .env.local.example .env.local
.\scripts\start-local.ps1
.\scripts\check-local.ps1
```

State that dependencies must be installed once before the first start and link to the per-module installation sections instead of embedding every dependency command in the first screen.

- [x] **Step 3: Document the first administrator without a default password**

Show the non-destructive creation command:

```powershell
cd site-auth
python -m site_auth.cli create-admin --email <ADMIN_EMAIL> --username <ADMIN_USERNAME>
```

Explain that the password is entered twice at the hidden prompt, must contain at least 12 characters, and must not be typed as a standalone PowerShell command.

- [x] **Step 4: Document Xiaohongshu login and collection**

Explain this UI workflow:

```text
登录管理员 → 打开 /stock/ → 找到“宝妈指数”
→ 点击“重新登录小红书” → 用小红书扫码
→ 点击“立即刷新宝妈指数”进行首次验证
```

State that collection runs daily at `08:30` in `Asia/Shanghai`, uses real Eastmoney public content plus the local Xiaohongshu Playwright login state, and preserves the most recent real snapshot when a source fails.

- [x] **Step 5: Keep detailed content delegated**

Link to:

```text
stock-research-package/stock-module/README.md
Openwrite-main/README.md
守岸人3.0/README.md
deploy/baota/README.md
```

The repository does not currently contain `site-auth/README.md`, so the root README must contain the complete administrator quick-start itself. Use `deploy/baota/README.md`, the root service table, `nginx.conf`, and `.env.production.example` as the current deployment sources. If `DEPLOY.md` is mentioned, label it as legacy background because it contains pre-integration port examples.

Do not repeat complete tool inventories, complete API references, or module troubleshooting tables in the root README.

### Task 3: Verify accuracy, safety, and Markdown quality

**Files:**
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-07-31-root-readme-rewrite-design.md`
- Verify: `docs/superpowers/plans/2026-07-31-root-readme-rewrite.md`

- [x] **Step 1: Check Markdown whitespace and conflict markers**

Run:

```powershell
git diff --check -- README.md docs/superpowers/specs/2026-07-31-root-readme-rewrite-design.md docs/superpowers/plans/2026-07-31-root-readme-rewrite.md
rg -n "^(<<<<<<<|=======|>>>>>>>)" README.md
```

Expected: both commands produce no errors.

- [x] **Step 2: Check required developer topics**

Run:

```powershell
rg -n "start-local|check-local|stop-local|create-admin|5173|5174|5175|8000|8008|小红书|08:30|同花顺|K 线|\\.env\\.local" README.md
```

Expected: every required topic appears in the final README.

- [x] **Step 3: Verify relative links**

Parse Markdown links whose targets are relative local paths and confirm that every target exists under the repository root.

Expected: zero missing local targets.

- [x] **Step 4: Scan the documentation diff for sensitive values**

Run:

```powershell
git diff -- README.md docs/superpowers/specs/2026-07-31-root-readme-rewrite-design.md docs/superpowers/plans/2026-07-31-root-readme-rewrite.md |
  rg -n "(sk-[A-Za-z0-9_-]{16,}|API[_ -]?KEY\s*[:=]\s*\S+|PASSWORD\s*[:=]\s*\S+|sd_session=|Bearer\s+[A-Za-z0-9._-]{16,})"
```

Expected: no real credentials or session material.

- [x] **Step 5: Review the final diff**

Run:

```powershell
git diff --stat -- README.md docs/superpowers/specs/2026-07-31-root-readme-rewrite-design.md docs/superpowers/plans/2026-07-31-root-readme-rewrite.md
git diff -- README.md
```

Expected: a shorter developer-first root README with no unrelated file changes.
