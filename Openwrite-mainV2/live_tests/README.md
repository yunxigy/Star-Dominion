# OpenWrite real-model diagnostics

This directory is intentionally outside the default `pytest` collection configured in
`pyproject.toml`. The normal test suite remains offline and free.

Pytest diagnostics use `~/my_novel` as their source fixture, copy only its OpenWrite project data
to an isolated temporary directory, and allow model-driven writes to happen in that copy. The
manual QA project is never mutated by pytest runs.

To override the source fixture for an automated run, point the diagnostics at an isolated project
explicitly. Manual Studio, live-server, and browser QA must still use `~/my_novel`:

```bash
export OPENWRITE_LIVE_FIXTURE="~/my_novel"
```

## Tiers

- `smoke`: provider connectivity and OpenAI-compatible tool calling.
- `agent`: smoke tests plus read-only Goethe and Dante ReAct interactions.
- `full`: agent tests plus an existing-chapter review and a complete `ch_007` write/review flow.

`test_fixture_contract.py` is offline and always runs. All other tests require an explicit opt-in
and an API key in the environment.

## Usage

```bash
export LLM_API_KEY="..."
export OPENWRITE_RUN_LIVE=1

# Cheap provider check
OPENWRITE_LIVE_TIER=smoke .venv/bin/pytest -q live_tests

# Read-only long-session agent checks
OPENWRITE_LIVE_TIER=agent .venv/bin/pytest -q live_tests

# Real review, chapter generation, fact extraction, settlement and review
OPENWRITE_LIVE_TIER=full .venv/bin/pytest -q live_tests
```

Defaults target `https://api.deepseek.com` with `deepseek-v4-flash`. Override them when testing a
different compatible endpoint:

```bash
export OPENWRITE_LIVE_BASE_URL="https://api.deepseek.com"
export OPENWRITE_LIVE_MODEL="deepseek-v4-flash"
export OPENWRITE_LIVE_TARGET_WORDS=1200
```

Sanitized reports are written to `live_test_artifacts/<run-id>/`, which is ignored by Git. The
reports contain model output and workflow state but redact the active API key if it appears in an
exception or provider response.

## Full Studio Agent tool matrix

With Studio already running on `~/my_novel`, exercise every currently exposed Goethe/Dante tool
through a separate real-model Agent turn:

```bash
.venv/bin/python live_tests/run_agent_tool_matrix.py --allow-writes
```

The runner discovers the live tool catalogs, rejects any project other than `~/my_novel`, and
writes an incrementally updated audit artifact under `live_test_artifacts/`. Use `--tools` with a
comma-separated list of tool names or case keys to rerun only failures.
