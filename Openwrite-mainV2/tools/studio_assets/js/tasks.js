import { $, api, showToast, state } from "./core.js";

const watchers = new Map();
let refreshWorkspace = async () => {};
let openTaskResult = async () => {};
let onTasksUpdated = async () => {};
let pollTimer = null;
let refreshing = false;
let clearingFailedTasks = false;
let failedTaskCount = 0;

export function bindTaskCenter(callbacks = {}) {
  refreshWorkspace = callbacks.refreshWorkspace || refreshWorkspace;
  openTaskResult = callbacks.openTaskResult || openTaskResult;
  onTasksUpdated = callbacks.onTasksUpdated || onTasksUpdated;
  $("#task-center-open").addEventListener("click", openTaskCenter);
  $("#task-center-close").addEventListener("click", () => $("#task-center-dialog").close());
  $("#task-detail-close").addEventListener("click", () => $("#task-detail-dialog").close());
  $("#task-refresh").addEventListener("click", refreshTasks);
  $("#task-clear-failed").addEventListener("click", clearFailedTasks);
  $("#controlled-write-open").addEventListener("click", () => {
    $("#task-center-dialog").close();
    $("#controlled-write-dialog").showModal();
  });
  $("#controlled-write-close").addEventListener("click", () => $("#controlled-write-dialog").close());
  $("#controlled-write-cancel").addEventListener("click", () => $("#controlled-write-dialog").close());
  $("#controlled-write-form").addEventListener("submit", submitControlledWrite);
  if (!pollTimer) pollTimer = window.setInterval(refreshTasks, 2500);
}

export async function enqueueTask(type, input, options = {}) {
  const payload = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ type, input }),
  });
  const task = payload.data;
  if (typeof options.onComplete === "function") {
    watchers.set(task.task_id, options.onComplete);
  }
  showToast(options.label || "任务已加入队列");
  await refreshTasks();
  if (options.open !== false) openTaskCenter();
  return task;
}

export function openTaskCenter() {
  const dialog = $("#task-center-dialog");
  if (!dialog.open) dialog.showModal();
  refreshTasks();
}

export async function refreshTasks() {
  if (refreshing || !state.workspace?.initialized) return;
  refreshing = true;
  try {
    const payload = await api("/api/tasks?limit=100");
    const surface = payload.data;
    state.tasks = surface.tasks || [];
    renderTaskBadge(surface.counts || {});
    renderTaskList(state.tasks);
    await dispatchWatchers(state.tasks);
    await onTasksUpdated(state.tasks);
  } catch (error) {
    if ($("#task-center-dialog")?.open) $("#task-list").textContent = error.message;
  } finally {
    refreshing = false;
  }
}

async function dispatchWatchers(tasks) {
  for (const task of tasks) {
    const callback = watchers.get(task.task_id);
    if (!callback || !["completed", "failed", "cancelled", "interrupted"].includes(task.status)) continue;
    watchers.delete(task.task_id);
    if (task.status === "completed") {
      await callback(task);
    } else if (task.status === "failed") {
      showToast(task.error?.message || "任务执行失败", true);
    }
  }
}

function renderTaskBadge(counts) {
  const active = Number(counts.pending || 0) + Number(counts.running || 0) + Number(counts.awaiting_confirmation || 0);
  const failed = Number(counts.failed || 0);
  failedTaskCount = Number.isFinite(failed) ? Math.max(0, Math.floor(failed)) : 0;
  $("#task-active-count").textContent = String(active);
  $("#task-center-open").classList.toggle("active", active > 0);
  $("#task-center-open").setAttribute("aria-label", active ? `任务中心，${active} 个活动任务` : "任务中心");
  syncClearFailedButton();
}

function syncClearFailedButton() {
  const button = $("#task-clear-failed");
  button.disabled = clearingFailedTasks || failedTaskCount === 0;
  button.title = failedTaskCount ? `清除 ${failedTaskCount} 个失败任务` : "没有失败任务";
}

async function clearFailedTasks() {
  if (clearingFailedTasks || failedTaskCount === 0) return;
  if (!window.confirm(`确定清除 ${failedTaskCount} 个失败任务吗？此操作只删除任务历史。`)) return;

  clearingFailedTasks = true;
  syncClearFailedButton();
  try {
    const payload = await api("/api/tasks/clear-failed", {
      method: "POST",
      body: "{}",
    });
    const deletedCount = Number(payload.data?.deleted_count || 0);
    showToast(deletedCount ? `已清除 ${deletedCount} 个失败任务` : "没有可清除的失败任务");
    await refreshTasks();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    clearingFailedTasks = false;
    syncClearFailedButton();
  }
}

function renderTaskList(tasks) {
  const root = $("#task-list");
  root.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有后台任务。";
    root.append(empty);
    return;
  }
  const order = ["running", "pending", "awaiting_confirmation", "failed", "interrupted", "completed", "cancelled"];
  order.forEach((status) => {
    const group = tasks.filter((task) => task.status === status);
    if (!group.length) return;
    const heading = document.createElement("h3");
    heading.className = "task-group-title";
    heading.textContent = `${statusLabel(status)} · ${group.length}`;
    root.append(heading);
    group.forEach((task) => root.append(buildTaskRow(task)));
  });
}

function buildTaskRow(task) {
  const row = document.createElement("article");
  row.className = `task-row status-${task.status}`;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "task-row-copy";
  const title = document.createElement("strong");
  title.textContent = task.input_summary || taskTypeLabel(task.type);
  const meta = document.createElement("span");
  meta.textContent = `${phaseLabel(task.phase)} · ${durationLabel(task)}`;
  const error = document.createElement("small");
  error.textContent = task.error?.message || resultSummary(task);
  error.hidden = !error.textContent;
  copy.append(title, meta, error);
  copy.addEventListener("click", () => showTaskDetail(task));
  const actions = document.createElement("div");
  actions.className = "task-row-actions";
  if (["pending", "running", "awaiting_confirmation"].includes(task.status)) {
    actions.append(taskActionButton("取消", () => taskAction(task, "cancel")));
  }
  if (["failed", "cancelled", "interrupted"].includes(task.status) && task.retryable) {
    actions.append(taskActionButton("重试", () => taskAction(task, "retry")));
  }
  if (task.status === "awaiting_confirmation") {
    actions.append(taskActionButton("继续", () => taskAction(task, "confirm"), true));
  }
  if (["completed", "awaiting_confirmation"].includes(task.status) && Object.keys(task.result || {}).length) {
    actions.append(taskActionButton("结果", () => openTaskResult(task)));
  }
  row.append(copy, actions);
  return row;
}

function taskActionButton(label, handler, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "primary-button" : "quiet-button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function taskAction(task, action) {
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(task.task_id)}/${action}`, {
      method: "POST",
      body: "{}",
    });
    const next = payload.data;
    if (action === "retry" || action === "confirm") showToast("任务已重新加入队列");
    else showToast(next.status === "cancelled" ? "任务已取消" : "已请求取消任务");
    await refreshTasks();
    await refreshWorkspace();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function showTaskDetail(task) {
  const title = $("#task-detail-title");
  const meta = $("#task-detail-meta");
  const eventsRoot = $("#task-detail-events");
  title.textContent = task.input_summary || taskTypeLabel(task.type);
  meta.textContent = `${statusLabel(task.status)} · ${task.task_id}`;
  eventsRoot.textContent = "正在读取活动记录…";
  if ($("#task-center-dialog").open) $("#task-center-dialog").close();
  $("#task-detail-dialog").showModal();
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(task.task_id)}`);
    eventsRoot.replaceChildren();
    (payload.data.events || []).forEach((event) => {
      const item = document.createElement("li");
      const phase = document.createElement("strong");
      phase.textContent = phaseLabel(event.phase);
      const note = document.createElement("span");
      note.textContent = event.details?.note || eventLabel(event.event);
      item.append(phase, note);
      eventsRoot.append(item);
    });
  } catch (error) {
    eventsRoot.textContent = error.message;
  }
}

async function submitControlledWrite(event) {
  event.preventDefault();
  const button = $("#controlled-write-submit");
  button.disabled = true;
  try {
    await enqueueTask(
      "continuous_write",
      {
        max_chapters: Number($("#controlled-write-count").value),
        minimum_review_score: Number($("#controlled-write-score").value),
        target_words: Number($("#controlled-write-words").value || 0),
        max_tokens: Number($("#controlled-write-tokens").value || 0),
        max_cost_usd: Number($("#controlled-write-cost").value || 0),
        max_failures: Number($("#controlled-write-failures").value || 2),
        stop_on_blocker: $("#controlled-stop-blocker").checked,
        stop_on_continuity_error: $("#controlled-stop-continuity").checked,
        stop_on_outline_gap: true,
        require_confirmation_after_each_chapter: $("#controlled-confirm-each").checked,
      },
      { label: "连续写作任务已加入队列", open: false },
    );
    $("#controlled-write-dialog").close();
    openTaskCenter();
  } catch (error) {
    $("#controlled-write-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function resultSummary(task) {
  const result = task.result || {};
  if (result.score !== undefined) return `审稿 ${Math.round(Number(result.score))} 分`;
  if (result.proposal_id) return "修订提案已生成";
  if (result.report_id) return "研究报告已归档";
  if (result.chapter_id) return `${result.chapter_id} 已完成`;
  if (result.completed_chapters) return `已推进 ${result.completed_chapters.length} 章`;
  return "";
}

function durationLabel(task) {
  const start = Date.parse(task.started_at || task.created_at || "");
  const end = Date.parse(task.completed_at || "") || Date.now();
  if (!Number.isFinite(start)) return "刚刚";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function taskTypeLabel(type) {
  return {
    chapter_write: "章节写作", chapter_review: "章节审稿",
    revision_selection: "局部修订", revision_from_review: "审稿问题修订",
    source_operation: "来源处理", manuscript_import: "旧稿导入",
    continuous_write: "受控连续写作", research: "深度研究",
  }[type] || type;
}

function statusLabel(status) {
  return {
    pending: "等待中", running: "正在运行", awaiting_confirmation: "需要确认",
    completed: "最近完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
  }[status] || status;
}

function phaseLabel(phase) {
  return {
    queued: "排队", reading: "读取", preparing: "准备", model: "模型处理",
    validating: "校验", committing: "提交", complete: "完成",
  }[phase] || phase;
}

function eventLabel(event) {
  return {
    task_created: "任务已创建", task_started: "开始执行",
    task_completed: "任务完成", task_failed: "任务失败",
    task_cancel_requested: "收到取消请求", task_cancelled: "任务已取消",
    task_interrupted: "进程中断", task_awaiting_confirmation: "等待用户确认",
  }[event] || "阶段更新";
}
