# ShouAnRen Persona and Prompt Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-isolated Personas, deterministic Persona selection, configurable prompt blocks, safe prompt previews, and chat integration without duplicating model API keys.

**Architecture:** Keep Persona selection and prompt composition in independent services. Persist user-owned Personas, bindings, prompt presets, and model-profile references through additive schema version 4; the chat router consumes one composed result while existing worldbook, memory, branch, TTS/STT, and authentication behavior remains intact.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLAlchemy, SQLite/PostgreSQL-compatible migrations, native HTML/CSS/JavaScript, pytest.

---

## Clean-room and security constraints

- Do not copy or adapt SillyTavern source, tests, UI text, or assets.
- Persona and preset records are private to the site user who created them.
- Prompt previews return composed text and token estimates, never API keys, cookies, authentication headers, or administrator-only configuration.
- Model profiles store provider/model/parameters and references only; secrets remain in the existing encrypted site AI configuration.

## File map

- Create `守岸人3.0/server/models/persona.py`: Persona, PersonaBinding, PromptPreset, PromptBlock, and ModelProfile.
- Modify `守岸人3.0/server/models/__init__.py`: export phase-2 models.
- Modify `守岸人3.0/server/migrations.py`: schema version 4.
- Modify `守岸人3.0/server/database.py`: additive phase-2 columns and tables.
- Create `守岸人3.0/server/services/persona_service.py`: ownership and four-level selection precedence.
- Create `守岸人3.0/server/services/prompt_composer.py`: ordered block composition, token budget, and preview trace.
- Create `守岸人3.0/server/routers/persona.py`: Persona CRUD and default/character/chat binding APIs.
- Create `守岸人3.0/server/routers/prompt_presets.py`: preset, block, model-profile, and preview APIs.
- Modify `守岸人3.0/server/main.py`: register new routers.
- Modify `守岸人3.0/server/routers/chat.py`: use Persona selection and prompt composition.
- Create `守岸人3.0/frontend/personas.html` and `守岸人3.0/frontend/js/personas.js`: private Persona management.
- Create `守岸人3.0/frontend/prompt-manager.html` and `守岸人3.0/frontend/js/prompt-manager.js`: block ordering and preview.
- Modify `守岸人3.0/frontend/index.html`: owned-user navigation entries.
- Add `守岸人3.0/tests/test_persona_models.py`, `test_persona_service.py`, `test_persona_api.py`, `test_prompt_composer.py`, `test_prompt_api.py`, and `test_prompt_frontend_contract.py`.

### Task 1: Schema Version 4 and Private Phase-2 Models

**Files:** `server/models/persona.py`, `server/models/__init__.py`, `server/database.py`, `server/migrations.py`, `server/tests/test_database_migrations.py`, `tests/test_persona_models.py`

- [x] **Step 1: Write failing model and migration tests**

```python
def test_persona_and_prompt_models_round_trip(db_session, seeded_chat):
    persona = Persona(id="p1", user_id=seeded_chat.owner.id, name="Rover", description="A traveler", injection_position="before_char", is_default=True)
    binding = PersonaBinding(id="b1", user_id=seeded_chat.owner.id, persona_id=persona.id, scope_type="chat", scope_id=seeded_chat.session.id)
    preset = PromptPreset(id="preset1", user_id=seeded_chat.owner.id, name="Roleplay", token_budget=4096)
    block = PromptBlock(id="block1", preset_id=preset.id, kind="persona", name="Persona", enabled=True, sort_order=20)
    profile = ModelProfile(id="profile1", user_id=seeded_chat.owner.id, name="DeepSeek", provider="siliconflow", model="deepseek-v4-flash", prompt_preset_id=preset.id, parameters={"temperature": 0.8})
    db_session.add_all([persona, binding, preset, block, profile]); db_session.commit()
    assert persona.to_dict()["is_default"] is True
    assert profile.to_dict()["parameters"] == {"temperature": 0.8}
```

Add a legacy-schema migration test asserting schema version `4` and tables `personas`, `persona_bindings`, `prompt_presets`, `prompt_blocks`, and `model_profiles`.

- [x] **Step 2: Run RED**

Run: `python -m pytest -q tests/test_persona_models.py server/tests/test_database_migrations.py`
Expected: imports/tables are missing.

- [x] **Step 3: Implement models and additive migration**

Use UUID string primary keys. `Persona` fields: `user_id`, `name` (1–120), `avatar_url`, `description`, `injection_position` (`before_char|after_char|depth`), `depth`, `is_default`, timestamps. `PersonaBinding` has a unique `(user_id, scope_type, scope_id)` and check constraint `scope_type IN ('character','chat')`. `PromptPreset` owns `token_budget`; `PromptBlock` stores `kind`, `name`, `enabled`, `sort_order`, `role`, `content`, `max_tokens`; `ModelProfile` stores provider/model/parameters JSON, preset reference, stop-sequence references, and no key field.

Set `CURRENT_SCHEMA_VERSION = 4`; create the five tables with `checkfirst=True`. Do not add a plaintext secret column.

- [x] **Step 4: Run GREEN and commit**

Run: `python -m pytest -q tests/test_persona_models.py server/tests/test_database_migrations.py`
Expected: PASS.

Commit: `feat(shouanren): add persona and prompt schema`

### Task 2: Persona Ownership and Selection Precedence

**Files:** `server/services/persona_service.py`, `tests/test_persona_service.py`

- [x] **Step 1: Write failing precedence tests**

```python
def test_persona_selection_precedence(db_session, persona_graph):
    service = PersonaService(db_session, owner_id=persona_graph.owner.id)
    assert service.select(character_id="c1", session_id="s1").source == "chat"
    service.clear_binding("chat", "s1")
    assert service.select(character_id="c1", session_id="s1").source == "character"
    service.clear_binding("character", "c1")
    assert service.select(character_id="c1", session_id="s1").source == "default"

def test_temporary_persona_does_not_replace_persistent_binding(db_session, persona_graph):
    service = PersonaService(db_session, owner_id=persona_graph.owner.id)
    selected = service.select(character_id="c1", session_id="s1", temporary_persona_id="temporary")
    assert selected.persona.id == "temporary"
    assert service.binding("chat", "s1").persona_id == "chat-persona"
```

Add tests that another user receives `PersonaNotFound` for reads, updates, selection, and bindings.

- [x] **Step 2: Run RED, implement, run GREEN**

Implement `owned_persona`, `list_personas`, `set_default`, `bind`, `clear_binding`, `binding`, and `select`. Validate the chat belongs to the owner and character bindings refer to readable characters. Temporary selection is request-only and never persisted.

Run: `python -m pytest -q tests/test_persona_service.py tests/test_resource_security.py`
Expected: PASS.

Commit: `feat(shouanren): select private personas`

### Task 3: Persona CRUD and Binding API

**Files:** `server/routers/persona.py`, `server/main.py`, `tests/test_persona_api.py`

- [x] **Step 1: Write failing API tests**

Test `GET/POST /api/personas`, `PUT/DELETE /api/personas/{id}`, `PUT /api/personas/default/{id}`, `PUT/DELETE /api/personas/bindings/{scope_type}/{scope_id}`, and `GET /api/personas/selection?session_id=...`. Assert cross-user IDs return 404, duplicate defaults collapse to one, invalid injection positions return 422, and deleting a Persona removes its bindings.

- [x] **Step 2: Run RED, implement bounded Pydantic payloads, run GREEN**

Use `name` length 1–120, description max 20000, depth 0–100, and `Literal` scope/position fields. Map service `NotFound` to HTTP 404.

Run: `python -m pytest -q tests/test_persona_api.py tests/test_site_auth.py`
Expected: PASS.

Commit: `feat(shouanren): expose persona management api`

### Task 4: Deterministic Prompt Composer and Safe Preview

**Files:** `server/services/prompt_composer.py`, `tests/test_prompt_composer.py`

- [x] **Step 1: Write failing composition tests**

```python
def test_composer_orders_blocks_and_reports_budget_rejections():
    result = PromptComposer().compose(blocks=[system_block, character_block, persona_block, worldbook_block, history_block], token_budget=20)
    assert [item.kind for item in result.included] == ["system", "character", "persona"]
    assert result.trace[-1].reason == "token_budget_exceeded"

def test_preview_redacts_secret_shaped_metadata():
    preview = PromptComposer().preview(blocks=[block], metadata={"api_key": "secret", "model": "x"})
    assert "secret" not in str(preview)
    assert preview.metadata == {"model": "x"}
```

- [x] **Step 2: Run RED, implement pure types/composer, run GREEN**

Define canonical kinds: `system`, `character`, `persona`, `lorebook`, `memory`, `rag`, `author_note`, `history`, `final`. Stable ordering is `(sort_order, id)`. Disabled/empty blocks receive trace reasons. Token estimation reuses `lorebook_engine.estimate_tokens`. Preview metadata allows only `provider`, `model`, `temperature`, `top_p`, `max_tokens`, and stop-sequence names.

Run: `python -m pytest -q tests/test_prompt_composer.py`
Expected: PASS.

Commit: `feat(shouanren): compose inspectable prompts`

### Task 5: Prompt Preset, Model Profile, and Preview API

**Files:** `server/routers/prompt_presets.py`, `server/main.py`, `tests/test_prompt_api.py`

- [x] **Step 1: Write failing ownership and preview tests**

Cover preset/block CRUD, atomic block reordering, model profile CRUD without key fields, and `POST /api/prompt-presets/preview`. Assert another user gets 404, duplicate sort positions resolve by ID, unknown block kinds return 422, and response JSON contains no key/token/authorization fields.

- [x] **Step 2: Run RED, implement, run GREEN**

Use one transaction for reordering. Model profile parameters allow only `temperature`, `top_p`, `max_tokens`, `frequency_penalty`, and `presence_penalty`; reject unknown keys. Preview loads only records owned by the current user.

Run: `python -m pytest -q tests/test_prompt_api.py tests/test_resource_security.py`
Expected: PASS.

Commit: `feat(shouanren): expose prompt manager api`

### Task 6: Chat Integration and Native Management Pages

**Files:** `server/routers/chat.py`, `server/utils/prompt_builder.py`, `frontend/personas.html`, `frontend/js/personas.js`, `frontend/prompt-manager.html`, `frontend/js/prompt-manager.js`, `frontend/index.html`, `tests/test_chat_api.py`, `tests/test_prompt_frontend_contract.py`

- [x] **Step 1: Write failing chat/frontend tests**

Verify selected Persona content is injected at its configured position; chat binding beats character/default; a temporary `persona_id` form field affects only that request; prompt preview shows ordered blocks and trace; all server strings render through `textContent`; pages load `auth.js` and `api.js`; private actions redirect through unified login.

- [x] **Step 2: Run RED and integrate services**

Add optional `persona_id` and `model_profile_id` form fields. Build canonical blocks from current system rules, character, selected Persona, evaluated worldbook entries, memories, summary/history, and preset custom blocks. Preserve existing depth worldbook injection and branch history. Pass provider/model parameters to the existing LLM service without copying credentials.

- [x] **Step 3: Build pages and verify**

Persona page supports create/edit/delete/default and character/chat binding. Prompt Manager supports preset selection, enable/disable, numeric ordering, block editor, model-profile references, and preview trace. Use confirmation for deletes, disabled submit buttons during requests, labels, `aria-live`, and no `innerHTML` for server data.

Run: `python -m pytest -q tests/test_chat_api.py tests/test_persona_api.py tests/test_prompt_api.py tests/test_prompt_frontend_contract.py && node --check frontend/js/personas.js && node --check frontend/js/prompt-manager.js`
Expected: PASS.

Commit: `feat(shouanren): integrate personas and prompt manager`

### Task 7: Documentation, Full Verification, Migration, and Restart

**Files:** `守岸人3.0/README.md`, this plan.

- [ ] Update README with selection precedence, temporary selection, prompt block kinds, preview safety, schema v4, and clean-room scope.
- [ ] Run `python -m pytest -q` in `守岸人3.0`; expected zero failures.
- [ ] Run `python -m compileall -q server tests` and Node syntax checks for both new scripts.
- [ ] Run `git diff --check` and stage only phase-2 files.
- [ ] Run root `scripts/stop-local.ps1`, `start-local.ps1`, and `check-local.ps1`; expected exit code 0.
- [ ] Inspect `schema_metadata.version == 4` and the five new tables.
- [ ] Mark executed checkboxes and commit `docs(shouanren): document personas and prompt manager`.

Do not delete reference repositories in this phase. Do not implement Character Card V3/CharX, RAG, group-chat orchestration, automation, or visual themes here.
