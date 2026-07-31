# 守岸人聊天体验增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在守岸人现有架构上实现可靠的统一身份映射、消息滑动、非破坏式编辑/删除、对话分支、检查点、搜索和完整备份。

**Architecture:** `site-auth` 继续负责唯一密码和会话，守岸人只保存与其 ID 绑定的本地资料。聊天历史改为“消息父指针 + 分支元数据 + 当前头节点”，活动上下文通过父指针恢复，swipe 仍是单条 AI 消息的候选集合。HTTP 路由只负责验证和序列化，分支不变量集中在独立 `ChatHistoryService`。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy 2、SQLite/PostgreSQL、原生 JavaScript/CSS、pytest

---

## 文件结构

新增文件：

- `守岸人3.0/server/services/site_user_profiles.py`：把 `site-auth` 身份映射到守岸人本地资料。
- `守岸人3.0/server/services/chat_history.py`：活动路径、分支、编辑、删除、swipe 和检查点领域逻辑。
- `守岸人3.0/server/services/chat_backups.py`：版本化完整备份和保留策略。
- `守岸人3.0/tests/conftest.py`：隔离数据库与用户测试夹具。
- `守岸人3.0/tests/test_site_user_profiles.py`
- `守岸人3.0/tests/test_chat_history.py`
- `守岸人3.0/tests/test_chat_api.py`
- `守岸人3.0/tests/test_chat_backups.py`

修改文件：

- `守岸人3.0/server/models/user.py`
- `守岸人3.0/server/models/chat_db.py`
- `守岸人3.0/server/models/__init__.py`
- `守岸人3.0/server/database.py`
- `守岸人3.0/server/middleware/auth.py`
- `守岸人3.0/server/routers/chat.py`
- `守岸人3.0/frontend/index.html`
- `守岸人3.0/frontend/js/api.js`
- `守岸人3.0/frontend/js/app.js`
- `守岸人3.0/frontend/css/main.css`
- `守岸人3.0/README.md`

## Task 1：统一身份映射与测试数据库

**Files:**

- Create: `守岸人3.0/server/services/site_user_profiles.py`
- Create: `守岸人3.0/tests/conftest.py`
- Create: `守岸人3.0/tests/test_site_user_profiles.py`
- Modify: `守岸人3.0/server/models/user.py`
- Modify: `守岸人3.0/server/database.py`
- Modify: `守岸人3.0/server/middleware/auth.py`

- [ ] **Step 1：写身份映射失败测试**

测试必须证明旧本地 `admin` 会绑定到 `site-auth` ID，但本地主键不改变；新用户会创建不可本地登录的影子资料：

```python
def test_existing_local_user_is_bound_without_changing_primary_key(db_session):
    local = User(
        id="legacy-admin",
        username="admin",
        email="admin@shouanren.com",
        password_hash="legacy-disabled",
        role="admin",
    )
    db_session.add(local)
    db_session.commit()

    identity = SiteUser(
        id="site-admin",
        username="admin",
        email="admin@local.invalid",
        role="admin",
    )
    resolved = ensure_site_user_profile(db_session, identity)

    assert resolved.id == "legacy-admin"
    assert resolved.site_user_id == "site-admin"
    assert resolved.username == "admin"
    assert resolved.role == "admin"


def test_new_site_user_gets_non_login_shadow_profile(db_session):
    identity = SiteUser(
        id="site-reader",
        username="reader",
        email="reader@example.com",
        role="user",
    )

    resolved = ensure_site_user_profile(db_session, identity)

    assert resolved.site_user_id == "site-reader"
    assert resolved.password_hash == "!site-auth-only!"
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_site_user_profiles.py" -q
```

Expected: FAIL，因为 `site_user_id` 和 `ensure_site_user_profile` 尚不存在。

- [ ] **Step 3：实现本地资料映射**

在 `User` 增加：

```python
site_user_id = Column(String(64), unique=True, nullable=True, index=True)
```

新增服务的公开函数：

```python
def ensure_site_user_profile(db: Session, identity: SiteUser) -> User:
    bound = db.scalar(select(User).where(User.site_user_id == identity.id))
    if bound is not None:
        bound.username = identity.username
        bound.email = identity.email
        bound.role = identity.role
        bound.is_active = identity.is_active
        db.commit()
        db.refresh(bound)
        return bound

    username_match = db.scalar(
        select(User).where(func.lower(User.username) == identity.username.lower())
    )
    email_match = db.scalar(
        select(User).where(func.lower(User.email) == identity.email.lower())
    )
    if username_match is not None and email_match is not None and username_match.id != email_match.id:
        raise SiteUserProfileConflict("用户名和邮箱分别属于不同本地资料")

    profile = username_match or email_match
    if profile is None:
        profile = User(
            username=identity.username,
            email=identity.email,
            password_hash="!site-auth-only!",
        )
        db.add(profile)
    profile.site_user_id = identity.id
    profile.role = identity.role
    profile.is_active = identity.is_active
    db.commit()
    db.refresh(profile)
    return profile
```

把现有认证依赖拆成 `get_site_identity(request)` 和：

```python
async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    identity = await get_site_identity(request)
    try:
        return ensure_site_user_profile(db, identity)
    except SiteUserProfileConflict as exc:
        raise HTTPException(status_code=409, detail="统一账号与本地资料冲突") from exc
```

`database.py` 为旧库补 `users.site_user_id`，并用 `CREATE UNIQUE INDEX IF NOT EXISTS ix_users_site_user_id ON users(site_user_id)` 创建唯一索引；SQLite 与 PostgreSQL 的唯一索引都允许多个 `NULL`。迁移必须先查询重复非空 ID，发现冲突就中止并列出本地用户主键，不得静默覆盖。不得迁移或验证旧 `password_hash`。

- [ ] **Step 4：运行身份与既有认证测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_site_user_profiles.py" "守岸人3.0/tests/test_site_auth.py" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/models/user.py" "守岸人3.0/server/database.py" "守岸人3.0/server/middleware/auth.py" "守岸人3.0/server/services/site_user_profiles.py" "守岸人3.0/tests/conftest.py" "守岸人3.0/tests/test_site_user_profiles.py" "守岸人3.0/tests/test_site_auth.py"
git commit -m "fix(shouanren): map site identities to local profiles"
```

## Task 2：分支化聊天数据模型与可重复迁移

**Files:**

- Modify: `守岸人3.0/server/models/chat_db.py`
- Modify: `守岸人3.0/server/models/__init__.py`
- Modify: `守岸人3.0/server/database.py`
- Create: `守岸人3.0/tests/test_chat_history.py`

- [ ] **Step 1：写旧消息迁移测试**

使用临时 SQLite 文件创建旧版 `chat_sessions` 和 `chat_messages`，运行迁移两次并断言：

```python
def test_chat_graph_migration_is_idempotent(legacy_database):
    migrate_chat_graph(legacy_database.engine)
    migrate_chat_graph(legacy_database.engine)

    session = legacy_database.session.get(ChatSession, "session-1")
    messages = (
        legacy_database.session.query(ChatMessage)
        .order_by(ChatMessage.sequence)
        .all()
    )

    assert session.current_branch_id is not None
    assert session.head_message_id == messages[-1].id
    assert session.version == 1
    root_branch = legacy_database.session.get(ChatBranch, session.current_branch_id)
    assert root_branch.head_message_id == messages[-1].id
    assert [message.parent_message_id for message in messages] == [
        None,
        messages[0].id,
        messages[1].id,
    ]
    assert len({message.branch_id for message in messages}) == 1
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py::test_chat_graph_migration_is_idempotent" -q
```

Expected: FAIL，因为图模型尚不存在。

- [ ] **Step 3：实现模型**

`ChatSession` 增加 `current_branch_id`、`head_message_id`、`title` 和 `version`。`ChatMessage` 增加 `branch_id`、`parent_message_id`、`sequence` 和 `edited_at`。

新增：

```python
class ChatBranch(Base):
    __tablename__ = "chat_branches"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    parent_branch_id = Column(String, ForeignKey("chat_branches.id"), nullable=True)
    fork_message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    head_message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    name = Column(String(120), nullable=False, default="主分支")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChatCheckpoint(Base):
    __tablename__ = "chat_checkpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    branch_id = Column(String, ForeignKey("chat_branches.id"), nullable=False)
    message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

实现 `migrate_chat_graph(engine)`：创建新表、补列、为每个旧会话创建确定性根分支、按 `(created_at, id)` 回填父指针和序号，并让根分支与会话的 `head_message_id` 都指向最后一条旧消息。根分支 ID 使用 `uuid5(NAMESPACE_URL, f"shouanren:{session_id}:root")`，保证重复执行不新增分支。每个分支自己保存头指针，`ChatSession.head_message_id` 只是当前分支头指针的缓存；切换分支时必须同步两者。

- [ ] **Step 4：运行迁移与模型测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py::test_chat_graph_migration_is_idempotent" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/models/chat_db.py" "守岸人3.0/server/models/__init__.py" "守岸人3.0/server/database.py" "守岸人3.0/tests/test_chat_history.py"
git commit -m "feat(shouanren): add branch-aware chat schema"
```

## Task 3：活动路径与 Swipe 领域服务

**Files:**

- Create: `守岸人3.0/server/services/chat_history.py`
- Modify: `守岸人3.0/tests/test_chat_history.py`

- [ ] **Step 1：写路径和 swipe 测试**

```python
def test_active_path_follows_parent_pointers(db_session, seeded_chat):
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    assert [item.content["text"] for item in service.active_path(seeded_chat.session.id)] == [
        "你好",
        "你好，漂泊者",
    ]


def test_regeneration_context_excludes_target_and_descendants(db_session, seeded_chat):
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    context = service.context_before(seeded_chat.assistant_message.id)
    assert [item.content["text"] for item in context] == ["你好"]


def test_selecting_swipe_updates_only_selected_candidate(db_session, seeded_chat):
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    updated = service.append_swipe(seeded_chat.assistant_message.id, "另一个回答")
    service.select_swipe(updated.id, 0)

    assert updated.swipes == ["你好，漂泊者", "另一个回答"]
    assert updated.swipe_id == "0"
    assert updated.content["text"] == "你好，漂泊者"
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py" -q
```

Expected: FAIL，因为 `ChatHistoryService` 尚不存在。

- [ ] **Step 3：实现领域服务**

公开接口固定为：

```python
class ChatHistoryService:
    def __init__(self, db: Session, *, owner_id: str): ...
    def owned_session(self, session_id: str) -> ChatSession: ...
    def owned_message(self, message_id: str) -> ChatMessage: ...
    def require_version(self, session_id: str, expected_version: int) -> ChatSession: ...
    def active_path(self, session_id: str, *, head_id: str | None = None) -> list[ChatMessage]: ...
    def context_before(self, message_id: str) -> list[ChatMessage]: ...
    def prompt_messages_before(self, message_id: str) -> list[dict[str, str]]: ...
    def append_message(self, session_id: str, role: str, text: str) -> ChatMessage: ...
    def append_swipe(self, message_id: str, text: str) -> ChatMessage: ...
    def select_swipe(self, message_id: str, swipe_id: int) -> ChatMessage: ...
```

`active_path` 从 `head_message_id` 沿 `parent_message_id` 向根遍历，检测循环后反转。`owned_session` 和 `owned_message` 查不到或不属于当前用户时统一抛 `ChatResourceNotFound`。`prompt_messages_before` 调用 `context_before`，把每条消息转换为现有 `build_messages` 接受的 `{"role": ..., "content": ...}`，其中 assistant 文本取当前 `swipe_id` 对应候选；如果候选越界则退回 `content["text"]`。写入使用 `flag_modified(message, "swipes")` 和短事务。

- [ ] **Step 4：运行测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/services/chat_history.py" "守岸人3.0/tests/test_chat_history.py"
git commit -m "feat(shouanren): centralize chat history semantics"
```

## Task 4：历史与重新生成 API

**Files:**

- Modify: `守岸人3.0/server/routers/chat.py`
- Create: `守岸人3.0/tests/test_chat_api.py`

- [ ] **Step 1：写 API 失败测试**

```python
def test_history_returns_message_and_swipe_metadata(chat_client, seeded_chat):
    response = chat_client.get(f"/api/chat/history?session_id={seeded_chat.session.id}")
    assert response.status_code == 200
    assert response.json()[-1] == {
        "id": seeded_chat.assistant_message.id,
        "role": "assistant",
        "content": "你好，漂泊者",
        "swipes": ["你好，漂泊者"],
        "swipe_id": 0,
        "branch_id": seeded_chat.root_branch.id,
        "parent_message_id": seeded_chat.user_message.id,
        "created_at": seeded_chat.assistant_message.created_at.isoformat(),
        "edited_at": None,
    }


def test_regenerate_uses_only_context_before_target(chat_client, seeded_chat, fake_llm):
    response = chat_client.post(
        f"/api/chat/messages/{seeded_chat.assistant_message.id}/regenerate",
        data={"version": "1"},
    )
    assert response.status_code == 200
    assert [message["content"] for message in fake_llm.last_messages if message["role"] != "system"] == [
        "你好"
    ]
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_api.py" -q
```

Expected: FAIL，历史缺少元数据且新 regenerate 路由不存在。

- [ ] **Step 3：重构路由**

使用 `ChatHistoryService` 替换 `_load_db_history`。增加：

```python
@router.post("/messages/{message_id}/regenerate")
async def regenerate_message(
    message_id: str,
    version: int = Form(...),
    backend: str | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    target = service.owned_message(message_id)
    session = service.require_version(target.session_id, version)
    character = db.get(Character, session.character_id)
    if character is None:
        raise HTTPException(status_code=404, detail="角色不存在")
    history = service.prompt_messages_before(message_id)
    prompt = build_messages(build_system_prompt(character), history)
    generated = clean_text(llm_service.chat(prompt, backend=backend), mode="display")
    service.require_version(target.session_id, version)
    updated = service.append_swipe(message_id, generated)
    return serialize_chat_message(updated)
```

在路由文件中新增唯一序列化函数 `serialize_chat_message(message)`，明确返回 `id`、`role`、选中候选文本、`swipes`、整数 `swipe_id`、`branch_id`、`parent_message_id`、`created_at` 和 `edited_at`；历史、重新生成和旧 swipe 路由全部复用它。生成期间不持有数据库事务；追加前再次检查版本。保留旧 `/api/chat/swipe` 一版兼容期，但内部调用同一服务并返回弃用响应头。

- [ ] **Step 4：运行 API 和认证测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_api.py" "守岸人3.0/tests/test_site_auth.py" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/routers/chat.py" "守岸人3.0/tests/test_chat_api.py"
git commit -m "fix(shouanren): restore swipe state and regeneration context"
```

## Task 5：非破坏式编辑、删除、分支与检查点

**Files:**

- Modify: `守岸人3.0/server/services/chat_history.py`
- Modify: `守岸人3.0/server/routers/chat.py`
- Modify: `守岸人3.0/tests/test_chat_history.py`
- Modify: `守岸人3.0/tests/test_chat_api.py`

- [ ] **Step 1：写分支不变量测试**

```python
def test_edit_creates_branch_and_preserves_original_path(db_session, seeded_chat):
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    original_branch = seeded_chat.session.current_branch_id
    edited = service.edit_message(
        seeded_chat.user_message.id,
        "重新问候",
        expected_version=1,
    )

    assert edited.branch_id != original_branch
    assert service.active_path(seeded_chat.session.id)[0].content["text"] == "重新问候"
    service.activate_branch(seeded_chat.session.id, original_branch)
    assert service.active_path(seeded_chat.session.id)[0].content["text"] == "你好"


def test_delete_truncates_new_branch_without_deleting_original(db_session, seeded_chat):
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    service.delete_from(
        seeded_chat.assistant_message.id,
        expected_version=1,
    )
    assert [item.role for item in service.active_path(seeded_chat.session.id)] == ["user"]
    assert db_session.get(ChatMessage, seeded_chat.assistant_message.id) is not None
```

检查点测试必须覆盖创建、恢复、删除和跨用户 404。

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py" "守岸人3.0/tests/test_chat_api.py" -q
```

Expected: FAIL，因为编辑、删除、分支和检查点方法不存在。

- [ ] **Step 3：实现服务方法和 API**

服务增加：

```python
def edit_message(self, message_id: str, text: str, *, expected_version: int) -> ChatMessage: ...
def delete_from(self, message_id: str, *, expected_version: int) -> ChatBranch: ...
def list_branches(self, session_id: str) -> list[ChatBranch]: ...
def activate_branch(self, session_id: str, branch_id: str) -> ChatSession: ...
def create_checkpoint(self, session_id: str, name: str, message_id: str | None) -> ChatCheckpoint: ...
def restore_checkpoint(self, checkpoint_id: str) -> ChatSession: ...
def delete_checkpoint(self, checkpoint_id: str) -> None: ...
```

编辑和删除都创建 `ChatBranch(parent_branch_id=current_branch_id, fork_message_id=target.parent_message_id)`。编辑写入新消息并设为头节点；删除把头节点设为目标父节点。每次结构修改将 `session.version += 1`。版本不符抛 `ChatVersionConflict`。

增加设计文档定义的 PATCH、DELETE、branch 和 checkpoint 路由；资源不存在或越权统一映射为 404，版本冲突映射为 409。

- [ ] **Step 4：运行测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_history.py" "守岸人3.0/tests/test_chat_api.py" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/services/chat_history.py" "守岸人3.0/server/routers/chat.py" "守岸人3.0/tests/test_chat_history.py" "守岸人3.0/tests/test_chat_api.py"
git commit -m "feat(shouanren): add chat branches and checkpoints"
```

## Task 6：搜索、兼容导出与完整备份

**Files:**

- Create: `守岸人3.0/server/services/chat_backups.py`
- Create: `守岸人3.0/tests/test_chat_backups.py`
- Modify: `守岸人3.0/server/services/chat_history.py`
- Modify: `守岸人3.0/server/routers/chat.py`
- Modify: `守岸人3.0/tests/test_chat_api.py`

- [ ] **Step 1：写搜索和备份往返测试**

```python
def test_search_is_scoped_to_owner(chat_client, seeded_chat, another_users_chat):
    response = chat_client.get("/api/chat/search?q=漂泊者")
    assert response.status_code == 200
    assert {item["session_id"] for item in response.json()["items"]} == {
        seeded_chat.session.id
    }


def test_full_backup_round_trip_preserves_graph(db_session, seeded_branched_chat, tmp_path):
    backups = ChatBackupService(db_session, root=tmp_path)
    payload = backups.export_session(
        seeded_branched_chat.session.id,
        owner_id=seeded_branched_chat.user_id,
    )
    imported = backups.import_session(payload, owner_id=seeded_branched_chat.user_id)

    assert imported.branch_count == payload["branch_count"]
    assert imported.checkpoint_count == payload["checkpoint_count"]
    assert imported.message_count == payload["message_count"]


def test_automatic_snapshots_are_atomic_and_keep_latest_twenty(
    db_session, seeded_branched_chat, tmp_path
):
    backups = ChatBackupService(db_session, root=tmp_path)
    for version in range(1, 23):
        backups.snapshot_after_change(
            seeded_branched_chat.session.id,
            owner_id=seeded_branched_chat.user_id,
            version=version,
        )

    files = sorted(tmp_path.glob("*.json"))
    assert len(files) == 20
    assert not list(tmp_path.glob("*.tmp"))
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_backups.py" "守岸人3.0/tests/test_chat_api.py" -q
```

Expected: FAIL，因为搜索与完整备份尚不存在。

- [ ] **Step 3：实现搜索和备份**

`ChatBackupService` 的 JSON 顶层固定为：

```python
{
    "format": "shouanren-chat-backup",
    "version": 1,
    "exported_at": "ISO-8601",
    "session": {},
    "branches": [],
    "messages": [],
    "checkpoints": [],
}
```

导入先在内存验证：

- 文件不超过 10 MiB。
- 消息不超过 20,000。
- 所有 parent、branch、checkpoint 引用存在。
- 消息父指针无环。
- 角色存在。

验证通过后在单事务中重写所有 ID。JSONL 导出只输出活动路径，继续包含 `role`、`content`、`swipes`、`swipe_id` 和时间。

搜索使用 SQLAlchemy 查询当前用户会话，并在 Python 中对 JSON `content` 与 `swipes` 做大小受限匹配；默认最多返回 50 项，每项片段不超过 160 字。

`snapshot_after_change` 先把完整图写入同目录临时文件，`flush`/关闭后用原子替换生成 `{session_id}-{version}-{timestamp}.json`；只保留该会话最近 20 份。Task 5 的编辑、删除、切换分支、创建/恢复/删除检查点，以及本任务的完整导入成功提交后，都调用该方法。备份失败要记录错误并向写操作返回 500，不得让页面显示“已保存”却没有恢复点。

- [ ] **Step 4：运行测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_backups.py" "守岸人3.0/tests/test_chat_api.py" -q
```

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/server/services/chat_backups.py" "守岸人3.0/server/services/chat_history.py" "守岸人3.0/server/routers/chat.py" "守岸人3.0/tests/test_chat_backups.py" "守岸人3.0/tests/test_chat_api.py"
git commit -m "feat(shouanren): add chat search and graph backups"
```

## Task 7：聊天前端交互

**Files:**

- Modify: `守岸人3.0/frontend/index.html`
- Modify: `守岸人3.0/frontend/js/api.js`
- Modify: `守岸人3.0/frontend/js/app.js`
- Modify: `守岸人3.0/frontend/css/main.css`
- Create: `守岸人3.0/tests/test_chat_frontend_contract.py`

- [ ] **Step 1：写前端契约失败测试**

```python
def test_chat_frontend_exposes_branch_and_message_controls():
    root = Path(__file__).resolve().parents[1]
    html = (root / "frontend" / "index.html").read_text("utf-8")
    app = (root / "frontend" / "js" / "app.js").read_text("utf-8")

    for marker in (
        "chat-session-panel",
        "chat-search-input",
        "branch-select",
        "checkpoint-list",
    ):
        assert marker in html
    for function_name in (
        "editChatMessage",
        "deleteChatMessage",
        "activateChatBranch",
        "createChatCheckpoint",
        "restoreChatCheckpoint",
        "searchChats",
        "exportChatBackup",
    ):
        assert f"function {function_name}" in app or f"async function {function_name}" in app
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_frontend_contract.py" -q
```

Expected: FAIL，因为新控件尚不存在。

- [ ] **Step 3：实现 UI**

`loadChatHistory()` 必须把完整字段传给 `addMessage`：

```javascript
history.forEach((message) => {
  addMessage(
    message.role === 'user' ? 'user' : 'ai',
    message.content,
    false,
    message.id,
    message.swipes,
    message.swipe_id,
    message,
  );
});
```

所有修改请求使用 `API.patch`、`API.del`、`API.postForm`，不得自行添加 Bearer 头。`api.js` 增加：

```javascript
async patch(endpoint, body) {
  return this.parse(await this.request(endpoint, { method: 'PATCH', body }));
}
```

消息悬浮栏提供编辑、删除、检查点；AI 消息保留左右 swipe 与重新生成。侧栏增加搜索、分支选择、检查点和导出。409 时显示“对话已在其他页面更新，正在重新加载”并调用 `loadChatHistory()`。

CSS 必须包含：

- 桌面端操作栏悬浮显示。
- 键盘聚焦时操作栏可见。
- 触屏端操作栏常显。
- 360px 宽度下按钮可换行，聊天气泡不横向溢出。

- [ ] **Step 4：运行前端契约和认证静态测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests/test_chat_frontend_contract.py" "守岸人3.0/tests/test_site_auth.py" -q
```

Expected: PASS，且前端不重新引入 localStorage token 或 Bearer 登录。

- [ ] **Step 5：提交**

```powershell
git add -- "守岸人3.0/frontend/index.html" "守岸人3.0/frontend/js/api.js" "守岸人3.0/frontend/js/app.js" "守岸人3.0/frontend/css/main.css" "守岸人3.0/tests/test_chat_frontend_contract.py"
git commit -m "feat(shouanren): add branch-aware chat controls"
```

## Task 8：文档、回归与本地验收

**Files:**

- Modify: `守岸人3.0/README.md`
- Modify: `README.md`

- [ ] **Step 1：更新文档**

在守岸人 README 增加：

- 单一 `site-auth` 账号与本地影子资料的边界。
- 消息 swipe、编辑、删除、分支和检查点。
- JSONL 与完整备份的差异。
- 搜索、文件限制和备份目录。

根 README 的守岸人功能摘要增加“分支对话、检查点、搜索和备份”，不复制完整 API 表。

- [ ] **Step 2：运行全量守岸人测试**

Run:

```powershell
python -m pytest "守岸人3.0/tests" -q
```

Expected: 所有测试 PASS。

- [ ] **Step 3：运行数据库迁移烟测**

在仓库根目录执行；先复制真实数据库到临时目录，再进入守岸人目录对副本运行两次迁移：

```powershell
$repoRoot = (Resolve-Path .).Path
$smokeDb = Join-Path $repoRoot ".runtime\shouanren-migration-smoke.db"
Copy-Item -LiteralPath (Join-Path $repoRoot "守岸人3.0\data\app.db") -Destination $smokeDb -Force
$env:DATABASE_URL = "sqlite:///$($smokeDb.Replace('\','/'))"
Push-Location (Join-Path $repoRoot "守岸人3.0")
try {
    python -c "from server.database import init_db; init_db(); init_db()"
} finally {
    Pop-Location
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
```

Expected: 两次迁移均完成，无重复分支、重复索引或异常。验证后确认 `$smokeDb` 位于仓库 `.runtime` 目录，再删除该临时副本。

- [ ] **Step 4：启动并运行全站冒烟检查**

Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\stop-local.ps1
.\scripts\start-local.ps1
.\scripts\check-local.ps1
```

Expected:

- 8000–8008 与 5173–5175 正常。
- 匿名守岸人聊天返回 401。
- 同一 `site-auth` 登录会话可访问股票和守岸人。
- 守岸人聊天、分支、检查点、搜索和导出可用。

- [ ] **Step 5：检查差异和敏感信息**

Run:

```powershell
git diff --check
git status --short
git diff -- "守岸人3.0" README.md
```

Expected: 无冲突标记、空白错误、数据库、备份、日志、Cookie 或 API Key。

- [ ] **Step 6：提交文档**

```powershell
git add -- "守岸人3.0/README.md" README.md
git commit -m "docs(shouanren): document branching chat workflow"
```

## 完成标准

- `site-auth` 是唯一密码与会话来源，旧守岸人资料通过 `site_user_id` 映射且旧聊天不丢失。
- 页面刷新后消息 ID、swipes 和选中项完整恢复。
- 重新生成不包含目标回复及后续上下文。
- 编辑和删除创建可恢复的新分支。
- 检查点可以创建、恢复和删除。
- 搜索和两种导出均严格按用户隔离。
- 完整备份可以恢复分支图。
- 所有修改请求使用 Cookie、CSRF 和版本冲突保护。
- 守岸人测试、数据库迁移烟测与全站冒烟检查通过。
