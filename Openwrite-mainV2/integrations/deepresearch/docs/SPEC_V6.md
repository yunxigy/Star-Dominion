# DeepResearch Framework v6 Draft

## 0. 目标

v6 的目标不是推翻 v5，而是把 v5 已经确定的数据边界和流程语义升级成真正可运行、可审计、可视化的多 agent 研究系统。

v6 必须保留这些 v5 思想：

- `ReportNode` 只表示报告结构。
- `KnowledgeNode` 只表示资料资产。
- `EvidenceLink` 是报告结构和资料资产之间唯一绑定方式。
- 子 agent 不能直接绕过 orchestrator 修改 KG 或 TaskLedger。
- 结构调整必须通过 `StructurePatch`，再由确定性 guard 决定 apply / reject / redispatch。
- 写报告前必须经过 completion gate。
- 发布前必须经过 publish gate。
- 所有 LLM 调用、工具调用、KG/ledger 写入、agent 生命周期都必须进入 trace。

v6 新增目标：

- 主调度 agent 作为智能 planner，覆盖预处理、初步探索、初始树规划和首轮任务创建。
- Evidence / Reflection / StructureReview / Writer / PublishReview 都是职责明确的 agent。
- ReflectionSchedulerAgent 只在一轮 EvidenceAgent 全部结束后运行，做全局审查。
- 支持后端 API 长任务运行、SSE/WebSocket 流式输出、取消运行、恢复查看 trace。
- 支持类似 ChatGPT Deep Research 的可视化：主 agent 和子 agent 都有独立时间线、可折叠 thinking/transcript、工具调用、资料卡片、报告树和证据覆盖状态。

---

## 1. v6 总体流程

```text
ResearchEpisode
  -> MainPlannerAgent boundary
       - parse user request
       - build GlobalRubric
       - scout initial source map
       - propose initial ReportNode tree
       - create first evidence tasks

  -> Evidence Dispatch Loop
       while budget remains:
         DispatchCycle(N)
           -> run EvidenceAgent[] in parallel for queued task batch
           -> wait until every EvidenceAgent in the batch settles
           -> ReflectionSchedulerAgent global review
           -> StructureReviewAgent tree/evidence review
           -> StructureCriticAgent + DeterministicPatchGuard
           -> CompletionGate
           -> if ready_for_report: break
           -> else continue with newly queued/repair tasks

  -> Writer Loop
       -> LeafWriterAgent[] writes minimal report node sections
       -> SectionWriterAgent[] writes aspect synthesis
       -> SynthesisWriterAgent writes executive summary and conclusion

  -> Publish Loop
       -> PublishGate deterministic checks
       -> optional PublishReviewAgent semantic checks
       -> if needs_repair: create repair tasks and return to Evidence Dispatch Loop
       -> else publish report
```

关键规则：

- EvidenceAgent 是局部探索者，只能判断当前 task / report node。
- ReflectionSchedulerAgent 是 batch-level 全局审查者，只在当前 dispatch cycle 的所有 EvidenceAgent 都结束后运行。
- StructureReviewAgent 是探索树调整者，只提出 patch，不直接改树。
- CompletionGate 和 PublishGate 是硬门控，不能被 agent 绕过。
- WriterAgent 不允许凭空补证；发现关键证据不足时输出 writer gap 或 repair task。
- root `ReportNode` 不是普通证据叶节点。root 只代表全局研究目标和报告约束，不能因为 root 级 publish gap 无限创建 `T_completion_R_root_*`。root 级 gap 应优先映射到具体 aspect/hypothesis；若已经有大量子树证据且多轮修复后只剩“研究局限/方法论/数据稀缺/覆盖说明”类中等残留，CompletionGate 应 acknowledge 为报告层 caveat，而不是继续补搜。
- `pruned` 只表示确定不进入最终报告。若 pruned 节点仍有直接强证据或有 supported 子节点，CompletionGate 可确定性恢复，避免 writer/publish gate 因隐藏有效内容反复修复；但不能仅凭历史 `coverage` 计数恢复没有直接 `EvidenceLink` 的节点。
- 外部 provider 故障（Jina/reader timeout、TLS reset、内容安全拒绝）是 infrastructure gap，不是研究内容 gap。它可被记录和 acknowledged，不应触发无限 repair loop。
- 中等残留缺口的处理必须保守：只有在节点已 supported/partially_supported/verified、已有足够支持证据、且已多轮修复后，才能自动 acknowledge；高影响缺口、零证据节点、反证节点仍必须阻塞。

---

## 2. Agent 职责

### 2.1 MainPlannerAgent

目标形态是替代 v5 中分散的 `parse -> rubric -> scout -> architect-tree` 固定链路，但当前实现为了 checkpoint/resume 和可审计性，采用 **MainPlannerAgent boundary**：外层发出 `main_planner_started` / `main_planner_finished`，内部仍按 `parse -> rubric -> init-root -> scout -> architect-tree` 分阶段执行并分别 checkpoint。

这不是整体流程思想的偏离。v5/v6 的核心要求是产物边界稳定、trace 可审计、失败可恢复；因此当前实现优先保留分段 checkpoint，而不是把四个阶段一次性塞进一个不可恢复的大 ReAct prompt。

输入：

- `TaskSubmission`
- UI hints
- runtime profile
- 可用工具列表

可用工具：

- `web_search`
- `fetch_page`
- `save_knowledge_node`
- `link_evidence`
- `propose_report_tree`
- `create_task`
- `finish_initial_plan`

输出：

- `GlobalRubric`
- root `ReportNode`
- scout `KnowledgeNode[]` and `EvidenceLink[]`
- initial `ReportNode` tree
- first wave `TaskItem[]`
- planner summary for UI

约束：

- 目标形态下不能直接写 KG/ledger，只能通过工具请求写入。
- 当前实现中 `rubricPhase`、`initRootPhase`、`scoutPhase`、`architectTreePhase` 仍直接写入 KG/ledger；这是 checkpoint/resume 兼容层，后续如果迁移为完整 ReAct planner，也必须保持同样的数据落点和 checkpoint 语义。
- 初始 report tree 是可修正的，不代表最终结构。
- 初始 scout 目标是建立资料地图，不是穷尽证据。

### 2.2 EvidenceAgent

EvidenceAgent 是真正 ReAct agent，不再是一次 plan 加一次 assess。

循环：

```text
observe ContextPacket
-> choose action
-> tool call
-> observe result
-> continue or finish_evidence
```

可用工具：

- `web_search`
- `fetch_page`
- `save_knowledge_node`
- `link_evidence`
- `open_gap`
- `suggest_patch`
- `finish_evidence`

输出仍统一为 `AgentRunResult`。

约束：

- 只负责当前 `TaskItem` 绑定的 `ReportNode`。
- 可以建议结构 patch，但不能应用 patch。
- 可以提出 open gap，但不能决定全局研究完成。
- 不能写报告。

### 2.3 ReflectionSchedulerAgent

ReflectionSchedulerAgent 是全局调度反思器。

硬规则：

> ReflectionSchedulerAgent runs only after every EvidenceAgent in the current dispatch cycle has settled.

输入：

- 当前 cycle 的全部 `AgentRunResult[]`
- 当前完整 TaskLedger
- 当前 ReportNode coverage
- 当前 open gaps
- 当前 dispatch budget

职责：

- 识别重复任务和重复证据。
- 判断哪些 task 已完成、哪些应 blocked、哪些要重新 queued。
- 判断哪些 open gap 可接受并 acknowledged。
- 判断哪些 gap 影响核心结论，必须生成 repair task。
- 判断是否继续下一轮 dispatch。
- 对 provider outage 只记录/acknowledge infrastructure gap，不能因为 Jina/reader 故障反复创建同一 repair task。
- 每轮 repair 任务有总量上限；对同一 node 的重复 repair 也有 cap。到 cap 后，若节点已经有足够证据且剩余只是中等残留 caveat，应交给 CompletionGate acknowledge；若仍是高影响阻塞，则返回 `needs_human_review`。

输出：

```json
{
  "continueDispatch": true,
  "taskUpdates": [],
  "newTasks": [],
  "skipReasons": []
}
```

约束：

- 不能改 report tree。
- 不能写报告。
- 不能应用 structure patch。

### 2.4 StructureReviewAgent

StructureReviewAgent 是探索树调整器。

输入：

- current report tree
- evidence links by report node
- coverage stats
- open gaps
- worker patch suggestions
- reflection output

输出：

- `StructurePatchSuggestion[]`

允许 patch：

- `add_aspect_node`
- `add_hypothesis_node`
- `rename_report_node`
- `move_report_node`
- `merge_report_nodes`
- `move_evidence_link`
- `retag_knowledge_node`
- `discard_knowledge_node`
- `downplay_hypothesis`

三层审查：

```text
Layer 1: StructureReviewAgent proposes patches
Layer 2: StructureCriticAgent critiques risk: safe / risky / dangerous
Layer 3: DeterministicPatchGuard decides: apply / reject / redispatch
```

当前实现细节：

- StructureReviewAgent 和 worker suggestion 输出先经过 `sanitizeSuggestions`。缺少 `patch.op`、字段不完整或不在 allowlist 的 patch 会被过滤并记录事件，不会导致 evidence run 失败。
- StructureCriticAgent 当前是确定性 critic，而不是 LLM agent。这是有意设计：结构风险审查不能被模型绕过。
- PatchGuard 是最终确定性裁决层；budget 不允许新增 research work 时，`add_*` 这类会产生任务的 patch 会被过滤或 reject。

### 2.5 WriterAgent

WriterAgent 采用 leaf-first。

子角色：

- `LeafWriterAgent`: 每个最小 report node 一个小节。
- `SectionWriterAgent`: 每个 top-level aspect 做综合。
- `SynthesisWriterAgent`: 只写执行摘要和结论。

LeafWriterAgent 流程：

```text
read leaf ReportBundle summary catalog
-> decide which citations need full source inspection
-> fetch selected citation URLs
-> draft leaf section
-> self-check citations
-> finish_leaf
```

当前实现细节：

- writer 先拿 leaf 的 summary catalog，再由 `LeafWriterSourceInspector` 决定是否打开已绑定 citation URL 的全文。
- writer 不能主动搜索新资料；探索职责仍属于 EvidenceAgent。
- citation-required leaf 没有 evidence 时，writer 只创建 `T_writer_repair_*` / `writer_gap_repair`，不能凭空写完整小节。
- 最终报告不应输出重复的“证据缺口/开放性问题/局限”块。medium/high-impact gap 应在 completion/publish gate 前解决或 acknowledge；low-impact caveat 才能被压缩为报告中的谨慎表述。

约束：

- 默认只能打开已有 citation URL。
- 如果需要新增证据，必须输出 repair request，回到 Evidence Dispatch Loop。
- 不能引用 citation index 外的来源。

### 2.6 PublishReviewAgent

PublishGate 仍以确定性检查为主。

确定性检查：

- citation map 完整。
- evidence index 可追溯。
- 报告未截断。
- 无重复结论。
- high-impact gaps 已关闭或 acknowledged。
- 篇幅和节点数量匹配。

PublishReviewAgent 可选检查：

- rubric coverage
- 逻辑跳跃
- 过度确定
- open gaps 是否被隐藏
- 章节拼接是否自然

输出：

```json
{
  "decision": "pass" | "request_revision",
  "issues": [],
  "repairTasks": []
}
```

---

## 3. 通用 AgentRuntime

v6 必须新增统一 agent runtime，避免每个 phase 各写一套伪 agent。

接口草案：

```ts
interface AgentRuntimeInput {
  agent: {
    agentId: string;
    agentRunId: string;
    role: AgentRole;
    title: string;
    objective: string;
    taskId?: string;
    reportNodeId?: string;
    branchId?: string;
  };
  system: string;
  context: unknown;
  tools: ToolRegistry;
  budget: {
    maxReactSteps: number;
    maxToolCalls: number;
    maxSearchCalls?: number;
    maxFetchCalls?: number;
  };
  outputSchema: unknown;
}
```

每轮 LLM 输出：

```json
{
  "thoughtSummary": "短说明，不暴露隐藏链路",
  "action": "tool" | "finish",
  "toolName": "web_search",
  "args": {},
  "finish": {}
}
```

runtime 负责：

- 预算统计。
- tool allowlist 校验。
- JSON parse / repair。
- tool result 注入下一轮 observation。
- lifecycle events。
- abort / timeout。
- failure recovery。
- trace and stream frames。

---

## 4. ToolRegistry

v6 工具调用必须走统一 `ToolRegistry.invoke`。

工具分类：

```text
Read tools:
  web_search
  fetch_page
  inspect_knowledge_node
  list_report_tree
  list_relevant_evidence

Write tools:
  save_knowledge_node
  link_evidence
  open_gap
  suggest_patch
  create_task

Finish tools:
  finish_initial_plan
  finish_evidence
  finish_reflection
  finish_structure_review
  finish_leaf
  finish_section
  finish_synthesis
```

权限原则：

- 每个 agent 只拿本职责需要的工具。
- 写工具必须做 deterministic validation。
- 所有工具调用必须产出 visual event。
- agent 只能请求工具，不能直接调内部 service。

---

## 5. 后端 API 和可视化事件

v6 后端需要同时支持 CLI、SSE、未来 WebSocket 和前端持久化视图。

### 5.1 API

最低接口：

```text
POST /research
  -> starts a run and streams SSE

GET /research/:runId
  -> returns run summary

GET /research/:runId/events
  -> returns persisted visual events

GET /research/:runId/report
  -> returns report markdown

POST /research/:runId/cancel
  -> cancels running episode
```

当前已实现 `POST /research` SSE、`GET /research/:runId`、`GET /research/:runId/events`、`GET /research/:runId/report`、`GET /research/:runId/evidence-index`、`POST /research/:runId/cancel` 和 `/healthz`。接口以 `runId` 为查询主键，因为 `episodeId` 要到 orchestrator context 初始化后才稳定出现。

### 5.2 VisualResearchEvent

后端向前端输出稳定事件，而不是只输出日志行。

```ts
interface VisualResearchEvent {
  eventId: string;
  episodeId: string;
  timestamp: string;
  kind:
    | "agent_started"
    | "agent_thinking"
    | "agent_message"
    | "tool_started"
    | "tool_finished"
    | "source_saved"
    | "evidence_linked"
    | "gap_opened"
    | "task_created"
    | "tree_changed"
    | "reflection_decision"
    | "structure_decision"
    | "writer_draft"
    | "gate_check"
    | "artifact_ready"
    | "error";
  actor: {
    agentRunId?: string;
    role: AgentRole;
    title: string;
    taskId?: string;
    reportNodeId?: string;
    parentAgentRunId?: string;
  };
  ui: {
    lane: "main" | "agent" | "writer" | "gate" | "system";
    severity?: "info" | "warning" | "error" | "success";
    title: string;
    summary?: string;
    collapsible?: boolean;
    initiallyCollapsed?: boolean;
  };
  payload?: unknown;
}
```

### 5.3 前端视图建议

页面布局：

```text
Header: task title, status, elapsed time, controls
Left: report tree + task list + coverage badges
Center: agent timeline
Right: source/evidence drawer + live report preview
Bottom/Drawer: raw transcript and debug trace
```

Agent timeline：

- MainPlannerAgent 单独主线。
- 每个 EvidenceAgent 一张可折叠 run card。
- run card 内展示：
  - 当前目标
  - thinking summary
  - tool calls
  - found sources
  - evidence links
  - open gaps
  - final assessment
- Reflection/Structure/Completion/Writer/Gate 作为阶段卡片。

视觉原则：

- 不展示隐藏 chain-of-thought，只展示 `thoughtSummary`。
- transcript 可折叠，默认收起。
- source 卡片展示 title、tier、url、summary、引用节点。
- report tree 显示 coverage: supporting / contradicting / gaps。
- repair loop 必须可见，不能让用户误以为一次性完成。

---

## 6. 实施计划

### Block 1: AgentRuntime and Visual Events

目标：

- 新增 agent runtime 合约。
- 新增 visual event 合约。
- 新增最小 `runAgentRuntime`。
- 让 stream frame 能携带稳定 `visual` 字段。

验收：

- 单测覆盖 agent lifecycle、tool call、finish、budget exceeded。
- `pnpm typecheck` 通过。

### Block 2: ToolRegistry

目标：

- 实现 orchestrator tool registry。
- search/fetch/save/link/open_gap/suggest_patch/create_task 走统一 invoke。
- 工具调用全部进入 visual events。

验收：

- Evidence 相关旧测试通过。
- 工具预算超限会停止 agent 并输出 gap/failure。

### Block 3: EvidenceAgent ReAct

目标：

- 将 `dispatch-evidence` 从 plan/search/assess 三段式改为 ReAct。
- 保留 `AgentRunResult` 输出。

验收：

- EvidenceAgent 能多轮 search/fetch/save/open_gap/finish。
- 每个子 agent 在 SSE 里有独立流式输出。

### Block 4: MainPlannerAgent

目标：

- 内部替代 parse/rubric/scout/architect 固定链。
- 对外仍保留 phase checkpoint 和 v5 artifacts。

验收：

- 能生成 GlobalRubric、root、initial tree、first tasks。
- scout sources 写入 KG。
- 初始 report tree 后续可被 structure review 修正。

### Block 5: Reflection + Structure Loop

目标：

- ReflectionSchedulerAgent batch-level 全局审查。
- StructureReviewAgent + StructureCriticAgent + PatchGuard 完成闭环。

验收：

- Reflection 只在 batch 全部 settled 后运行。
- 能识别 gap 并生成 repair task。
- 能 apply safe patch / redispatch risky patch / reject dangerous patch。

### Block 6: WriterAgent

目标：

- Leaf/Section/Synthesis writer 使用 AgentRuntime。
- leaf source inspection 成为 writer tool call。

验收：

- writer 能按需 fetch citation URL。
- 不足证据能生成 writer gap/repair task。
- leaf-first 报告结构保持稳定。

### Block 7: Publish API and UI Event Replay

目标：

- 增加 episode 查询、事件回放、取消 API。
- SSE 输出 `VisualResearchEvent`。
- 为前端保留稳定字段。

验收：

- POST /research 可流式运行。
- GET events 可回放。
- cancel 能中止长任务。

### Block 8: PublishReviewAgent

目标：

- publish gate 增加可选语义审稿。

验收：

- 能发现 rubric coverage / overclaim / hidden gaps。
- needs_repair 生成 repair task 并回到 dispatch loop。

---

## 7. 每块实现后的回顾规则

每完成一个 block，必须执行：

1. 对照本 v6 文档列出该 block 的要求。
2. 标注当前实现：
   - satisfied
   - partially satisfied
   - missing
   - design mismatch
3. 如果实现不符合设计：
   - 优先修实现。
   - 如果设计过度或与 v5 思想冲突，再修改文档。
4. 跑相关测试。
5. 决定下一块做什么。

---

## 8. 当前 v5 到 v6 的差距清单

- scout 仍是一次 plan + 批量 search/fetch，不是真 ReAct。
- evidence 已迁入 `AgentRuntime + ToolRegistry` ReAct，并能通过 `VisualResearchEvent` 展示子 agent / tool 事件。
- `ToolRegistry` 已有 orchestrator runtime 实现；Evidence、Reflection、StructureReview、Writer inspection 已接入，scout 和 MainPlanner 内部仍是 checkpoint phase 兼容层。
- `maxReactSteps/maxToolCalls` 已驱动 evidence、reflection、structure review、writer runtime；scout 仍使用 phase 预算。
- stream frame 已有稳定 `VisualResearchEvent` schema；HTTP API 已支持 run 查询、事件回放、取消；示例 UI 已可消费这些事件。
- backend API 已支持启动流式 run、run 查询、事件回放、取消；HTTP 库层为测试/嵌入保留 in-memory 默认值，示例服务器默认注入 SQLite WAL run store。
- publish gate 已有确定性检查和可选 AI semantic reviewer。
- writer 已纳入 `AgentRuntime`，并支持 citation source inspection；低预算 fallback `report.write` 仍是直接 LLM call。
- 示例 UI 已提供 timeline、lane filter、agent 聚合、replay/cancel；生产级前端仍需持久化登录、权限、多用户 run 管理等工程化能力。

这些差距是 v6 后续工程化路线，不应覆盖上面列出的核心流程思想。

---

## 9. 实施回顾记录

### Block 1 Review: AgentRuntime and Visual Events

要求对照：

- `AgentRuntime` contract：satisfied。`AgentRuntimeBudget` / `AgentRuntimeMeta` / `AgentRuntimeDecision` / `AgentRuntimeResult` 已加入 contracts。
- `VisualResearchEvent` schema：satisfied。已作为稳定前端事件类型加入 contracts。
- 最小 `runAgentRuntime`：satisfied。支持多轮 JSON decision、tool allowlist、工具调用、预算限制、finish、失败返回和 visual lifecycle callback。
- stream frame 稳定 `visual` 字段：satisfied。`ResearchStreamFrame.visual` 已生成；旧 `line` 输出保留。
- Reflection batch-level 可视化语义：satisfied。`cycle_reflection` 映射为 `ReflectionSchedulerAgent` / `reflection_decision` / `main` lane，标题固定为 `Global reflection after agent batch`。
- 测试：satisfied。新增 runtime 基础测试和 reflection visual 事件测试。

当前限制：

- Scout / rubric / root / architect 仍是 checkpoint-aware phase，不是完整 ReAct agent；Evidence、Reflection、StructureReview、Writer 已迁入 `runAgentRuntime`。
- MainPlanner 当前是外层 agent 边界，不是内部完全工具化的 planner。
- 现有 orchestrator 代码已经保证 Reflection 在 `dispatchEvidencePhase` 的 `Promise.all` 返回后运行；Block 5 已把 ReflectionSchedulerAgent 迁入 runtime，并保留 dispatch cycle started/finished 事件边界。

### Block 2 Review: ToolRegistry

要求对照：

- 统一 `ToolRegistry.invoke` 入口：satisfied。新增 `createPhaseToolRegistry`，默认暴露 v6 runtime 工具集。
- read tools：satisfied。已支持 `web_search`、`fetch_page`、`inspect_knowledge_node`、`list_report_tree`、`list_relevant_evidence`。
- write tools：satisfied。已支持 `save_knowledge_node`、`link_evidence`、`open_gap`、`suggest_patch`、`create_task`。
- deterministic validation：partially satisfied。基础参数校验、source quality、KG/ledger service 校验已复用；更细粒度的 role-based patch/task policy 留到 StructureReview/PatchGuard block。
- trace 输出：satisfied。search/fetch 复用 traced provider；KG/ledger/structure 写入走 `traceWrite`。
- 每个 agent 权限收窄：satisfied at API level。`createPhaseToolRegistry` 可传入 `tools` allowlist；具体 phase 迁移时绑定角色权限。
- 测试：satisfied。新增 tools 单测覆盖 traced search/fetch、source/evidence/gap/task 写入。

当前限制：

- Evidence、Reflection、StructureReview、Writer inspection 已使用 registry/runtime 工具；scout 和 MainPlanner 内部的 KG/ledger 写入仍走 checkpoint phase 兼容层。
- `suggest_patch` 只负责记录 suggestion，不做最终语义审查；StructureCriticAgent + DeterministicPatchGuard 接管风险判断和落库。
- finish tools 仍由 `AgentRuntime` 的 `finish` action 表达，后续如前端需要可再补显式 finish tool event。

### Block 3 Review: EvidenceAgent ReAct

要求对照：

- `dispatch-evidence` 从 plan/search/assess 三段式改为 ReAct：satisfied。`runEvidenceTask` 现在通过 `runAgentRuntime` 多轮执行，每轮由 LLM 返回 `tool` 或 `finish`。
- 使用统一 `ToolRegistry`：satisfied。EvidenceAgent 通过 `createPhaseToolRegistry` 调用 `web_search`、`fetch_page`、`save_knowledge_node`、`link_evidence`、`open_gap`、`suggest_patch`。
- 保留 `AgentRunResult` 输出：satisfied。runtime steps 被归集为 `knowledgeNodeIds`、`evidenceLinkIds`、`openGaps`、`structurePatchSuggestions`、`turnSummary`。
- 子 agent 独立流式输出：satisfied for backend trace/SSE。LLM 调用通过 `tracedLlmChat(..., "dispatch-evidence.react", meta)` 进入 MemoryGraph，tool 调用沿用 traced provider / `traceWrite`，都带 `taskId`、`reportNodeId`、`agentRunId`。
- Reflection 只在 batch 全部 settled 后运行：satisfied。已有 dispatch 使用 `Promise.all` 等待当前 queued batch；新增完整 episode 测试断言两个 `evidence_agent_finished` 之后才出现 `cycle_reflection`。
- 测试：satisfied。新增 ReAct tool loop 测试、batch reflection 顺序测试；orchestrator 测试更新为显式 ReAct scripted LLM。

设计调整：

- finish tool 暂时不作为 registry tool，而是保留为 `AgentRuntimeDecision.action === "finish"`。这样 runtime 可以统一处理预算、失败和最终输出，后续前端仍可把 finish 渲染成 agent message。
- 为了兼容旧测试夹具，`AgentRuntime` 支持把旧 `queries` / `relation` JSON 修复成 tool/finish decision；真实模型仍按 v6 action schema 执行。

当前限制：

- EvidenceAgent 已是真 ReAct，但 scout 仍是固定 plan/search/fetch。
- `suggest_patch` 的最终风险审查不在 EvidenceAgent 内，而是在 StructureCriticAgent + PatchGuard 中做确定性闭环。
- 示例前端已实现 Agent Cluster / detail drawer / timeline；生产级前端仍需多用户、持久化 run 列表和权限控制。

### Block 4 Review: MainPlannerAgent

要求对照：

- 主调度 agent 边界：satisfied。orchestrator 现在通过 `runMainPlannerFromCursor` 发出 MainPlannerAgent 边界事件，并支持从 `after_rubric` / `after_root` / `after_scout` / `after_main_planner` checkpoint 恢复。
- 对外保留 v5 checkpoint/artifacts：satisfied。MainPlanner boundary 内部仍发出 `episode_started`、`rubric_created`、`root_created`、`scout_started/finished`、`architect_tree_created`，下游 dispatch/report/publish 不变。
- 生成 `GlobalRubric`、root、initial tree、first tasks：satisfied。当前仍复用 `rubricPhase`、`initRootPhase`、`architectTreePhase` 的 v5 数据写入逻辑。
- scout sources 写入 KG：satisfied。当前仍复用 `scoutPhase` 的 search/fetch/save source 路径。
- MainPlannerAgent 可视化事件：satisfied。新增 `main_planner_started` / `main_planner_finished`，stream renderer 映射为 main lane 的 `agent_started` / `agent_message`。
- 主 agent 内部完全通过工具请求写入 KG/ledger：partially satisfied。phase 边界已经统一，但内部仍直接复用 v5 phase 写入逻辑；后续需要把 scout/propose_report_tree/create_task 迁入 `ToolRegistry`。

实现说明：

- 仓库里保留了 `mainPlannerPhase` helper，但当前主路径没有直接调用它；主路径使用 cursor-aware `runMainPlannerFromCursor`，以保证 planner 子阶段失败后能从最近 checkpoint 继续。

设计调整：

- 为了不破坏 v5 checkpoint 和现有可运行链路，Block 4 先落地 MainPlannerAgent 的外层运行边界，而不是一次性把 parse/rubric/scout/architect 全部改成一个大 ReAct prompt。
- 这保持了 v5 的 `ReportNode` / `KnowledgeNode` / `EvidenceLink` 产物稳定，也给前端提供了可折叠主 agent run 的开始/结束节点。

当前限制：

- scout 仍是 plan/search/fetch 固定流程，不是真 ReAct。
- architect tree 仍是一次 LLM 生成，然后 deterministic 写入 KG/ledger。
- `propose_report_tree` 和 `finish_initial_plan` 尚未作为 ToolRegistry 工具实现。

### Block 5 Review: Reflection + Structure Loop

要求对照：

- ReflectionSchedulerAgent batch-level 全局审查：satisfied。`cycleReflectionPhase` 仍只在 dispatch batch 的 `Promise.all` 完成后调用；复杂决策已迁入 `AgentRuntime`，可用 `list_report_tree`、`list_queued_tasks`、`list_open_gaps`、`list_cycle_agent_results`、`list_relevant_evidence` 工具逐步审查。
- Reflection 识别 gap 并生成 repair task：satisfied。原有 `taskUpdates` / `newTasks` / deterministic gap synthesis 保留，新增事件记录 created task ids 和 continue decision。
- StructureReviewAgent 提出 patches：satisfied。`structureReviewPhase` 的结构建议已迁入 `AgentRuntime`，可用 `list_report_tree`、`list_evidence_links`、`list_open_gaps`、`list_worker_patch_suggestions`、`list_relevant_evidence`、`inspect_knowledge_node` 工具逐步审查后输出 patch suggestions。
- StructureCriticAgent 风险审查：satisfied。每个 patch 经 `critiquePatch` 产出 `safe` / `risky` / `dangerous`，并发出 `structure_critic_decision`。
- DeterministicPatchGuard 最终决策：satisfied。新增 `deterministicPatchGuard`，将 dangerous patch reject、budget 不允许的 redispatch reject、safe patch apply、risky patch redispatch；并发出 `patch_guard_decision`。
- safe apply / risky redispatch / dangerous reject：satisfied。测试覆盖 rename/add hypothesis safe apply、evidenced move risky redispatch、cycle-creating move dangerous reject。
- 可视化事件：satisfied。stream renderer 已把 ReflectionSchedulerAgent、StructureReviewAgent、StructureCriticAgent、PatchGuard 映射到 stable `VisualResearchEvent`；`agent_runtime_visual` 会暴露 started/thinking/tool/finish runtime lifecycle。

设计调整：

- StructureCriticAgent 目前是确定性 critic，而不是独立 LLM agent。这样更符合 v5 的硬门控思想：结构风险审查不能被模型绕过。
- PatchGuard 保持最终确定性裁决层，负责把 critic 输出落成 `apply` / `reject` / `redispatch`，并拦截明显危险 patch。

当前限制：

- StructureCriticAgent 仍是确定性 critic，不是 LLM/ReAct agent；这是有意设计，用于保证结构风险审查不可被模型绕过。
- PatchGuard 仍是确定性最终裁决层，不是 agent。
- 前端还没有真正的树状 patch 审查 UI；后端事件已经具备渲染所需字段。

### Block 6 Review: WriterAgent

要求对照：

- Leaf/Section/Synthesis writer 使用 AgentRuntime：satisfied。`report.leaf` / `report.section` / `report.synthesize` 现在都通过 `runWriterDraftAgent` 进入 `AgentRuntime`，并以 `finish.markdown` 作为唯一写作输出。
- leaf source inspection 成为 writer tool call：satisfied。`inspectLeafSources` 现在通过 `LeafWriterSourceInspector` runtime 决策是否调用 `fetch_citation_source`，由 `WriterCitationToolRegistry` 拉取 citation URL 正文片段。
- writer 能按需 fetch citation URL：satisfied。writer inspect 阶段只拿 leaf 已绑定 citation 的 summary catalog，可自行选择最多 `writer.maxFetchCalls` 个来源打开全文。
- 不足证据能生成 writer gap/repair task：satisfied。citation-required leaf 没有 evidence 时，writer 创建 `T_writer_repair_*` 并发出 `writer_gap_repair` 事件，避免最终写作阶段凭空补证。
- leaf-first 报告结构保持稳定：satisfied。报告先逐个最小 report node 生成 leaf draft，再由 top-level section 综合 overview，最后只生成执行摘要和结论；section 拼接时保留 leaf draft 原文。
- prompt/runtime 兼容：satisfied。writer runtime 不再携带旧 evidence prompt hints，且对非 writer tool action 做 deterministic Markdown fallback，避免 smoke/mock provider 把 writer 误导成 search agent。
- 子树 leaf 覆盖：satisfied。leaf-first 分组现在基于 `node.parentNodeId` 推导子树，不依赖 bundle `children` 是否同步，确保 top-level aspect 汇总所有后代 leaf。

设计调整：

- WriterAgent 不是直接开放任意搜索工具，而是先给 summary catalog，再让 writer 决定是否打开已绑定 citation 的全文。这符合“探索由 EvidenceAgent 完成、写作只核查已绑定证据”的边界。
- 最终报告按最小 report node 写作后拼装，避免一次性 root 写作压缩大量证据；section writer 只写 overview，不覆盖 leaf draft。
- writer repair task 进入 ledger，由后续 dispatch/reflection 流程补证，而不是 writer 自行改树或发明证据。

当前限制：

- 当 report call budget 不足以覆盖所有 leaf/section/synthesis 时，仍会回退到 `report.write` 的完整 bundle 单次写作路径；这是预算保护，不是目标路径。
- `report.write` fallback 还没有迁入 `AgentRuntime`。
- Writer source inspection 只允许打开已绑定 citation URL；如果 leaf 完全无证据，只能生成 repair task，不能在 writer 阶段主动搜索。

### Block 7 Review: Publish API and UI Event Replay

要求对照：

- POST /research 可流式运行：satisfied。现有 SSE 行为保留，仍输出 `frame` / `result`，并新增首个 `run` SSE event 返回 stable `runId`。
- GET events 可回放：satisfied。新增 `GET /research/:runId/events`，默认返回 JSON `{events, frames, visualEvents}`；请求 `Accept: text/event-stream` 时可按 SSE 形式回放 `run` / `frame` / `result`。
- episode/run 查询：satisfied。新增 `GET /research/:runId`，返回 status、episodeId、summary、result、error 和 frame/event counts。
- cancel 能中止长任务：satisfied。新增 `POST /research/:runId/cancel`，通过保存的 `AbortController` 触发 abort，并将 run 标为 `cancelled`。
- SSE 输出 `VisualResearchEvent`：satisfied。`ResearchStreamFrame.visual` 已稳定输出，run replay 会聚合 `visualEvents`，供前端按 agent lane/tree 复现。
- 测试覆盖：satisfied。新增 node-http 测试覆盖 replay JSON、visualEvents 聚合、cancel endpoint abort。

设计调整：

- 这里使用轻量 `ResearchRunStore` 管理运行态，不引入数据库；默认每个 HTTP handler 一个 in-memory store，也允许外部注入 store 便于测试或未来持久化。
- 事件回放以 `runId` 为主键，不强依赖 episodeId，因为 episodeId 要到 orchestrator context 初始化后才可稳定出现。
- cancel API 只做控制面 abort；已写出的 artifact 不回滚，后续 UI 应以 run status 和 result/error 决定展示。

当前限制：

- 默认 run store 是进程内内存，服务重启后不能回放旧 run；需要持久化时可实现同一 `ResearchRunStore` 接口。
- 已有示例前端控制台，但还不是生产级前端；稳定 replay API 和 `VisualResearchEvent` 数据是后续正式前端的接口边界。

### Block 8 Review: PublishReviewAgent

要求对照：

- publish gate 增加可选语义审稿：satisfied。确定性 citation/truncation gate 通过后，`semanticPublishReview` 会调用 `publish-gate.semantic`，按 rubric coverage / overclaim / hidden gaps 做语义审稿。
- 能发现 rubric coverage / overclaim / hidden gaps：satisfied。semantic prompt 明确要求检查三类高价值风险，返回 `rubric_coverage` / `overclaim` / `hidden_gap` 或自定义 issue code。
- needs_repair 生成 repair task：satisfied。semantic error issue 复用 `createRepairTasks`，生成 `T_publish_repair_*`，可绑定具体 `reportNodeId`，objective 包含 suggested repair。
- needs_repair 回到 dispatch loop：satisfied。`publishGatePhase` 返回非 succeeded 后，orchestrator 会在存在可自动执行的 `T_publish_repair_*` 且 `publishGate.maxCycles` 额度未耗尽时，回到 Evidence Dispatch Loop；修复任务同样经过 EvidenceAgent、ReflectionSchedulerAgent、StructureReviewAgent、CompletionGate，再重新写作和发布检查。
- 可视化事件：satisfied。新增 `publish_gate_review_started` / `publish_gate_review_finished`，stream renderer 的 publish gate 事件族可归入 gate lane。
- 测试覆盖：satisfied。新增 publish semantic review 测试，断言 overclaim issue 创建 repair task 并发出 review events。

设计调整：

- 语义审稿只在 deterministic gate 没有 error 时运行；如果 citation、截断、模板结论等硬错误已出现，先修硬错误。
- PublishReviewAgent 不直接修改报告或树，只产生 repair task；证据补充和结构调整仍交给 EvidenceAgent / ReflectionSchedulerAgent / StructureReviewAgent。

当前限制：

- semantic reviewer 是单次 LLM JSON check，不是多轮 ReAct。
- publish repair 使用独立的小额度 `publishGate.maxCycles`，避免普通探索轮次用尽后无法执行发布前定向修复；该额度耗尽后仍有阻塞问题时，orchestrator 返回 `needs_human_review`，不会无限追加新轮次。

### Block 9 Review: Example DeepResearch UI

要求对照：

- 像 ChatGPT/Kimi Deep Research 一样可视化主 agent 和子 agent：satisfied for example UI。新增独立 `examples/research-console.html`，按 `VisualResearchEvent.ui.lane` 展示 main / subagent / writer / gate / system，并用 Agent Cluster 聚合每个 agent 的 thinking/tool/message 步骤。
- 美观大方且可直接使用：satisfied for lightweight console。UI 使用数据密集三栏工作台、稳定尺寸指标、lane/kind filters、可折叠 details、agent progress bars，不需要前端构建链。
- 支持后端 API 运行：satisfied。`examples/backend-sse-server.mjs` 现在提供 `/console` 和 `/research` API，UI 直接消费 SSE stream；`/ui` 保留旧轻量页面。
- 子 agent 每一步可见：satisfied at event level。Agent Cluster 和 timeline 会显示 `frame.visual` 的 actor、lane、summary、taskId/reportNodeId，并在 details/Inspector 中展示 payload 或 transcript messages。
- 支持 replay/cancel/report preview：satisfied。UI 提供 Replay 和 Cancel 按钮，分别调用 `GET /research/:runId/events` 与 `POST /research/:runId/cancel`；报告完成后调用 `GET /research/:runId/report` 和 `GET /research/:runId/evidence-index` 展示 Markdown 和 citation count。

设计调整：

- 先提供无构建静态示例 UI，避免为当前仓库引入 React/Vite 等额外前端工具链；生产前端后续可复用同一 `VisualResearchEvent` schema 和 replay API。
- UI 不直接解释业务逻辑，只呈现 agent lane、状态、payload、transcript、run metadata 和最终报告。

当前限制：

- 示例 UI 是单用户开发控制台，不含登录、服务端持久化、多 run 列表等生产功能。
- 已用浏览器截图验证初始三栏布局、模拟 agent cluster 展开和 report tab；后续如引入正式前端构建链，应补 Playwright 回归测试。

### Block 10 Review: Checkpoint Resume and Real API Block Tests

要求对照：

- debug 失败后不必从头跑：satisfied for phase checkpoints。runner 默认在 rubric、root、scout、main planning、dispatch、structure review、report draft 后写 checkpoint；失败时写 `last-error.json`。
- checkpoint 能恢复 KG/ledger/memory/state：satisfied。`ResearchCheckpoint` 保存 `EpisodeRunState`、ReportNodes、KnowledgeNodes、EvidenceLinks、OpenGaps、TaskItems、MemoryEvents、fetch cache。
- checkpoint 崩溃一致性：satisfied。v3 对 checkpoint/latest/pointer/failure metadata 使用同目录 atomic replace + fsync；MemoryEvents 写入不可变、带 SHA-256 与压缩大小的 sidecar。目录或 `latest.json` 恢复会在最新 JSON、gzip、checksum 或 event count 损坏时按时间倒序回退，HTTP 冷启动扫描复用同一有效性判定。v1/v2 保持可读。
- CLI 可恢复：satisfied。新增 `--resume <checkpoint.json|checkpoint-dir>`、`--checkpoint-dir <dir>`、`--no-checkpoint`。
- backend API 可恢复：satisfied。HTTP body 支持 `resume` / `resumeCheckpointPath` / `checkpointDir` / `disableCheckpoints`。
- backend run store 可持久化：satisfied for shared-host deployments。新增 SQLite WAL `ResearchRunStore`，持久化稳定 `RUN_* -> EP_*` 映射、状态、有限 replay events/frames、checkpoint cursor、heartbeat 和取消状态；run ID 创建为原子冲突检查，跨 worker 取消通过 durable status 触发 owner 的 `AbortController`。跨区域部署仍需用事务型外部数据库实现同一接口。
- provider/episode 成本预算可执行：satisfied。LLM、search 和非缓存 fetch 统一进入 usage ledger；`maxRequests`、输入/输出/总 token 与估算成本在每次请求前检查，耗尽时返回带审计和 checkpoint 的失败结果，不绕过质量门禁。每次完成写 `budget-audit.json`，HTTP 提供 `/research/:runId/budget`。
- 自适应停止：satisfied with deterministic quality guard。每轮记录 KnowledgeNode/EvidenceLink/完成任务/质量分/must 覆盖/错误减少；连续低收益只在 must 已覆盖、质量 error 为零、无阻塞 node/gap、无 repair/HIL task 时取消剩余探索任务，否则记录 deferred 并继续。
- 人审响应可执行：satisfied。`human-review.json` 的 question ID 是权威绑定；CLI `--review-response`、TypeScript API `humanReviewResponse`、HTTP `humanReviewResponse` / `reviewResponse` 都只能与 resume checkpoint 一起使用。`continue_research` 可在自动预算耗尽后授权一个额外 dispatch cycle；`downplay` / `omit` / `accept_risk` 形成可审计、范围受限的 waiver，并写入 `human-review-response.json` 与 checkpoint。
- resume 不重复已完成规划/探索：satisfied by tests。新增回归测试：publish review 故障后 checkpoint 停在 `after_report`，resume 后不再调用 GlobalRubric/main planner，直接发布；architect 故障后 checkpoint 停在 `after_scout`，resume 后不再跑 scout。
- 分块真实 API 测试：satisfied。`deepseek.live.spec.ts` 拆成真实 DeepSeek block tests、真实 Jina tool tests、可选端到端 live episode；普通测试默认跳过 live，显式 env 开关才联网。

设计调整：

- checkpoint 采用 JSON 快照而非仅 trace replay。trace 适合观察，checkpoint 适合恢复执行，两者职责不同；完整恢复目录必须同时保留 checkpoint JSON 与其引用的 `events-*.jsonl.gz`。
- 默认使用文件快照，覆盖当前 in-memory stack 的失败恢复；未来如果使用 SQLite stack，可继续保留同一 checkpoint 层作为跨实现保险。
- 端到端 live episode 保持显式 opt-in，因为完整真实链路可能耗时较长、成本较高；日常 real 验证优先跑 DeepSeek/Jina 分块 live tests。

当前限制：

- checkpoint 粒度是 planner subphase / dispatch cycle / structure review / report 边界，不是每个单独 tool call 后都可恢复；失败在某个 EvidenceAgent 内部时会回到该 dispatch cycle 前后的最近稳定点。
- checkpoint 是本地 artifact 文件，没有远程对象存储或多进程锁。
- live e2e 测试真实但慢；本轮验证中 DeepSeek 分块 live 和 Jina tool live 已通过，完整 e2e 运行时间过长，保留为手动按需开关。

## 10. 当前实现一致性审计（2026-07-06）

### 10.1 与 v6 / v5 核心思想一致的部分

- `ReportNode` / `KnowledgeNode` / `EvidenceLink` 的边界仍然成立。报告结构、资料资产、证据绑定没有混成一个对象。
- EvidenceAgent 已经是多轮 ReAct，并通过 `AgentRuntime + ToolRegistry` 做 search/fetch/save/link/open_gap/suggest_patch。
- ReflectionSchedulerAgent 在每个 dispatch cycle 的 EvidenceAgent 全部 settled 之后运行，符合“全局审查而不是单 agent 自评”的设计。
- StructureReviewAgent 只提出 patch；StructureCriticAgent 和 DeterministicPatchGuard 负责风险审查和最终 apply/reject/redispatch。
- CompletionGate 和 PublishGate 仍是硬门控。agent 不能直接绕过 gate 发布报告。
- Writer 已经 leaf-first：先写最小 report node，再做 section synthesis，最后写摘要和结论；writer 只能打开已绑定 citation URL，不能主动搜索新资料。
- 后端 API 已支持 SSE 启动、run 查询、事件回放、报告读取、evidence index 读取和取消；示例 UI 已能展示主 agent、子 agent cluster、timeline、详情页、replay/cancel 和报告预览。

### 10.2 当前仍是兼容层或有意保留的偏差

- MainPlannerAgent 当前是边界，不是完整 ReAct planner。主路径使用 `runMainPlannerFromCursor`，内部仍分 `parse/rubric/root/scout/architect` 子阶段，以保证 checkpoint/resume。仓库中的 `mainPlannerPhase` helper 不是当前主执行路径。
- Scout 仍是一次 plan + 批量 search/fetch，不是真 ReAct。若后续要改，必须保留 scout 的资料地图职责，不能让 scout 写最终结论。
- StructureCriticAgent 和 PatchGuard 是确定性层，不应为了“全部 agent 化”改成纯 LLM 裁决；这是为了保留 v5 的硬 guard 思想。
- publish semantic review 是单次 LLM JSON check，不是 ReAct；它只产出 repair task，不直接改报告。
- HTTP handler 未注入 store 时仍使用进程内默认值；示例服务器已经默认使用 SQLite WAL store，支持重启后回放、稳定 run/episode 映射、heartbeat 和跨 worker 取消。跨区域部署仍需事务型外部存储。
- `report.write` fallback 仍是低预算保护路径。目标路径是 leaf/section/synthesis writer，不能把 fallback 当成主要写作流程。

### 10.3 Trace 调试后确定的设计修正

- root `ReportNode` 不能像普通 leaf 一样无限补证。root 级 gap 要下沉到具体 aspect/hypothesis；如果子树证据已经充分，剩余只是方法论、覆盖边界或资料稀缺说明，应 acknowledge 为 caveat。
- `pruned` 节点只能在有直接强证据或 supported 子节点时恢复，不能只凭旧 coverage 计数恢复，避免隐藏节点反复触发 writer/publish 修复。
- provider outage 是基础设施缺口，不是内容缺口；Jina/reader timeout、TLS reset、内容安全拒绝等不能导致无限 repair loop。
- 中等残留 gap 只能在 supported/partially_supported/verified、有足够证据、且多轮修复后保守 acknowledge；高影响 gap、零证据节点、反证节点仍必须阻塞。
- 最终报告不应重复输出大段“还有什么证据缺陷”。这些内容应在 completion/publish 前解决或 acknowledge；只有低影响 caveat 才能转成报告中的谨慎限定语。

### 10.4 Artifact-level 质量回归

- `configs/regression/quality-regression.json` 保存版本化质量基线，覆盖健康权威证据、must requirement 漏映射、时效失效、冲突状态不一致、未引用数字/日期、精确 waiver 和预算阈值。
- `pnpm quality:regression` 直接调用生产 `auditEvidenceQuality`，也可读取真实 episode 的 `evidence-quality-audit.json` 与 `budget-audit.json`；任一断言失败都会返回非零退出码并写机器可读结果。
- benchmark runner 会把 evidence/budget audit 保留在每个 task trace 中，并写 `failure.json` 与根级 `failures.json`。调用方可用 `qualityExpectation` 在输出 benchmark 结果前执行逐任务门禁。
- 该门禁不替代 live benchmark。它负责快速、确定性地阻止审计语义和既定质量下限退化；live benchmark 继续验证模型与 provider 的实际效果。
- 完整 manifest 与 CI 用法见 [`QUALITY_REGRESSION.md`](QUALITY_REGRESSION.md)。

### 10.4 默认预算策略

当前默认 runtime profile 已按真实任务运行情况调成高预算基线。这里的重点不是“靠数量解决质量问题”，而是之前默认值过低，会让 agent 在正常探索、补证、写作前就被预算误杀。

- Evidence runtime: `maxReactSteps=144`、`maxToolCalls=384`、`maxSearchCalls=96`、`maxFetchCalls=96`。
- Dispatch phase: `maxCycles=72`、`maxParallelAgents=48`、`maxConcurrentAgents=8`。`maxParallelAgents` 表示一轮全局反思前最多收集多少个子任务结果；`maxConcurrentAgents` 表示真实同时运行的子代理数，用来避免搜索、Jina 和 LLM provider 被瞬时并发打满。
- Scout phase: `maxSearchCalls=24`、`maxFetchCalls=28`。
- Structure review: `maxLlmCalls=60`、`maxOutputItems=60`。
- Report phase: `maxLlmCalls=240`、`maxTokens=49152`、`contextTokenLimit=192000`。
- Writer runtime: `maxReactSteps=36`、`maxToolCalls=72`、`maxFetchCalls=32`。

这些数值不应轻易调回低值；它们是当前真实运行的最低可用基线。质量问题仍不能靠继续堆数量解决，真正阻塞的问题应由 CompletionGate / PublishGate / repair loop 处理；预算耗尽时如果还存在高影响缺口，应返回 `needs_human_review`，而不是硬写报告。

### 10.5 证据组合质量审计（2026-07-14）

- citation ID 完整不再等价于证据质量合格。新增 `EvidenceQualityPolicy` 和 `evidence-quality.ts`，对每个 active leaf 确定性检查唯一来源数、独立域名数、primary/official 来源、平均质量、全文抓取和直接 evidence relation。
- completion gate 会读取同一审计结果；balanced 模式只阻塞明显的 grounding defect，strict 模式把全部阈值升级为修复任务和硬门禁。
- publish gate 在格式检查之外审计 evidence-bearing sentence 的本地 citation coverage，并单独标记无引用的数字、比例和日期主张。
- 每次发布写出 `evidence-quality-audit.json`，`EpisodeResult` / run summary 暴露路径和质量指标，HTTP 后端提供 `GET /research/:runId/evidence-quality`。
- 来源入库不再完全信任 agent 自报。政府和主要国际组织域名会确定性识别为 official；只有高置信信号才会升级 tier，普通学术托管域名不会自动被判为 primary。
- LLM semantic publish review 仍然保留，用来判断 overclaim、rubric coverage 和 hidden gap；确定性质量审计不冒充语义蕴含判断器。

### 10.6 需求追踪、时效性与冲突证据（2026-07-14）

- `GlobalRubric` 新增结构化 `ResearchRequirement[]`，保存稳定 ID、优先级、证据需求、可观察成功标准、地域和时间范围。自然语言 rubric 继续保留，但不再是唯一覆盖依据。
- `ReportNode.requirementIds` 建立用户要求到 aspect/leaf 的可追溯映射。Architect 漏填时，确定性 normalizer 会过滤非法 ID，并把遗漏 requirement 分配给词义最相关的 leaf。
- evidenceRequired requirement 只有在 mapped active leaf 存在直接 supports/qualifies/contradicts 证据时才算 covered；background link 不算。语言、格式、篇幅等输出约束设为 evidenceRequired=false，在成品报告上检查，不强求无关外部证据。未映射 must requirement 不能被 auto_accept 跳过。
- `current/as_of` requirement 使用来源 `publishedAt` 检查时效性，区分 current、stale 和 unknown。已知过期的 must requirement 在 balanced/strict 模式阻塞；strict 模式也阻塞发布日期未知。
- 被直接反证的 hypothesis 是可报告的负面研究结论，`contradicted` 不再自动等同于未完成。支持与反证同时存在时必须标记 `partially_supported`，reportlet 必须引用双方；status 与 evidence relation 不一致会触发确定性错误。
