export type ToolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
