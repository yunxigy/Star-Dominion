import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ImageActionBar } from './ImageActionBar';
import { ImageBatchQueue } from './ImageBatchQueue';
import { ImageDropzone } from './ImageDropzone';
import { ImageParameterPanel } from './ImageParameterPanel';
import { ImagePreviewPane } from './ImagePreviewPane';
import { ImageWorkbench } from './ImageWorkbench';
import {
  NumberControl,
  PresetControl,
  RangeControl,
  SelectControl,
  ToggleControl,
} from './controls';
import type { BatchItem } from './types';

interface TestParams {
  quality: number;
}

function makeItem(
  id: string,
  name: string,
  status: BatchItem<TestParams>['status'],
): BatchItem<TestParams> {
  return {
    id,
    file: new File(['image'], name, { type: 'image/png' }),
    sourceUrl: `blob:${id}`,
    metadata: {
      width: 800,
      height: 600,
      mime: 'image/png',
      bytes: 2048,
    },
    params: { quality: 80 },
    status,
    progress: status === 'done' ? 100 : 0,
    outputs: [],
    error: status === 'error' ? '图片解码失败' : null,
    stale: false,
  };
}

describe('ImageWorkbench low-level primitives', () => {
  it('renders the required slots as accessible workbench landmarks', () => {
    const html = renderToStaticMarkup(
      <ImageWorkbench
        upload={<button type="button">上传图片</button>}
        controls={<label>质量<input aria-label="质量" type="range" /></label>}
        queue={<div>队列内容</div>}
        preview={<img src="data:image/png;base64,eA==" alt="处理预览" />}
        actions={<button type="button">下载</button>}
        notice={<span>仅在浏览器本地处理</span>}
      />,
    );

    expect(html).toContain('class="image-workbench');
    expect(html).toContain('aria-label="图片处理参数"');
    expect(html).toContain('aria-label="图片预览"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('队列内容');
    expect(html).toContain('仅在浏览器本地处理');
  });

  it('renders a real labelled multi-file input with accept, limits and disabled state', () => {
    const html = renderToStaticMarkup(
      <ImageDropzone
        accept="image/png,image/jpeg"
        disabled
        maxFiles={8}
        maxFileSizeBytes={50 * 1024 * 1024}
        multiple
        onFiles={vi.fn()}
      />,
    );

    expect(html).toContain('<label');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain('最多 8 张');
    expect(html).toContain('单张不超过 50 MB');
  });

  it('renders a generic selectable queue with metadata, status, errors and named actions', () => {
    const html = renderToStaticMarkup(
      <ImageBatchQueue
        items={[
          makeItem('done', '旅行照片.png', 'done'),
          makeItem('error', '损坏图片.png', 'error'),
        ]}
        selectedId="done"
        select={vi.fn()}
        remove={vi.fn()}
        retry={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="图片队列"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('旅行照片.png');
    expect(html).toMatch(/PNG|image\/png/);
    expect(html).toContain('800 × 600');
    expect(html).toContain('2 KB');
    expect(html).toContain('已完成');
    expect(html).toContain('图片解码失败');
    expect(html).toContain('aria-label="重试 损坏图片.png"');
    expect(html).toContain('aria-label="移除 旅行照片.png"');
  });

  it('renders original and selected output previews plus accessible output thumbnails', () => {
    const html = renderToStaticMarkup(
      <ImagePreviewPane
        source={{
          id: 'source',
          src: 'blob:source',
          name: '原始照片.png',
          alt: '原始照片预览',
        }}
        outputs={[
          { id: 'one', src: 'blob:one', name: '结果一.png', alt: '结果一预览' },
          {
            id: 'two',
            src: 'blob:two',
            name: '结果二.png',
            alt: '结果二预览',
            metrics: [{ label: '清晰度', value: '清晰' }],
          },
        ]}
        selectedOutputId="two"
        selectOutput={vi.fn()}
      />,
    );

    expect(html).toContain('alt="原始照片预览"');
    expect(html).toContain('alt="结果二预览"');
    expect(html).toContain('aria-label="选择输出 结果一.png"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('清晰度');
    expect(html).toContain('清晰');

    const emptyHtml = renderToStaticMarkup(<ImagePreviewPane />);
    expect(emptyHtml).toContain('上传图片后可在这里查看预览');
  });

  it('renders a semantic parameter panel and accessible labelled controls', () => {
    const html = renderToStaticMarkup(
      <ImageParameterPanel title="导出参数" applyAll={vi.fn()} applyAllDisabled>
        <NumberControl label="宽度" value={800} onChange={vi.fn()} />
        <RangeControl label="质量" min={1} max={100} value={80} onChange={vi.fn()} />
        <ToggleControl label="保持比例" checked onChange={vi.fn()} />
        <PresetControl
          label="常用尺寸"
          options={[
            { label: '小', value: 'small' },
            { label: '大', value: 'large' },
          ]}
          value="large"
          onChange={vi.fn()}
        />
        <SelectControl
          label="格式"
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
          ]}
          value="png"
          onChange={vi.fn()}
        />
      </ImageParameterPanel>,
    );

    expect(html).toContain('<h2');
    expect(html).toContain('导出参数');
    expect(html).toContain('应用到全部');
    expect(html).toContain('type="number"');
    expect(html).toContain('type="range"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<select');
    expect(html).toContain('aria-label="质量数值"');
  });

  it('uses real disabled buttons for every action', () => {
    const html = renderToStaticMarkup(
      <ImageActionBar
        status="尚未添加图片"
        reset={vi.fn()}
        processSelected={vi.fn()}
        processAll={vi.fn()}
        downloadSelected={vi.fn()}
        downloadZip={vi.fn()}
        resetDisabled
        processSelectedDisabled
        processAllDisabled
        downloadSelectedDisabled
        downloadZipDisabled
      />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('重置');
    expect(html).toContain('处理选中');
    expect(html).toContain('处理全部');
    expect(html).toContain('下载选中');
    expect(html).toContain('ZIP');
    expect(html.match(/disabled=""/g)).toHaveLength(5);
  });
});
