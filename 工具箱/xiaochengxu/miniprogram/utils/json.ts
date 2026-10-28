import { ToolResult } from './result';

function parseJson(input: string): ToolResult<unknown> {
  if (!input.trim()) return { ok: false, error: '请输入 JSON 内容' };

  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    return { ok: false, error: message };
  }
}

export function formatJson(input: string, indent = 2): ToolResult<string> {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value, null, indent) };
}

export function minifyJson(input: string): ToolResult<string> {
  const parsed = parseJson(input);
  if (!parsed.ok) return parsed;
  return { ok: true, value: JSON.stringify(parsed.value) };
}

export interface JsonValidation {
  valid: boolean;
  message: string;
  error?: string;
}

export function validateJson(input: string): JsonValidation {
  const parsed = parseJson(input);
  if (parsed.ok) return { valid: true, message: 'JSON 格式有效' };
  return { valid: false, message: 'JSON 格式无效', error: parsed.error };
}
