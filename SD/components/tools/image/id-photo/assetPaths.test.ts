import { describe, expect, it } from 'vitest';

import { buildMediaPipeAssetPaths } from './assetPaths';

describe('buildMediaPipeAssetPaths', () => {
  it('keeps assets on the deployment root', () => {
    expect(buildMediaPipeAssetPaths('/')).toEqual({
      wasmRoot: '/vendor/mediapipe/wasm',
      modelUrl: '/vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
    });
  });

  it('keeps assets below a configured Vite base path', () => {
    expect(buildMediaPipeAssetPaths('/stock/')).toEqual({
      wasmRoot: '/stock/vendor/mediapipe/wasm',
      modelUrl: '/stock/vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
    });
  });

  it('normalizes missing and duplicate slashes', () => {
    expect(buildMediaPipeAssetPaths('tools//')).toEqual({
      wasmRoot: '/tools/vendor/mediapipe/wasm',
      modelUrl: '/tools/vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
    });
  });
});
