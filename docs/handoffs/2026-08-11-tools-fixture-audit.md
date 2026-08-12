# 工具真实测试夹具审计

更新时间：2026-08-11  
工作区：`E:\\AI\\gp`  
前端：`E:\\AI\\gp\\SD`，`http://127.0.0.1:5173`

## 结论

主工作区的工具注册、构建和路由级检查通过，但真实文件验证发现了几个不能忽略的问题：NCM 转换器当前对标准 NCM 文件确定失败；3 个允许上传 `.docx` 的工具仍把 Office 二进制当作普通文本读取；扫描型 PDF 没有文本层，需要明确走 OCR；浏览器内 OCR 在本次运行中没有在可接受时间内完成。

因此目前可以说“前端入口和基础逻辑可用”，不能说“184 个工具都已完成真实文件端到端验证”。

## 已验证通过

### 工程级检查

- 工具注册：184 个工具、16 个分类，`npm.cmd run validate` 通过。
- TypeScript：`npm.cmd run lint`（`tsc --noEmit`）通过。
- 单元/专项测试：27 个测试文件、93 个测试通过。
- 生产构建：`npm.cmd run build -- --logLevel warn` 通过；只有 bundle 大小提示，没有编译错误。
- 路由扫描：184/184 个 `/tool/<id>` 页面成功渲染，没有捕获到错误边界文本。
- `git diff --check` 通过；工作区原有改动未被回退或覆盖。

### 代表性工具交互

以下交互在运行中的 `5173` 前端完成：

| 工具 | 操作 | 结果 |
| --- | --- | --- |
| 结构化数据转换 | JSON 转 YAML | 通过，输出包含 `name:` |
| CIDR 计算器 | 输入网段 | 通过，显示网络地址 |
| Cron 工具 | 输入 `0 9 * * 1` | 通过，显示下次执行时间 |
| 编码修复 | 检测乱码 | 通过，修复按钮状态正确 |
| 引用工作台 | 导入引用文本 | 通过，条目可见 |
| 高级文本对比 | 对比两段文本 | 通过，差异词可见 |

### `ceshi` 夹具完整性

| 文件 | 检查结果 |
| --- | --- |
| `01.docx` | DOCX ZIP 有效；178 个段落、34 个表格；可由 Mammoth 转换为 HTML（20,410 字符），文本抽取 10,346 字符 |
| `02.pdf` | PDF 有效，共 14 页；属于扫描/图片型 PDF，文本层抽取为 0 字符 |
| `03.png` | PNG 有效，715×876，RGBA；适合作为证件照/抠图测试素材，但不是标准证件照构图 |
| `05.jpg` | JPEG 有效，1080×2388，RGB；是中文截图，适合作为 OCR 测试素材，不是发票样本 |
| `m04.ncm` | 文件头 `CTENFDAM` 有效；标准结构中的 key length=128、metadata length=686，封面从 845 偏移开始 |
| `S3RL,BEARN - TRILLIUM HARDTEKK.wma` | PyAV 可解码为 WMA（wmav2），92.365 秒，44.1 kHz，双声道 |
| `Симпа (Mikis Remix).mp3` | PyAV 可解码为 MP3，152.064 秒，48 kHz，双声道 |

### 实际文件链路

- `01.docx` 通过现有 `extractContractText` 成功抽取；查重后端用同一 DOCX 与自身比较返回 HTTP 200、相似度 100%。
- `01.docx` 与扫描型 `02.pdf` 进行查重时返回 HTTP 400：`论文 2 内容过短或为空`。这不是接口崩溃，而是当前查重链路没有对扫描 PDF 自动 OCR。
- `02.pdf` 能被 PDF.js 正常打开和遍历 14 页，但没有可提取的文字层，不能把“打开成功”误认为“文字识别成功”。
- `05.jpg` 的 OCR 运行未在本次 Node/Tesseract harness 中完成（超过约 90 秒后终止），因此 OCR 目前只能标记为待运行时专项验证，不能标为通过。
- 浏览器本次未执行本地文件上传端到端操作：当前 in-app browser 不提供把工作区路径直接注入 `<input type=file>` 的能力；文件内容链路已通过 Node/Python 和后端接口验证，上传 UI 仍需在真实浏览器手测。

## 已确认的问题

### P0/P1：NCM 转换器不能处理当前真实样本

`SD/components/tools/audio/NcmConverter.tsx` 将文件偏移硬编码为 `1024`，随后把该位置的 4 字节当作 key length。对 `ceshi/m04.ncm`，真实 key length 位于偏移 `10`、值为 `128`；偏移 `1024` 读出的值为 `7424`，会直接触发“无效的 NCM 密钥长度”。即使绕过该检查，当前实现也不是完整的 NCM AES core-key/meta-key/audio-key 解密流程。

### P1：3 个 DOCX 工具会把二进制当普通文本

以下组件允许选择 `.docx`，但调用了 `file.text()`：

- `SD/components/tools/office/WordFormatChecker.tsx`
- `SD/components/tools/academic/ThesisFormatChecker.tsx`
- `SD/components/tools/academic/TermConsistency.tsx`

这会把 `01.docx` 的 ZIP 二进制解释成乱码。项目中已有 `extractContractText`，应统一复用并在解析失败时给出明确提示。

### P1：扫描 PDF 与 OCR 的产品边界不清晰

扫描 PDF 没有文本层是正常文件特征，但当前用户只能得到“内容为空”类失败。PDF/查重页面应在检测到 0 字符时明确提示“这是扫描 PDF，请使用 OCR 版工具”，并为 OCR 加入进度、超时和失败状态。

### P1：OCR 运行时需要确定性保障

本次 OCR harness 没有在合理时间内完成。需要确认语言模型资产（中文/英文）、Worker 加载路径、首次下载缓存和超时回收；不能只依赖网络 CDN 后让页面无限等待。

### P2：音频格式兼容性仍需浏览器实测

PyAV 能解码 MP3/WMA 只证明服务端/本地解码器可读，不代表 Chromium 的 `AudioContext` 或浏览器下载链路支持 WMA。音频转换器需要在浏览器环境对 WMA 给出能力检测和降级提示。

## 后续修复顺序

1. 按标准 NCM 结构重写解析与 AES 解密，先用 `m04.ncm` 做回归测试，再补浏览器下载结果校验。
2. 让上述 3 个 DOCX 工具统一调用 `extractContractText`，补充真实 `01.docx` 的组件测试。
3. 为扫描 PDF 增加“需 OCR”识别和清晰提示；修复 OCR Worker 的本地资产、进度、超时和错误回收。
4. 在真实 Chromium 中补做 `03.png`、`05.jpg`、音频和 DOCX 的文件上传手测。
5. 继续做大文件、空文件、错误扩展名和重复上传的边界测试。

## 修复与回归结果

本轮已针对上述问题完成修复：

- 新增标准 NCM 解析器 `SD/components/tools/audio/ncm.ts`，实现 core key/meta key AES-128-ECB、RC4 派生流和封面区跳过；`m04.ncm` 解密结果可被 PyAV 识别为 MP3（4,831 帧，约 126 秒）。
- `NcmConverter` 改为调用标准解析器，不再使用固定 `offset=1024` 或简化 S-box。
- `WordFormatChecker`、`ThesisFormatChecker`、`TermConsistency` 统一调用 `readSupportedDocumentText`，DOCX 使用 Mammoth 提取，并显示解析错误。
- `ExtractPdfText` 检测到空文字层时，会提示这是扫描 PDF 并引导使用 OCR。
- `SearchablePdfOcr` 改用本地 Worker/WASM/中英文模型，增加模型加载和单页识别 60 秒超时，并在 finally 中终止 Worker；`05.jpg` 本地模型实测返回 334 字符。
- 新增 NCM、DOCX、OCR 超时和扫描 PDF 识别回归测试。

最新验证：前端 28 个测试文件、98 个测试通过；TypeScript 检查通过；生产构建通过（仅有 bundle 体积提示）。临时夹具 HTTP 服务已停止，5190 端口已释放。
