# Root README Rewrite Design

## Goal

Rewrite the repository root `README.md` for GitHub developers who need to understand the monorepo and run the complete local system quickly.

The README will be written in Chinese. Commands, paths, environment-variable names, service names, and API routes will retain their original technical spelling.

## Audience

Primary audience:

- Developers opening the GitHub repository for the first time.
- Contributors who need to install dependencies, start all services, verify the environment, and locate the relevant module.

Secondary audience:

- Maintainers creating the first administrator account.
- Maintainers connecting the stock module to Xiaohongshu through the Playwright-backed MCP login state.

Production operators are not the primary audience. Current integrated deployment guidance remains in `deploy/baota/README.md` and module-specific documentation; the older `DEPLOY.md` is supplementary background only.

## Information Architecture

The README will use a developer-first order:

1. Project summary and core module table.
2. Five-minute quick start.
3. Local URLs and service/port table.
4. First administrator creation and login.
5. Stock module summary, including real market data, K-line data, Tonghuashun concepts, and the Mom Index.
6. Xiaohongshu QR login, local login-state storage, the daily 08:30 collection, and administrator manual refresh.
7. Repository structure and a compact architecture diagram.
8. Environment-variable and secret-handling rules.
9. Common tests, health checks, and service stop commands.
10. Production deployment pointer and module documentation links.

## Content Boundaries

The root README will:

- Use `scripts/start-local.ps1`, `scripts/check-local.ps1`, and `scripts/stop-local.ps1` as the canonical full-system workflow.
- Describe ports `8000`–`8008` and development frontends `5173`–`5175` once.
- Explain that no default administrator password is committed and show the supported `site-auth` CLI workflow.
- Explain that Xiaohongshu uses a pinned, read-only Playwright MCP integration and stores its login state only in the ignored local data directory.
- Direct readers to module READMEs for exhaustive setup, API, Worker, and troubleshooting details.

The root README will not:

- Enumerate every SD tool.
- Duplicate complete module feature lists.
- Include real passwords, API keys, cookies, tokens, or machine-specific configuration.
- Claim that generated data, caches, upstream checkouts, or login-state directories belong in Git.
- Present unverified badges, test counts, or functionality that cannot be traced to the current code or scripts.

## Editing Strategy

The existing uncommitted README rewrite is treated as source material, not discarded blindly. Accurate descriptions are retained in a shorter form; duplicated, stale, or overly detailed sections are replaced.

Target length is approximately 250–350 lines so the quick-start path remains visible while the full monorepo is still represented.

## Verification

Before completion:

- Compare every documented service and port against `scripts/start-local.ps1`.
- Compare health-check commands against `scripts/check-local.ps1`.
- Compare administrator commands against `site-auth/site_auth/cli.py`.
- Compare stock and Xiaohongshu behavior against the stock module README and implementation.
- Confirm every relative Markdown link resolves to an existing tracked file.
- Scan the final diff for secrets, local credentials, generated paths, and misleading defaults.
- Review the rendered heading hierarchy, fenced commands, tables, and Mermaid syntax.
