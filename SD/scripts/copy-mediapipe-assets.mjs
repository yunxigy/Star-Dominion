import { access, cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXPECTED_WASM_FILES = Object.freeze([
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]);

async function validateDirectory(directory) {
  const actual = (await readdir(directory)).sort();
  const expected = [...EXPECTED_WASM_FILES].sort();
  const missing = expected.filter((fileName) => !actual.includes(fileName));
  const unexpected = actual.filter((fileName) => !expected.includes(fileName));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Invalid MediaPipe WASM assets (${details})`);
  }
  await Promise.all(expected.map((fileName) => access(join(directory, fileName))));
}

export async function copyMediaPipeAssets({ sourceDir, destinationDir }) {
  await validateDirectory(sourceDir);
  await mkdir(dirname(destinationDir), { recursive: true });

  const suffix = `${process.pid}-${Date.now()}`;
  const temporaryDir = `${destinationDir}.tmp-${suffix}`;
  const backupDir = `${destinationDir}.bak-${suffix}`;
  let hasBackup = false;

  try {
    await mkdir(temporaryDir, { recursive: true });
    await Promise.all(
      EXPECTED_WASM_FILES.map((fileName) =>
        cp(join(sourceDir, fileName), join(temporaryDir, fileName)),
      ),
    );
    await validateDirectory(temporaryDir);

    try {
      await rename(destinationDir, backupDir);
      hasBackup = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await rename(temporaryDir, destinationDir);
    if (hasBackup) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    if (hasBackup) {
      await rm(destinationDir, { recursive: true, force: true });
      await rename(backupDir, destinationDir);
    }
    throw error;
  }
}

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await copyMediaPipeAssets({
    sourceDir: join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
    destinationDir: join(projectRoot, 'public', 'vendor', 'mediapipe', 'wasm'),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
