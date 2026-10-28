import { ToolResult } from './result';

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): ToolResult<string> {
  try {
    return { ok: true, value: decodeURIComponent(input) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'URL 解码失败';
    return { ok: false, error: message };
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Encode(input: string): number[] {
  const bytes: number[] = [];
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function utf8Decode(bytes: number[]): ToolResult<string> {
  let output = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    let codePoint: number;
    let width: number;

    if (first <= 0x7f) {
      codePoint = first;
      width = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      width = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      width = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      width = 4;
    } else {
      return { ok: false, error: 'Base64 内容不是有效的 UTF-8 文本' };
    }

    if (index + width > bytes.length) {
      return { ok: false, error: 'Base64 内容不是有效的 UTF-8 文本' };
    }
    for (let offset = 1; offset < width; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) {
        return { ok: false, error: 'Base64 内容不是有效的 UTF-8 文本' };
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (
      (width === 2 && codePoint < 0x80) ||
      (width === 3 && codePoint < 0x800) ||
      (width === 4 && codePoint < 0x10000) ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return { ok: false, error: 'Base64 内容不是有效的 UTF-8 文本' };
    }

    output += String.fromCodePoint(codePoint);
    index += width;
  }
  return { ok: true, value: output };
}

function encodeBase64Bytes(bytes: readonly number[]): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const hasSecond = second !== undefined;
    const hasThird = third !== undefined;
    const firstValue = first >> 2;
    const secondValue = ((first & 0x03) << 4) | (hasSecond ? second >> 4 : 0);
    const thirdValue = hasSecond ? (((second & 0x0f) << 2) | (hasThird ? third >> 6 : 0)) : 64;
    const fourthValue = hasThird ? third & 0x3f : 64;

    output += BASE64_ALPHABET[firstValue];
    output += BASE64_ALPHABET[secondValue];
    output += thirdValue === 64 ? '=' : BASE64_ALPHABET[thirdValue];
    output += fourthValue === 64 ? '=' : BASE64_ALPHABET[fourthValue];
  }
  return output;
}

export function base64Encode(input: string): string {
  return encodeBase64Bytes(utf8Encode(input));
}

export function base64EncodeBytes(input: Uint8Array): string {
  return encodeBase64Bytes(Array.from(input));
}

function base64Value(character: string): number {
  return BASE64_ALPHABET.indexOf(character);
}

export function base64Decode(input: string): ToolResult<string> {
  const compact = input.replace(/\s/g, '');
  if (!compact) return { ok: true, value: '' };
  if (
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    return { ok: false, error: 'Base64 格式无效' };
  }

  const bytes: number[] = [];
  for (let index = 0; index < compact.length; index += 4) {
    const first = base64Value(compact[index]);
    const second = base64Value(compact[index + 1]);
    const thirdCharacter = compact[index + 2];
    const fourthCharacter = compact[index + 3];
    const third = thirdCharacter === '=' ? 0 : base64Value(thirdCharacter);
    const fourth = fourthCharacter === '=' ? 0 : base64Value(fourthCharacter);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      return { ok: false, error: 'Base64 格式无效' };
    }
    if (thirdCharacter === '=' && fourthCharacter !== '=') {
      return { ok: false, error: 'Base64 格式无效' };
    }

    bytes.push((first << 2) | (second >> 4));
    if (thirdCharacter !== '=') bytes.push(((second & 0x0f) << 4) | (third >> 2));
    if (fourthCharacter !== '=') bytes.push(((third & 0x03) << 6) | fourth);
  }

  return utf8Decode(bytes);
}
