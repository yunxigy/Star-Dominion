import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('independent module integration', () => {
  it('proxies all ShouAnRen root assets to the ShouAnRen service', () => {
    const configSource = source('../vite.config.ts');
    for (const assetRoot of ['/css', '/js', '/static', '/avatars', '/audio']) {
      expect(configSource).toContain(`'${assetRoot}':`);
    }
  });

  it('registers the standalone STM32 page route', () => {
    expect(source('../App.tsx')).toContain('path="/stm32/*"');
  });

  it('does not open the STM32 page automatically', () => {
    expect(source('../pages/Stm32Page.tsx')).not.toContain('window.open(');
  });

  it('reports a missing STM32 map configuration only once in StrictMode', () => {
    const windowSource = source('../pages/Stm32Window.tsx');
    expect(windowSource).toContain('mapConfigurationReportedRef.current');
  });
});
