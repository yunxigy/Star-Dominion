# 深度研究框架原理流程设计 v5

> 本文档是 v5 的**完整执行规格说明书**。v5 从早期探索版的目标架构出发，做数据模型精简和接口透明化，但不简化流程。
> 本文档不是历史草稿，而是当前代码实现的流程参考和后续维护的操作手册。
>
> 与 v4 的关系：v5 保留 v4 的 10 阶段流程和数据语义，但做以下改动：
> 1. 数据模型字段精简（删除冗余，合并同类项，但不丢失语义）。
> 2. 每一步的输入/输出/组装方式详细说明到代码级精度。
> 3. 明确当前代码实现中的已知错误和修正方案。
> 4. 配置体系合并为统一 `RuntimeProfile`。
> 5. Agent Context Packet 的组装规则透明化，不再隐含在 memory graph 里。

---

## 1. v5 设计原则

### 1.1 从 v4 吸收什么

- **10 阶段流程不变**：parse → rubric → init-root → scout → architect-tree → dispatch-evidence → cycle-reflection → structure-review → completion-gate → report → publish-gate。
- **数据语义不变**：ReportNode 只表示报告结构，KnowledgeNode 只表示知识资产，EvidenceLink 是两者唯一绑定方式。
- **自然语言约束优先**：用户要求保留在 `rubricText` 中，不拆成硬编码字段。
- **子 agent 不能改报告树**：只有主调度器（orchestrator）能改 ReportNode tree。
- **Reporter 只消费 ReportBundle**：不读 raw trace，不读 task ledger。

### 1.2 v5 修正什么（相对于 v4 和当前实现）

| 问题 | v4 的做法 | v5 的修正 |
|------|----------|----------|
| 数据模型字段冗余 | 保留所有 v4 字段 | 删除冗余字段，合并同类项 |
| Context Packet 组装不透明 | 由 MemoryGraph 隐式组装 | 由 `ContextBuilder` 显式组装，每一步组装规则文档化 |
| 配置散落 | `RunOptions` + `DebugConfig` 两套 | 合并为统一 `RuntimeProfile` |
| 代码实现已知 bug | 在 v4 文档里列了 7 个 | 在 v5 文档里给出具体修正方案 |
| 字段重复描述 | 同一件事在多个地方描述 | 只在定义处描述一次，后续引用 |
| agent 输出 schema 不统一 | evidence agent 和 scout 输出不同 | 统一为 `AgentRunResult` |

### 1.3 精简原则

- **不删除语义**：删除的字段必须是其信息可以由其他字段推导出来的。
- **不合并阶段**：10 个阶段保持独立，但阶段内的数据流更紧凑。
- **配置外置**：所有运行参数（temperature、topK、maxSteps）不写在业务代码里，统一从 `RuntimeProfile` 读取。
- **上下文组装显式**：给 agent 的 context 必须在文档中写明"这一段从哪来、怎么组装、裁剪规则是什么"。

---

## 2. 精简数据模型

### 2.1 模型变更总览

v5 相比 v4，删除的字段：

| 字段 | 所在模型 | 删除理由 | 信息替代来源 |
|------|---------|---------|------------|
| `scope.timeRangeHint` | `ResearchContext` | 自然语言，进入 `rubricText` | `GlobalRubric.rubricText` |
| `scope.outputHint` | `ResearchContext` | 自然语言，进入 `outputHints` | `GlobalRubric.outputHints` |
| `scope.languageHint` | `ResearchContext` | 与 `outputHints.language` 重复 | `GlobalRubric.outputHints.language` |
| `constraints.uiCitationRequired` | `ResearchContext` | 与 `outputHints.citationRequired` 重复 | `GlobalRubric.outputHints.citationRequired` |
| `constraints.benchmarkPromptRaw` | `ResearchContext` | 直接拼进 `userInput` | `ResearchContext.userInput` |
| `coverage.neutralCount` | `ReportNode` | 中性证据不单独统计 | `evidenceLinks` 的 `relation` 字段可过滤 |
| `hypothesis.questionHints` | `ReportNode` | 与 `researchBrief` 语义重叠 | `researchBrief` 已包含研究方向 |
| `hypothesis.searchHints` | `ReportNode` | 与 `evidenceGuidance` 语义重叠 | `evidenceGuidance` 已包含搜索策略 |
| `hypothesis.confidence` | `ReportNode` | 冗余，由 coverage 推导 | `ReportNode.coverage` 的 evidence count |
| `contentPreview` | `KnowledgeNode` | 可实时生成，不需要存储 | 运行时从 `summary` + `url` 生成 |
| `retrievedByBranchId` | `KnowledgeNode` | branch 与 task 一一对应，taskId 足够 | `KnowledgeNode.retrievedByTaskId` → 查 `TaskItem.branchId` |
| `metadata.retrievalQuery` | `KnowledgeNode` | 放到 MemoryGraph 的 trace 中 | `MemoryGraph` event |
| `createdByBranchId` | `EvidenceLink` | branch 与 task 一一对应 | `EvidenceLink.createdByTaskId` → 查 `TaskItem.branchId` |
| `createdByAgentRunId` | `EvidenceLink` | 放到 MemoryGraph 的 trace 中 | `MemoryGraph` event |
| `orderIndex` | `ReportNode` | append 顺序即自然顺序 | 同 `parentNodeId` 下的创建顺序 |
| `acceptanceCriteria` 字段的重复 | `TaskItem` | 在 `rubric` 和 `architect-tree` 阶段会生成 | `TaskItem` 保留，但不在 `ResearchContext` 中重复定义 |

v5 合并的字段：

| 原字段 | 合并后 | 说明 |
|-------|-------|------|
| `RunOptions` + `DebugConfig` | `RuntimeProfile` | 统一运行参数配置 |
| `evidenceGuidance` + `researchBrief` | `researchBrief` | 合并为更完整的任务描述 |

### 2.2 任务提交入口：TaskSubmission（不变）

```ts
interface TaskSubmission {
  sessionId: string; // 会话ID（调用方传入，如前端/UI、CLI、benchmark，用于关联同一来源的多次研究）
  userInput: string; // 用户原始任务文本（自然语言，所有约束保留在此）
  uiOptions?: {
    outputLanguage?: string; // 输出语言（如zh-CN）
    citationRequired?: boolean; // 是否要求引用（true表示报告中必须有引用标注）
  };
  attachments?: Array<{
    fileId: string; // 文件ID（调用方上传时分配）
    filename: string; // 文件名
    mimeType: string; // MIME类型（如application/pdf）
  }>;
}
```

**说明**：`TaskSubmission` 是框架的入口，不限制来源。它可以是：
- 前端 UI 的表单提交；
- CLI 的命令行参数；
- benchmark 框架的评测输入；
- 外部 API 调用。

所有自然语言约束保留在 `userInput` 中，不拆字段。`uiOptions` 是可选的调用层偏好，benchmark 或 CLI 场景可以省略。

### 2.3 精简后：ResearchContext

```ts
interface ResearchContext {
  episodeId: string; // 研究运行ID（本框架生成，一次研究的唯一标识）
  sessionId: string; // 会话ID
  userInput: string; // 用户原始任务文本
  expectedArtifacts: string[]; // 期望输出产物列表（如["report","evidence_index"]）
}
```

**精简说明**：
- 删除 `scope`（`timeRangeHint/outputHint/languageHint` 进入 `GlobalRubric`）。
- 删除 `constraints`（`uiCitationRequired` 进入 `GlobalRubric.outputHints`，`benchmarkPromptRaw` 直接拼进 `userInput`）。
- 删除 `isolation`（跨任务共享在 deep research 场景下没有实际意义，同主题的研究天然在同一 episode 中持续）。

**v5 的 `ResearchContext` 组装方式**：
1. `sessionId`：直接复制 `TaskSubmission.sessionId`。
2. `episodeId`：由 adapter 生成，格式 `EP_<YYYYMMDD>_<seq>`，seq 为当日内递增序号。
3. `userInput`：直接复制 `TaskSubmission.userInput`。
4. `expectedArtifacts`：由 adapter 根据 CLI 参数 > benchmark 输入 > 全局配置 `artifacts.mode` 决定。默认 `normal` 模式输出 `["report", "evidence_index"]`。

### 2.4 精简后：GlobalRubric

```ts
interface GlobalRubric {
  rubricId: string; // Rubric标识符
  episodeId: string; // 研究运行ID
  rubricText: string; // 全局约束文本（自然语言，所有agent的行为约束）
  outputHints: {
    titleHint?: string; // 标题提示（从用户任务提取的短标题）
    language?: string; // 语言（如zh-CN、en-US）
    citationRequired?: boolean; // 是否要求引用
    format?: string; // 输出格式（如markdown）
  };
  researchQuestionHints?: string[]; // 研究问题提示（3-6个高层探索方向）
}
```

**不变**：保留 v4 的语义边界。`rubricText` 是自然语言约束的全集，`outputHints` 只放轻提示，`researchQuestionHints` 只用于 scout 和 architect-tree 的初始方向。

**组装方式**：
- `rubricText` = `userInput` + `uiOptions`（语言、引用）的自然语言整合，由 rubric 阶段的 AI 生成。
- `outputHints` 从 `uiOptions` 和 `userInput` 中提取。`titleHint` 由 rubric AI 从 `userInput` 中提取一句短标题。
- `researchQuestionHints` 由 rubric AI 生成 3-6 个高层方向。

### 2.5 精简后：RuntimeProfile（合并 RunOptions + DebugConfig）

```ts
interface RuntimeProfile {
  hilMode: "auto_accept" | "explicit"; // "auto_accept" = 自动接受agent结果，"explicit" = 需要显式确认
  artifactDir: string; // 产物输出目录（报告/证据索引/trace的存放位置）
  reportFormat: "markdown"; // "markdown" = Markdown格式（当前唯一支持的报告格式）
  includeEvidenceIndex: boolean; // 是否包含证据索引

  // LLM 配置（按阶段/角色分组）
  llm: Record<string, {
    model: string; // 模型名称（如default、gpt-4o）
    maxTokens: number; // 最大输出token数
    temperature: number; // 采样温度（0=确定性，1=随机性高）
    timeoutMs: number; // 超时时间（毫秒）
  }>;

  // 阶段预算
  phases: Record<string, {
    enabled: boolean; // 是否启用（阶段开关）
    maxCycles?: number;        // 循环次数（如 dispatchEvidence 的循环）
    maxLlmCalls?: number;      // LLM 调用次数上限
    maxAgentRuns?: number;     // agent 运行次数上限
    maxParallelAgents?: number; // 并行 agent 数
    contextTokenLimit: number; // 上下文 token 上限
    maxOutputItems?: number;   // 输出项上限（如 patch 数量）
  }>;

  // Agent 配置
  agents: Record<string, {
    maxRuns?: number; // 最大运行次数
    maxReactSteps: number; // 最大ReAct步数
    maxToolCalls?: number; // 最大工具调用次数
    maxSearchCalls?: number; // 最大搜索调用次数
    maxFetchCalls?: number; // 最大页面获取次数
    outputRepairAttempts: number; // 输出修复尝试次数
    allowToolEscalationRequest: boolean; // 是否允许工具升级请求
  }>;

  // 工具配置
  tools: Record<string, {
    topK?: number; // 返回TopK结果
    timeoutMs: number; // 超时时间（毫秒）
    retry?: number; // 重试次数
    rateLimitPerMinute?: number; // 每分钟速率限制
  }>;

  // Provider 安全阀
  providers: Record<string, {
    maxCostUsd?: number; // 最大成本（美元）
    maxRequests?: number; // 最大请求数
    timeoutMs?: number; // 超时时间（毫秒）
  }>;
}
```

**精简说明**：
- v4 的 `RunOptions` 和 `DebugConfig` 合并为 `RuntimeProfile`。
- `safetyLimits` 删除（`maxCostUsd` 已放到 `providers` 中，`maxWallTimeMs` 由 orchestrator 外层控制）。
- `artifacts` 配置删除，直接由 `expectedArtifacts` + `includeEvidenceIndex` 决定。
- 配置合并规则不变：CLI 显式参数 > benchmark 输入 > 全局配置文件。

### 2.6 精简后：ReportNode

```ts
interface ReportNode {
  nodeId: string; // 节点ID（格式：R_root、R_aspect_序号、R_hyp_序号）
  nodeKind: "root" | "aspect" | "hypothesis"; // "root" = 根节点（报告总标题），"aspect" = 一级主题，"hypothesis" = 具体假设
  label: string; // 节点标签（标题，用于报告章节标题）
  parentNodeId: string | null; // 父节点ID（report tree的父子关系）
  scopeNote: string; // 范围说明（该节点覆盖的研究范围描述）
  status:
    | "planned" // "planned" = 已规划（尚未开始研究）
    | "researching" // "researching" = 正在研究（证据agent正在执行）
    | "needs_review" // "needs_review" = 需要审查（agent返回但尚未确认）
    | "needs_repair" // "needs_repair" = 需要修复（证据不足或结构问题）
    | "supported" // "supported" = 已支持（有支持证据，无反驳证据）
    | "partially_supported" // "partially_supported" = 部分支持（有支持和反驳证据）
    | "contradicted" // "contradicted" = 被反驳（有反驳证据，无支持证据）
    | "insufficient_evidence" // "insufficient_evidence" = 证据不足（无支持也无反驳）
    | "downplayed" // "downplayed" = 已降级（重要性降低，不再深入）
    | "verified" // "verified" = 已验证（有充分证据支持，确认成立）
    | "pruned"; // "pruned" = 已剪枝（不再研究，从最终报告中移除）
  hypothesis?: {
    statement: string; // 假设陈述（可研究的判断或问题）
    researchBrief: string;       // 合并：原 researchBrief + questionHints + searchHints + evidenceGuidance
    evidenceGuidance: string;    // 保留：搜索和证据策略指导
    confidence: number;          // 保留：由 coverage 自动计算，不存储，只读
  };
  coverage: {
    supportingCount: number; // 支持证据数量
    contradictingCount: number; // 反驳证据数量
    openGapCount: number; // 开放缺口数量
    // v5 删除 neutralCount：中立证据不单独统计
  };
  createdAt: string; // 创建时间
  updatedAt: string; // 更新时间
}
```

**精简说明**：
- 删除 `orderIndex`：append 顺序即自然顺序。在 `architect-tree` 阶段创建节点时，按 AI 返回的数组顺序作为 `orderIndex`。
- `hypothesis` 中的 `questionHints` 和 `searchHints` 合并进 `researchBrief`：因为这些字段的语义都是"给 evidence agent 的研究指导"，合并成一个更完整的 `researchBrief` 更不容易遗漏信息。`evidenceGuidance` 保留，但语义收窄为"搜索和证据策略的具体指导"。
- `hypothesis.confidence` 标记为"只读，由 coverage 自动计算"：不要存储这个冗余字段，每次都由 `supportingCount / (supportingCount + contradictingCount + openGapCount)` 计算。但实现上为了性能可以缓存，文档中明确它是推导值。
- 删除 `coverage.neutralCount`：中性证据数量不单独统计。在 `coverage` 中只关心"支持"、"反驳"、"缺口"三个维度。

### 2.7 精简后：KnowledgeNode

```ts
interface KnowledgeNode {
  nodeId: string; // 知识节点ID
  nodeType: string; // 知识节点类型（如WebPage/Paper/DataPoint）
  title: string; // 标题（资料标题，用于引用和来源标注）
  url?: string; // URL（资料来源地址，可选）
  contentHash: string; // 内容哈希（用于去重）
  summary: string; // 摘要（资料内容摘要，200-500字）
  sourceTier: string; // 来源层级（official/primary/secondary）
  qualityScore: number; // 质量评分（0-1）
  retrievedByTaskId: string; // 由哪个任务检索（关联到TaskItem）
  // v5 删除 retrievedByBranchId：通过 taskId 查 TaskItem 可得
  retrievedAt: string; // 检索时间（ISO 8601格式）
  metadata: {
    authors?: string[]; // 作者列表
    publishedAt?: string; // 发布时间
    venue?: string; // 发表场所
    publisher?: string; // 出版机构
    language?: string; // 语言
    // v5 删除 retrievalQuery：放到 MemoryGraph trace 中
  };
}
```

**精简说明**：
- 删除 `retrievedByBranchId`：branch 和 task 是一对一关系，通过 `retrievedByTaskId` 查 `TaskItem` 即可得 `branchId`。减少存储冗余，避免不同步。
- 删除 `contentPreview`：这个字段可以实时从 `summary` + `url` 生成。如果需要片段，reporter 可以从原始内容中按需提取。不需要在 KG 中存储。
- 删除 `metadata.retrievalQuery`：检索 query 是过程信息，不是知识资产本身。放到 MemoryGraph 的 trace 中记录即可。

### 2.8 精简后：EvidenceLink

```ts
interface EvidenceLink {
  linkId: string; // 链接ID
  reportNodeId: string; // 报告节点ID
  knowledgeNodeId: string; // 知识节点ID
  relation: string; // 关系（supports=支持，contradicts=反驳，qualifies=限定，background=背景）
  claimText: string; // 声明文本（该证据支持的判断）
  evidenceQuote?: string; // 证据引用（原文片段，可选）
  confidence: number; // 置信度（0-1之间）
  createdByTaskId: string; // 由哪个任务创建
  // v5 删除 createdByBranchId 和 createdByAgentRunId：放到 MemoryGraph trace 中
  createdAt: string; // 创建时间
}
```

**精简说明**：
- 删除 `createdByBranchId`：branch 和 task 一一对应，通过 `createdByTaskId` 查 `TaskItem` 即可。
- 删除 `createdByAgentRunId`：agent run 是过程信息，放到 MemoryGraph 的 trace 中记录。EvidenceLink 是结构关系，只保留创建它的 task 即可。

### 2.9 精简后：TaskItem

```ts
interface TaskItem {
  taskId: string; // 任务ID
  parentTaskId: string | null; // 父任务ID（树形任务结构）
  reportNodeId: string; // 关联报告节点ID
  title: string; // 任务标题
  objective: string; // 研究目标（该任务要研究什么）
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled"; // "queued" = 已排队（等待调度器分发）
  priority: number; // 优先级（数字越大优先级越高）
  branchId: string; // 分支ID（与taskId一一对应）
  acceptanceCriteria: string[];  // v5 强调：必须非空，至少 1 条
  createdAt: string; // 创建时间
  updatedAt: string; // 更新时间
}
```

**不变**：`TaskItem` 在 v4 中已经是精简的，v5 不改动。但强调 `acceptanceCriteria` 必须非空。root task 的 acceptanceCriteria 在 `rubric` 阶段由 AI 生成，简短自然语言即可。

### 2.10 新增：ContextPacket（给 Agent 的完整上下文包）

v5 新增一个显式类型，说明给 agent 的 context 包含什么：

```ts
interface ContextPacket {
  // 全局约束
  globalRubric: {
    rubricText: string; // 全局约束文本
    outputHints: GlobalRubric["outputHints"]; // 输出提示
  };

  // 当前任务
  currentTask: {
    taskId: string; // 任务ID
    branchId: string; // 分支ID
    reportNodeId: string; // 关联报告节点ID
    objective: string; // 研究目标
    acceptanceCriteria: string[]; // 验收标准
  };

  // 当前报告节点
  currentReportNode: {
    nodeId: string; // 节点ID
    nodeKind: string; // 节点类型
    label: string; // 节点标签
    scopeNote: string; // 范围说明
    hypothesis?: {
      statement: string; // 假设陈述
      researchBrief: string; // 研究简报
      evidenceGuidance: string; // 证据指导
    };
  };

  // 父节点上下文
  parentContext?: {
    nodeId: string; // 父节点ID
    label: string; // 父节点标签
    scopeNote: string; // 父节点范围说明
  };

  // 同级任务（避免重复）
  siblingTasks: Array<{
    taskId: string; // 任务ID
    title: string; // 任务标题
    status: string; // 任务状态
  }>;

  // 已有相关证据
  relevantEvidence: Array<{
    knowledgeNodeId: string; // 知识节点ID
    title: string; // 资料标题
    sourceTier: string; // 来源层级
    summary: string; // 摘要
    relation: string; // 关系
  }>;

  // 运行限制
  budget: {
    maxReactSteps: number; // 最大ReAct步数
    maxToolCalls: number; // 最大工具调用次数
    maxSearchCalls: number; // 最大搜索调用次数
    maxFetchCalls: number; // 最大页面获取次数
  };

  // 可用工具
  availableTools: Array<{
    toolName: string; // 工具名称
    description: string; // 工具描述
  }>;

  // 绑定上下文
  bindingContext: {
    currentReportNodeId: string; // 当前报告节点ID
    currentTaskId: string; // 当前任务ID
    currentBranchId: string; // 当前分支ID
  };
}
```

**说明**：`ContextPacket` 是 v5 的新增类型，它不存储到数据库，而是每次给 agent 调用时由 `ContextBuilder` 实时组装。它的目的是**把 agent 看到的上下文完全透明化**——在文档中明确说明每个字段从哪来、怎么组装、怎么裁剪。

### 2.11 精简后：ReportBundle（给 Reporter 的完整证据包）

```ts
interface ReportBundle {
  episodeId: string; // 研究运行ID
  root: ReportNode; // 根报告节点
  tree: Array<{
    node: ReportNode; // 报告节点
    children: string[]; // 子节点ID列表
    evidence: Array<{
      link: EvidenceLink; // 证据链接
      knowledge: KnowledgeNode; // 知识节点
    }>;
    openGaps: OpenGap[]; // 开放缺口
  }>;
  globalEvidenceIndex: Array<{
    citationId: string; // 引用编号
    knowledgeNodeId: string; // 知识节点ID
    title: string; // 资料标题
    url?: string; // URL
    sourceTier: string; // 来源层级
    retrievedAt: string; // 检索时间
  }>;
  constraints: {
    language: string; // 语言
    citationRequired: boolean; // 是否要求引用
    rubricId: string; // Rubric标识符
    rubricText: string; // 全局约束文本
  };
}
```

**不变**：`ReportBundle` 在 v4 中已经是合理的，v5 不改动。但明确说明：Reporter **只**接收这个 bundle，不读 task ledger、不读 memory graph、不读 raw trace。

### 2.12 精简后：EpisodeResult

```ts
interface EpisodeResult {
  episodeId: string; // 研究运行ID
  status: "succeeded" | "failed" | "needs_human_review"; // "failed" = 失败（agent运行失败或超时）
  reportArtifactPath: string; // 报告产物路径
  evidenceIndexPath?: string; // 证据索引路径
  tracePath?: string; // trace文件路径
  metrics: {
    reportNodeCount: number; // 报告节点数
    knowledgeNodeCount: number; // 知识节点数
    evidenceLinkCount: number; // 证据链接数
    completedTaskCount: number; // 已完成任务数
    openGapCount: number; // 开放缺口数
    citationCount: number; // 引用数
    rubricIssueCount: number; // Rubric问题数
    publishGatePassed: boolean; // 发布门是否通过
  };
  closedAt: string; // 关闭时间
}
```

**不变**：`EpisodeResult` 在 v4 中已经是精简的，v5 不改动。

### 2.13 统一 Agent 输出：AgentRunResult

v5 统一所有 agent 的输出格式：

```ts
interface AgentRunResult {
  agentRunId: string; // Agent运行ID
  taskId: string; // 任务ID
  reportNodeId: string; // 报告节点ID
  branchId: string; // 分支ID
  branchOutcome: "done_here" | "defer_to_next_round" | "failed"; // "failed" = 失败（agent运行失败或超时）
  knowledgeNodeIds: string[]; // 创建/引用的知识节点ID列表
  evidenceLinkIds: string[]; // 创建/引用的证据链接ID列表
  nodeUpdates: Array<{
    reportNodeId: string; // 报告节点ID
    oldStatus: string; // 旧状态
    newStatus: string; // 新状态
    reason: string; // 原因
    confidence: number; // 置信度
  }>;
  openGaps: Array<{
    gapType: string; // 缺口类型
    description: string; // 描述
    suggestedQuery: string; // 建议搜索查询
  }>;
  structurePatchSuggestions: StructurePatchSuggestion[]; // 结构补丁建议
  turnSummary: {
    actionSummary: string; // 行动摘要
    searchSummary: string; // 搜索摘要
    reasoningSummary: string; // 推理摘要
    citedKnowledgeNodeIds: string[]; // 引用的知识节点ID列表
    citedEvidenceLinkIds: string[]; // 引用的证据链接ID列表
  };
}
```

**说明**：v4 中 scout 和 evidence agent 的输出格式不同。v5 统一为 `AgentRunResult`，所有 agent 都输出这个格式。scout 的 `ScoutSummary` 放到 `turnSummary.reasoningSummary` 中。

---

## 3. v5 完整 Pipeline：10 阶段详细输入输出

v5 保留 v4 的 10 阶段流程：

```
parse
  -> rubric
  -> init-root
  -> scout
  -> architect-tree
  -> dispatch-evidence-agents
  -> cycle-reflection
  -> structure-review
  -> completion-gate
  -> report
  -> publish-gate/refetch-loop
```

每个阶段按以下结构详细说明：
- **输入**：从哪些上游/服务获取，具体内容和格式。
- **输出**：写入哪些服务/文件，具体内容和格式。
- **如果是 AI 阶段**：Agent Context 怎么组装（system prompt + user prompt 的每个部分从哪来）。
- **状态落地**：写哪些表/文件，写哪些字段。

### 3.0 阶段总览表

| 阶段 | 调用 AI？ | 主要输入 | 主要输出 | 写哪些服务 |
|------|---------|---------|---------|----------|
| parse | 否 | TaskSubmission | ResearchContext + RuntimeProfile | MemoryGraph |
| rubric | 是 | ResearchContext | GlobalRubric + root TaskItem | KG metadata + TaskLedger + MemoryGraph |
| init-root | 否 | GlobalRubric | root ReportNode | KG report_nodes |
| scout | 是 | GlobalRubric + root | AgentRunResult + KnowledgeNode[] + EvidenceLink[] | KG + MemoryGraph |
| architect-tree | 是 | ScoutSummary + GlobalRubric | ReportNode tree + TaskItem[] | KG + TaskLedger |
| dispatch-evidence | 是 | TaskItem + ContextPacket | AgentRunResult[] | KG + TaskLedger + MemoryGraph |
| cycle-reflection | 是 | AgentRunResult[] | TaskUpdates + NewTasks | TaskLedger + MemoryGraph |
| structure-review | 是 | ReportTree + Evidence | StructurePatch[] | KG + TaskLedger |
| completion-gate | 否 | ReportTree + TaskLedger | "ready" / "need_more" | — |
| report | 是 | ReportBundle | Draft Markdown | 文件系统 |
| publish-gate | 否/可选 | Draft + EvidenceIndex | Report / RepairTasks | 文件系统 + TaskLedger |

---

### 3.1 Phase 1: parse（确定性代码，无 AI）

#### 输入

| 来源 | 内容 | 格式 |
|------|------|------|
| `TaskSubmission`（入口层传入） | `sessionId`, `userInput`, `uiOptions`, `attachments` | JSON object |
| 全局配置文件 | `configs/runtime/default.json` | JSON file |
| CLI 参数（如有） | `--maxToken`, `--phase.xxx.maxCycles` 等 | 命令行参数 |
| benchmark 输入（如有） | 附加约束、artifact 列表 | 取决于 benchmark 协议 |

#### 处理逻辑

```
TaskSubmission.userInput → ResearchContext.userInput（直接复制）
TaskSubmission.sessionId → ResearchContext.sessionId（直接复制）
generateEpisodeId() → ResearchContext.episodeId（格式：EP_<YYYYMMDD>_<seq>）

mergeArtifacts(
  CLI 显式 artifact 列表（最高优先级）,
  benchmark 输入 artifact 列表,
  全局配置 artifacts.mode
) → ResearchContext.expectedArtifacts

mergeRuntimeProfile(
  CLI 显式参数,
  benchmark 输入参数,
  全局配置 JSON
) → RuntimeProfile（完整合并后的配置）
```

#### 输出

```ts
interface EpisodeInput {
  researchContext: ResearchContext;  // 精简后的 4 字段
  runtimeProfile: RuntimeProfile;    // 合并后的统一配置
}
```

#### 状态落地

写入 `MemoryGraph`：

```json
{
  "eventType": "episode_started",
  "episodeId": "EP_20260616_001",
  "sessionId": "S_web_001",
  "timestamp": "2026-06-16T10:00:00Z",
  "runtimeProfileKeys": ["llm", "phases", "agents", "tools", "providers"]
}
```

**注意**：`parse` 是确定性代码，不调用 LLM。任何需要理解用户任务语义的操作都放到 `rubric` 阶段。

---

### 3.2 Phase 2: rubric（AI 阶段：全局 Rubric 整理器）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `ResearchContext.userInput` | 用户原始任务文本 | 直接复制，全文保留 |
| `ResearchContext.uiOptions` | UI 偏好（语言、引用） | 自然语言描述拼接到 prompt |
| benchmark 附加说明（如有） | 禁止来源、额外约束 | 直接复制到 prompt |
| `RuntimeProfile.llm.rubric` | LLM 参数 | 用于调用 LLM |

#### Agent Context 组装

**System Prompt**（固定字符串，不变化）：

```text
你是 deep research 的全局 Rubric 整理器。
你要把用户任务、UI 偏好、benchmark 附加说明整理成一段后续所有 agent 都能直接阅读的 rubricText。
不要把自然语言要求过度拆成字段；大部分约束应保留在 rubricText 中。
不要从用户文本中抽取另一套约束字段；禁止来源、引用要求、证据偏好都写进 rubricText，必要时同步成 outputHints。
outputHints.titleHint 是从用户任务中提炼的一句短标题，用于 root ReportNode.label 和最终报告默认标题；它不是额外约束。
researchQuestionHints 只写 3-6 个高层探索方向，用于初始 scout 广域检索和 architect-tree 建树。
researchQuestionHints 不是完整任务拆解、不是章节列表、不是验收标准；不能覆盖 rubricText。
不要写报告，不要搜索资料。
只输出严格 JSON。
```

**User Prompt 组装**（从输入动态拼接）：

```text
[第1段：用户原始任务]
ResearchContext.userInput:
<直接复制 ResearchContext.userInput 全文，不截断>

[第2段：UI 偏好]
UI 偏好：
- outputLanguage: <uiOptions.outputLanguage 或 "未指定">
- citationRequired: <uiOptions.citationRequired 或 false>

[第3段：benchmark 附加说明（如有）]
<如果 ResearchContext.userInput 中包含 benchmark 的附加说明（如 BLOCKED REFERENCES），这一段已经包含在第1段中，不需要重复。>

[第4段：输出指令]
请整理：
1. 一段完整的 rubricText，保留用户原本的限制、质量要求、写作要求和证据偏好。
2. outputHints，只放标题、语言、引用、格式这类轻提示。titleHint 应该是一句短标题，用于 root ReportNode.label。
3. researchQuestionHints，只给最开始的广域探索和建树提供 3-6 个方向提示，不要求覆盖所有细节，不能替代 rubricText。

输出 JSON schema:
{
  "rubricId": string,
  "rubricText": string,
  "outputHints": {"titleHint": string, "language": string, "citationRequired": boolean, "format": string},
  "researchQuestionHints": string[]
}
```

**组装规则**：
- 第1段：必须完整复制 `userInput`，不截断、不摘要。这是全局约束的唯一来源。
- 第2段：UI 偏好从 `uiOptions` 中提取，如果没有则省略该段。
- 第3段：如果 `userInput` 中已经包含 benchmark 附加说明（如 BLOCKED REFERENCES），不需要单独拼一段；如果 benchmark 通过其他通道传入，则单独拼一段。
- 第4段：固定输出指令，不变化。

#### LLM 调用参数

```json
{
  "model": "default",
  "maxTokens": 2048,
  "temperature": 0.2,
  "timeoutMs": 30000
}
```

从 `RuntimeProfile.llm.rubric` 读取。

#### AI 应输出

```json
{
  "rubricId": "RB_001",
  "rubricText": "请写一份中文研究报告：分析中国从土地财政转向房地产税的改革路径。报告需要覆盖历史背景、财政影响、国际经验、试点经验、风险和政策建议。不要使用维基百科、论坛帖和无法追溯来源的自媒体文章。涉及具体财政数字时，必须优先寻找官方或高质量研究来源。最终报告要明确说明不确定性和改革风险。强结论必须绑定证据，无法确认的判断需要降调或说明证据不足。",
  "outputHints": {
    "titleHint": "中国从土地财政转向房地产税的改革路径",
    "language": "zh-CN",
    "citationRequired": true,
    "format": "markdown"
  },
  "researchQuestionHints": [
    "中国土地财政形成机制是什么？",
    "房地产税能否替代土地出让收入？",
    "国际经验和中国试点能提供什么启示？",
    "改革的主要风险和可行路径是什么？"
  ]
}
```

#### 输出与状态落地

1. **保存 `GlobalRubric`**：
   - 写入 `KG` 的 episode metadata 或单独存储。
   - `rubricId` 格式：`RB_<episodeId 后缀>_<seq>`。

2. **创建 root TaskItem**：
   ```json
   {
     "taskId": "T_root",
     "parentTaskId": null,
     "reportNodeId": "R_root",
     "title": "研究：<outputHints.titleHint>",
     "objective": "完成全局研究任务",
     "status": "queued",
     "priority": 100,
     "branchId": "B_root",
     "acceptanceCriteria": [
       "覆盖所有一级 aspect",
       "每个关键判断至少有一条支持或反驳证据",
       "publish gate 无空引用",
       "明显不满足 rubricText 的问题已生成 diagnostics 或 repair task"
     ]
   }
   ```
   - `acceptanceCriteria` 从 `rubricText` 中提取关键约束，简短自然语言即可，不复制复杂 schema。
   - 写入 `TaskLedger`。

3. **写入 MemoryGraph**：
   ```json
   {
     "eventType": "rubric_created",
     "rubricId": "RB_001",
     "episodeId": "EP_20260616_001",
     "titleHint": "中国从土地财政转向房地产税的改革路径"
   }
   ```

---

### 3.3 Phase 3: init-root（确定性代码，无 AI）

#### 输入

| 来源 | 内容 |
|------|------|
| `GlobalRubric.outputHints.titleHint` | 报告标题提示 |
| `GlobalRubric.rubricId` | Rubric 引用 ID |

#### 处理逻辑

```
label = GlobalRubric.outputHints.titleHint
if (!label) label = userInput.substring(0, 60)  // 降级：取 userInput 前60字符
```

#### 输出

创建 root `ReportNode`：

```json
{
  "nodeId": "R_root",
  "nodeKind": "root",
  "label": "中国从土地财政转向房地产税的改革路径",
  "parentNodeId": null,
  "scopeNote": "中文深度研究报告，必须遵守 GlobalRubric RB_001",
  "status": "planned",
  "coverage": {
    "supportingCount": 0,
    "contradictingCount": 0,
    "openGapCount": 0
  }
}
```

**说明**：
- root node 不参与写正文。
- root node 只保存全局研究目标和最终报告约束。
- `scopeNote` 固定格式："<语言>深度研究报告，必须遵守 GlobalRubric <rubricId>"。

#### 状态落地

- `KG.report_nodes` 新增 `R_root`。
- `TaskLedger` 中 `T_root.status = running`（从 queued 转为 running）。
- `MemoryGraph` 写入 `root_created` event。

---

### 3.4 Phase 4: scout（AI 阶段：主调度器广域探索）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `GlobalRubric` | rubricText + outputHints + researchQuestionHints | 直接复制到 prompt |
| `root ReportNode` | nodeId, label, scopeNote | 直接复制到 prompt |
| `RuntimeProfile.phases.scout` | maxReactSteps, maxSearchCalls, maxFetchCalls | 数字写入 prompt |
| `RuntimeProfile.tools` | web_search.topK, fetch_page.timeoutMs | 数字写入 prompt |
| 工具入口 | 当前可用工具列表 | 从 orchestrator tools surface 动态获取 |

#### Agent Context 组装

**System Prompt**（固定）：

```text
你是 deep research orchestrator，当前处于 scout 广域探索模式。
目标是在有限步数内建立初始资料地图，为后续 architect-tree 建树提供背景、数据、争议、政策、国际比较等线索。
你可以直接调用已注册工具，不要停留在规划层。
每一步只能做一个动作：web_search、fetch_page、save_knowledge_node、link_evidence、finish_scout。
researchQuestionHints 只是广域探索方向提示，不是完整 checklist；任何冲突都以 GlobalRubric.rubricText 为准。
不要写报告，不要创建 ReportNode tree，不要分发子 agent。
当已有资料足够支撑建树时，调用 finish_scout 输出 ScoutSummary。
```

**User Prompt 组装**：

```text
[第1段：用户任务]
用户任务：
<ResearchContext.userInput 全文>

[第2段：全局 Rubric]
GlobalRubric.rubricText:
<GlobalRubric.rubricText 全文>

[第3段：研究问题提示]
researchQuestionHints:
<GlobalRubric.researchQuestionHints，每个一行，前面加 "- " >

[第4段：运行限制]
运行限制：
- scout.maxReactSteps: <RuntimeProfile.phases.scout.maxReactSteps>
- scout.maxSearchCalls: <RuntimeProfile.phases.scout.maxSearchCalls>
- scout.maxFetchCalls: <RuntimeProfile.phases.scout.maxFetchCalls>
- web_search.topK: <RuntimeProfile.tools.web_search.topK>
- scout 目标不是穷尽资料，而是在预算内形成足够建树的资料地图。

[第5段：当前绑定上下文]
当前绑定上下文：
- currentReportNodeId: R_root
- currentTaskId: T_root
- currentBranchId: B_scout
- save_knowledge_node 成功后，系统会自动创建到 currentReportNodeId 的 EvidenceLink。

[第6段：可用工具]
可用工具：
- web_search(query, topK=<RuntimeProfile.tools.web_search.topK>)
- fetch_page(url)
- save_knowledge_node(input)
- link_evidence(reportNodeId, knowledgeNodeId, relation, note)
- finish_scout(summary)
```

**组装规则**：
- 第1段：必须保留用户原始任务文本，用于 scout 理解研究目标。
- 第2段：必须保留完整 `rubricText`，用于 scout 遵守来源限制和证据偏好。
- 第3段：`researchQuestionHints` 是方向提示，帮助 scout 确定搜索范围。
- 第4段：运行限制从 `RuntimeProfile` 读取，动态填入数字。
- 第5段：固定绑定上下文，scout 阶段绑定到 `R_root`。
- 第6段：可用工具从 orchestrator tools surface 动态注册。scout 阶段只注册读工具（search/fetch）和受控的 KG 写入工具（save/link）。

**工具注册**（scout 阶段）：

```json
{
  "agentRunId": "ORCH_scout_001",
  "enabledTools": ["web_search", "fetch_page", "save_knowledge_node", "link_evidence", "finish_scout"],
  "disabledTools": ["open_gap", "suggest_patch", "write_report_node", "draft_report"],
  "reason": "scout 阶段只需要搜索和保存初始资料，不需要报告写作或结构建议。"
}
```

#### LLM 调用参数

从 `RuntimeProfile.llm.scout` 读取：

```json
{
  "model": "default",
  "maxTokens": 2048,
  "temperature": 0.3,
  "timeoutMs": 30000
}
```

#### ReAct 过程

scout 是一个 ReAct loop：

```
Turn 1: Thought -> Action(web_search) -> Observation(搜索结果)
Turn 2: Thought -> Action(fetch_page) -> Observation(页面内容)
Turn 3: Thought -> Action(save_knowledge_node) -> Observation(保存结果 + autoEvidenceLink)
...
Turn N: Thought -> Action(finish_scout) -> Observation(scout 结束)
```

每轮 ReAct 的输入是上轮 Observation + 当前 context（rubric + 运行限制）。

#### AI 输出：AgentRunResult（统一格式）

```json
{
  "agentRunId": "ORCH_scout_001",
  "taskId": "T_root",
  "reportNodeId": "R_root",
  "branchId": "B_scout",
  "branchOutcome": "done_here",
  "knowledgeNodeIds": ["K_web_001", "K_web_002", "K_web_003"],
  "evidenceLinkIds": ["E_scout_001", "E_scout_002", "E_scout_003"],
  "nodeUpdates": [],
  "openGaps": [],
  "structurePatchSuggestions": [],
  "turnSummary": {
    "actionSummary": "检索并收集土地财政、房地产税试点、国际比较三类背景资料",
    "searchSummary": "使用官方统计和财政报告作为主要来源，辅以 OECD 比较和试点政策",
    "reasoningSummary": "已有资料可支撑土地财政背景、房地产税试点、国际比较三个一级方向。房地产税替代规模仍需要后续 evidence agent 深挖测算和反方证据。",
    "citedKnowledgeNodeIds": ["K_web_001", "K_web_002", "K_web_003"],
    "citedEvidenceLinkIds": ["E_scout_001", "E_scout_002", "E_scout_003"]
  }
}
```

**v5 修正**：v4 中 scout 输出 `ScoutSummary` 作为独立类型，v5 统一为 `AgentRunResult`。`ScoutSummary` 的内容放到 `turnSummary.reasoningSummary` 中。

#### 输出与状态落地

1. **工具注册**：orchestrator tools surface 给 scout 注册 `web_search`、`fetch_page`、`save_knowledge_node`、`link_evidence`、`finish_scout`。

2. **工具调用处理**：
   - `web_search(query, topK)`：调用 `tool-providers` 的搜索 provider，返回 `SearchResult[]`。
   - `fetch_page(url)`：调用 `tool-providers` 的 fetch provider，返回页面内容。
   - `save_knowledge_node(input)`：
     - 写入 `KG.knowledge_nodes`。
     - 基于当前 `currentReportNodeId`（R_root）自动创建 `EvidenceLink`（relation="background"）。
     - 返回 `{ knowledgeNodeId, autoEvidenceLinkId, linkedReportNodeId, dedupedFromKnowledgeNodeId }`。
   - `link_evidence(...)`：补充关联，用于一个资料挂到多个 report node 或调整 relation。
   - `finish_scout(summary)`：结束 scout loop。

3. **KG 写入**：
   - `knowledge_nodes`：新增 `KnowledgeNode`（`nodeId` 格式 `K_<type>_<seq>`）。
   - `evidence_links`：新增 `EvidenceLink`（`linkId` 格式 `E_scout_<seq>`）。
   - v5 关键修正：删除 `attach` 双轨。所有报告-知识绑定只通过 `evidence_links` 表。

4. **MemoryGraph 写入**：
   - `scout_started` event。
   - 每轮 ReAct 的 `thought/action/observation`。
   - `scout_finished` event，包含 `turnSummary`。

5. **URL/content 去重**：`tool-providers/normalizer.ts` 负责 canonical URL 和 content hash 去重。重复 URL 不重复写入 KG。

---

### 3.5 Phase 5: architect-tree（AI 阶段：报告结构架构师）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `ResearchContext.userInput` | 用户原始任务 | 直接复制到 prompt |
| `GlobalRubric` | rubricText + outputHints + researchQuestionHints | 直接复制到 prompt |
| `scout AgentRunResult` | knowledgeNodeIds, evidenceLinkIds, turnSummary | 组装为"资料地图" |
| `KG.knowledge_nodes` | 已保存的 KnowledgeNode[] | 按 sourceTier 分组，提取 title/summary |
| `KG.evidence_links` | scout 创建的 EvidenceLink[] | 提取 relation 和 claimText |

#### Agent Context 组装

**System Prompt**（固定）：

```text
你是 deep research 的报告结构架构师。
你只负责设计 ReportNode tree，不写正文，不编造证据。
一级节点要覆盖用户要求；二级 hypothesis 应该是可研究、可被证据约束的判断或问题。
只输出严格 JSON。
```

**User Prompt 组装**：

```text
[第1段：用户任务]
用户任务：
<ResearchContext.userInput 全文>

[第2段：全局 Rubric]
全局 Rubric：
<GlobalRubric.rubricText 全文>

[第3段：初始资料地图]
初始资料地图：
<按以下格式组装 scout 收集的资料：
对每个 knowledgeNodeId：
1. <knowledgeNodeId> | <sourceTier> | <title> | <summary 前100字>
>

[第4段：输出指令]
请输出报告树，schema:
{
  "aspects": [
    {
      "label": string,
      "scopeNote": string,
      "hypotheses": [
        {
          "statement": string,
          "researchBrief": string,    // v5 合并：包含研究方向、搜索策略、证据指导
          "evidenceGuidance": string   // 搜索和证据策略的具体指导
        }
      ],
      "tasks": [
        {
          "title": string,
          "objective": string,
          "acceptanceCriteria": string[]
        }
      ]
    }
  ]
}
```

**组装规则**：
- 第3段"资料地图"：从 `KG.knowledge_nodes` 和 `KG.evidence_links` 读取 scout 阶段保存的资料。按 `sourceTier` 分组（official/primary/secondary），每个资料只展示 `title` 和 `summary` 前 100 字，不要全文。
- 第4段：v5 中 `hypothesis` 的 `researchBrief` 合并了原 `questionHints` + `searchHints` + `evidenceGuidance` 的语义。`evidenceGuidance` 保留但语义收窄为"具体搜索策略指导"。

#### LLM 调用参数

从 `RuntimeProfile.llm.architect` 读取（v5 新增 architect 专用 LLM 配置）：

```json
{
  "model": "default",
  "maxTokens": 4096,
  "temperature": 0.2,
  "timeoutMs": 30000
}
```

#### AI 输出示例

```json
{
  "aspects": [
    {
      "label": "土地财政的形成与规模",
      "scopeNote": "解释土地财政形成机制、规模变化及地方财政依赖",
      "hypotheses": [
        {
          "statement": "土地出让收入长期构成地方政府重要预算外或政府性基金收入来源。",
          "researchBrief": "核实土地出让收入的财政地位、变化趋势和统计口径限制。需要回答：土地出让收入在地方财政中承担什么角色？不同统计口径会怎样影响判断？",
          "evidenceGuidance": "优先找官方统计和财政报告，也需要记录口径限制。"
        }
      ],
      "tasks": [
        {
          "title": "核实土地财政规模和依赖度",
          "objective": "找到官方或高质量资料说明土地出让收入规模、变化和地方财政依赖",
          "acceptanceCriteria": [
            "至少一个官方数据源",
            "至少一个能说明趋势或占比的证据",
            "记录口径限制"
          ]
        }
      ]
    }
  ]
}
```

#### 输出与状态落地

1. **创建 ReportNode tree**：
   - 对每个 aspect：创建 `ReportNode`（nodeKind="aspect"，parentNodeId="R_root"）。
   - 对每个 hypothesis：创建 `ReportNode`（nodeKind="hypothesis"，parentNodeId=aspect 的 nodeId）。
   - `status` 初始为 `"planned"`。
   - `coverage` 初始为 `{ supportingCount: 0, contradictingCount: 0, openGapCount: 0 }`（v5 删除 neutralCount）。
   - `createdAt` = `updatedAt` = 当前时间戳。

2. **创建 TaskItem**：
   - 对每个 hypothesis 创建一个 `TaskItem`（与 hypothesis 一对一）。
   - `taskId` 格式：`T_<hypothesis 的短标识>`。
   - `branchId` 格式：`B_<hypothesis 的短标识>`。
   - `status = "queued"`。
   - `acceptanceCriteria` 从 architect AI 返回的 `tasks[].acceptanceCriteria` 复制。
   - 写入 `TaskLedger`。

3. **写入 MemoryGraph**：`architect_tree_created` event，包含创建的 aspect 和 hypothesis 数量。

**关键规则**：
- 先建报告树，再分发深搜任务。
- 不允许 agent 自己创建 report tree，agent 只能建议 patch（通过 `suggest_patch` 工具）。
- report tree 必须遵守 `rubricText`，但不依赖硬编码的章节字段。

---

### 3.6 Phase 6: dispatch-evidence-agents（AI 阶段：证据型研究 agent）

这是整个框架中最复杂的阶段。v5 的详细说明：

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `TaskLedger` | runnable TaskItem[]（status="queued"） | 按 priority 排序，取前 N 个（N = RuntimeProfile.phases.dispatchEvidence.maxParallelAgents） |
| `KG.report_nodes` | 对应 ReportNode[] | 按 reportNodeId 读取 |
| `KG.knowledge_nodes` | 相关 KnowledgeNode[] | 读取与当前任务相关的证据（同 parent aspect 的 evidence） |
| `KG.evidence_links` | 相关 EvidenceLink[] | 读取与当前 report node 相关的证据 |
| `GlobalRubric` | rubricText + outputHints | 直接复制到 context |
| `RuntimeProfile` | 阶段预算 + agent 预算 + 工具配置 | 动态组装到 context |
| `MemoryGraph` | 最近完成的 sibling task 的 turnSummary | 用于避免重复 |

#### ContextPacket 组装（v5 新增：详细说明）

v5 的核心改进：给每个 evidence agent 的 `ContextPacket` 不是隐式由 MemoryGraph 组装，而是显式由 `ContextBuilder` 组装。以下是完整的组装规则。

**ContextBuilder 输入**：
- `taskItem: TaskItem`（当前任务）
- `reportNode: ReportNode`（当前报告节点）
- `globalRubric: GlobalRubric`
- `runtimeProfile: RuntimeProfile`
- `kgSnapshot: { knowledgeNodes, evidenceLinks }`（KG 的部分快照）
- `memoryEvents: MemoryEvent[]`（最近相关 memory events）
- `siblingTasks: TaskItem[]`（同级任务列表）

**ContextBuilder 组装规则**：

```
ContextPacket.globalRubric.rubricText = GlobalRubric.rubricText（全文，不截断）
ContextPacket.globalRubric.outputHints = GlobalRubric.outputHints（完整对象）

ContextPacket.currentTask.taskId = TaskItem.taskId
ContextPacket.currentTask.branchId = TaskItem.branchId
ContextPacket.currentTask.reportNodeId = TaskItem.reportNodeId
ContextPacket.currentTask.objective = TaskItem.objective
ContextPacket.currentTask.acceptanceCriteria = TaskItem.acceptanceCriteria（完整数组，不截断）

ContextPacket.currentReportNode.nodeId = ReportNode.nodeId
ContextPacket.currentReportNode.nodeKind = ReportNode.nodeKind
ContextPacket.currentReportNode.label = ReportNode.label
ContextPacket.currentReportNode.scopeNote = ReportNode.scopeNote
ContextPacket.currentReportNode.hypothesis = ReportNode.hypothesis（如果存在，完整对象）

ContextPacket.parentContext = 如果 ReportNode.parentNodeId 存在：
  从 KG 读取父节点，组装 { nodeId, label, scopeNote }
  否则：undefined

ContextPacket.siblingTasks = 从 TaskLedger 读取：
  所有 parentNodeId = 当前 ReportNode.parentNodeId 的 TaskItem
  排除当前 taskId
  每个组装为 { taskId, title, status }
  最多取 5 个（避免 context 过长）

ContextPacket.relevantEvidence = 从 KG 读取：
  所有 EvidenceLink.reportNodeId 在以下集合中的证据：
  - 当前 ReportNode 的 parentNodeId（即同级节点的证据）
  - 当前 ReportNode 本身已有的证据
  按 sourceTier 排序（official > primary > secondary > other）
  每个组装为 { knowledgeNodeId, title, sourceTier, summary: summary前200字, relation }
  最多取 10 个（contextTokenLimit 控制）

ContextPacket.budget.maxReactSteps = RuntimeProfile.agents.evidence.maxReactSteps
ContextPacket.budget.maxToolCalls = RuntimeProfile.agents.evidence.maxToolCalls
ContextPacket.budget.maxSearchCalls = RuntimeProfile.agents.evidence.maxSearchCalls
ContextPacket.budget.maxFetchCalls = RuntimeProfile.agents.evidence.maxFetchCalls

ContextPacket.availableTools = orchestrator tools surface 按当前任务动态注册的工具列表
ContextPacket.bindingContext = { currentReportNodeId, currentTaskId, currentBranchId }
```

**上下文裁剪规则**：
- `relevantEvidence` 的 `summary` 每个最多 200 字，超过则截断并加 "..."（截断标记）。
- `siblingTasks` 最多 5 个，超过则取 status="completed" 优先，然后按 priority 排序。
- `relevantEvidence` 最多 10 个，超过则按 sourceTier 排序后截断。
- 如果总 token 数超过 `RuntimeProfile.phases.dispatchEvidence.contextTokenLimit`，则进一步缩减 `relevantEvidence` 的 summary 到 100 字，再超则减少 evidence 数量到 5 个。
- `rubricText` 不截断，它是全局约束，必须全文保留。
- `researchBrief` 不截断，它是当前任务的核心指导。

#### Agent Context 组装（System Prompt + User Prompt）

**System Prompt**（固定）：

```text
你是证据型研究 agent。
你只能完成当前 report node 的研究任务。
你必须使用工具搜索或读取资料，不能凭记忆输出事实。
你可以保存 KnowledgeNode、提出 OpenGap 或 StructurePatchSuggestion。
当你在当前任务上下文中调用 save_knowledge_node 时，系统会自动创建该 KnowledgeNode 到当前 reportNodeId 的 EvidenceLink。
只有需要把同一个 KnowledgeNode 额外关联到其他 report node，或需要调整 relation 时，才调用 link_evidence。
你不能修改 ReportNode tree，不能写最终报告。
最终只输出严格 JSON（AgentRunResult 格式）。
```

**User Prompt 组装**（从 ContextPacket 动态拼接）：

```text
[第1段：当前任务]
任务：
taskId: <ContextPacket.currentTask.taskId>
branchId: <ContextPacket.currentTask.branchId>
reportNodeId: <ContextPacket.currentTask.reportNodeId>
objective: <ContextPacket.currentTask.objective>

[第2段：当前报告节点]
当前报告节点：
nodeId: <ContextPacket.currentReportNode.nodeId>
nodeKind: <ContextPacket.currentReportNode.nodeKind>
label: <ContextPacket.currentReportNode.label>
scopeNote: <ContextPacket.currentReportNode.scopeNote>

<如果 hypothesis 存在：>
hypothesis:
  statement: <ContextPacket.currentReportNode.hypothesis.statement>
  researchBrief: <ContextPacket.currentReportNode.hypothesis.researchBrief>
  evidenceGuidance: <ContextPacket.currentReportNode.hypothesis.evidenceGuidance>

[第3段：父节点上下文]
<如果 ContextPacket.parentContext 存在：>
父节点上下文：
<ContextPacket.parentContext.label>：<ContextPacket.parentContext.scopeNote>

[第4段：已有相关证据]
已有相关证据：
<对每个 ContextPacket.relevantEvidence：>
- [<knowledgeNodeId>] <sourceTier> | <title> | <summary> | relation: <relation>

[第5段：同级任务]
同级任务（仅供参考，请聚焦于你的任务）：
<对每个 ContextPacket.siblingTasks：>
- <taskId>: <title> (<status>)

[第6段：全局 Rubric]
全局 Rubric：
<ContextPacket.globalRubric.rubricText>

[第7段：运行限制]
运行限制：
- 当前 evidence agent 总工具调用上限：<ContextPacket.budget.maxToolCalls> 次。
- 最多 <ContextPacket.budget.maxSearchCalls> 次 search，<ContextPacket.budget.maxFetchCalls> 次 fetch。
- maxReactSteps: <ContextPacket.budget.maxReactSteps>。
- 不要求用满上限；当证据已经足够支持、反驳或限定当前 report node 时，应停止扩展并总结。
- 如果 search/fetch 用尽仍证据不足，必须输出 openGaps，而不是凭空补结论。

[第8段：当前绑定上下文]
当前绑定上下文：
- currentReportNodeId: <ContextPacket.bindingContext.currentReportNodeId>
- currentTaskId: <ContextPacket.bindingContext.currentTaskId>
- currentBranchId: <ContextPacket.bindingContext.currentBranchId>
- save_knowledge_node 成功后，系统会自动创建到 currentReportNodeId 的 EvidenceLink。

[第9段：可用工具]
可用工具：
<对每个 ContextPacket.availableTools：>
- <toolName>: <description>

[第10段：输出格式]
输出 JSON schema（AgentRunResult）：
{
  "agentRunId": string,
  "taskId": string,
  "reportNodeId": string,
  "branchId": string,
  "branchOutcome": "done_here" | "defer_to_next_round" | "failed",
  "knowledgeNodeIds": string[],
  "evidenceLinkIds": string[],
  "nodeUpdates": [
    {"reportNodeId": string, "oldStatus": string, "newStatus": string, "reason": string, "confidence": number}
  ],
  "openGaps": [{"gapType": string, "description": string, "suggestedQuery": string}],
  "structurePatchSuggestions": [],
  "turnSummary": {
    "actionSummary": string,
    "searchSummary": string,
    "reasoningSummary": string,
    "citedKnowledgeNodeIds": string[],
    "citedEvidenceLinkIds": string[]
  }
}
```

**组装规则详细说明**：
- 第1段：当前任务信息。`objective` 必须完整复制，不截断。这是 agent 的核心任务。
- 第2段：当前报告节点。如果 `nodeKind="hypothesis"`，必须包含 `hypothesis` 对象（statement + researchBrief + evidenceGuidance）。
- 第3段：父节点上下文。帮助 agent 理解当前任务在报告树中的位置。如果父节点是 root，则省略此段。
- 第4段：已有相关证据。这是最重要的上下文之一——告诉 agent 哪些资料已经被找到，避免重复搜索。按 `sourceTier` 排序，official 在前。每个证据只展示摘要前 200 字（裁剪后）。
- 第5段：同级任务。告诉 agent 其他维度在做什么，避免重复工作。只展示标题和状态，不展示详细内容。
- 第6段：全局 Rubric。必须全文保留，不截断。这是所有 agent 的行为约束。
- 第7段：运行限制。从 `RuntimeProfile` 读取，动态填入数字。必须明确告诉 agent 预算限制，避免浪费。
- 第8段：绑定上下文。固定格式，说明当前 agent 的"位置"。`save_knowledge_node` 的自动绑定依赖此上下文。
- 第9段：可用工具。从 orchestrator tools surface 动态注册。不同任务可能注册不同工具。
- 第10段：输出格式。固定 JSON schema，agent 必须严格遵守。

#### 工具注册（dispatch-evidence 阶段）

```json
{
  "agentRunId": "A_land_revenue_001",
  "enabledTools": [
    "web_search",
    "fetch_page",
    "save_knowledge_node",
    "link_evidence",
    "open_gap",
    "suggest_patch"
  ],
  "disabledTools": [
    "write_report_node",
    "draft_report",
    "finish_scout"
  ],
  "reason": "evidence agent 需要搜索、读取、保存证据、提出缺口和结构建议。不需要写报告或结束 scout。"
}
```

**工具注册规则**：
- orchestrator tools surface 根据任务类型（evidence）、已接入工具接口、系统级工具权限和运行参数选择工具。
- `tool-providers` 提供具体工具实现。
- agent 运行中可以请求启用新工具（通过 `allowToolEscalationRequest`），但只能由 orchestrator 批准。
- orchestrator 在任务结束、预算耗尽、发现漂移后注销对应工具。

#### LLM 调用参数

从 `RuntimeProfile.llm.evidence` 读取（v5 新增 evidence 专用 LLM 配置）：

```json
{
  "model": "default",
  "maxTokens": 4096,
  "temperature": 0.2,
  "timeoutMs": 30000
}
```

#### AI 输出：AgentRunResult（统一格式）

```json
{
  "agentRunId": "A_land_revenue_001",
  "taskId": "T_land_revenue",
  "reportNodeId": "R_hyp_land_revenue",
  "branchId": "B_land_revenue",
  "branchOutcome": "done_here",
  "knowledgeNodeIds": ["K_web_001", "K_web_011"],
  "evidenceLinkIds": ["E_land_001", "E_land_002"],
  "nodeUpdates": [
    {
      "reportNodeId": "R_hyp_land_revenue",
      "oldStatus": "researching",
      "newStatus": "supported",
      "reason": "已找到官方统计和财政口径说明土地出让收入对地方政府性基金收入的重要性。",
      "confidence": 0.82
    }
  ],
  "openGaps": [
    {
      "gapType": "time_series",
      "description": "仍缺少连续十年以上口径一致的土地出让收入占比序列。",
      "suggestedQuery": "全国 土地出让收入 2010 2023 地方政府性基金收入 占比"
    }
  ],
  "structurePatchSuggestions": [],
  "turnSummary": {
    "actionSummary": "检索并核实土地出让收入规模与财政依赖资料。",
    "searchSummary": "使用官方统计和财政报告作为主要来源。",
    "reasoningSummary": "证据支持土地出让收入在地方财政体系中长期重要，但趋势口径仍需谨慎。",
    "citedKnowledgeNodeIds": ["K_web_001", "K_web_011"],
    "citedEvidenceLinkIds": ["E_land_001", "E_land_002"]
  }
}
```

#### 输出与状态落地

1. **校验**：
   - `knowledgeNodeIds` 必须真实存在于 KG。
   - `evidenceLinkIds` 必须来自 `save_knowledge_node` 工具返回的 `autoEvidenceLinkId`，或来自显式 `link_evidence` 工具调用。agent 不能凭空编造 link id。
   - `evidenceLinkIds` 必须指向当前或允许的 report node（即当前 `reportNodeId` 或其父节点）。

2. **更新 ReportNode coverage**：
   - 遍历 `evidenceLinkIds`，按 `relation` 分类：
     - `relation="supports"` → `supportingCount++`
     - `relation="contradicts"` → `contradictingCount++`
     - `relation="background"` → 不计入 coverage（不增加 support/contradict）
   - v5 删除 `neutralCount`。

3. **更新 ReportNode status**：
   - `nodeUpdates` 中的 `newStatus` 是 agent 的建议，但**最终状态由 orchestrator 根据 coverage 确认**。
   - orchestrator 确认规则：
     - `supportingCount >= 1 && contradictingCount == 0` → `supported`（如果 agent 建议 supported）
     - `supportingCount >= 1 && contradictingCount >= 1` → `partially_supported`
     - `supportingCount == 0 && contradictingCount >= 1` → `contradicted`
     - `supportingCount == 0 && contradictingCount == 0 && openGapCount > 0` → `insufficient_evidence`
     - agent 建议 `downplayed` → 需要 orchestrator 确认（通常是因为证据不足但结论不重要）

4. **更新 TaskLedger**：
   - `T_land_revenue.status = "completed"`（如果 `branchOutcome="done_here"`）。
   - `T_land_revenue.status = "blocked"`（如果 `branchOutcome="failed"`）。
   - `T_land_revenue.status = "queued"`（如果 `branchOutcome="defer_to_next_round"`）。

5. **写入 MemoryGraph**：
   - `evidence_agent_started` event（包含 agentRunId, taskId, reportNodeId）。
   - 每轮 ReAct 的 thought/action/observation（如果 trace 级别为 debug）。
   - `evidence_agent_finished` event（包含 `turnSummary`）。

6. **OpenGap 处理**：
   - `openGaps` 进入 `TaskLedger` 的 gap 列表。
   - `cycle-reflection` 阶段判断是否基于这些 gap 生成新 task。

---

### 3.7 Phase 7: cycle-reflection（AI 阶段：本轮调度反思器）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| 本轮 `AgentRunResult[]` | 所有 evidence agent 的输出 | 从 MemoryGraph 读取或从 phase runner 传递 |
| `TaskLedger` | 当前所有 task 状态 | 读取全量 task 状态 |
| `KG` | evidence coverage 统计 | 读取每个 report node 的 coverage |
| `RuntimeProfile` | 阶段预算 | 读取当前 cycle 和 max cycle |

#### Agent Context 组装

**System Prompt**（固定）：

```text
你是 deep research 的调度反思器。
你只判断哪些任务完成、哪些缺口值得继续派发、哪些任务重复或漂移。
不能改 ReportNode tree，不能写报告。
只输出严格 JSON。
```

**User Prompt 组装**：

```text
[第1段：本轮任务结果]
本轮任务结果：
<对每个 AgentRunResult：>
1. <taskId> -> <branchOutcome>, evidenceLinks: <evidenceLinkIds 数量>, openGap: <openGaps 描述>

[第2段：当前 phase budget]
当前 phase budget：
- dispatchEvidence.maxCycles: <RuntimeProfile.phases.dispatchEvidence.maxCycles>
- dispatchEvidence.currentCycle: <当前 cycle 数>
- evidenceAgent.remainingToolCalls: <剩余工具调用数>

[第3段：当前 coverage]
当前 coverage：
<对每个 report node：>
- <nodeId>: supporting=<supportingCount>, contradicting=<contradictingCount>, openGap=<openGapCount>

[第4段：输出指令]
请输出：
{
  "taskUpdates": [
    {"taskId": string, "newStatus": "completed" | "queued" | "blocked", "reason": string}
  ],
  "newTasks": [
    {"title": string, "objective": string, "reportNodeId": string, "priority": number, "acceptanceCriteria": string[]}
  ],
  "skipReasons": [
    {"gap": string, "reason": string}
  ]
}
```

#### LLM 调用参数

从 `RuntimeProfile.llm.reflection` 读取（v5 新增 reflection 专用 LLM 配置）：

```json
{
  "model": "default",
  "maxTokens": 2048,
  "temperature": 0.2,
  "timeoutMs": 30000
}
```

#### AI 输出示例

```json
{
  "taskUpdates": [
    {
      "taskId": "T_land_revenue",
      "newStatus": "completed",
      "reason": "已有足够证据支持核心判断，长时间序列缺口可在报告中说明口径限制。"
    },
    {
      "taskId": "T_tax_capacity",
      "newStatus": "queued",
      "reason": "替代规模测算不足，需要第二轮补证。"
    }
  ],
  "newTasks": [
    {
      "title": "补充房地产税替代规模测算",
      "objective": "寻找房地产税潜在收入、税基和税率假设的测算资料",
      "reportNodeId": "R_hyp_tax_capacity",
      "priority": 90,
      "acceptanceCriteria": [
        "至少一个测算来源",
        "明确税率和税基假设",
        "包含不确定性或反方约束"
      ]
    }
  ],
  "skipReasons": [
    {
      "gap": "土地出让收入十年以上连续序列",
      "reason": "对最终结论有帮助但不是必要条件，可由报告注明口径限制。"
    }
  ]
}
```

#### 输出与状态落地

1. **更新 TaskLedger**：
   - `taskUpdates` 中的每个 task 更新状态。
   - `newTasks` 中的每个 task 创建新的 `TaskItem`，`status = "queued"`。
   - `skipReasons` 写入 MemoryGraph 的 `gap_skipped` event。

2. **判断是否继续 dispatch**：
   - 如果 `currentCycle < maxCycles` 且还有 `queued` task → 继续下一轮 dispatch。
   - 如果 `currentCycle >= maxCycles` → 进入 `completion-gate`。
   - 如果所有 task 都 `completed` 或 `blocked` → 进入 `completion-gate`。

3. **写入 MemoryGraph**：`cycle_reflection` event，包含 taskUpdates 和 newTasks 的摘要。

---

### 3.8 Phase 8: structure-review（AI 阶段：结构审查器）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `KG.report_nodes` | 当前完整 report tree | 读取全量 tree |
| `KG.evidence_links` | 所有证据链接 | 按 report node 分组统计 |
| `TaskLedger` | open gaps | 读取未关闭的 gap |
| 本轮 `AgentRunResult[]` | worker 的 patch suggestions | 收集所有 `structurePatchSuggestions` |
| `RuntimeProfile` | 阶段预算 | 读取 maxLlmCalls, maxOutputItems |

#### Agent Context 组装

**System Prompt**（固定）：

```text
你是 deep research 的结构审查器。
你检查当前报告树的结构是否合理，证据是否覆盖充分。
你可以提出结构 patch，但不能直接修改报告树。
只输出严格 JSON。
```

**User Prompt 组装**：

```text
[第1段：当前报告树]
当前报告树：
<按树形结构展示，每个节点显示：>
- <nodeId> <nodeKind> <label> <status>
  <如果 hypothesis：显示 statement>

[第2段：证据覆盖]
证据覆盖：
<对每个 report node：>
- <nodeId>: supporting=<supportingCount>, contradicting=<contradictingCount>, openGap=<openGapCount>

[第3段：worker patch suggestions]
worker 提出的结构建议：
<收集所有 AgentRunResult.structurePatchSuggestions>

[第4段：允许的 patch op]
只允许输出这些 patch op：
- add_aspect_node: 在 parent 下新增一级 aspect
- add_hypothesis_node: 在 aspect 下新增 hypothesis
- rename_report_node: 重命名节点
- move_report_node: 移动节点到新的 parent
- merge_report_nodes: 合并两个节点
- move_evidence_link: 移动证据链接到新的 report node
- retag_knowledge_node: 重新标记知识节点类型或 source tier
- discard_knowledge_node: 标记知识节点为废弃（不删除，只标记）
- downplay_hypothesis: 降级某个 hypothesis 的重要性

[第5段：输出指令]
请评估当前报告树，输出需要修改的 patch 列表和理由。
输出 JSON：
{
  "patches": [
    {"op": string, "rationale": string, ...op-specific fields}
  ],
  "rationale": string
}
```

#### LLM 调用参数

从 `RuntimeProfile.llm.structureReview` 读取：

```json
{
  "model": "default",
  "maxTokens": 2048,
  "temperature": 0.2,
  "timeoutMs": 30000
}
```

#### 流程：三层审查

v5 明确结构审查的三层流程：

```
Layer 1: LLM 提议 patch
  -> 输入：report tree + evidence coverage + worker suggestions
  -> 输出：proposed patches[]

Layer 2: Critic 评估风险
  -> 输入：proposed patches[] + current tree + coverage
  -> 输出：critique（每条 patch 的风险评估：safe / risky / dangerous）
  -> 规则：
     - safe: 只改 label/scopeNote，不影响树结构
     - risky: 移动/合并节点，可能影响已有证据链接
     - dangerous: 删除/大量重排节点，可能丢失已收集证据

Layer 3: Scheduler 决策
  -> 输入：critique + current cycle budget
  -> 输出：apply / reject / redispatch
  -> 规则：
     - apply: 安全 patch，直接执行
     - reject: 风险过高或预算不足，记录 skip reason
     - redispatch: 需要新证据支持，生成 repair task
```

#### AI 输出示例

```json
{
  "patches": [
    {
      "op": "add_aspect_node",
      "parentNodeId": "R_root",
      "label": "改革风险与过渡安排",
      "scopeNote": "分析征管、居民负担、地方财政缺口和市场预期风险",
      "rationale": "用户明确要求风险，但当前一级结构没有独立风险节点。"
    }
  ],
  "rationale": "当前报告树缺少用户明确要求的风险分析维度。"
}
```

#### 输出与状态落地

1. **Critic 评估**：
   - 每条 patch 评估风险等级（safe/risky/dangerous）。
   - 风险评估基于：是否影响已有 evidence links、是否改变已有 task 的 reportNodeId、是否超出 `maxOutputItems`。

2. **Scheduler 决策**：
   - `apply`：调用 `patch-applier`（确定性代码）执行 patch。
   - `reject`：记录 reject reason 到 MemoryGraph。
   - `redispatch`：生成新的 `TaskItem`，指向新增的/修改的 report node。

3. **Patch Applier 执行**：
   - `add_aspect_node`：创建新 `ReportNode`（nodeKind="aspect"），创建对应 `TaskItem`。
   - `add_hypothesis_node`：创建新 `ReportNode`（nodeKind="hypothesis"），创建对应 `TaskItem`。
   - `rename_report_node`：修改 `ReportNode.label`。
   - `move_report_node`：修改 `ReportNode.parentNodeId`，同时更新所有相关 `EvidenceLink` 的 `reportNodeId`（如果它们指向被移动的节点）。
   - `merge_report_nodes`：合并两个节点，保留目标节点的 evidence links，将源节点的 evidence links 移动到目标节点，然后标记源节点为 `pruned`。
   - `move_evidence_link`：修改 `EvidenceLink.reportNodeId`。
   - `retag_knowledge_node`：修改 `KnowledgeNode.nodeType` 或 `sourceTier`。
   - `discard_knowledge_node`：修改 `KnowledgeNode.qualityScore = 0` 或标记废弃状态（v5 不删除，只标记）。
   - `downplay_hypothesis`：修改 `ReportNode.status = "downplayed"`。

4. **写入 MemoryGraph**：`structure_review` event，包含 applied patches 和 rejected patches。

---

### 3.9 Phase 9: completion-gate（确定性代码，可选 AI 辅助）

#### 输入

| 来源 | 内容 |
|------|------|
| `KG.report_nodes` | 完整 report tree |
| `KG.evidence_links` | 所有证据链接 |
| `TaskLedger` | 所有 task 状态 |
| `GlobalRubric` | rubricText（用于检查 rubric violation） |

#### 处理逻辑（确定性规则优先）

```typescript
function checkCompletion(reportTree, evidenceLinks, taskLedger, rubric): CompletionDecision {
  // 规则 1：所有非 pruned 的 report node 必须是 terminal 状态
  const nonTerminalNodes = reportTree
    .filter(n => n.nodeKind !== "root" && n.status !== "pruned") // "pruned" = 已剪枝（不再研究，从最终报告中移除）
    .filter(n => !isTerminalStatus(n.status));

  // 规则 2：关键 hypothesis（非 downplayed）至少有一条 evidence link
  const keyHypotheses = reportTree
    .filter(n => n.nodeKind === "hypothesis" && n.status !== "downplayed" && n.status !== "pruned"); // "downplayed" = 已降级（重要性降低，不再深入）
  const uncoveredHypotheses = keyHypotheses.filter(h =>
    evidenceLinks.filter(e => e.reportNodeId === h.nodeId).length === 0
  );

  // 规则 3：open gaps 不影响最终结论，或已在报告中降调
  const impactfulGaps = taskLedger.gaps.filter(g => g.impact === "high" && g.status !== "acknowledged");

  // 规则 4：针对 rubricText 的明显问题已经进入 diagnostics 或 repair task
  const rubricViolations = checkRubricViolations(reportTree, evidenceLinks, rubric);

  if (nonTerminalNodes.length > 0) {
    return { decision: "need_more_work", reason: "仍有非 terminal 节点", newTasks: generateTasks(nonTerminalNodes) };
  }
  if (uncoveredHypotheses.length > 0) {
    return { decision: "need_more_work", reason: "关键 hypothesis 缺少证据", newTasks: generateTasks(uncoveredHypotheses) };
  }
  if (impactfulGaps.length > 0) {
    return { decision: "need_more_work", reason: "存在影响结论的开放缺口", newTasks: generateTasks(impactfulGaps) };
  }
  if (rubricViolations.length > 0) {
    return { decision: "need_more_work", reason: "存在 rubric violation", newTasks: generateRepairTasks(rubricViolations) };
  }

  return { decision: "ready_for_report" };
}
```

#### 输出

```json
// 情况 1：还需要工作
{
  "decision": "need_more_work",
  "reason": "仍有非 terminal 关键节点，且风险节点刚创建未派发证据任务。",
  "newTasks": ["T_tax_capacity_repair", "T_risk"]
}

// 情况 2：可以进入报告
{
  "decision": "ready_for_report"
}
```

#### 状态落地

- 如果 `need_more_work`：将 `newTasks` 写入 `TaskLedger`，返回 `dispatch-evidence` 阶段。
- 如果 `ready_for_report`：进入 `report` 阶段。
- 写入 MemoryGraph：`completion_gate` event。

**v5 修正**：v4 中 completion-gate 默认无 AI。v5 改为"确定性规则优先，可选 AI 辅助"。如果确定性规则判断模糊（如处于边界状态），可以调用 LLM 做辅助判断，但决策权仍在确定性规则。

---

### 3.10 Phase 10: report（AI 阶段：报告写作者）

#### 输入

| 来源 | 内容 | 组装方式 |
|------|------|---------|
| `ReportBundle` | 由 `KG.bundle-builder` 生成 | 确定性代码组装，不是 AI |
| `RuntimeProfile.llm.report` | LLM 参数 | 读取配置 |

#### ReportBundle 组装（v5 详细说明）

`ReportBundle` 不是由 AI 组装的，而是由 `KG.bundle-builder` 确定性代码组装的。以下是组装规则：

```typescript
function buildReportBundle(kg, episodeId, rubric): ReportBundle {
  // 1. 读取 root ReportNode
  const root = kg.getReportNode("R_root");

  // 2. 读取完整 tree
  const allNodes = kg.getAllReportNodes();
  const tree = allNodes.map(node => {
    const children = allNodes
      .filter(n => n.parentNodeId === node.nodeId)
      .map(n => n.nodeId);
    const evidence = kg.getEvidenceLinks(node.nodeId)
      .map(link => ({
        link,
        knowledge: kg.getKnowledgeNode(link.knowledgeNodeId)
      }));
    const openGaps = taskLedger.getOpenGaps(node.nodeId);
    return { node, children, evidence, openGaps };
  });

  // 3. 构建全局证据索引（用于 citation）
  const allKnowledgeNodes = kg.getAllKnowledgeNodes();
  const globalEvidenceIndex = allKnowledgeNodes.map((kn, idx) => ({
    citationId: `C${idx + 1}`,  // 自动生成 citation ID
    knowledgeNodeId: kn.nodeId,
    title: kn.title,
    url: kn.url,
    sourceTier: kn.sourceTier,
    retrievedAt: kn.retrievedAt
  }));

  // 4. 组装 constraints
  const constraints = {
    language: rubric.outputHints.language || "zh-CN",
    citationRequired: rubric.outputHints.citationRequired || false,
    rubricId: rubric.rubricId,
    rubricText: rubric.rubricText
  };

  return { episodeId, root, tree, globalEvidenceIndex, constraints };
}
```

**组装规则说明**：
- `tree` 数组包含所有 report nodes（包括 root, aspect, hypothesis）。
- 每个 node 的 `children` 是其直接子节点的 `nodeId` 列表。
- `evidence` 按 `sourceTier` 排序（official > primary > secondary > other）。
- `citationId` 自动生成（`C1`, `C2`, ...），与 `knowledgeNodeId` 一一映射。
- `openGaps` 从 `TaskLedger` 读取，只包含当前 report node 相关的 gap。

#### Agent Context 组装

**System Prompt**（固定）：

```text
你是 deep research 的最终报告写作者。
你只能使用 ReportBundle 中提供的证据写作。
每个事实性判断必须有 citationId（如 [C1]）。
必须遵守 GlobalRubric.rubricText 中的来源、引用、结构和表达要求。
不能使用未出现在 EvidenceIndex 中的资料。
输出 Markdown。
```

**User Prompt 组装**：

```text
[第1段：写作目标]
写作目标：
产出 <constraints.language> 深度研究报告：<ReportBundle.root.label>

[第2段：全局约束]
全局约束：
<ReportBundle.constraints.rubricText>

[第3段：报告结构]
报告结构（按 ReportBundle.tree 组装）：
<对每个 aspect node：>
## <node.label>
<node.scopeNote>

<对每个 hypothesis node（作为子节点）：>
### <node.label>
statement: <node.hypothesis.statement>
researchBrief: <node.hypothesis.researchBrief>

[第4段：每个节点的证据]
<对每个 report node：>
<node.label> 的证据：
<对每个 evidence：>
- [<citationId>] <knowledge.title> (<knowledge.sourceTier>): <knowledge.summary 前300字>
  relation: <evidence.relation>, claim: <evidence.claimText>

[第5段：开放缺口]
开放缺口（需在报告中说明）：
<对每个 openGap：>
- <gap.description>

[第6段：输出要求]
输出要求：
- 语言：<constraints.language>
- 格式：Markdown
- 保留 citationId，例如 [C1]
- 不输出证据列表之外的引用
- 每个事实判断必须绑定 citation
- 无法确认的判断必须降调或说明证据不足
```

**组装规则说明**：
- 第1段：写作目标。从 `ReportBundle.root.label` 和 `constraints.language` 组装。
- 第2段：全局约束。必须完整保留 `rubricText`，不截断。这是 reporter 的行为约束。
- 第3段：报告结构。从 `ReportBundle.tree` 组装。只包含 `nodeKind="aspect"` 的节点作为一级标题，`nodeKind="hypothesis"` 的节点作为二级标题。root 节点不参与正文结构。
- 第4段：每个节点的证据。这是 reporter 的核心输入材料。每个证据包含：citationId、知识标题、sourceTier、摘要（前 300 字）、relation、claimText。按 sourceTier 排序。
- 第5段：开放缺口。如果存在 `openGaps`，reporter 必须在报告中说明这些限制。
- 第6段：输出要求。固定格式要求。

**上下文裁剪规则**：
- 如果总 token 超过 `RuntimeProfile.phases.report.contextTokenLimit`，则：
  1. 缩减每个 evidence 的 `summary` 到 150 字。
  2. 如果仍超，减少 evidence 数量（保留 official/primary 的，丢弃 secondary 的）。
  3. 如果仍超，减少 `openGaps` 数量（只保留影响结论的）。
  4. `rubricText` 不截断。如果必须截断，则优先截断其他部分。

#### LLM 调用参数

从 `RuntimeProfile.llm.report` 读取：

```json
{
  "model": "default",
  "maxTokens": 8192,
  "temperature": 0.2,
  "timeoutMs": 60000
}
```

**注意**：`report` 阶段的 `maxTokens` 通常最大（8192 或更高），因为报告本身很长。

#### AI 输出

Markdown 格式的完整报告，包含 `##` 标题和 `[C1]` 引用标记。

#### 输出与状态落地

1. **保存 draft markdown**：`artifacts/<episodeId>/report-draft.md`。
2. **保存 citation map**：`artifacts/<episodeId>/citation-map.json`（citationId → knowledgeNodeId 的映射）。
3. **保存 grounding diagnostics**：`artifacts/<episodeId>/grounding-diagnostics.json`（每个 citation 的验证结果）。
4. **写入 MemoryGraph**：`report_draft_created` event。

---

### 3.11 Phase 11: publish-gate（确定性检查为主，可选 AI 辅助）

#### 输入

| 来源 | 内容 |
|------|------|
| `report-draft.md` | 最终报告的 draft |
| `citation-map.json` | citationId → knowledgeNodeId 的映射 |
| `ReportBundle` | 完整的证据包 |
| `RuntimeProfile` | 阶段预算 |

#### 确定性检查（优先级：高）

publish-gate 先执行确定性检查，不需要 LLM：

```typescript
function deterministicPublishCheck(draft, citationMap, evidenceIndex): PublishCheckResult {
  const issues = [];

  // 检查 1：每条引用都能回到 KnowledgeNode
  const usedCitations = extractCitationIds(draft);  // 正则匹配 [C\d+]
  for (const cid of usedCitations) {
    if (!citationMap[cid]) {
      issues.push({ code: "missing_citation", severity: "error", message: `引用 ${cid} 未在 citation map 中定义` });
    }
    if (!evidenceIndex.find(e => e.citationId === cid)) {
      issues.push({ code: "orphan_citation", severity: "error", message: `引用 ${cid} 未在 evidence index 中` });
    }
  }

  // 检查 2：每个核心结论都有 supporting/contradicting/qualifying evidence
  const sections = extractSections(draft);
  for (const section of sections) {
    const claims = extractClaims(section);  // 简单规则：每段第一句或带数据的句子
    for (const claim of claims) {
      const cids = extractCitationIds(claim);
      if (cids.length === 0) {
        issues.push({ code: "ungrounded_claim", severity: "warning", message: `段落可能包含未引用的事实判断` });
      }
    }
  }

  // 检查 3：没有假引用、空引用、重复引用错配
  for (const cid of usedCitations) {
    const knId = citationMap[cid];
    const kn = evidenceIndex.find(e => e.knowledgeNodeId === knId);
    if (kn && !kn.url && !kn.title) {
      issues.push({ code: "empty_reference", severity: "error", message: `引用 ${cid} 指向空资料` });
    }
  }

  // 检查 4：报告长度
  if (draft.length < 2000) {
    issues.push({ code: "too_short", severity: "warning", message: "报告长度不足 2000 字符" });
  }

  // 检查 5：rubricText 中的禁止来源
  const blockedPatterns = extractBlockedPatterns(rubricText);  // 从 rubricText 中提取禁止来源
  for (const pattern of blockedPatterns) {
    if (draft.includes(pattern)) {
      issues.push({ code: "blocked_source", severity: "error", message: `报告中包含禁止来源: ${pattern}` });
    }
  }

  return { issues };
}
```

#### 可选 AI 辅助检查（如果确定性检查通过但有 warning）

如果确定性检查只产生 warning（没有 error），可以调用 LLM 做辅助检查：

**System Prompt**：

```text
你是 deep research 的发布审查器。
你检查报告是否满足用户要求的质量标准。
只输出 JSON：{ "passed": boolean, "issues": [{"code": string, "severity": "warning"|"error", "message": string}] }
```

**User Prompt**：

```text
报告草稿：
<report-draft.md 全文（如果太长则截断到 contextTokenLimit）>

用户要求：
<rubricText>

请检查：
1. 报告是否覆盖 rubricText 中要求的所有内容？
2. 报告是否有明显的逻辑漏洞或事实错误？
3. 报告语气是否合适（是否过于确定，是否说明不确定性）？
4. 引用格式是否一致？
```

#### 输出

**情况 1：通过**

```json
{
  "status": "passed",
  "reportArtifactPath": "artifacts/EP_20260616_001/report.md",
  "evidenceIndexPath": "artifacts/EP_20260616_001/evidence-index.json",
  "tracePath": "artifacts/EP_20260616_001/trace.jsonl"
}
```

**情况 2：需要修复**

```json
{
  "status": "needs_repair",
  "diagnostics": [
    {
      "code": "missing_citation",
      "severity": "error",
      "message": "第二节出现未带 citation 的事实判断。"
    }
  ],
  "repairTasks": [
    {
      "title": "修复第二节缺失引用",
      "objective": "为房地产税替代规模判断补充证据或删除该判断",
      "reportNodeId": "R_hyp_tax_capacity",
      "acceptanceCriteria": [
        "所有事实判断都有 citation",
        "citationId 能映射到 KnowledgeNode"
      ]
    }
  ]
}
```

#### 输出与状态落地

1. **如果 passed**：
   - `report-draft.md` 重命名为 `report.md`。
   - 生成 `evidence-index.json`（从 `ReportBundle.globalEvidenceIndex` 导出）。
   - 生成 `trace.jsonl`（从 `MemoryGraph` 导出）。
   - 写入 MemoryGraph：`episode_succeeded` event。

2. **如果 needs_repair**：
   - `repairTasks` 写入 `TaskLedger`。
   - 返回 `dispatch-evidence` 阶段（或直接进入 targeted repair，v5 可选）。
   - 写入 MemoryGraph：`publish_gate_repair` event。

---

## 4. 代码实现错误与修正方案

### 4.1 v4 中已知的 7 个 bug（v5 修正方案）

| # | Bug | 影响 | v5 修正方案 |
|---|-----|------|------------|
| 1 | `OrchestratorState` 要求 `evidenceLinks`，但构造和序列化没有完整初始化/输出 | 运行时可能缺少 evidence links | `OrchestratorState` 初始化时默认 `evidenceLinks: []`，序列化时完整输出。phase runner 在每次 agent 运行后同步更新 evidenceLinks。 |
| 2 | `InMemoryReporterService.inner` 声明为 `readonly` 但被二次赋值，且依赖 fixture | 编译错误 + 测试路径污染主流程 | 删除 `readonly` 修饰符（或改为 getter/setter）。删除 fixture 主路径，reporter 只消费 `ReportBundle`。 |
| 3 | `createSqliteMemoryGraph(opts)` 忽略 `dbPath` | SQLite 实现无法指定数据库路径 | 修正构造函数：确保 `dbPath` 被传入并用于数据库连接。如果 `dbPath` 未提供，使用默认路径并记录 warn。 |
| 4 | `TaskLedger` 要求非空 `acceptanceCriteria`，但 orchestrator 创建 root task 时传 `[]` | root task 的 acceptanceCriteria 为空，违反约束 | 在 `rubric` 阶段生成 root task 的 `acceptanceCriteria`（从 rubricText 中提取关键约束）。如果 rubric 阶段未生成，使用默认 acceptanceCriteria。 |
| 5 | 结构审查 contract 与 implementation op 名不一致 | patch 无法正确应用 | 统一使用 `patch.ts` 中的 op 名。`structure-review.ts` 实现只接受 `patch.ts` 中定义的 op。如果 LLM 输出旧 op 名，做映射转换或拒绝。 |
| 6 | KG 同时维护 attach edge 和 evidence link | 报告绑定关系存在双轨，数据不同步 | 删除 `attach` 写入路径。所有报告-知识绑定只通过 `evidence_links` 表。KG 表结构固定为：report_nodes, knowledge_nodes, evidence_links。 |
| 7 | 搜索 provider 只薄封装结果，没有统一 normalize、dedup、全局来源策略过滤、source tier 识别 | 重复 URL 污染 KG，来源质量不可控 | 新增 `tool-providers/normalizer.ts`：统一 canonical URL、content hash、title/snippet 清洗、source tier 识别。新增 `tool-providers/policy.ts`：来源过滤策略（如排除 wikipedia）。 |

### 4.2 v3/v4 实现中的其他错误（v5 修正）

| Bug | 影响 | v5 修正方案 |
|-----|------|------------|
| `MemoryGraph` 硬编码 KG/report 上下文拼装 | 给 agent 的上下文不可预测 | 新增 `ContextBuilder`，从 `TaskLedger + KG + MemoryGraph` 显式组装 `ContextPacket`。`MemoryGraph` 只存事件和摘要。 |
| `Reporter` 从 `DraftBundle` 和 attach 边组织材料 | 报告生成路径依赖旧数据模型 | `Reporter` 只接收 `ReportBundle`（由 `KG.bundle-builder` 生成）。`DraftBundle` 不写入 KG，只作为 reporter 内部中间格式。 |
| 旧单体 Orchestrator 实现包含所有阶段 | 任何小改动牵连大块逻辑 | 拆成 `phase-runner.ts` + 独立 phase 文件。`Orchestrator` 只负责串联阶段。每个 phase 文件只做一件事。 |
| 配置散落在 `config.ts` + `RunOptions` + `DebugConfig` | 修改参数需要改多个地方 | 合并为统一 `RuntimeProfile`。所有运行参数从配置文件读取，代码中不写死数字。 |
| `WorkerResult` 包含 `completedTodos/partialTodos/maybeTodos/kgWriteCandidates/draftBundle` | 输出格式与 v4 目标架构不一致 | 统一为 `AgentRunResult`。删除旧字段。`kgWriteCandidates` 的功能由 `save_knowledge_node` 工具替代。 |
| `structure-review` 的实现仍有旧 op 名称 | patch 无法正确应用 | 重写 `structure-review.ts`：只接受 `patch.ts` 中的 op。review 分三层：propose → critic → scheduler decision。patch applier 是确定性代码。 |
| `evidenceLinks` 缺少 `createdByAgentRunId` 等追溯字段 | 无法追踪 evidence link 的创建者 | v5 简化：只保留 `createdByTaskId`。`agentRunId` 和 `branchId` 通过 `TaskItem` 关联。过程信息放到 `MemoryGraph` trace 中。 |
| `ResearchContext` 的 `scope` 和 `constraints` 字段冗余 | 用户约束被拆成多个字段，容易不同步 | 删除 `scope` 和 `constraints`，自然语言约束进入 `rubricText`。`expectedArtifacts` 保留在 `ResearchContext`。 |
| `ReportNode.coverage.neutralCount` 不实用 | 统计维度过多，增加复杂度 | 删除 `neutralCount`。只统计 `supporting/contradicting/openGap`。 |
| `KnowledgeNode.retrievedByBranchId` 与 `retrievedByTaskId` 冗余 | branch 和 task 一对一，字段重复 | 删除 `retrievedByBranchId`。通过 `retrievedByTaskId` 查 `TaskItem` 得 `branchId`。 |

---

## 5. v5 配置体系

### 5.1 统一配置：RuntimeProfile

v5 合并 v4 的 `RunOptions` 和 `DebugConfig` 为统一的 `RuntimeProfile`。

```json
// configs/runtime/default.json（全局默认配置）
{
  "hilMode": "auto_accept",
  "artifactDir": "artifacts",
  "reportFormat": "markdown",
  "includeEvidenceIndex": true,
  "llm": {
    "rubric": { "model": "default", "maxTokens": 2048, "temperature": 0.2, "timeoutMs": 30000 },
    "scout": { "model": "default", "maxTokens": 2048, "temperature": 0.3, "timeoutMs": 30000 },
    "architect": { "model": "default", "maxTokens": 4096, "temperature": 0.2, "timeoutMs": 30000 },
    "evidence": { "model": "default", "maxTokens": 4096, "temperature": 0.2, "timeoutMs": 30000 },
    "reflection": { "model": "default", "maxTokens": 2048, "temperature": 0.2, "timeoutMs": 30000 },
    "structureReview": { "model": "default", "maxTokens": 2048, "temperature": 0.2, "timeoutMs": 30000 },
    "report": { "model": "default", "maxTokens": 8192, "temperature": 0.2, "timeoutMs": 60000 }
  },
  "phases": {
    "scout": { "enabled": true, "maxReactSteps": 24, "maxSearchCalls": 24, "maxFetchCalls": 32, "contextTokenLimit": 16000 },
    "dispatchEvidence": { "enabled": true, "maxCycles": 20, "maxParallelAgents": 24, "contextTokenLimit": 24000, "maxOutputItems": 24 },
    "structureReview": { "enabled": true, "maxLlmCalls": 20, "maxOutputItems": 24, "contextTokenLimit": 12000 },
    "report": { "enabled": true, "maxLlmCalls": 20, "contextTokenLimit": 32000 }
  },
  "agents": {
    "evidence": { "maxReactSteps": 24, "maxToolCalls": 64, "maxSearchCalls": 24, "maxFetchCalls": 32, "outputRepairAttempts": 2, "allowToolEscalationRequest": false }
  },
  "tools": {
    "web_search": { "topK": 20, "timeoutMs": 10000, "retry": 2 },
    "fetch_page": { "timeoutMs": 15000, "retry": 1 },
    "arxiv_search": { "topK": 10, "timeoutMs": 15000, "retry": 1 }
  },
  "providers": {
    "default_llm": { "maxCostUsd": 5, "maxRequests": 1000, "timeoutMs": 60000 }
  }
}
```

### 5.2 配置合并规则

```
优先级（从高到低）：
1. CLI 显式参数（如 --maxToken 2048, --phase.dispatchEvidence.maxCycles 24）
2. benchmark adapter 输入（benchmark 框架提供的参数）
3. 全局配置文件（configs/runtime/default.json）

adapter 负责合并三层来源，生成完整的 RuntimeProfile。
orchestrator 只读取合并后的 RuntimeProfile，不再判断参数来源。
```

### 5.3 配置读取路径

```
configs/
  runtime/
    default.json          # 默认配置（必须存在）
    production.json       # 生产环境覆盖（可选）
    debug.json            # 调试环境覆盖（可选）

  合并规则：
  default.json -> production.json（覆盖） -> debug.json（覆盖） -> CLI 参数（覆盖）
```

---

## 6. 当前 v5 文件树

```text
deepresearch-framework/
  README.md                         # 项目入口、运行方式、包职责
  ARCHITECTURE.md                   # 当前实现架构概览
  docs/SPEC_V5.md                   # 本执行规格说明书
  package.json                      # workspace 脚本
  tsconfig.base.json                # 共享 TS 配置
  configs/
    runtime/
      default.json                  # 统一 RuntimeProfile 默认配置

  packages/
    contracts/
      src/
        context.ts                  # ResearchContext, RuntimeProfile, EpisodeResult
        knowledge.ts                # KnowledgeNode, EvidenceLink
        report.ts                   # ReportNode, ReportNodeStatus
        task.ts                     # TaskItem, TaskStatus
        agent.ts                    # AgentRunResult, ContextPacket, ToolDefinition
        workflow.ts                 # PhaseName, PhaseInput/Output
        patch.ts                    # StructurePatch, PatchDecision, PatchCritique
        providers.ts                # LLM/Tool provider contracts
        errors.ts                   # typed framework errors
        index.ts                    # 统一导出，不导出旧 alias
      package.json
      tsconfig.json

    orchestrator/
      src/
        cli.ts                      # 终端入口
        orchestrator.ts             # Orchestrator public class，串联 phase
        research-api.ts             # backend API: runResearch / streamResearch
        node-http.ts                # dependency-free HTTP/SSE handler
        sse.ts                      # SSE stream helpers
        run-state.ts                # Episode runtime state 初始化、序列化、恢复
        phase-runner.ts             # 统一 phase 执行、错误处理、trace 包装
        phases/
          parse.ts                  # 标准化 ResearchContext，组装 RuntimeProfile
          rubric.ts                 # 整理 GlobalRubric：rubricText + outputHints
          init-root.ts              # 创建 root ReportNode
          scout.ts                  # 主调度器 scout ReAct
          architect-tree.ts         # 建立 aspect/hypothesis report tree
          dispatch-evidence.ts      # 选择 runnable tasks，组装 ContextPacket，调用 subagent
          cycle-reflection.ts       # 本轮 worker result 汇总，产生下一轮任务
          structure-review.ts       # patch 提议、批判、决策、应用
          completion-gate.ts        # 判断是否可以进入写作
          report.ts                 # leaf-first 报告写作
          publish-gate.ts           # 终稿验收和 repair task 生成
        context-builder.ts          # v5 新增：从 task/kg/memory 显式组装 ContextPacket
        tools.ts                    # 当前 agent 可用工具定义
        trace.ts                    # summary/full trace 记录
        stream-renderer.ts          # CLI/SSE stream frame 渲染
        source-store.ts             # source save/reuse/link 逻辑
        source-quality.ts           # source policy and quality checks
        prompts.ts                  # phase prompts
        reporter.ts                 # deterministic reporter fallback
        infra/
          config.ts                 # 读取、合并、校验 RuntimeProfile
          ids.ts                    # deterministic id helpers
          json.ts                   # JSON parse/repair helpers
          ai.ts                     # LLM provider guards
        index.ts
      package.json
      tsconfig.json

    knowledge-graph/
      src/
        kg-service-base.ts          # common KG logic and ReportBundle builder
        impl/in-memory.ts           # in-memory implementation
        impl/sqlite.ts              # sqlite implementation
        factory.ts                  # service factories
        types.ts                    # validators and internal helpers
        index.ts
      package.json
      tsconfig.json

    task-ledger/
      src/
        common ledger implementation file
        _validate.ts                # TaskStatus 合法流转
        impl/in-memory.ts           # in-memory implementation
        impl/sqlite.ts              # sqlite implementation
        types.ts                    # validators and internal helpers
        index.ts
      package.json
      tsconfig.json

    memory-graph/
      src/
        memory-graph-impl.ts        # common event/trace store logic
        impl/in-memory.ts           # in-memory implementation
        impl/sqlite.ts              # sqlite implementation
        types.ts                    # internal helpers
        index.ts
      package.json
      tsconfig.json

    report-evaluator/
      src/
        reporter-base.ts            # deterministic ReportBundle -> Markdown fallback
        impl/in-memory.ts           # in-memory implementation
        impl/sqlite.ts              # sqlite implementation
        types.ts
        index.ts
      package.json
      tsconfig.json

    tool-providers/
      src/
        fetch-page.ts               # Jina reader / fetch provider
        user-file.ts                # user file provider
        index.ts
      package.json
      tsconfig.json

    embedding-providers/
      src/
        providers/                  # DeepSeek/OpenAI-compatible/Echo/FeatureHash providers
        internal/feature-hash.ts    # local embedding helpers
        index.ts
      package.json
      tsconfig.json

    benchmark-adapters/
      src/
        deepresearch-bench.ts       # benchmark adapter
        deepresearch-bench-ii.ts    # benchmark adapter
        runner.ts                   # 调用 orchestrator 并导出 artifact
        types.ts
        index.ts
      package.json
      tsconfig.json

    testing/
      src/
        fixtures.ts                 # 测试 fixture，只能被 tests import
        test-stack.ts               # 构造 in-memory stack
        index.ts
      package.json
      tsconfig.json

    calibration/
      src/
        collect.ts                  # 收集 run artifacts
        analyzer.ts                 # 分析指标
        actual-gain.ts              # 信息收益计算
        report.ts                   # calibration 报告
        types.ts
        index.ts
      package.json
      tsconfig.json
```

---

## 7. 关键设计决策记录

### 7.1 为什么删除 `scope` 和 `constraints` 字段？

v4 的 `ResearchContext` 包含 `scope`（timeRangeHint, outputHint, languageHint）和 `constraints`（uiCitationRequired, benchmarkPromptRaw）。这些字段的本质是"从用户输入中提取的提示信息"，但：
- 它们的信息已经包含在 `userInput` 或 `uiOptions` 中。
- 过早拆分会导致信息不同步（如用户输入和 scope 冲突）。
- `rubric` 阶段会重新整理这些信息，生成更准确的 `GlobalRubric`。

v5 的做法：删除这些字段，让 `rubric` 阶段从 `userInput` 和 `uiOptions` 中统一提取。`ResearchContext` 只保留 `expectedArtifacts`（系统级产物配置）。

### 7.2 为什么删除 `coverage.neutralCount`？

`neutralCount` 的语义是"既不支持也不反驳的证据数量"。但在实际研究中：
- "背景"证据（`relation="background"`）不贡献支持或反驳，但也不是"中立"——它只是提供上下文。
- 真正"中立"的证据很少，大多数证据要么支持、要么反驳、要么提供背景。
- 统计 `neutralCount` 增加了复杂度，但没有带来决策价值。

v5 的做法：删除 `neutralCount`。`coverage` 只关心三个维度：支持、反驳、缺口。

### 7.3 为什么删除 `retrievedByBranchId` 和 `createdByBranchId`？

`branchId` 和 `taskId` 在 v4 中是一对一关系（每个 task 对应一个 branch）。因此：
- `retrievedByBranchId` 的信息可以通过 `retrievedByTaskId` → `TaskItem.branchId` 推导。
- `createdByBranchId` 的信息可以通过 `createdByTaskId` → `TaskItem.branchId` 推导。
- 保留这些字段会导致数据冗余和不同步风险。

v5 的做法：删除这些字段。如果需要追溯 branch，通过 taskId 查询 TaskLedger。

### 7.4 为什么新增 `ContextPacket`？

v4 中给 agent 的 context 是隐式由 MemoryGraph 组装的，组装规则散落在 memory-context.ts 中。这导致：
- 不同 agent 看到的上下文不一致。
- 组装逻辑难以追踪和修改。
- 新开发者难以理解 agent 看到什么。

v5 的做法：新增 `ContextPacket` 类型，由 `ContextBuilder` 显式组装。在文档中详细说明每个字段的来源和组装规则。`MemoryGraph` 只存事件，不参与 context 组装。

### 7.5 为什么统一 `AgentRunResult`？

v4 中 scout 和 evidence agent 的输出格式不同（scout 输出 `ScoutSummary`，evidence agent 输出 `WorkerResult`）。这导致：
- phase runner 需要处理两种格式。
- 结构不一致，难以统一处理。

v5 的做法：统一为 `AgentRunResult`。scout 的 `ScoutSummary` 放到 `turnSummary.reasoningSummary` 中。所有 agent 都输出相同的 JSON schema，phase runner 统一处理。

---

## 8. 验收标准

### 源码层

- [ ] 没有 `ResourceNode`（已删除）。
- [ ] 没有 `AttachEdge`（已删除）。
- [ ] 没有 `attach()` 报告绑定 API（已删除）。
- [ ] 没有 `DraftBundle` 写入 KG（`DraftBundle` 只作为 reporter 内部中间格式）。
- [ ] 没有主流程 fixture fallback（已删除）。
- [ ] 旧单体 orchestrator 实现被拆除（拆成 phase 文件 + `orchestrator.ts` facade）。
- [ ] `structure-review` 只使用 `patch.ts` 中的 op。
- [ ] search/fetch/user-file 能力统一进入 `tool-providers`。
- [ ] `maxTokens/topK/retry/concurrency` 等参数不写死在业务代码里（从 `RuntimeProfile` 读取）。
- [ ] 没有 `scope.timeRangeHint/outputHint/languageHint`（已删除）。
- [ ] 没有 `constraints.uiCitationRequired/benchmarkPromptRaw`（已删除）。
- [ ] 没有 `coverage.neutralCount`（已删除）。
- [ ] 没有 `retrievedByBranchId` / `createdByBranchId`（已删除）。
- [ ] `ContextBuilder` 显式组装 `ContextPacket`（已新增）。
- [ ] `AgentRunResult` 统一所有 agent 输出（已统一）。

### 运行层

- [ ] 用户约束不被解析成独立字段；通过 `rubricText` 进入 scout、agent、report 和 publish-gate。
- [ ] 系统级工具权限、provider 安全限制、rate limit 独立执行，不混入用户 rubric。
- [ ] 每条最终引用都能回溯到 `KnowledgeNode`。
- [ ] 每个 report node 的状态能由 evidence coverage 解释。
- [ ] publish gate 不通过时能产生 repair task。
- [ ] trace 可以解释每个 evidence link 由哪个 task 创建。
- [ ] `ContextPacket` 的组装规则在文档中详细说明。
- [ ] `ReportBundle` 的组装规则在文档中详细说明。

### 文档层

- [ ] README 说明 v5 包职责和最小运行方式。
- [ ] `docs/SPEC_V5.md` 作为完整执行规格说明书。
- [ ] 旧探索文档不随项目发布，不再约束实现。
- [ ] 配置文档说明 `RuntimeProfile` 的合并规则。
- [ ] Agent prompt 模板在代码中可追踪（`prompts.ts`），与文档一致。

---

> 文档版本：v5.0
> 最后更新：2026-07-03
> 状态：当前 v5 实现参考
