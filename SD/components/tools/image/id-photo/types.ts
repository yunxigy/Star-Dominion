export interface SegmentationSnapshot {
  width: number;
  height: number;
  backgroundConfidence: Float32Array;
}

export interface MaskControls {
  threshold: number;
  featherRadius: number;
}

export type OverrideMode = 'erase' | 'restore';

export interface MaskStroke {
  x: number;
  y: number;
  radius: number;
  mode: OverrideMode;
}

export type RgbColor = readonly [number, number, number];

export type PhotoBackground =
  | { kind: 'solid'; color: RgbColor }
  | { kind: 'vertical-gradient'; top: RgbColor; bottom: RgbColor };
