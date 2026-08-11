# AI Certificate Photo Background Replacement Design

**Date:** 2026-08-11
**Status:** Approved approach; awaiting written-spec review
**Scope:** Replace the existing `id-photo-bg-color` pixel-threshold implementation with a fully self-hosted, browser-local portrait segmentation workflow.

## Goals

- Replace red, blue, white, gradient, or custom certificate-photo backgrounds without confusing foreground clothing with the requested output color.
- Preserve hair, face, skin, clothes, glasses, and accessories through an ML-generated alpha mask plus user correction tools.
- Keep source images on the user's device. No image bytes may be uploaded to the site backend or a third-party API.
- Work after deployment on a server that cannot access Google, a CDN, or an AI API at runtime.
- Preserve the current lazy-loaded tool entry and existing Vite deployment behavior.
- Produce deterministic, testable compositing code shared by preview and download.

## Non-goals

- Identity recognition, face recognition, beautification, or biometric analysis.
- Training or fine-tuning a segmentation model.
- Guaranteed pixel-perfect masks for every photograph. The editor must expose manual correction because the selected model explicitly does not promise pixel-perfect output.
- A backend GPU or Python inference service.
- Reworking unrelated image tools or the whole toolbox visual system.

## Selected approach

Use Google's MediaPipe Image Segmenter for Web through `@mediapipe/tasks-vision` with the official SelfieMulticlass 256x256 model. The model classifies background, hair, body skin, face skin, clothes, and accessories. The person alpha is derived from the confidence masks rather than from the requested output color.

MediaPipe source and the selected model are Apache-2.0 licensed. The repository must include a third-party notice identifying the package, model, source URLs, and license. No AGPL code, UI, assets, or tests may be copied.

The official model card notes that low light, backlighting, noise, and large occluders can reduce mask quality. Manual erase/restore controls are therefore a required part of the first release, not an optional future enhancement.

## Deployment architecture

The production server only serves static assets:

1. Vite bundles the MediaPipe JavaScript package with the application.
2. A repository build script copies the package's version-pinned WASM files from `node_modules` into `public/vendor/mediapipe/wasm` before development and production builds.
3. The official `.tflite` model is stored under `public/vendor/mediapipe/models` so production inference never fetches an external URL.
4. Runtime asset URLs are derived from `import.meta.env.BASE_URL`, preserving root and sub-path deployments.
5. Nginx must serve `.wasm` as `application/wasm` and `.tflite` as `application/octet-stream`. Long-lived immutable caching is allowed for versioned files.
6. Inference and compositing run in the browser. The server requires neither GPU support nor an outbound network connection.

The app must show a clear compatibility error if WebAssembly initialization fails. It must not fall back to the broken HSL algorithm.

## Component boundaries

### `idPhotoSegmentation.ts`

- Lazily initializes and caches one Image Segmenter instance.
- Accepts an image source and returns normalized confidence masks plus dimensions.
- Knows the MediaPipe class ordering and asset paths.
- Releases MediaPipe mask objects after copying their data.
- Does not render React UI or perform downloads.

### `idPhotoMask.ts`

- Converts the six confidence channels into a foreground alpha mask.
- Applies a user-controlled threshold through a smooth transition rather than a binary cutoff.
- Applies bounded edge feathering with a separable blur.
- Stores erase/restore edits as a separate override mask so changing threshold or feathering does not discard brush work.
- Exposes pure functions suitable for deterministic unit tests.

### `idPhotoComposite.ts`

- Composites the full-resolution source, corrected alpha mask, and selected solid/gradient background.
- Reduces residual source-background spill only on partially transparent edge pixels.
- Exports PNG for lossless edges and JPEG only when explicitly selected.
- Provides one function used by both preview and download.

### `IdPhotoBgColor.tsx`

- Owns upload, model-loading, processing, editor, export, and error UI state.
- Renders source, result, and mask views without duplicating processing logic.
- Revokes object URLs when input/result changes or the component unmounts.
- Keeps all user data in memory and clears it on reset.

## Processing flow

1. Validate file type and decode orientation-correct image data.
2. Reject unreadable images and guard against excessive decoded pixel counts.
3. Initialize the local segmenter on first use and display model-loading progress.
4. Run one still-image segmentation pass and copy the confidence masks.
5. Build alpha from `1 - backgroundConfidence`, constrained by the foreground class channels.
6. Apply threshold, feathering, and the current brush override mask.
7. Composite at the source resolution against the selected background.
8. Render preview from the same composite result used for export.
9. Recompute only mask refinement/compositing when controls change; do not rerun ML inference unless the input image changes.

## User experience

- Upload area accepts the current image formats supported by the browser.
- A privacy label states that processing occurs locally and the photo is not uploaded.
- Background choices include white, blue, red, gradient blue, and custom color.
- Editor controls include edge threshold, feathering, brush size, erase background, restore person, undo last stroke, reset mask, and mask overlay visibility.
- Processing buttons are disabled while work is active and expose status through `aria-live`.
- Canvas editing supports pointer input for mouse, pen, and touch.
- Errors distinguish model loading, unsupported browser, invalid image, no confident person found, and export failure.
- The old misleading sensitivity control and target-color-based detection are removed.

## Quality and performance

- ML inference runs once per source image. Threshold, color, feather, and brush changes reuse cached masks.
- Full-resolution export is preserved, while on-screen previews may be capped to a bounded display resolution.
- Pixel loops use typed arrays and avoid React state per pixel.
- The model and WASM are lazy-loaded only when the tool starts processing an image.
- The first load may be slower; versioned browser caching makes later visits faster.
- Very large images receive an explicit size warning or bounded downscale instead of risking a browser crash.

## Failure handling

- Model/WASM unavailable: show a retryable local-model error with deployment diagnostic details.
- No confident person: keep the original image, explain the issue, and allow retry with another photo.
- Browser memory pressure: request a smaller image rather than silently exporting a partial result.
- Canvas security/decoding error: stop and show a local decode error.
- Export error: preserve the current mask and preview so the user can retry.

## Testing strategy

Tests are written before production code and must fail for the expected missing behavior.

### Pure mask/composite tests

- Red source background can be replaced with blue independent of target-color classification.
- Blue foreground clothing remains foreground when its mask says person.
- Threshold and feather controls produce measurably different alpha values.
- Solid and gradient colors composite correctly at fully opaque, fully transparent, and edge alpha values.
- Brush erase/restore overrides survive threshold changes and undo restores the previous mask state.
- Preview and export call the same compositor.

### Segmentation adapter tests

- Correct local URLs are generated under `/` and a non-root Vite base.
- The six confidence masks are copied and MediaPipe resources are closed.
- Initialization is cached and failures remain retryable.

### Component contract tests

- No HSL background detector remains.
- The UI exposes local-processing privacy text, progress, threshold, feather, mask view, erase/restore, undo, reset, and PNG/JPEG export.
- Server/model errors are rendered accessibly.
- Object URLs are revoked.

### Final verification

- Focused Vitest red/green runs for each new pure unit.
- Full `npm test` and `npm run build` in `SD`.
- Manual browser checks with red, blue, white, gray, and non-uniform backgrounds; blue/red clothing; glasses; loose hair; and touch brush input.
- Production-like static serving verifies local WASM/model requests, MIME types, caching, and zero third-party network requests.

## Acceptance criteria

- Changing target color never changes which pixels are considered the person.
- Threshold and feather controls visibly and numerically affect the mask.
- Blue or red foreground clothing is preserved when the ML mask classifies it as person.
- The user can erase and restore mask regions and undo the most recent stroke.
- Preview and downloaded output match.
- Browser network logs show no source-image upload and no model/WASM request to an external origin.
- The tool works from the deployed site path with the production Nginx configuration.
- Full frontend tests and production build pass.

## References

- MediaPipe Image Segmenter for Web: <https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js>
- MediaPipe Image Segmenter models: <https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/index#models>
- SelfieMulticlass model card: <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf>
- MediaPipe Apache-2.0 license: <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>
