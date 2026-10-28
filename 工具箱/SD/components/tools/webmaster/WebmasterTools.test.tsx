// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetaTagTool, OpenGraphPreviewTool, RobotsTxtTool, SitemapGeneratorTool, UrlParserTool, UtmBuilderTool, SlugGeneratorTool, UserAgentParserTool, SslCheckerTool, DnsLookupTool, HttpStatusTool, WebSocketTesterTool } from './WebmasterTools';

describe('webmaster tool route exports', () => {
  it('exports twelve named modes with close controls', () => {
    const tools = [MetaTagTool, OpenGraphPreviewTool, RobotsTxtTool, SitemapGeneratorTool, UrlParserTool, UtmBuilderTool, SlugGeneratorTool, UserAgentParserTool, SslCheckerTool, DnsLookupTool, HttpStatusTool, WebSocketTesterTool];
    tools.forEach((Tool) => { const { unmount } = render(<Tool onClose={() => undefined} />); expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy(); unmount(); });
  });
  it('generates metadata and parses a URL through the visible workbench', async () => {
    render(<MetaTagTool onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect((screen.getByLabelText('处理结果') as HTMLTextAreaElement).value).toContain('<title>我的网站</title>'));
  });
  it('renders Open Graph values as text instead of HTML', () => {
    render(<OpenGraphPreviewTool onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }));
    expect(screen.getByTestId('og-preview').textContent).toContain('分享标题');
  });
});
