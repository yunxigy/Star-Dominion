import { describe, expect, test } from 'vitest';

import {
  HOME_CATEGORY_DESCRIPTION_CLASS,
  HOME_CATEGORY_TITLE_CLASS,
  HOME_HOT_TOOL_DESCRIPTION_CLASS,
  HOME_HOT_TOOL_TITLE_CLASS,
  TOOLBOX_CARD_DESCRIPTION_CLASS,
  TOOLBOX_CARD_TITLE_CLASS,
  TOOL_WINDOW_AD_CLASS,
  TOOL_WINDOW_CONTENT_CLASS,
} from './toolUiLayout';

describe('tool page typography and width', () => {
  test('uses one-step-larger typography for toolbox cards', () => {
    expect(TOOLBOX_CARD_TITLE_CLASS).toContain('text-2xl');
    expect(TOOLBOX_CARD_DESCRIPTION_CLASS).toContain('text-lg');
  });

  test('uses one-step-larger typography for homepage tool cards', () => {
    expect(HOME_HOT_TOOL_TITLE_CLASS).toContain('text-xl');
    expect(HOME_HOT_TOOL_DESCRIPTION_CLASS).toContain('text-lg');
    expect(HOME_CATEGORY_TITLE_CLASS).toContain('text-2xl');
    expect(HOME_CATEGORY_DESCRIPTION_CLASS).toContain('text-lg');
  });

  test('uses a wider, roomier tool workspace', () => {
    expect(TOOL_WINDOW_CONTENT_CLASS).toContain('max-w-7xl');
    expect(TOOL_WINDOW_CONTENT_CLASS).toContain('p-8');
    expect(TOOL_WINDOW_AD_CLASS).toContain('max-w-7xl');
  });
});
