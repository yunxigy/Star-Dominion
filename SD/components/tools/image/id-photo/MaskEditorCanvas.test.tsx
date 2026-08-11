import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MaskEditorCanvas, { mapPointerToMask } from './MaskEditorCanvas';

describe('mapPointerToMask', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };

  it('scales display coordinates to mask coordinates', () => {
    expect(mapPointerToMask({ clientX: 50, clientY: 45 }, rect, 256, 128)).toEqual({
      x: 51.2,
      y: 32,
    });
  });

  it('clips pointer coordinates to mask bounds', () => {
    expect(mapPointerToMask({ clientX: -100, clientY: 999 }, rect, 256, 128)).toEqual({
      x: 0,
      y: 127,
    });
  });
});

describe('MaskEditorCanvas', () => {
  it('describes the interactive correction surface accessibly', () => {
    const html = renderToStaticMarkup(
      <MaskEditorCanvas
        image={null}
        alpha={new Float32Array(1)}
        overrides={new Int8Array(1)}
        maskWidth={1}
        maskHeight={1}
        brushRadius={1}
        mode="erase"
        showOverlay
        onStrokeStart={() => undefined}
        onPaint={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="人像蒙版手工修正画布"');
  });
});
