const CORE_KEY = hexBytes('687a4852416d736f356b496e62617857');
const META_KEY = hexBytes('2331346c6a6b5f215c5d2630553c2728');

export interface NcmDecoded {
  audioData: Uint8Array;
  format: 'mp3' | 'flac' | 'ogg';
  metadata: Record<string, unknown>;
}

const SBOX = Uint8Array.from([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = (() => {
  const inverse = new Uint8Array(256);
  SBOX.forEach((value, index) => { inverse[value] = index; });
  return inverse;
})();

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function multiply(left: number, right: number): number {
  let result = 0;
  let a = left;
  let b = right;
  for (let index = 0; index < 8; index += 1) {
    if (b & 1) result ^= a;
    a = (a & 0x80) ? ((a << 1) ^ 0x11b) & 0xff : (a << 1) & 0xff;
    b >>>= 1;
  }
  return result;
}

function expandKey(key: Uint8Array): Uint8Array {
  const expanded = new Uint8Array(176);
  expanded.set(key.slice(0, 16));
  let generated = 16;
  let round = 1;
  const temp = new Uint8Array(4);

  while (generated < expanded.length) {
    temp.set(expanded.slice(generated - 4, generated));
    if (generated % 16 === 0) {
      const first = temp[0];
      temp[0] = SBOX[temp[1]] ^ RCON[round];
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[first];
      round += 1;
    }
    for (let index = 0; index < 4; index += 1) {
      expanded[generated] = expanded[generated - 16] ^ temp[index];
      generated += 1;
    }
  }
  return expanded;
}

function addRoundKey(state: Uint8Array, expanded: Uint8Array, offset: number): void {
  for (let index = 0; index < 16; index += 1) state[index] ^= expanded[offset + index];
}

function inverseSubBytes(state: Uint8Array): void {
  for (let index = 0; index < 16; index += 1) state[index] = INV_SBOX[state[index]];
}

function inverseShiftRows(state: Uint8Array): void {
  const original = state.slice();
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      state[column * 4 + row] = original[((column - row + 4) % 4) * 4 + row];
    }
  }
}

function inverseMixColumns(state: Uint8Array): void {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a0 = state[offset];
    const a1 = state[offset + 1];
    const a2 = state[offset + 2];
    const a3 = state[offset + 3];
    state[offset] = multiply(a0, 0x0e) ^ multiply(a1, 0x0b) ^ multiply(a2, 0x0d) ^ multiply(a3, 0x09);
    state[offset + 1] = multiply(a0, 0x09) ^ multiply(a1, 0x0e) ^ multiply(a2, 0x0b) ^ multiply(a3, 0x0d);
    state[offset + 2] = multiply(a0, 0x0d) ^ multiply(a1, 0x09) ^ multiply(a2, 0x0e) ^ multiply(a3, 0x0b);
    state[offset + 3] = multiply(a0, 0x0b) ^ multiply(a1, 0x0d) ^ multiply(a2, 0x09) ^ multiply(a3, 0x0e);
  }
}

function aesEcbDecrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (data.length % 16 !== 0) throw new Error('NCM AES 数据长度无效');
  const expanded = expandKey(key);
  const output = new Uint8Array(data.length);

  for (let offset = 0; offset < data.length; offset += 16) {
    const state = data.slice(offset, offset + 16);
    addRoundKey(state, expanded, 160);
    for (let round = 9; round > 0; round -= 1) {
      inverseShiftRows(state);
      inverseSubBytes(state);
      addRoundKey(state, expanded, round * 16);
      inverseMixColumns(state);
    }
    inverseShiftRows(state);
    inverseSubBytes(state);
    addRoundKey(state, expanded, 0);
    output.set(state, offset);
  }
  return output;
}

function removePadding(data: Uint8Array): Uint8Array {
  const padding = data[data.length - 1];
  if (!padding || padding > 16 || padding > data.length) throw new Error('NCM AES 填充无效');
  for (let index = data.length - padding; index < data.length; index += 1) {
    if (data[index] !== padding) throw new Error('NCM AES 填充无效');
  }
  return data.slice(0, data.length - padding);
}

function xorBytes(data: Uint8Array, value: number): Uint8Array {
  const result = data.slice();
  for (let index = 0; index < result.length; index += 1) result[index] ^= value;
  return result;
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) throw new Error('NCM 文件已损坏');
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '');
  const binary = globalThis.atob
    ? globalThis.atob(normalized)
    : (globalThis as typeof globalThis & { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer?.from(normalized, 'base64');
  if (!binary) throw new Error('NCM 元数据 Base64 解码失败');
  if (typeof binary === 'string') {
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  return new Uint8Array(binary);
}

function buildKeyBox(keyData: Uint8Array): Uint8Array {
  const box = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + box[index] + keyData[index % keyData.length]) & 0xff;
    [box[index], box[j]] = [box[j], box[index]];
  }
  return box;
}

function decryptAudio(data: Uint8Array, keyBox: Uint8Array): Uint8Array {
  const stream = new Uint8Array(256);
  for (let index = 0; index < stream.length; index += 1) {
    stream[index] = keyBox[(keyBox[index] + keyBox[(index + keyBox[index]) & 0xff]) & 0xff];
  }
  const output = data.slice();
  for (let index = 0; index < output.length; index += 1) {
    output[index] ^= stream[(index + 1) & 0xff];
  }
  return output;
}

function detectFormat(data: Uint8Array, metadata: Record<string, unknown>): 'mp3' | 'flac' | 'ogg' {
  const declared = String(metadata.format || '').toLowerCase();
  if (declared === 'flac' || declared === 'ogg' || declared === 'mp3') return declared;
  if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) return 'flac';
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67) return 'ogg';
  return 'mp3';
}

export async function decryptNcmData(data: Uint8Array): Promise<NcmDecoded> {
  const magic = new TextDecoder().decode(data.slice(0, 8));
  if (magic !== 'CTENFDAM') throw new Error('不是有效的 NCM 文件');

  let offset = 10;
  const keyLength = readUint32(data, offset);
  offset += 4;
  if (keyLength <= 0 || keyLength > data.length - offset) throw new Error('无效的 NCM 密钥长度');

  const encryptedKey = xorBytes(data.slice(offset, offset + keyLength), 0x64);
  offset += keyLength;
  const keyData = removePadding(aesEcbDecrypt(encryptedKey, CORE_KEY)).slice(17);
  if (keyData.length === 0) throw new Error('NCM 音频密钥为空');
  const keyBox = buildKeyBox(keyData);

  const metadataLength = readUint32(data, offset);
  offset += 4;
  let metadata: Record<string, unknown> = {};
  if (metadataLength > 0) {
    if (metadataLength > data.length - offset) throw new Error('NCM 元数据长度无效');
    const metadataBytes = xorBytes(data.slice(offset, offset + metadataLength), 0x63);
    offset += metadataLength;
    const encoded = new TextDecoder().decode(metadataBytes.slice(22));
    const decryptedMetadata = removePadding(aesEcbDecrypt(decodeBase64(encoded), META_KEY));
    const metadataText = new TextDecoder().decode(decryptedMetadata);
    const jsonStart = metadataText.indexOf('{');
    if (jsonStart >= 0) metadata = JSON.parse(metadataText.slice(jsonStart)) as Record<string, unknown>;
  }

  offset += 5;
  const imageSpace = readUint32(data, offset);
  offset += 4;
  const imageSize = readUint32(data, offset);
  offset += 4;
  if (imageSpace < imageSize || imageSpace > data.length - offset) throw new Error('NCM 封面数据长度无效');
  offset += imageSpace;
  if (offset > data.length) throw new Error('NCM 音频数据偏移无效');

  const audioData = decryptAudio(data.slice(offset), keyBox);
  return { audioData, format: detectFormat(audioData, metadata), metadata };
}
