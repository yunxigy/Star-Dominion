import { buildMediaPipeAssetPaths } from './assetPaths';
import type { SegmentationSnapshot } from './types';

export type PortraitImage = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap;

interface ConfidenceMaskPort {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
  close(): void;
}

interface SegmentationResultPort {
  confidenceMasks?: ConfidenceMaskPort[];
}

interface SegmenterPort {
  segment(image: PortraitImage): SegmentationResultPort | Promise<SegmentationResultPort>;
  close?(): void;
}

export type SegmenterFactory = () => Promise<SegmenterPort>;

let initializationPromise: Promise<SegmenterPort> | null = null;

async function createLocalSegmenter(): Promise<SegmenterPort> {
  const [{ FilesetResolver, ImageSegmenter }, paths] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    Promise.resolve(buildMediaPipeAssetPaths(import.meta.env.BASE_URL)),
  ]);
  const vision = await FilesetResolver.forVisionTasks(paths.wasmRoot);
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: paths.modelUrl },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  return segmenter as unknown as SegmenterPort;
}

function getSegmenter(factory: SegmenterFactory): Promise<SegmenterPort> {
  if (initializationPromise) return initializationPromise;

  let attempt: Promise<SegmenterPort>;
  attempt = Promise.resolve()
    .then(factory)
    .catch((error) => {
      if (initializationPromise === attempt) initializationPromise = null;
      throw error;
    });
  initializationPromise = attempt;
  return attempt;
}

export async function resetPortraitSegmenter(): Promise<void> {
  const current = initializationPromise;
  initializationPromise = null;
  if (!current) return;
  try {
    const segmenter = await current;
    segmenter.close?.();
  } catch {
    // A failed initialization has no live native resource to close.
  }
}

export async function segmentPortrait(
  image: PortraitImage,
  factory: SegmenterFactory = createLocalSegmenter,
): Promise<SegmentationSnapshot> {
  const segmenter = await getSegmenter(factory);
  const result = await segmenter.segment(image);
  const masks = result.confidenceMasks ?? [];

  try {
    if (masks.length !== 6) {
      throw new Error(`Expected six confidence masks, received ${masks.length}`);
    }
    const [backgroundMask] = masks;
    const { width, height } = backgroundMask;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || masks.some((mask) => mask.width !== width || mask.height !== height)) {
      throw new Error('MediaPipe confidence mask dimensions are inconsistent');
    }

    const backgroundConfidence = new Float32Array(backgroundMask.getAsFloat32Array());
    if (backgroundConfidence.length !== width * height) {
      throw new Error('MediaPipe confidence mask dimensions do not match its data');
    }

    let maximumForegroundConfidence = 0;
    for (const confidence of backgroundConfidence) {
      maximumForegroundConfidence = Math.max(maximumForegroundConfidence, 1 - confidence);
    }
    if (maximumForegroundConfidence < 0.2) {
      throw new Error('No confident person was found in this image');
    }

    return { width, height, backgroundConfidence };
  } finally {
    masks.forEach((mask) => mask.close());
  }
}
