# Self-Hosted AI Certificate Photo Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken target-color HSL detector with a fully self-hosted MediaPipe portrait segmenter, deterministic mask editor, and shared preview/export compositor.

**Architecture:** Keep ML inference behind a small adapter and move mask refinement, manual overrides, and compositing into pure typed-array functions. Vite serves a pinned Apache-2.0 model and locally copied WASM assets; the React tool loads them lazily and never uploads the source photo.

**Tech Stack:** React 18, TypeScript, Vite 5, Vitest, Canvas 2D, `@mediapipe/tasks-vision@1.0.1`, MediaPipe SelfieMulticlass 256x256, Nginx.

---

## Clean-room, privacy, and deployment constraints

- Do not use the existing HSL detector as a fallback.
- Do not copy AGPL code, tests, UI text, or assets.
- Do not send image bytes, masks, or metadata to any backend or external origin.
- Runtime model and WASM requests must resolve below `import.meta.env.BASE_URL`.
- Pin the model URL, byte length `16371837`, and SHA-256 `C6748B1253A99067EF71F7E26CA71096CD449BAEFA8F101900EA23016507E0E0`.
- Keep generated `public/vendor/mediapipe/wasm/` artifacts out of Git; build them from the pinned npm package. Commit the pinned `.tflite` model and its license notice.
- Work only in `E:\AI\gp-main-integration` on `codex/id-photo-background-ai`; do not stage the unrelated dirty worktree under `E:\AI\gp`.

## File map

- Create `SD/components/tools/image/id-photo/types.ts`: shared immutable mask, background, export, and editor types.
- Create `SD/components/tools/image/id-photo/assetPaths.ts`: base-aware local WASM/model URLs.
- Create `SD/components/tools/image/id-photo/mask.ts`: alpha generation, feathering, override painting, undo state.
- Create `SD/components/tools/image/id-photo/composite.ts`: solid/gradient compositing and edge decontamination.
- Create `SD/components/tools/image/id-photo/segmentation.ts`: lazy MediaPipe adapter and mask resource cleanup.
- Create `SD/components/tools/image/id-photo/MaskEditorCanvas.tsx`: pointer-based erase/restore overlay.
- Rewrite `SD/components/tools/image/IdPhotoBgColor.tsx`: accessible upload, inference, refine, preview, and export workflow.
- Create colocated `*.test.ts` and `*.test.tsx` files for each pure boundary and component contract.
- Create `SD/scripts/copy-mediapipe-assets.mjs`: copy exactly six package WASM runtime files into `public`.
- Create `SD/scripts/copy-mediapipe-assets.test.ts`: real temporary-directory copy and validation tests.
- Modify `SD/package.json` and `SD/package-lock.json`: pinned dependency and predev/prebuild asset preparation.
- Create `SD/public/vendor/mediapipe/models/selfie_multiclass_256x256.tflite`: pinned official model.
- Create `SD/THIRD_PARTY_NOTICES.md`: MediaPipe runtime and model attribution.
- Modify `SD/tools/registry.tsx`: mark the tool local/private and update its description.
- Modify `nginx.conf`: correct MIME and immutable caching for `.wasm` and `.tflite`.
- Modify `SD/README.md`: document local processing, model size, deployment, and limitations.

### Task 1: Local MediaPipe assets and base-aware URLs

**Files:**
- Create: `SD/components/tools/image/id-photo/assetPaths.ts`
- Test: `SD/components/tools/image/id-photo/assetPaths.test.ts`
- Create: `SD/scripts/copy-mediapipe-assets.mjs`
- Test: `SD/scripts/copy-mediapipe-assets.test.ts`
- Modify: `SD/package.json`
- Modify: `SD/package-lock.json`
- Create: `SD/public/vendor/mediapipe/models/selfie_multiclass_256x256.tflite`

- [x] **Step 1: Write failing asset URL and copy tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildMediaPipeAssetPaths } from './assetPaths';

describe('buildMediaPipeAssetPaths', () => {
  it('keeps model and wasm on the deployed origin below the Vite base', () => {
    expect(buildMediaPipeAssetPaths('/')).toEqual({
      wasmRoot: '/vendor/mediapipe/wasm',
      modelUrl: '/vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
    });
    expect(buildMediaPipeAssetPaths('/stock/').modelUrl).toBe(
      '/stock/vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
    );
  });
});
```

The copy-script test must create temporary source/destination directories, write the six expected runtime filenames, call `copyMediaPipeAssets`, and assert that an unexpected or missing filename rejects without leaving a partial destination.

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/id-photo/assetPaths.test.ts scripts/copy-mediapipe-assets.test.ts`

Expected: FAIL because both modules are missing.

- [x] **Step 3: Implement normalized URLs and atomic asset copy**

```ts
const normalizeBase = (base: string) => {
  const segments = base.split('/').filter(Boolean);
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
};

export function buildMediaPipeAssetPaths(base: string) {
  const normalized = normalizeBase(base);
  return {
    wasmRoot: `${normalized}/vendor/mediapipe/wasm`,
    modelUrl: `${normalized}/vendor/mediapipe/models/selfie_multiclass_256x256.tflite`,
  };
}
```

`copy-mediapipe-assets.mjs` must export `EXPECTED_WASM_FILES` and `copyMediaPipeAssets({ sourceDir, destinationDir })`. Copy into a sibling temporary directory, verify all six files, then rename it over the destination. The expected files are:

```js
export const EXPECTED_WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
```

Install exactly `@mediapipe/tasks-vision@1.0.1`. Add `prepare:mediapipe`, `predev`, and `prebuild` scripts. Download the official model URL from the approved design, then verify its byte length and SHA-256 before placing it under `public/vendor/mediapipe/models`.

- [x] **Step 4: Run GREEN and asset verification**

Run:

```powershell
npm.cmd test -- components/tools/image/id-photo/assetPaths.test.ts scripts/copy-mediapipe-assets.test.ts
npm.cmd run prepare:mediapipe
Get-FileHash public/vendor/mediapipe/models/selfie_multiclass_256x256.tflite -Algorithm SHA256
```

Expected: tests PASS; all six WASM runtime files exist; model hash equals the pinned uppercase SHA-256.

- [x] **Step 5: Commit**

```powershell
git add -- SD/package.json SD/package-lock.json SD/scripts/copy-mediapipe-assets.mjs SD/scripts/copy-mediapipe-assets.test.ts SD/components/tools/image/id-photo/assetPaths.ts SD/components/tools/image/id-photo/assetPaths.test.ts SD/public/vendor/mediapipe/models/selfie_multiclass_256x256.tflite
git commit -m "build(image): self-host portrait segmentation assets"
```

### Task 2: Deterministic alpha-mask refinement

**Files:**
- Create: `SD/components/tools/image/id-photo/types.ts`
- Create: `SD/components/tools/image/id-photo/mask.ts`
- Test: `SD/components/tools/image/id-photo/mask.test.ts`

- [x] **Step 1: Write failing mask behavior tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPersonAlpha } from './mask';

describe('buildPersonAlpha', () => {
  it('derives foreground from model confidence, never from output color', () => {
    const background = new Float32Array([0.95, 0.1]);
    expect(Array.from(buildPersonAlpha({
      backgroundConfidence: background,
      width: 2,
      height: 1,
      threshold: 0.5,
      featherRadius: 0,
    }))).toEqual([0, 1]);
  });

  it('changes edge alpha when threshold and feather controls change', () => {
    const background = new Float32Array([0.9, 0.55, 0.2]);
    const sharp = buildPersonAlpha({ backgroundConfidence: background, width: 3, height: 1, threshold: 0.5, featherRadius: 0 });
    const soft = buildPersonAlpha({ backgroundConfidence: background, width: 3, height: 1, threshold: 0.65, featherRadius: 1 });
    expect(Array.from(soft)).not.toEqual(Array.from(sharp));
    expect(soft[1]).toBeGreaterThan(0);
    expect(soft[1]).toBeLessThan(1);
  });
});
```

Add tests for dimension mismatch, threshold clamping, zero-radius identity, and blur preserving a constant mask.

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/id-photo/mask.test.ts`

Expected: FAIL because `buildPersonAlpha` is missing.

- [x] **Step 3: Implement pure typed-array refinement**

Define:

```ts
export interface SegmentationSnapshot {
  width: number;
  height: number;
  backgroundConfidence: Float32Array;
}

export interface MaskControls {
  threshold: number;
  featherRadius: number;
}
```

Implement `smoothstep`, a bounded separable box blur, and `buildPersonAlpha`. Validate `width * height`, clamp all outputs to `[0, 1]`, and never accept a target background color in this API.

- [x] **Step 4: Run GREEN and full mask tests**

Run: `npm.cmd test -- components/tools/image/id-photo/mask.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add -- SD/components/tools/image/id-photo/types.ts SD/components/tools/image/id-photo/mask.ts SD/components/tools/image/id-photo/mask.test.ts
git commit -m "feat(image): refine portrait alpha masks"
```

### Task 3: Erase, restore, reset, and undo mask edits

**Files:**
- Modify: `SD/components/tools/image/id-photo/types.ts`
- Modify: `SD/components/tools/image/id-photo/mask.ts`
- Modify: `SD/components/tools/image/id-photo/mask.test.ts`

- [x] **Step 1: Write failing manual correction tests**

```ts
it('applies erase and restore strokes independently of automatic controls', () => {
  const empty = new Int8Array(25);
  const erased = paintOverride(empty, 5, 5, { x: 2, y: 2, radius: 1, mode: 'erase' });
  const restored = paintOverride(erased, 5, 5, { x: 4, y: 4, radius: 1, mode: 'restore' });
  const alpha = applyOverrides(new Float32Array(25).fill(0.5), restored);
  expect(alpha[12]).toBe(0);
  expect(alpha[24]).toBe(1);
});

it('undo returns the exact previous override snapshot', () => {
  const previous = new Int8Array([0, -1, 0]);
  const history = pushMaskHistory([], previous, 20);
  expect(undoMaskHistory(history)).toEqual({ mask: previous, history: [] });
});
```

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/id-photo/mask.test.ts`

Expected: FAIL because manual override functions are missing.

- [x] **Step 3: Implement immutable override helpers**

Use `-1` for erase, `0` for automatic, and `1` for restore. `paintOverride` must clone its input, rasterize a clipped circular brush, and return the clone. `applyOverrides` must clone alpha. History is capped at 20 snapshots and never stores the large source image.

- [x] **Step 4: Run GREEN**

Run: `npm.cmd test -- components/tools/image/id-photo/mask.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add -- SD/components/tools/image/id-photo/types.ts SD/components/tools/image/id-photo/mask.ts SD/components/tools/image/id-photo/mask.test.ts
git commit -m "feat(image): edit and undo portrait masks"
```

### Task 4: Shared full-resolution compositor

**Files:**
- Modify: `SD/components/tools/image/id-photo/types.ts`
- Create: `SD/components/tools/image/id-photo/composite.ts`
- Test: `SD/components/tools/image/id-photo/composite.test.ts`

- [x] **Step 1: Write failing solid, gradient, and edge tests**

```ts
it('preserves blue clothing when the model alpha marks it as foreground', () => {
  const source = new Uint8ClampedArray([20, 80, 200, 255]);
  const result = compositeRgba({
    source,
    alpha: new Float32Array([1]),
    width: 1,
    height: 1,
    background: { kind: 'solid', color: [208, 48, 48] },
  });
  expect(Array.from(result)).toEqual([20, 80, 200, 255]);
});

it('uses one alpha blend for transparent and edge pixels', () => {
  const source = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]);
  const result = compositeRgba({
    source,
    alpha: new Float32Array([0, 0.5]),
    width: 2,
    height: 1,
    background: { kind: 'solid', color: [255, 255, 255] },
  });
  expect(Array.from(result.slice(0, 4))).toEqual([255, 255, 255, 255]);
  expect(Array.from(result.slice(4, 8))).toEqual([178, 178, 178, 255]);
});
```

Add a deterministic vertical gradient test and a partial-alpha decontamination test using an estimated original background color.

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/id-photo/composite.test.ts`

Expected: FAIL because `compositeRgba` is missing.

- [x] **Step 3: Implement one compositor for preview and export**

```ts
export type PhotoBackground =
  | { kind: 'solid'; color: readonly [number, number, number] }
  | { kind: 'vertical-gradient'; top: readonly [number, number, number]; bottom: readonly [number, number, number] };
```

Validate RGBA and alpha lengths. Compute background color per output row, combine source alpha with mask alpha, and return an opaque `Uint8ClampedArray`. Apply spill reduction only when `0 < alpha < 1`; do not recolor fully opaque clothing or skin.

- [x] **Step 4: Run GREEN**

Run: `npm.cmd test -- components/tools/image/id-photo/composite.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add -- SD/components/tools/image/id-photo/types.ts SD/components/tools/image/id-photo/composite.ts SD/components/tools/image/id-photo/composite.test.ts
git commit -m "feat(image): composite certificate photo backgrounds"
```

### Task 5: Lazy MediaPipe segmentation adapter

**Files:**
- Create: `SD/components/tools/image/id-photo/segmentation.ts`
- Test: `SD/components/tools/image/id-photo/segmentation.test.ts`

- [x] **Step 1: Write failing adapter tests with a narrow injected port**

```ts
it('copies the background mask and closes every MediaPipe mask', async () => {
  const closeCalls = [0, 0, 0, 0, 0, 0];
  const masks = closeCalls.map((_, index) => ({
    width: 2,
    height: 1,
    getAsFloat32Array: () => new Float32Array(index === 0 ? [0.9, 0.1] : [0.02, 0.18]),
    close: () => { closeCalls[index] += 1; },
  }));
  const snapshot = await segmentPortrait('image' as never, async () => ({
    segment: () => ({ confidenceMasks: masks }),
  }));
  expect(Array.from(snapshot.backgroundConfidence)).toEqual([0.9, 0.1]);
  expect(closeCalls).toEqual([1, 1, 1, 1, 1, 1]);
});
```

Add tests for mask count not equal to six, inconsistent dimensions, no confident foreground, initialization promise reuse, and failed initialization clearing the cache for retry.

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/id-photo/segmentation.test.ts`

Expected: FAIL because `segmentPortrait` is missing.

- [x] **Step 3: Implement the production adapter**

Use `FilesetResolver.forVisionTasks(paths.wasmRoot)` and `ImageSegmenter.createFromOptions` with:

```ts
{
  baseOptions: { modelAssetPath: paths.modelUrl },
  runningMode: 'IMAGE',
  outputConfidenceMasks: true,
  outputCategoryMask: false,
}
```

Copy the background channel before closing every `MPMask` in `finally`. Cache the initialization promise, clear it after rejection, and expose `resetPortraitSegmenter()` for a retry button and test cleanup. Do not accept external model URLs.

- [x] **Step 4: Run GREEN and TypeScript check**

Run:

```powershell
npm.cmd test -- components/tools/image/id-photo/segmentation.test.ts
npm.cmd run lint
```

Expected: PASS and zero TypeScript errors.

- [x] **Step 5: Commit**

```powershell
git add -- SD/components/tools/image/id-photo/segmentation.ts SD/components/tools/image/id-photo/segmentation.test.ts
git commit -m "feat(image): segment portraits locally"
```

### Task 6: Accessible mask editor and certificate-photo workflow

**Files:**
- Create: `SD/components/tools/image/id-photo/MaskEditorCanvas.tsx`
- Create: `SD/components/tools/image/id-photo/MaskEditorCanvas.test.tsx`
- Rewrite: `SD/components/tools/image/IdPhotoBgColor.tsx`
- Test: `SD/components/tools/image/IdPhotoBgColor.test.tsx`
- Modify: `SD/tools/registry.tsx`

- [x] **Step 1: Write failing component contracts**

Render the editor with `renderToStaticMarkup` and assert the initial screen contains:

```ts
expect(html).toContain('照片仅在当前浏览器处理');
expect(html).toContain('上传证件照');
expect(html).toContain('AI 人像分割');
expect(html).toContain('aria-live="polite"');
```

Read the source contract and assert the old identifiers `rgbToHsl`, `isBackground`, and the misleading `灵敏度` label are absent. Add pure coordinate tests exported from `MaskEditorCanvas.tsx` for display-to-mask pointer scaling and clipping.

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- components/tools/image/IdPhotoBgColor.test.tsx components/tools/image/id-photo/MaskEditorCanvas.test.tsx`

Expected: FAIL because the new editor contract is absent.

- [x] **Step 3: Build the editor and state machine**

Use explicit states:

```ts
type ProcessingState =
  | { status: 'idle' }
  | { status: 'loading-model' }
  | { status: 'segmenting' }
  | { status: 'ready' }
  | { status: 'error'; kind: 'model' | 'browser' | 'image' | 'person' | 'export'; message: string };
```

Requirements:

- Decode once per input and reject decoded images over 40 million pixels.
- Segment once per input; retain only copied confidence data.
- Recompute mask/composite when threshold, feather, background, or overrides change.
- Present source/result/mask tabs; default to result.
- Expose solid white/blue/red, gradient blue, and custom color.
- Expose threshold, feather, brush size, erase, restore, undo, reset, and mask overlay.
- Use pointer capture for mouse, pen, and touch strokes.
- Export PNG and JPEG from the exact current composite buffer.
- Revoke previous source/result object URLs on replacement and unmount.
- Replace `alert` with an `aria-live` status/error panel.
- Keep controls disabled during model loading and segmentation.

- [x] **Step 4: Run focused GREEN, full tests, and build**

Run:

```powershell
npm.cmd test -- components/tools/image/IdPhotoBgColor.test.tsx components/tools/image/id-photo
npm.cmd test
npm.cmd run build
```

Expected: all tests PASS and production build succeeds.

- [x] **Step 5: Commit**

```powershell
git add -- SD/components/tools/image/IdPhotoBgColor.tsx SD/components/tools/image/IdPhotoBgColor.test.tsx SD/components/tools/image/id-photo/MaskEditorCanvas.tsx SD/components/tools/image/id-photo/MaskEditorCanvas.test.tsx SD/tools/registry.tsx
git commit -m "feat(image): replace certificate photo backgrounds with AI masks"
```

### Task 7: Notices, Nginx MIME/cache, and deployment documentation

**Files:**
- Create: `SD/THIRD_PARTY_NOTICES.md`
- Modify: `SD/README.md`
- Modify: `nginx.conf`
- Create: `SD/lib/idPhotoDeployment.test.ts`

- [x] **Step 1: Write failing deployment contract tests**

The test must read `nginx.conf`, `SD/package.json`, the third-party notice, and the built asset script. Assert:

```ts
expect(nginx).toMatch(/\.wasm\$/);
expect(nginx).toContain('application/wasm');
expect(nginx).toMatch(/\.tflite\$/);
expect(nginx).toContain('application/octet-stream');
expect(notice).toContain('Apache License, Version 2.0');
expect(notice).toContain('selfie_multiclass_256x256.tflite');
expect(JSON.stringify(pkg.scripts)).toContain('prepare:mediapipe');
```

- [x] **Step 2: Run RED**

Run: `npm.cmd test -- lib/idPhotoDeployment.test.ts`

Expected: FAIL because MIME/cache locations and notices are absent.

- [x] **Step 3: Implement production delivery rules and docs**

Add regex locations before the generic JS/CSS cache location:

```nginx
location ~* \.wasm$ {
    default_type application/wasm;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
}

location ~* \.tflite$ {
    default_type application/octet-stream;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
}
```

Document the 16.4 MB model, local-only inference, build asset preparation, supported browsers, memory limit, model limitations, and troubleshooting for 404/MIME failures. Add Apache-2.0 attribution for runtime and model without relicensing first-party code.

- [x] **Step 4: Run GREEN and Nginx syntax check when available**

Run:

```powershell
npm.cmd test -- lib/idPhotoDeployment.test.ts
nginx -t -c E:\AI\gp-main-integration\nginx.conf
```

Expected: test PASS. If local Nginx is unavailable or BaoTa includes do not exist on Windows, record that limitation and validate the two isolated location blocks through the contract test; production must still run `nginx -t` before reload.

- [x] **Step 5: Commit**

```powershell
git add -- SD/THIRD_PARTY_NOTICES.md SD/README.md SD/lib/idPhotoDeployment.test.ts nginx.conf
git commit -m "docs(image): deploy local portrait segmentation"
```

### Task 8: Production-like verification and handoff

**Files:**
- Modify: this plan only to mark executed checkboxes.

- [x] **Step 1: Run the complete automated verification**

```powershell
Set-Location E:\AI\gp-main-integration\SD
npm.cmd run prepare:mediapipe
npm.cmd test
npm.cmd run build
Set-Location E:\AI\gp-main-integration
git diff --check
```

Expected: zero test failures, build exit code 0, and no diff-check errors.

- [x] **Step 2: Verify built self-hosted artifacts**

Assert these built files exist and are non-empty:

```text
SD/dist/vendor/mediapipe/models/selfie_multiclass_256x256.tflite
SD/dist/vendor/mediapipe/wasm/vision_wasm_internal.js
SD/dist/vendor/mediapipe/wasm/vision_wasm_internal.wasm
SD/dist/vendor/mediapipe/wasm/vision_wasm_module_internal.js
SD/dist/vendor/mediapipe/wasm/vision_wasm_module_internal.wasm
SD/dist/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js
SD/dist/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm
```

Recompute the built model SHA-256 and require the pinned value. Search the built `IdPhotoBgColor-*` and `vision_bundle-*` chunks plus `SD/components/tools/image/IdPhotoBgColor.tsx`, `SD/components/tools/image/id-photo/`, and `SD/scripts/copy-mediapipe-assets.mjs` for external MediaPipe model/CDN URLs. Search the certificate-photo runtime sources for `rgbToHsl` and `isBackground`. Do not scan unrelated OCR or color-picker chunks, which legitimately contain their own CDN defaults or HSL utilities. Documentation and notices may retain the official source URL for provenance.

- [ ] **Step 3: Run a production-like browser test**

Start `npm.cmd run preview -- --host 127.0.0.1 --port 5176`. In a browser:

1. Open the certificate-photo background tool.
2. Upload a local portrait with a colored or non-uniform background.
3. Confirm model/WASM requests are only to `127.0.0.1:5176`.
4. Change red, blue, white, gradient, and custom backgrounds without rerunning inference.
5. Verify threshold and feather visibly affect only the edge.
6. Erase, restore, undo, reset, and use a touch/pointer stroke.
7. Export PNG and JPEG and compare them to the current preview.
8. Test blue/red clothing, glasses, loose hair, and a no-person image error.

Execution note (2026-08-11): the production page shell, privacy copy, upload control, and responsive layout were verified at `http://127.0.0.1:5176/tool/id-photo-bg-color`. Codex In-app Browser explicitly rejected local file uploads, so the real portrait interaction checklist above remains a manual acceptance test. Automated tests cover segmentation resource cleanup, no-person errors, colored clothing preservation, mask edits, compositing, and export-buffer parity. The preview server returned HTTP 200 and `application/wasm`; Vite leaves `.tflite` without a MIME type, while the committed Nginx rule supplies `application/octet-stream` in production.

- [x] **Step 4: Mark the plan and commit**

Stage only this feature's files. Do not stage `node_modules`, `dist`, runtime logs, databases, `.env` files, or the dirty `E:\AI\gp` worktree.

```powershell
git add -- docs/superpowers/plans/2026-08-11-id-photo-background-ai.md
git commit -m "docs: record AI certificate photo implementation"
```

## Completion evidence

- Exact test and build counts from the final run.
- Model byte length and SHA-256 from source and built output.
- Browser URLs used for the production-like check.
- Confirmation that network requests stayed on the local origin.
- Any Nginx syntax limitation caused by the local Windows environment.
- Commit list and branch name.
