import { describe, expect, it } from 'vitest';

import { decryptNcmData } from './ncm';

describe('NCM decoder', () => {
  it('rejects truncated files with a valid NCM header', async () => {
    const source = new Uint8Array(14);
    source.set(new TextEncoder().encode('CTENFDAM'));

    await expect(decryptNcmData(source)).rejects.toThrow('NCM');
  });

  it('rejects files that do not have the NCM magic header', async () => {
    await expect(decryptNcmData(new Uint8Array([1, 2, 3]))).rejects.toThrow('不是有效的 NCM 文件');
  });
});
