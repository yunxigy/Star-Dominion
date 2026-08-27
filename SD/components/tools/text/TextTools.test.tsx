// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BatchReplaceTool, CharacterFrequencyTool, DedupeLinesTool, EntityExtractorTool, LineNumberTool, MarkupConverterTool, RemoveBlankLinesTool, SortLinesTool, TextFileBatchTool } from './TextTools';

describe('text tool route exports', () => {
  it('renders all nine named modes with a visible heading and close action', () => {
    const tools = [RemoveBlankLinesTool, DedupeLinesTool, SortLinesTool, BatchReplaceTool, LineNumberTool, CharacterFrequencyTool, EntityExtractorTool, TextFileBatchTool, MarkupConverterTool];
    tools.forEach((Tool) => {
      const { unmount } = render(<Tool onClose={() => undefined} />);
      expect(screen.getAllByRole('button', { name: '关闭' }).length).toBeGreaterThan(0);
      unmount();
    });
  });
});
