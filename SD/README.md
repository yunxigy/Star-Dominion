# 逐梦工具箱

Star Dominion 的统一主站和在线工具目录。当前注册表包含 **185 个工具、16 个分类**，大部分功能在浏览器本地运行；需要服务端处理的工具会在页面中明确显示上传和隐私边界。

## 工具分类

| 分类 | 数量 | 主要能力 |
| --- | ---: | --- |
| PDF 工具 | 12 | 合并、拆分、压缩、页面处理、水印、加密、图文提取和格式转换 |
| 图片工具 | 12 | 压缩、裁剪、缩放、拼接、取色、证件照和 Base64 |
| 图片增强 | 10 | 清晰度、亮度、锐化、马赛克、文字、截图和封面 |
| 格式转换 | 10 | JPG、PNG、WebP、SVG、BMP、HEIC 和 ICO 转换 |
| 开发者工具 | 30 | 数据格式、编码、哈希、API、OpenAPI、网络、日志、Cron、CIDR 和 SQL |
| 计算器 | 17 | 日期、贷款、复利、百分比和常用单位换算 |
| 趣味工具 | 6 | 抽奖、随机数、随机选择和生活随机工具 |
| 测评中心 | 20 | 趣味、人格、倾向与边界三组互动测评，含 MBTI 40 题扩展版 |
| 塔罗星座 | 11 | 塔罗、星座、运势和配对 |
| 鼠标测试 | 10 | CPS、反应速度、DPI、滚轮、回报率和拖拽 |
| 文档处理 | 10 | OCR、翻译、摘要、语法、文本对比、论文查重和文档转换中心 |
| 音频处理 | 3 | 音频转换、NCM 处理和变声 |
| 数据处理 | 8 | Excel/CSV、PDF OCR、文档对比、批量文件、校验和隐私清理 |
| 办公工具 | 8 | 发票 OCR、表格清洗、Word 检查、合同审阅、格式转换和日历 |
| 学术工具 | 8 | 论文格式、参考文献、公式、表格 OCR、文献笔记和术语检查 |
| 生活工具 | 10 | 证件照、条码、压缩包、字幕、颜色、单位、密码和 Markdown |

## 数据边界

工具注册信息通过 `privacy` 和 `status` 标记运行边界：

| `privacy` | 含义 |
| --- | --- |
| `local` | 在浏览器本地处理，不主动上传文件 |
| `third-party-api` | 内容会发送给工具所使用的第三方 API |
| `backend-upload` | 文件会上传至本站后端处理 |

| `status` | 含义 |
| --- | --- |
| `stable` | 已按当前功能范围提供稳定能力 |
| `beta` | 可使用，但仍有格式、性能或准确率限制 |

发票 OCR、图片表格识别、PDF OCR 等结果可能受版式和图片质量影响，页面会明确提示用户复核。API 调试、网络检测等工具也受浏览器 CORS 和目标服务安全策略限制。

### 测评中心

测评中心新增 9 套原创 18 题测评，可按“趣味 / 人格 / 倾向与边界”筛选；原 MBTI 趣味测试已扩展为 40 题四维版本。测评内容只用于自我探索，不构成心理、医学或身份诊断。

新测评的答案只保存在当前页面内存中，不写入浏览器存储，也不会上传；关闭工具或刷新页面后，作答记录会消失。倾向与边界类测评支持跳题，并会在信息不足时避免输出确定结论。

## 页面路由

| 路由 | 说明 |
| --- | --- |
| `/` | 主站首页 |
| `/gj` | 完整工具目录 |
| `/category/:categoryId` | 分类页 |
| `/tool/:toolId` | 独立工具窗口 |
| `/stm32/` | STM32/4G 监测窗口 |
| `/auth/login` | 全站登录 |

股票、OpenWrite 和守岸人通过主站项目入口进入各自模块。

## 文档转换中心

`/tool/document-conversion-center` 是主站中的统一文档转换入口，调用根目录 `document-converter` 服务（默认 `127.0.0.1:8010`，生产环境经 `/document-api/` 代理）。支持：

- PDF → Word：逐页渲染为图片写入 DOCX，保留视觉版式，不承诺可编辑文字。
- Word、Excel、PPT → PDF：使用 LibreOffice headless 真实转换。
- PDF 表格 → Excel：按页抽取表格并写入 XLSX。
- Markdown、HTML → Word：保留标题、段落、列表、引用、代码、图片和表格。
- 图片/扫描件 → Word：Tesseract OCR 输出可编辑文字，同时保留原始页面图片。
- 批量转换：一次上传多个文件，返回带 `manifest.json` 结果清单的 ZIP。

服务端会在 `/api/v1/capabilities` 报告 LibreOffice、PDF、表格抽取和 OCR 能力；缺少依赖时前端会禁用对应模式，不会伪造成功结果。完整安装、API 和宝塔进程配置见 [`document-converter/README.md`](../document-converter/README.md) 与 [`deploy/baota/README.md`](../deploy/baota/README.md)。

## 本地开发

```powershell
cd E:\AI\gp\SD
npm.cmd install
npm.cmd run dev
```

默认开发地址为 `http://127.0.0.1:5173/`。

## 校验与构建

```powershell
npm.cmd run validate
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

- `validate` 检查工具 ID、分类、图标、组件和元数据。
- `test` 运行注册表、路由、认证和专业工具回归测试。
- `lint` 执行 TypeScript 静态检查。
- `build` 生成生产目录 `dist/`。

新增工具必须同时满足：

1. 在 `tools/registry.tsx` 注册唯一 ID。
2. 图标存在于统一 `ICON_MAP`。
3. 分类、隐私边界和稳定状态填写准确。
4. 工具名称与实际能力一致，不以占位页面或提示文字冒充功能。
5. 注册表校验、测试、TypeScript 和生产构建全部通过。

整体架构、全站端口和宝塔部署方式见 [根项目 README](../README.md)。
