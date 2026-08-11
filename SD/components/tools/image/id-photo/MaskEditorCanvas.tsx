import React, { useEffect, useRef } from 'react';

import type { OverrideMode } from './types';

interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PointerCoordinates {
  clientX: number;
  clientY: number;
}

export function mapPointerToMask(
  pointer: PointerCoordinates,
  rect: DisplayRect,
  maskWidth: number,
  maskHeight: number,
): { x: number; y: number } {
  const x = rect.width > 0 ? ((pointer.clientX - rect.left) / rect.width) * maskWidth : 0;
  const y = rect.height > 0 ? ((pointer.clientY - rect.top) / rect.height) * maskHeight : 0;
  return {
    x: Math.min(maskWidth - 1, Math.max(0, x)),
    y: Math.min(maskHeight - 1, Math.max(0, y)),
  };
}

interface MaskEditorCanvasProps {
  image: CanvasImageSource | null;
  alpha: Float32Array;
  overrides: Int8Array;
  maskWidth: number;
  maskHeight: number;
  brushRadius: number;
  mode: OverrideMode;
  showOverlay: boolean;
  onStrokeStart: () => void;
  onPaint: (point: { x: number; y: number }) => void;
}

const MaskEditorCanvas: React.FC<MaskEditorCanvasProps> = ({
  image,
  alpha,
  overrides,
  maskWidth,
  maskHeight,
  brushRadius,
  mode,
  showOverlay,
  onStrokeStart,
  onPaint,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || !image || alpha.length !== maskWidth * maskHeight) return;

    canvas.width = maskWidth;
    canvas.height = maskHeight;
    context.clearRect(0, 0, maskWidth, maskHeight);
    context.drawImage(image, 0, 0, maskWidth, maskHeight);
    if (!showOverlay) return;

    const pixels = context.getImageData(0, 0, maskWidth, maskHeight);
    for (let index = 0; index < alpha.length; index += 1) {
      const override = overrides[index] ?? 0;
      const amount = override === 0 ? (1 - alpha[index]) * 0.38 : 0.5;
      if (amount <= 0.01) continue;
      const color = override > 0 ? [38, 190, 110] : [220, 58, 72];
      const offset = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels.data[offset + channel] = Math.round(
          pixels.data[offset + channel] * (1 - amount) + color[channel] * amount,
        );
      }
    }
    context.putImageData(pixels, 0, 0);
  }, [alpha, image, maskHeight, maskWidth, overrides, showOverlay]);

  const paintAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onPaint(mapPointerToMask(event, canvas.getBoundingClientRect(), maskWidth, maskHeight));
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={maskWidth}
        height={maskHeight}
        className="max-h-[28rem] w-full cursor-crosshair touch-none rounded-xl border border-[#d8b58e] bg-[#f1dcc2] object-contain"
        aria-label="人像蒙版手工修正画布"
        role="img"
        onPointerDown={(event) => {
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          onStrokeStart();
          paintAt(event);
        }}
        onPointerMove={(event) => {
          if (activePointer.current === event.pointerId) paintAt(event);
        }}
        onPointerUp={(event) => {
          if (activePointer.current !== event.pointerId) return;
          activePointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { activePointer.current = null; }}
      />
      <p className="text-xs text-[#7a6654]">
        当前画笔：{mode === 'erase' ? '擦除人物' : '恢复人物'} · 半径 {brushRadius}px
      </p>
    </div>
  );
};

export default MaskEditorCanvas;
