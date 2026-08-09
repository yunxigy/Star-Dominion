# ShouAnRen Resource Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close story, lorebook, legacy-character, and affinity authorization gaps while making LorebookEntry priority persistent and migration-safe.

**Architecture:** Add a focused resource-access module that returns only resources the active user may read or edit. Routers delegate ownership decisions to it; lorebook priority becomes a versioned schema field while advanced evaluation remains out of scope.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLAlchemy, SQLite/PostgreSQL-compatible additive migrations, pytest.

---

## File map

- Create `守岸人3.0/server/services/resource_access.py`: character, story-session, lorebook, and lorebook-entry access rules.
- Create `守岸人3.0/tests/test_resource_security.py`: route-level authorization and validation regressions.
- Modify `守岸人3.0/server/routers/story.py`: authenticate and scope story-session reads and reuse the access module.
- Modify `守岸人3.0/server/routers/lorebook.py`: enforce character-derived read/edit access and validate entry inputs.
- Modify `守岸人3.0/server/routers/characters.py`: reuse character rules and restrict JSON-file mutation to admins.
- Modify `守岸人3.0/server/routers/affinity.py`: make manual point adjustment admin-only and bounded.
- Modify `守岸人3.0/server/models/lorebook.py`: persist and serialize `priority`.
- Modify `守岸人3.0/server/database.py`: add the priority column during the legacy additive migration.
- Modify `守岸人3.0/server/migrations.py`: bump schema version to 2.
- Modify `守岸人3.0/server/tests/test_database_migrations.py`: assert the version-2 migration contract.

### Task 1: Resource-access Module

**Files:**
- Create: `守岸人3.0/server/services/resource_access.py`
- Test: `守岸人3.0/tests/test_resource_security.py`

- [ ] **Step 1: Write failing unit tests for read/edit ownership**

Create users, a public role, a private role, a story session, a lorebook, and an entry in the existing `db_session` fixture. Assert that owner/admin access succeeds, public read succeeds, and another user cannot edit or obtain a private resource.

```python
def test_resource_access_hides_unowned_private_resources(db_session):
    with pytest.raises(HTTPException) as error:
        require_editable_character(db_session, other_user, private_character.id)
    assert error.value.status_code == 404

def test_resource_access_allows_public_read_but_not_edit(db_session):
    assert require_readable_character(db_session, other_user, public_character.id).id == public_character.id
    with pytest.raises(HTTPException):
        require_editable_character(db_session, other_user, public_character.id)
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m pytest -q tests/test_resource_security.py -k resource_access
```

Expected: collection/import failure because `server.services.resource_access` does not exist.

- [ ] **Step 3: Implement the minimal resource-access functions**

Add these functions, all returning `404` for missing or unauthorized private resources:

```python
def can_read_character(character: CharacterDB, user: User) -> bool: ...
def can_edit_character(character: CharacterDB, user: User) -> bool: ...
def require_readable_character(db: Session, user: User, character_id: str) -> CharacterDB: ...
def require_editable_character(db: Session, user: User, character_id: str) -> CharacterDB: ...
def require_owned_story_session(db: Session, user: User, session_id: str) -> StorySession: ...
def require_readable_lorebook(db: Session, user: User, lorebook_id: str) -> Lorebook: ...
def require_editable_lorebook(db: Session, user: User, lorebook_id: str) -> Lorebook: ...
def require_editable_lorebook_entry(db: Session, user: User, entry_id: str) -> LorebookEntry: ...
```

Lorebook access follows `Lorebook.character_id`; entry access follows `entry.lorebook_id` and then the character.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all `resource_access` tests pass.

### Task 2: Story-session read protection

**Files:**
- Modify: `守岸人3.0/server/routers/story.py:541-755`
- Test: `守岸人3.0/tests/test_resource_security.py`

- [ ] **Step 1: Write failing anonymous and cross-user API tests**

Build a small FastAPI test app with `story.router`, override `get_db`, and use two variants: no auth override for anonymous calls and a mutable `get_current_user` override for authenticated calls.

```python
def test_story_session_reads_require_login(anonymous_story_client, seeded_story):
    assert anonymous_story_client.get(f"/api/stories/sessions/{seeded_story.id}").status_code == 401
    assert anonymous_story_client.get(f"/api/stories/sessions/{seeded_story.id}/messages").status_code == 401

def test_story_session_reads_hide_other_users_session(story_client, seeded_story, current_identity):
    current_identity.user = other_user
    assert story_client.get(f"/api/stories/sessions/{seeded_story.id}").status_code == 404
    assert story_client.get(f"/api/stories/sessions/{seeded_story.id}/messages").status_code == 404
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m pytest -q tests/test_resource_security.py -k story_session_reads
```

Expected: anonymous detail is not `401` and anonymous messages are readable or return an unscoped response.

- [ ] **Step 3: Add authentication and resource access**

Change both GET handlers to depend on `get_current_user`. Call `require_owned_story_session` before serializing the session or querying messages. Replace repeated owner checks in branch, send, and delete handlers with the same function without changing response bodies.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: both tests pass.

### Task 3: Lorebook schema consistency and migration

**Files:**
- Modify: `守岸人3.0/server/models/lorebook.py:34-91`
- Modify: `守岸人3.0/server/database.py:312-370`
- Modify: `守岸人3.0/server/migrations.py:9`
- Modify: `守岸人3.0/server/tests/test_database_migrations.py`
- Test: `守岸人3.0/tests/test_resource_security.py`

- [ ] **Step 1: Write a failing model test**

```python
def test_lorebook_entry_persists_priority(db_session, seeded_lorebook):
    entry = LorebookEntry(lorebook_id=seeded_lorebook.id, keyword="岸", content="黑海岸", priority=7)
    db_session.add(entry)
    db_session.commit()
    db_session.expire_all()
    assert db_session.get(LorebookEntry, entry.id).priority == 7
    assert db_session.get(LorebookEntry, entry.id).to_dict()["priority"] == 7
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
python -m pytest -q tests/test_resource_security.py -k persists_priority
```

Expected: `TypeError` reports that `priority` is an invalid keyword for LorebookEntry.

- [ ] **Step 3: Add the model field and serialization**

Add `priority = Column(Integer, default=0, nullable=False)` and include `"priority": self.priority or 0` in `to_dict()`. Keep `order` unchanged.

- [ ] **Step 4: Write a failing version-2 migration test**

Extend `test_database_migrations.py` so the recorded version is expected to be 2. Add a SQLite table created without `priority`, run a migration callback that executes an additive `ALTER TABLE`, and assert both `schema_metadata.version == 2` and the new column exist after repeated execution.

- [ ] **Step 5: Run migration tests and verify RED**

Run:

```powershell
python -m pytest -q server/tests/test_database_migrations.py
```

Expected: version assertion fails with actual version 1.

- [ ] **Step 6: Implement migration version 2**

Set `CURRENT_SCHEMA_VERSION = 2`. In `_migrate_existing_tables`, call:

```python
_ensure_column("lorebook_entries", Column("priority", Integer, nullable=False, default=0))
```

Keep all migration operations idempotent.

- [ ] **Step 7: Run model and migration tests and verify GREEN**

Run both commands from Steps 2 and 5. Expected: all pass.

### Task 4: Lorebook route authorization and validation

**Files:**
- Modify: `守岸人3.0/server/routers/lorebook.py`
- Test: `守岸人3.0/tests/test_resource_security.py`

- [ ] **Step 1: Write failing route tests**

Cover these behaviors:

```python
def test_public_character_lorebook_is_readable_but_not_editable(...):
    assert client.get(f"/api/lorebooks/character/{character.id}").status_code == 200
    assert client.put(f"/api/lorebooks/{lorebook.id}", json={"name": "changed"}).status_code == 404

def test_lorebook_entry_validates_advanced_fields(...):
    response = owner_client.post(
        f"/api/lorebooks/{lorebook.id}/entries",
        json={"keyword": "岸", "content": "黑海岸", "position": "invalid", "probability": 2},
    )
    assert response.status_code == 422
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
python -m pytest -q tests/test_resource_security.py -k lorebook
```

Expected: unowned updates succeed or fail for the wrong reason, and invalid fields are accepted.

- [ ] **Step 3: Apply resource access to every lorebook route**

Use readable character/lorebook checks for GET handlers and editable character/lorebook/entry checks for POST, PUT, and DELETE handlers. Order entries by `priority DESC, order ASC, id ASC`.

- [ ] **Step 4: Add Pydantic constraints**

Use `Literal["and", "or"]`, `Literal["before_char", "after_char", "depth"]`, and `Field(ge=..., le=...)` for probability, cooldown, depth, order, and priority. Preserve current defaults.

- [ ] **Step 5: Run lorebook tests and verify GREEN**

Run the Step 2 command. Expected: all lorebook tests pass.

### Task 5: Legacy JSON mutation and affinity endpoint

**Files:**
- Modify: `守岸人3.0/server/routers/characters.py:216-329`
- Modify: `守岸人3.0/server/routers/affinity.py:64-101`
- Test: `守岸人3.0/tests/test_resource_security.py`

- [ ] **Step 1: Write failing legacy-character and affinity tests**

```python
def test_regular_user_cannot_delete_json_character(...):
    response = client.delete("/api/characters/legacy")
    assert response.status_code == 403
    assert legacy_path.exists()

def test_manual_affinity_adjustment_requires_admin(...):
    assert user_client.post(f"/api/affinity/characters/{character.id}/add-points?points=5").status_code == 403

def test_manual_affinity_adjustment_rejects_invalid_points(admin_client, character):
    assert admin_client.post(f"/api/affinity/characters/{character.id}/add-points?points=-1").status_code == 422
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
python -m pytest -q tests/test_resource_security.py -k "json_character or affinity"
```

Expected: regular JSON deletion returns success and regular affinity adjustment is allowed.

- [ ] **Step 3: Restrict file-character mutations**

Before deleting a JSON character or writing its avatar/voice, require `current_user.role == "admin"`; otherwise return `403`. Database-character paths use `require_editable_character`. Replace the current call that passes a file Character into `_is_allowed_to_edit`.

- [ ] **Step 4: Restrict and validate manual affinity adjustment**

Depend on `get_current_admin` and declare `points: int = Query(default=1, ge=1, le=100)`. Verify the character exists through `require_readable_character` before creating/updating affinity.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

### Task 6: Full verification and runtime reload

**Files:**
- Verify all files above.

- [ ] **Step 1: Run the ShouAnRen test suite**

```powershell
python -m pytest -q
```

Working directory: `守岸人3.0`. Expected: zero failures.

- [ ] **Step 2: Run Python and frontend syntax checks**

```powershell
python -m compileall -q server
```

Extract every inline `<script>` and run `node --check`; run `node --check frontend/js/*.js`. Expected: zero syntax failures.

- [ ] **Step 3: Inspect the final diff**

Run `git diff --check` and inspect only the files named in this plan. Expected: no whitespace errors and no unrelated changes staged.

- [ ] **Step 4: Restart managed local services**

Run `scripts/stop-local.ps1`, then `scripts/start-local.ps1` from the repository root so ports 8000–8009 and 5173–5175 load the new code.

- [ ] **Step 5: Run full smoke checks**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-local.ps1
```

Expected: all port, health, anonymous-auth, login, and cross-service checks pass.

- [ ] **Step 6: Commit only the implementation files**

Stage the files listed in this plan, review the staged diff, and commit with:

```powershell
git commit -m "fix(shouanren): enforce resource ownership"
```

Do not stage existing unrelated workspace changes.
