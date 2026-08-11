import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXPECTED_WASM_FILES,
  copyMediaPipeAssets,
} from './copy-mediapipe-assets.mjs';

const temporaryRoots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'mediapipe-assets-'));
  temporaryRoots.push(root);
  return root;
}

async function populateSource(sourceDir: string) {
  await mkdir(sourceDir, { recursive: true });
  await Promise.all(
    EXPECTED_WASM_FILES.map((fileName) =>
      writeFile(join(sourceDir, fileName), `asset:${fileName}`, 'utf8'),
    ),
  );
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('copyMediaPipeAssets', () => {
  it('copies exactly the pinned runtime files', async () => {
    const root = await makeRoot();
    const sourceDir = join(root, 'source');
    const destinationDir = join(root, 'public', 'wasm');
    await populateSource(sourceDir);

    await copyMediaPipeAssets({ sourceDir, destinationDir });

    expect((await readdir(destinationDir)).sort()).toEqual([...EXPECTED_WASM_FILES].sort());
    expect(await readFile(join(destinationDir, EXPECTED_WASM_FILES[0]), 'utf8')).toBe(
      `asset:${EXPECTED_WASM_FILES[0]}`,
    );
  });

  it('rejects a missing runtime file without replacing the current destination', async () => {
    const root = await makeRoot();
    const sourceDir = join(root, 'source');
    const destinationDir = join(root, 'public', 'wasm');
    await populateSource(sourceDir);
    await rm(join(sourceDir, EXPECTED_WASM_FILES[0]));
    await mkdir(destinationDir, { recursive: true });
    await writeFile(join(destinationDir, 'keep.txt'), 'current', 'utf8');

    await expect(copyMediaPipeAssets({ sourceDir, destinationDir })).rejects.toThrow(
      EXPECTED_WASM_FILES[0],
    );
    expect(await readdir(destinationDir)).toEqual(['keep.txt']);
  });

  it('rejects unexpected files without leaving a partial destination', async () => {
    const root = await makeRoot();
    const sourceDir = join(root, 'source');
    const destinationDir = join(root, 'public', 'wasm');
    await populateSource(sourceDir);
    await writeFile(join(sourceDir, 'unexpected.js'), 'unexpected', 'utf8');

    await expect(copyMediaPipeAssets({ sourceDir, destinationDir })).rejects.toThrow('unexpected.js');
    await expect(readdir(destinationDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
