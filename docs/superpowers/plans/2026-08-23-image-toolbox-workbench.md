# Image Toolbox Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将主站 22 个图片工具统一升级为浅色双栏工作台，覆盖批量队列、实时预览、参数预设、元数据、统一错误/重置/下载与按需 ZIP，同时保留全部浏览器本地处理能力和现有工具 URL。

**Architecture:** 保留 `ToolWindow` 作为页面外壳，在其内部新增一组可组合的 `image-workbench` 组件。标准工具通过 `BatchImageTool` + `useImageBatch` 接入统一队列和处理器；裁剪、取色、证件照换底、马赛克等交互型工具使用同一底层工作台插槽自行渲染编辑区。纯函数处理器与 React 展示层分离，批量并发固定为 2，Object URL 和 AbortController 由 hook 统一管理。

**Tech Stack:** React 18、TypeScript、Vite 5、Tailwind CSS 3、Canvas API、File/Blob/Object URL、JSZip、Vitest、React DOM server rendering

---

## Scope contract

本计划只迁移以下 22 个工具，不包含注册表中 `data` 分类的 `ScanProcessor.tsx`：

1. `components/tools/image/CompressImage.tsx`
2. `components/tools/image/ResizeImage.tsx`
3. `components/tools/image/CropImage.tsx`
4. `components/tools/image/WatermarkImage.tsx`
5. `components/tools/image/ImageToBase64.tsx`
6. `components/tools/image/Base64ToImage.tsx`
7. `components/tools/image/ColorPicker.tsx`
8. `components/tools/image/MergeImages.tsx`
9. `components/tools/image/SplitImageGrid.tsx`
10. `components/tools/image/FaviconGenerator.tsx`
11. `components/tools/image/IdPhotoResize.tsx`
12. `components/tools/image/IdPhotoBgColor.tsx`
13. `components/tools/image-enhance/ImageSharpness.tsx`
14. `components/tools/image-enhance/ImageBrightness.tsx`
15. `components/tools/image-enhance/ImageSharpen.tsx`
16. `components/tools/image-enhance/ImageExifRemover.tsx`
17. `components/tools/image-enhance/ImageEnhanceWatermark.tsx`
18. `components/tools/image-enhance/ImageAddText.tsx`
19. `components/tools/image-enhance/ImageMosaic.tsx`
20. `components/tools/image-enhance/ScreenshotBeautify.tsx`
21. `components/tools/image-enhance/MemeGenerator.tsx`
22. `components/tools/image-enhance/SocialMediaCover.tsx`

所有命令都从 `E:\AI\gp\SD` 执行，并使用 `npm.cmd`，避免 PowerShell 的 `npm.ps1` 执行策略问题。

## Task 1: 建立工作台领域类型与可测试队列状态机

**Files:**

- Create: `SD/components/tools/image-workbench/types.ts`
- Create: `SD/components/tools/image-workbench/queue.ts`
- Create: `SD/components/tools/image-workbench/queue.test.ts`

- [ ] **Step 1: 先写队列状态机失败测试**

在 `queue.test.ts` 覆盖添加文件、单项参数覆盖、应用到全部、处理中、成功、多输出、失败、重试、移除和选中项回退：

```ts
import { describe, expect, it } from 'vitest';
import { createBatchItems, imageQueueReducer } from './queue';

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

describe('imageQueueReducer', () => {
  it('keeps independent params and applies shared params on demand', () => {
    const [first, second] = createBatchItems([file('a.png'), file('b.png')], { quality: 80 });
    let state = { items: [first, second], selectedId: first.id };
    state = imageQueueReducer(state, {
      type: 'set-item-params',
      id: first.id,
      params: { quality: 60 },
    });
    expect(state.items.map((item) => item.params.quality)).toEqual([60, 80]);
    state = imageQueueReducer(state, { type: 'apply-params-to-all', params: { quality: 70 } });
    expect(state.items.map((item) => item.params.quality)).toEqual([70, 70]);
    expect(state.items.every((item) => item.stale)).toBe(true);
  });

  it('tracks multiple outputs, errors, retries and selection fallback', () => {
    const [first, second] = createBatchItems([file('a.png'), file('b.png')], { rows: 2 });
    let state = { items: [first, second], selectedId: first.id };
    state = imageQueueReducer(state, { type: 'start', id: first.id });
    expect(state.items[0].status).toBe('processing');
    state = imageQueueReducer(state, {
      type: 'succeed',
      id: first.id,
      outputs: [
        { id: 'one', name: 'a-1.png', blob: new Blob(), url: 'blob:one' },
        { id: 'two', name: 'a-2.png', blob: new Blob(), url: 'blob:two' },
      ],
    });
    expect(state.items[0].outputs).toHaveLength(2);
    state = imageQueueReducer(state, { type: 'fail', id: second.id, error: '无法解码图片' });
    expect(state.items[1].status).toBe('error');
    state = imageQueueReducer(state, { type: 'retry', id: second.id });
    expect(state.items[1].status).toBe('queued');
    state = imageQueueReducer(state, { type: 'remove', id: first.id });
    expect(state.selectedId).toBe(second.id);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `npm.cmd test -- components/tools/image-workbench/queue.test.ts`

Expected: FAIL，提示无法解析 `./queue`。

- [ ] **Step 3: 实现稳定的领域类型**

`types.ts` 必须导出以下类型，后续所有工具只使用这些命名：

```ts
export type BatchItemStatus = 'queued' | 'processing' | 'done' | 'error';
export type ProcessorMode = 'per-file' | 'group';

export interface ImageMetadata {
  width: number;
  height: number;
  mime: string;
  bytes: number;
}

export interface ProcessedAsset {
  name: string;
  blob: Blob;
  width?: number;
  height?: number;
}

export interface OutputAsset extends ProcessedAsset {
  id: string;
  url: string;
}

export interface BatchItem<P> {
  id: string;
  file: File;
  sourceUrl: string;
  metadata: ImageMetadata | null;
  params: P;
  status: BatchItemStatus;
  progress: number;
  outputs: OutputAsset[];
  error: string | null;
  stale: boolean;
}

export interface ProcessorContext {
  preview: boolean;
  signal: AbortSignal;
}

export interface ImageProcessor<P> {
  accept: string;
  mode: ProcessorMode;
  defaultParams: P;
  maxFiles?: number;
  concurrency?: number;
  process(
    files: readonly File[],
    params: P,
    context: ProcessorContext,
  ): Promise<ProcessedAsset[]>;
}

export interface ImageQueueState<P> {
  items: BatchItem<P>[];
  selectedId: string | null;
}
```

- [ ] **Step 4: 实现不可变队列 reducer**

`queue.ts` 导出 `createBatchItems`、`ImageQueueAction<P>` 和 `imageQueueReducer`。ID 使用模块内自增序号与 `Date.now()`，不能依赖测试环境可能缺失的 `crypto.randomUUID()`。所有参数修改都将结果标记为 `stale`；成功后清空错误并设 `progress: 100`；重试保留输入和参数但清空输出。

- [ ] **Step 5: 运行测试并提交**

Run: `npm.cmd test -- components/tools/image-workbench/queue.test.ts`

Expected: PASS，2 tests passed。

Run: `git add SD/components/tools/image-workbench/types.ts SD/components/tools/image-workbench/queue.ts SD/components/tools/image-workbench/queue.test.ts && git commit -m "feat(image-tools): add batch queue state model"`

## Task 2: 建立解码、限流处理、资源释放和 ZIP 下载基础设施

**Files:**

- Create: `SD/components/tools/image-workbench/processing.ts`
- Create: `SD/components/tools/image-workbench/processing.test.ts`
- Create: `SD/components/tools/image-workbench/download.ts`
- Create: `SD/components/tools/image-workbench/download.test.ts`

- [ ] **Step 1: 写并发和命名失败测试**

`processing.test.ts` 测试最多同时运行 2 项、任务输出顺序与输入一致、单项失败不吞错、AbortSignal 中断后不启动新任务。`download.test.ts` 测试扩展名替换、重复文件名去重和 ZIP 内容：

```ts
import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './processing';

describe('runWithConcurrency', () => {
  it('never exceeds the configured worker count', async () => {
    let active = 0;
    let peak = 0;
    const results = await runWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });
    expect(peak).toBe(2);
    expect(results).toEqual([2, 4, 6, 8]);
  });
});
```

```ts
import { describe, expect, it } from 'vitest';
import { buildOutputName, buildZipBlob } from './download';

describe('image output downloads', () => {
  it('builds deterministic names', () => {
    expect(buildOutputName('photo.jpeg', '-compressed', 'webp')).toBe('photo-compressed.webp');
  });

  it('creates a zip containing every output', async () => {
    const zip = await buildZipBlob([
      { id: '1', name: 'a.png', blob: new Blob(['a']), url: 'blob:a' },
      { id: '2', name: 'a.png', blob: new Blob(['b']), url: 'blob:b' },
    ]);
    expect(zip.type).toBe('application/zip');
    expect(zip.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/processing.test.ts components/tools/image-workbench/download.test.ts`

Expected: FAIL，两个实现模块均不存在。

- [ ] **Step 3: 实现处理基础设施**

`processing.ts` 导出：

- `runWithConcurrency<T, R>(items, concurrency, worker, signal?)`
- `decodeImage(file, signal)`，优先使用 `createImageBitmap`，回退到 `Image` + Object URL
- `readImageMetadata(file, signal)`
- `canvasToProcessedAsset(canvas, name, mime, quality?)`
- `revokeOutputAssets(outputs)`
- `formatProcessingError(error)`，将 AbortError、解码失败、Canvas 导出失败统一映射为中文可行动提示

并发数使用 `Math.max(1, Math.min(concurrency, items.length))`，默认调用方固定传 2。回退解码路径必须在 `finally` 撤销临时 Object URL。

- [ ] **Step 4: 实现按需 ZIP 和浏览器下载**

`download.ts` 使用现有依赖 `jszip`，导出：

```ts
export function buildOutputName(sourceName: string, suffix: string, extension: string): string;
export function dedupeOutputNames(outputs: readonly OutputAsset[]): Array<OutputAsset & { downloadName: string }>;
export function downloadBlob(blob: Blob, filename: string): void;
export function downloadOutput(output: OutputAsset): void;
export async function buildZipBlob(outputs: readonly OutputAsset[]): Promise<Blob>;
export async function downloadOutputsAsZip(outputs: readonly OutputAsset[], filename: string): Promise<void>;
```

ZIP 只在点击“打包下载”时生成；同名输出依次追加 `-2`、`-3`，不能覆盖。

- [ ] **Step 5: 运行测试并提交**

Run: `npm.cmd test -- components/tools/image-workbench/processing.test.ts components/tools/image-workbench/download.test.ts`

Expected: PASS。

Run: `git add SD/components/tools/image-workbench/processing.ts SD/components/tools/image-workbench/processing.test.ts SD/components/tools/image-workbench/download.ts SD/components/tools/image-workbench/download.test.ts && git commit -m "feat(image-tools): add local processing and zip utilities"`

## Task 3: 实现统一 hook 与浅色工作台基础组件

**Files:**

- Create: `SD/components/tools/image-workbench/useImageBatch.ts`
- Create: `SD/components/tools/image-workbench/ImageWorkbench.tsx`
- Create: `SD/components/tools/image-workbench/BatchImageTool.tsx`
- Create: `SD/components/tools/image-workbench/ImageDropzone.tsx`
- Create: `SD/components/tools/image-workbench/ImageBatchQueue.tsx`
- Create: `SD/components/tools/image-workbench/ImagePreviewPane.tsx`
- Create: `SD/components/tools/image-workbench/ImageParameterPanel.tsx`
- Create: `SD/components/tools/image-workbench/ImageActionBar.tsx`
- Create: `SD/components/tools/image-workbench/controls.tsx`
- Create: `SD/components/tools/image-workbench/index.ts`
- Create: `SD/components/tools/image-workbench/ImageWorkbench.test.tsx`
- Modify: `SD/index.css`

- [ ] **Step 1: 写静态结构与可访问性失败测试**

`ImageWorkbench.test.tsx` 使用 `renderToStaticMarkup`，不引入新的 DOM 测试依赖：

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImageWorkbench } from './ImageWorkbench';

describe('ImageWorkbench', () => {
  it('renders the control, preview and action landmarks', () => {
    const html = renderToStaticMarkup(
      <ImageWorkbench
        upload={<button type="button">上传图片</button>}
        controls={<label>质量<input aria-label="质量" type="range" /></label>}
        preview={<img src="data:image/png;base64,eA==" alt="处理预览" />}
        actions={<button type="button">下载</button>}
      />,
    );
    expect(html).toContain('image-workbench');
    expect(html).toContain('aria-label="图片处理参数"');
    expect(html).toContain('aria-label="图片预览"');
    expect(html).toContain('aria-live="polite"');
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/ImageWorkbench.test.tsx`

Expected: FAIL，`ImageWorkbench` 尚不存在。

- [ ] **Step 3: 实现 `useImageBatch`**

hook 的公开返回值固定为：

```ts
export interface UseImageBatchResult<P> {
  items: BatchItem<P>[];
  selected: BatchItem<P> | null;
  isProcessing: boolean;
  addFiles(files: readonly File[]): Promise<void>;
  removeItem(id: string): void;
  selectItem(id: string): void;
  setSelectedParams(params: P): void;
  applyParamsToAll(params: P): void;
  processSelected(): Promise<void>;
  processAll(): Promise<void>;
  retryItem(id: string): Promise<void>;
  reset(): void;
  allOutputs: OutputAsset[];
}
```

实现要求：

- `per-file` 模式每个队列项独立调用处理器，`group` 模式把全部输入作为一个任务。
- `processAll` 通过 `runWithConcurrency` 使用 `processor.concurrency ?? 2`。
- 单图参数变化后 200ms 防抖触发预览；队列超过 1 张时不自动批处理。
- 参数变化或重试前撤销旧输出 URL；组件卸载时撤销全部 source/output URL 并 abort。
- 新文件读取元数据失败时保留队列项并显示错误，不崩溃整个工作台。

- [ ] **Step 4: 实现可组合 UI 和浅色样式**

`ImageWorkbench` 只负责布局，接口固定为四个主要插槽和可选队列/提示：

```tsx
export interface ImageWorkbenchProps {
  upload: React.ReactNode;
  controls: React.ReactNode;
  queue?: React.ReactNode;
  preview: React.ReactNode;
  actions: React.ReactNode;
  notice?: React.ReactNode;
}
```

`BatchImageTool<P>` 组合 hook、上传区、队列、双预览与动作栏，供标准工具使用。低层组件必须满足：

- 上传区支持点击、拖拽、键盘 Enter/Space、多选和文件类型/数量提示。
- 队列展示缩略图、文件名、尺寸、体积、状态、失败原因、重试与删除。
- 预览区并排显示原图/处理后结果，窄屏自动上下排列；空态保留明确文本。
- 参数区使用原生 label，滑杆同时提供数值输入；预设使用可选按钮组。
- 动作栏包含“重置”“处理选中”“处理全部”“下载选中”“打包下载”。不可用时真正设置 `disabled`。
- 状态提示使用 `aria-live="polite"`，错误使用 `role="alert"`。
- 禁止 `window.alert`。

在 `index.css` 新增仅以 `.image-workbench` 开头的作用域样式：暖白背景、白色卡片、淡米灰边框、轻阴影、蓝色主按钮；桌面控制栏宽 360px，预览自适应；`max-width: 920px` 时改单列；`prefers-reduced-motion: reduce` 时关闭过渡。

- [ ] **Step 5: 运行组件测试、类型检查并提交**

Run: `npm.cmd test -- components/tools/image-workbench/ImageWorkbench.test.tsx components/tools/image-workbench/queue.test.ts components/tools/image-workbench/processing.test.ts components/tools/image-workbench/download.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image-workbench SD/index.css && git commit -m "feat(image-tools): build light image workbench shell"`

## Task 4: 让 ToolWindow 为图片工作台提供正确宽度并移除嵌套卡片

**Files:**

- Modify: `SD/pages/toolUiLayout.ts`
- Modify: `SD/pages/toolUiLayout.test.ts`
- Modify: `SD/components/ToolWindow.tsx`

- [ ] **Step 1: 扩展布局失败测试**

在现有 `toolUiLayout.test.ts` 保留默认工具断言，并新增：

```ts
import {
  getToolComponentShellClass,
  getToolWindowContentClass,
  usesImageWorkbench,
} from './toolUiLayout';

it('gives image categories a wider unwrapped workbench shell', () => {
  expect(usesImageWorkbench('image')).toBe(true);
  expect(usesImageWorkbench('image-enhance')).toBe(true);
  expect(usesImageWorkbench('text')).toBe(false);
  expect(getToolWindowContentClass('image')).toContain('max-w-[1500px]');
  expect(getToolComponentShellClass('image')).not.toContain('glass-card');
  expect(getToolComponentShellClass('text')).toContain('glass-card');
});
```

- [ ] **Step 2: 运行测试确认缺少新函数**

Run: `npm.cmd test -- pages/toolUiLayout.test.ts`

Expected: FAIL，缺少三个导出。

- [ ] **Step 3: 实现分类布局 helper**

在 `toolUiLayout.ts` 实现：

```ts
const IMAGE_WORKBENCH_CATEGORIES = new Set(['image', 'image-enhance']);

export function usesImageWorkbench(category: string): boolean {
  return IMAGE_WORKBENCH_CATEGORIES.has(category);
}

export function getToolWindowContentClass(category: string): string {
  return usesImageWorkbench(category)
    ? 'max-w-[1500px] mx-auto px-4 py-6 sm:px-6 lg:px-8'
    : TOOL_WINDOW_CONTENT_CLASS;
}

export function getToolComponentShellClass(category: string): string {
  return usesImageWorkbench(category)
    ? 'mb-6'
    : 'glass-card rounded-2xl p-6 mb-6';
}
```

- [ ] **Step 4: 接入 ToolWindow**

将 `ToolWindow.tsx` 的内容容器和工具组件外壳改为调用上述 helper。标题、描述、广告位、使用指南、FAQ、相关文章和 `onClose` 传参保持原行为；非图片工具生成的 class 必须字节级保持当前值。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- pages/toolUiLayout.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/pages/toolUiLayout.ts SD/pages/toolUiLayout.test.ts SD/components/ToolWindow.tsx && git commit -m "feat(image-tools): fit workbench into tool window"`

## Task 5: 提取 Canvas 处理器并用像素级纯函数测试锁定结果

**Files:**

- Create: `SD/components/tools/image/processors/basic.ts`
- Create: `SD/components/tools/image/processors/basic.test.ts`
- Create: `SD/components/tools/image/processors/conversion.ts`
- Create: `SD/components/tools/image/processors/conversion.test.ts`
- Create: `SD/components/tools/image/processors/composition.ts`
- Create: `SD/components/tools/image-enhance/processors/filters.ts`
- Create: `SD/components/tools/image-enhance/processors/filters.test.ts`
- Create: `SD/components/tools/image-enhance/processors/overlay.ts`

- [ ] **Step 1: 写不依赖浏览器 Canvas 的数学测试**

将可测试计算与绘制调用分离。测试至少覆盖：

- 保持比例缩放尺寸与不保持比例尺寸。
- `contain` / `cover` 绘制矩形。
- 九宫格切片坐标无缝覆盖原图。
- 亮度、对比度、饱和度像素变换范围夹在 0–255。
- 锐化卷积的边缘策略不会越界。
- 水印和文字的九宫格定位点。
- 社媒比例裁切矩形。

示例：

```ts
import { describe, expect, it } from 'vitest';
import { fitDimensions, splitGridRects } from './basic';

describe('basic image calculations', () => {
  it('keeps aspect ratio from width', () => {
    expect(fitDimensions(1200, 800, 600, undefined, true)).toEqual({ width: 600, height: 400 });
  });

  it('covers every source pixel when splitting', () => {
    expect(splitGridRects(5, 5, 2, 2)).toEqual([
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 3, y: 0, width: 2, height: 3 },
      { x: 0, y: 3, width: 3, height: 2 },
      { x: 3, y: 3, width: 2, height: 2 },
    ]);
  });
});
```

- [ ] **Step 2: 运行处理器测试并确认失败**

Run: `npm.cmd test -- components/tools/image/processors/basic.test.ts components/tools/image/processors/conversion.test.ts components/tools/image-enhance/processors/filters.test.ts`

Expected: FAIL，处理器文件不存在。

- [ ] **Step 3: 实现基础与转换处理器**

`basic.ts` 导出压缩、缩放、裁剪、图片水印处理器和所有布局计算函数。`conversion.ts` 导出 Data URL/Blob 转换、分割、favicon 多尺寸输出、证件照尺寸换算。`composition.ts` 导出横向、纵向、网格合并布局与处理器。

处理器共同规则：

- 输出扩展名与 MIME 一致；JPEG 输出先铺白底，避免透明区变黑。
- 默认保留原始方向和可见内容，不读取或上传外部资源。
- 处理前检查 `AbortSignal`，每次大循环也检查。
- 输出命名使用 `buildOutputName`。

- [ ] **Step 4: 实现滤镜与叠加处理器**

`filters.ts` 导出亮度/对比度/饱和度、锐度评分、锐化卷积和 EXIF 清理重编码处理器。`overlay.ts` 导出文字、水印、马赛克、截图美化、梗图和社媒封面绘制函数。锐度与锐化必须分开：锐度工具输出评分和可视化建议，锐化工具输出新图片。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image/processors/basic.test.ts components/tools/image/processors/conversion.test.ts components/tools/image-enhance/processors/filters.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image/processors SD/components/tools/image-enhance/processors && git commit -m "refactor(image-tools): extract tested canvas processors"`

## Task 6: 迁移压缩、尺寸、裁剪和基础水印四个高频工具

**Files:**

- Modify: `SD/components/tools/image/CompressImage.tsx`
- Modify: `SD/components/tools/image/ResizeImage.tsx`
- Modify: `SD/components/tools/image/CropImage.tsx`
- Modify: `SD/components/tools/image/WatermarkImage.tsx`
- Create: `SD/components/tools/image-workbench/coreTools.test.tsx`

- [ ] **Step 1: 写四工具工作台契约失败测试**

静态渲染四个组件，断言不出现嵌套页面标题、不出现 `alert(` 源码、出现工作台 class、上传输入支持 `multiple`，并分别出现关键控件：压缩质量/输出格式、宽高/保持比例、裁剪比例/坐标、水印位置/透明度。

- [ ] **Step 2: 运行测试确认旧 UI 不满足契约**

Run: `npm.cmd test -- components/tools/image-workbench/coreTools.test.tsx`

Expected: FAIL，旧组件未渲染 `image-workbench` 或不支持批量。

- [ ] **Step 3: 使用 `BatchImageTool` 迁移压缩和尺寸调整**

压缩参数固定为：

```ts
interface CompressParams {
  quality: number;
  format: 'original' | 'jpeg' | 'png' | 'webp';
  stripMetadata: boolean;
}
```

预设为“轻度 90%”“均衡 80%”“极致 60%”。结果区显示原体积、输出体积、节省百分比。

尺寸参数固定为：

```ts
interface ResizeParams {
  width: number;
  height: number;
  keepAspectRatio: boolean;
  format: 'original' | 'jpeg' | 'png' | 'webp';
  quality: number;
}
```

预设为“25%”“50%”“75%”“原尺寸”，提供宽高互换。批量时每项保存自己的原始比例和计算后尺寸。

- [ ] **Step 4: 迁移裁剪和水印**

裁剪使用低层 `ImageWorkbench`，左侧保留比例预设 `自由/1:1/4:3/16:9/3:4`，右侧在 canvas 上拖动裁剪框；队列切换时恢复对应裁剪参数。批量模式下允许“将比例应用到全部”，但不得把一张图的绝对像素坐标复制给不同尺寸图片。

水印使用 `BatchImageTool`，参数包括图片/文字模式、内容、字体、字号、颜色、透明度、旋转角、边距和九宫格位置。图片水印资源只保存在内存并在重置/卸载时释放 URL。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/coreTools.test.tsx components/tools/image/processors/basic.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image/CompressImage.tsx SD/components/tools/image/ResizeImage.tsx SD/components/tools/image/CropImage.tsx SD/components/tools/image/WatermarkImage.tsx SD/components/tools/image-workbench/coreTools.test.tsx && git commit -m "feat(image-tools): migrate core tools to workbench"`

## Task 7: 迁移 Base64 与取色工具，统一文本结果体验

**Files:**

- Modify: `SD/components/tools/image/ImageToBase64.tsx`
- Modify: `SD/components/tools/image/Base64ToImage.tsx`
- Modify: `SD/components/tools/image/ColorPicker.tsx`
- Create: `SD/components/tools/image-workbench/conversionTools.test.tsx`

- [ ] **Step 1: 写转换工具失败测试**

断言：图片转 Base64 支持多文件队列和逐项复制；Base64 转图片提供输入格式校验、预览和下载；取色器提供 HEX/RGB/HSL 三种结果、复制按钮和最近颜色列表；三个组件都使用 `ImageWorkbench` 且无 `alert`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/conversionTools.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 迁移 ImageToBase64 与 Base64ToImage**

为工作台增加可复用 `TextResultPanel`，放在 `ImagePreviewPane` 同目录并从 `index.ts` 导出。文本过长时虚拟为只读 textarea，不把完整 Base64 同时重复渲染到多个 DOM 节点。复制成功通过 `aria-live` 显示“已复制”，剪贴板失败显示手动复制提示。

Base64 转图片在 200ms 防抖后解析；接受带 MIME 的 Data URL 和纯 Base64；纯 Base64 默认按 PNG 尝试，并在签名识别到 JPEG/WebP/GIF 时更正 MIME。

- [ ] **Step 4: 迁移 ColorPicker**

右侧为放大镜取色画布；键盘方向键可微调采样点；点击颜色记录最近 8 个值；复制格式按钮同时显示 HEX、RGB、HSL。跨队列切换时保留每张图各自采样点。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/conversionTools.test.tsx components/tools/image/processors/conversion.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image/ImageToBase64.tsx SD/components/tools/image/Base64ToImage.tsx SD/components/tools/image/ColorPicker.tsx SD/components/tools/image-workbench && git commit -m "feat(image-tools): unify conversion and color tools"`

## Task 8: 迁移合并、切图和 Favicon，多输出结果完整接入 ZIP

**Files:**

- Modify: `SD/components/tools/image/MergeImages.tsx`
- Modify: `SD/components/tools/image/SplitImageGrid.tsx`
- Modify: `SD/components/tools/image/FaviconGenerator.tsx`
- Create: `SD/components/tools/image-workbench/groupOutputTools.test.tsx`

- [ ] **Step 1: 写分组和多输出失败测试**

断言合并工具支持拖拽排序和 group 模式；切图工具显示行列与预计输出数量；favicon 显示 16/32/48/64/128/180/192/512 尺寸开关；切图和 favicon 的动作栏同时有单项下载和 ZIP 下载。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/groupOutputTools.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 迁移 MergeImages**

使用 `processor.mode = 'group'`。队列支持 HTML5 drag/drop 排序，并提供键盘“上移/下移”按钮。参数包含布局 `horizontal/vertical/grid`、列数、间距、背景色、对齐方式和统一尺寸策略 `original/contain/cover`。结果始终为单张图。

- [ ] **Step 4: 迁移 SplitImageGrid 与 FaviconGenerator**

切图参数为行、列、输出格式、质量，命名采用 `原名-r{行}-c{列}.扩展名`。Favicon 输出选中尺寸的 PNG，并额外生成一个包含这些 PNG 的 `.ico`（若现有实现无法生成多帧 ICO，则保留 PNG ZIP，界面明确写“PNG 图标包”，不得伪称 ICO）。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/groupOutputTools.test.tsx components/tools/image-workbench/download.test.ts components/tools/image/processors/basic.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image/MergeImages.tsx SD/components/tools/image/SplitImageGrid.tsx SD/components/tools/image/FaviconGenerator.tsx SD/components/tools/image-workbench/groupOutputTools.test.tsx && git commit -m "feat(image-tools): add grouped and multi-output workbenches"`

## Task 9: 将两个证件照工具接入工作台且保留本地抠图编辑

**Files:**

- Modify: `SD/components/tools/image/IdPhotoResize.tsx`
- Modify: `SD/components/tools/image/IdPhotoBgColor.tsx`
- Modify: `SD/components/tools/image/IdPhotoBgColor.test.tsx`
- Create: `SD/components/tools/image-workbench/idPhotoTools.test.tsx`

- [ ] **Step 1: 扩展现有证件照测试**

保留 `IdPhotoBgColor.test.tsx` 的纯工具函数断言，新增静态结构断言：工作台、模型加载状态、原图/蒙版/结果三种预览、背景色预设、自定义颜色、边缘优化、撤销和下载。`IdPhotoResize` 断言包含一寸/二寸/小一寸/小二寸/护照预设和 DPI。

- [ ] **Step 2: 运行测试确认工作台结构尚未接入**

Run: `npm.cmd test -- components/tools/image/IdPhotoBgColor.test.tsx components/tools/image-workbench/idPhotoTools.test.tsx`

Expected: FAIL，新工作台断言失败；现有纯函数测试继续通过。

- [ ] **Step 3: 迁移 IdPhotoResize**

使用标准批量模式，预设必须明确显示毫米、像素和 DPI；自定义模式允许宽高毫米与 150/300/600 DPI。输出默认 JPEG 90%，背景为白色；结果元数据显示最终像素和打印尺寸。

- [ ] **Step 4: 包装 IdPhotoBgColor 而不重写分割核心**

保留现有本地模型加载、mask 推理、边缘优化和手工修补函数，只把上传区、参数卡、预览卡、状态和动作区替换为工作台组件。模型只加载一次；队列切换时缓存每项 mask；内存压力过高时只保留最近 3 项 mask，其余标记为需要重新处理。失败提示写明“模型加载失败/人物未识别/图片解码失败”中的具体一种。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image/IdPhotoBgColor.test.tsx components/tools/image-workbench/idPhotoTools.test.tsx`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image/IdPhotoResize.tsx SD/components/tools/image/IdPhotoBgColor.tsx SD/components/tools/image/IdPhotoBgColor.test.tsx SD/components/tools/image-workbench/idPhotoTools.test.tsx && git commit -m "feat(image-tools): integrate id photo tools into workbench"`

## Task 10: 迁移锐度、亮度、锐化和 EXIF 四个增强工具

**Files:**

- Modify: `SD/components/tools/image-enhance/ImageSharpness.tsx`
- Modify: `SD/components/tools/image-enhance/ImageBrightness.tsx`
- Modify: `SD/components/tools/image-enhance/ImageSharpen.tsx`
- Modify: `SD/components/tools/image-enhance/ImageExifRemover.tsx`
- Create: `SD/components/tools/image-workbench/filterTools.test.tsx`

- [ ] **Step 1: 写滤镜工具失败测试**

断言四个工具支持多文件；亮度工具含亮度/对比度/饱和度与预设；锐化含强度/半径/阈值；锐度检测展示评分和分级；EXIF 清理展示清理前后元数据与节省体积。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/filterTools.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 迁移 ImageSharpness、ImageBrightness 与 ImageSharpen**

亮度和锐化使用单图 200ms 实时预览，批量需点“处理全部”。锐度检测输出只读评分结果，阈值固定分为“偏模糊/一般/清晰”，同时显示评分计算是辅助参考。锐化前后可使用按住对比滑块，但需保留并排预览作为键盘和低动效回退。

- [ ] **Step 4: 迁移 ImageExifRemover**

EXIF 清理的队列先读取可展示元数据；删除时通过 Canvas 重编码，界面明确说明会移除拍摄时间、设备、定位等元数据，也可能改变文件体积。PNG/WebP 不显示 JPEG 专属字段。下载命名追加 `-clean`。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/filterTools.test.tsx components/tools/image-enhance/processors/filters.test.ts`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image-enhance/ImageSharpness.tsx SD/components/tools/image-enhance/ImageBrightness.tsx SD/components/tools/image-enhance/ImageSharpen.tsx SD/components/tools/image-enhance/ImageExifRemover.tsx SD/components/tools/image-workbench/filterTools.test.tsx && git commit -m "feat(image-tools): migrate filter tools to workbench"`

## Task 11: 迁移增强水印、文字和马赛克交互工具

**Files:**

- Modify: `SD/components/tools/image-enhance/ImageEnhanceWatermark.tsx`
- Modify: `SD/components/tools/image-enhance/ImageAddText.tsx`
- Modify: `SD/components/tools/image-enhance/ImageMosaic.tsx`
- Create: `SD/components/tools/image-workbench/overlayTools.test.tsx`

- [ ] **Step 1: 写叠加工具失败测试**

断言增强水印包含平铺密度和防移除旋转；文字工具包含字体、粗细、字号、行高、描边、阴影、位置；马赛克包含画笔大小、强度、撤销、重做、清空蒙版；三者都显示原图/结果和批量能力说明。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/overlayTools.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 迁移 ImageEnhanceWatermark 与 ImageAddText**

增强水印与基础水印共享 `overlay.ts`，但默认开启平铺并提供密度预设“稀疏/标准/密集”。文字工具支持画布内拖动文字，键盘方向键每次移动 1px，Shift+方向键移动 10px；批量应用时用归一化坐标而不是绝对像素。

- [ ] **Step 4: 迁移 ImageMosaic**

使用低层工作台和 canvas 双层结构：底层原图，上层只存储笔触蒙版。撤销栈最多 30 步，切换队列保留各项蒙版；“应用到全部”只复制画笔参数，不复制笔触。导出时将蒙版区域像素化，预览和最终输出使用同一函数。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/overlayTools.test.tsx`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image-enhance/ImageEnhanceWatermark.tsx SD/components/tools/image-enhance/ImageAddText.tsx SD/components/tools/image-enhance/ImageMosaic.tsx SD/components/tools/image-workbench/overlayTools.test.tsx && git commit -m "feat(image-tools): upgrade overlay editing tools"`

## Task 12: 迁移截图美化、梗图和社媒封面创作工具

**Files:**

- Modify: `SD/components/tools/image-enhance/ScreenshotBeautify.tsx`
- Modify: `SD/components/tools/image-enhance/MemeGenerator.tsx`
- Modify: `SD/components/tools/image-enhance/SocialMediaCover.tsx`
- Create: `SD/components/tools/image-workbench/creativeTools.test.tsx`

- [ ] **Step 1: 写创作工具失败测试**

断言截图美化有背景、圆角、阴影、内边距、比例预设；梗图有顶部/底部文字、字体、描边、对齐；社媒封面有常见平台尺寸预设、安全区和背景模式。三者均可重置、下载并显示最终尺寸。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- components/tools/image-workbench/creativeTools.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 迁移 ScreenshotBeautify 与 MemeGenerator**

截图美化预设固定为“自动”“1:1”“4:3”“16:9”“手机长图”，背景支持纯色和双色线性渐变。梗图默认白色 Impact 风格描边，但中文自动回退到系统无衬线字体；文字区支持换行，预览自动缩放字号以避免超出画布。

- [ ] **Step 4: 迁移 SocialMediaCover**

平台预设写入组件常量并展示尺寸，不从网络获取：小红书竖版 1242×1660、公众号首图 900×383、B 站封面 1146×717、视频号竖版 1080×1440、抖音竖版 1080×1440、通用 16:9 1920×1080。安全区只用于预览，默认不写入导出图片；裁切模式支持 contain/cover 和焦点位置。

- [ ] **Step 5: 验证并提交**

Run: `npm.cmd test -- components/tools/image-workbench/creativeTools.test.tsx`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS。

Run: `git add SD/components/tools/image-enhance/ScreenshotBeautify.tsx SD/components/tools/image-enhance/MemeGenerator.tsx SD/components/tools/image-enhance/SocialMediaCover.tsx SD/components/tools/image-workbench/creativeTools.test.tsx && git commit -m "feat(image-tools): migrate creative image tools"`

## Task 13: 全量契约、移动端、性能、无障碍和生产构建验收

**Files:**

- Create: `SD/components/tools/image-workbench/migrationContract.test.ts`
- Create: `SD/components/tools/image-workbench/accessibilityContract.test.tsx`
- Modify: `SD/index.css`
- Modify: `SD/components/tools/image-workbench/ImageBatchQueue.tsx`
- Modify: `SD/components/tools/image-workbench/ImagePreviewPane.tsx`
- Modify: `SD/components/tools/image-workbench/ImageActionBar.tsx`

- [ ] **Step 1: 写覆盖全部 22 文件的迁移契约**

`migrationContract.test.ts` 用 `node:fs` 读取 Scope contract 中的 22 个文件并断言：

- 每个文件导入 `image-workbench`。
- 不包含 `alert(`、`window.alert`、远程上传 API、硬编码 `http://` 或 `https://` 处理地址。
- 仍导出默认 React 组件并接受 `{ onClose: () => void }`，以兼容注册表。
- 22 个文件全部被枚举，测试中的数组长度严格为 22。

`accessibilityContract.test.tsx` 静态渲染基础组件，断言按钮文字、label、aria-live、role=alert、disabled、键盘可达上传区和图片 alt。

- [ ] **Step 2: 运行全量测试并收集真实失败项**

Run: `npm.cmd test`

Expected: 初次可能 FAIL；只修复本次图片工作台造成的失败，不改动无关模块行为。将每个失败归类为类型、资源释放、处理器结果、静态契约或已有无关失败。

- [ ] **Step 3: 完成移动端和性能收尾**

逐项验证并修复：

- 360px 宽度无横向滚动；主要按钮最小高度 44px。
- 队列超过 30 项时缩略图使用 `loading="lazy"`，只展示选中项大预览。
- 默认并发 2，单项失败不阻塞其他项。
- 预览最长边限制在 1600px；最终下载按用户设置原尺寸处理。
- 组件卸载、移除项目、重新处理、重置都会 revoke Object URL。
- 切换输入或参数会 abort 过时任务，旧结果不得覆盖新结果。
- 批量 ZIP 在点击时生成，完成后释放临时 URL。
- `prefers-reduced-motion`、高对比度焦点环、键盘操作完整。

- [ ] **Step 4: 执行全部自动化验收**

Run: `npm.cmd test`

Expected: PASS。

Run: `npm.cmd run lint`

Expected: PASS，TypeScript 0 errors。

Run: `npm.cmd run validate`

Expected: PASS，注册表验证成功且 URL/slug 不变。

Run: `npm.cmd run build`

Expected: PASS，生成 `SD/dist`，无 unresolved import。

- [ ] **Step 5: 手工浏览器验收与最终提交**

Run: `npm.cmd run dev -- --host 127.0.0.1`

在桌面 1440px 和移动端 390px 逐项检查 22 个工具，至少各使用一张 PNG 和一张 JPEG；批量工具额外使用 5 张混合尺寸图片。重点检查拖拽、队列切换、参数应用到全部、错误重试、下载命名、ZIP 内容、刷新后无残留 URL、页面浅色风格与主站一致。

Run: `git status --short`

确认只包含本计划文件与预期构建改动；不要提交 `SD/dist`，除非仓库当前发布流程明确跟踪它。

Run: `git add SD/components/tools/image-workbench SD/components/tools/image SD/components/tools/image-enhance SD/components/ToolWindow.tsx SD/pages/toolUiLayout.ts SD/pages/toolUiLayout.test.ts SD/index.css && git commit -m "feat(image-tools): complete unified image workbench"`

## Final acceptance checklist

- [ ] 22 个目标工具全部使用统一浅色工作台，原 URL 和注册表定义不变。
- [ ] 所有适合批量的工具支持队列；一对多和多对一输出语义正确。
- [ ] 单图参数更新约 200ms 后预览，批量只在明确操作时运行。
- [ ] 原图、结果、尺寸、格式和体积元数据可见。
- [ ] 重置、重试、下载选中、下载全部、ZIP 和错误反馈一致。
- [ ] 没有 `alert()`，没有外部图片处理请求，没有敏感数据上传。
- [ ] 桌面双栏、移动端单栏、键盘操作、焦点环和 reduced motion 可用。
- [ ] 全量测试、TypeScript、注册表校验和生产构建全部通过。

