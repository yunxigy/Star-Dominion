# OpenWrite integration

OpenWrite uses this bundled framework through `tools/research_service.py` and the Studio
`深度研究` workspace. Reports are copied into the active novel at
`data/research/reports/`; the framework's evidence, trace, and checkpoint files remain
under `data/research/artifacts/`.

The framework is intentionally optional. To prepare a fresh checkout, run:

```bash
cd integrations/deepresearch
pnpm install --frozen-lockfile
pnpm build
```

`pnpm install` only installs the locked dependencies. The Studio availability
check also requires the workspace `dist/` artifacts, so run `pnpm build` after
installation (and again after changing the DeepResearch source). Without the
build artifacts, the UI reports that the runtime is not ready instead of
starting a task that will fail with a missing-package error.

The Studio task accepts the same provider environment variables as the framework CLI.
When a model is configured in OpenWrite, its machine-local `LLM_API_KEY`, `LLM_MODEL`,
and `LLM_BASE_URL` values are mapped to the selected DeepResearch provider for the
duration of the child process and are never written into the novel workspace.
