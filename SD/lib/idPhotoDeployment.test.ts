import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('certificate photo deployment contract', () => {
  it('serves local WASM and model files with production MIME types and immutable caching', () => {
    const nginx = read('../../nginx.conf');
    expect(nginx).toMatch(/\\\.wasm\$/);
    expect(nginx).toContain('application/wasm');
    expect(nginx).toMatch(/\\\.tflite\$/);
    expect(nginx).toContain('application/octet-stream');
    expect(nginx.match(/max-age=2592000, immutable/g)).toHaveLength(2);
  });

  it('prepares local runtime assets and records their Apache-2.0 attribution', () => {
    const pkg = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };
    const notice = read('../THIRD_PARTY_NOTICES.md');
    expect(JSON.stringify(pkg.scripts)).toContain('prepare:mediapipe');
    expect(notice).toContain('Apache License, Version 2.0');
    expect(notice).toContain('selfie_multiclass_256x256.tflite');
    expect(notice).toContain('@mediapipe/tasks-vision@1.0.1');
  });

  it('keeps runtime code free from external model or CDN URLs', () => {
    const adapter = read('../components/tools/image/id-photo/segmentation.ts');
    const paths = read('../components/tools/image/id-photo/assetPaths.ts');
    expect(`${adapter}\n${paths}`).not.toMatch(/cdn\.jsdelivr\.net|storage\.googleapis\.com/);
  });
});
