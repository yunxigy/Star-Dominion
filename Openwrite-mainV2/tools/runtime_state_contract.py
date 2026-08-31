"""Prompt contract for chapter settlement runtime deltas."""

RUNTIME_DELTA_PROMPT_CONTRACT = """## runtime-delta-v1 精确契约

`state_delta.operations` 只允许以下 value 结构；字段名不得替换，不得把同一个通用对象用于多个集合：

- `current_state` / `ledger` / `relationships`: value 是只含本章新增事实的字符串。
- `characters`:
  `{name: "角色名", state: "当前状态", location: "当前位置", knowledge: ["已知事实"]}`
- `resources`: `{name: "资源名", owner: "持有者", status: "当前状态", quantity: 1}`
- `relationship_states`:
  `{source: "角色A", target: "角色B", status: "当前关系", tension: "未决张力"}`
- `open_threads`: `{title: "未决问题", status: open, detail: "本章新增事实"}`；
  status 只能是 open/resolved。
- `foreshadowing_refs`: `{title: "伏笔名", status: planted, reference: "正文证据"}`；
  status 只能是 planted/advanced/resolved。
- `proposed_entities`:
  `{name: "新实体名", entity_type: character, reason: "为何需要确认"}`；
  entity_type 只能是 character/place/organization/item/unknown。
- `timeline`:
  `{id: "event_ch_001_01", chapter_id: "ch_001", event: "客观事件", story_time: "故事内时间"}`。

对象可省略有默认值的非关键字段，但不能增加 schema 外字段。未知角色或设定只能写入
`proposed_entities`，不能直接污染 canonical 状态。每次输出 `state_delta` 时，还必须输出至少一个
`state_updates.current_state/ledger/relationships` 字符串，作为结构化操作无法应用时的
追加式安全回退；
回退内容只能追加本章新增事实，绝不能重写整份真相文件。"""
