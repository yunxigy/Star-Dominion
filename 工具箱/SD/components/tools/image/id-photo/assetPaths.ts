export interface MediaPipeAssetPaths {
  wasmRoot: string;
  modelUrl: string;
}

function normalizeBase(base: string): string {
  const segments = base.split('/').filter(Boolean);
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

export function buildMediaPipeAssetPaths(base: string): MediaPipeAssetPaths {
  const prefix = normalizeBase(base);
  return {
    wasmRoot: `${prefix}/vendor/mediapipe/wasm`,
    modelUrl: `${prefix}/vendor/mediapipe/models/selfie_multiclass_256x256.tflite`,
  };
}
