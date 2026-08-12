# 文档转换中心设计

## 目标

在逐梦工具箱中增加统一的文档转换中心，并提供一个独立的 FastAPI 服务。浏览器只负责选择文件、显示进度和下载结果；涉及 Office 渲染、PDF 页面 rasterize、PDF 表格抽取和 OCR 的任务在服务端完成。

## 已确认的转换边界

- PDF → Word：按页渲染为 PNG/JPEG，并将每页图片写入 DOCX。保留页面视觉效果，不承诺可编辑文字。
- Word/Excel/PPT → PDF：调用服务器上的 LibreOffice headless，使用独立用户 profile，输出真实 PDF。
- PDF 表格 → Excel：优先使用 pdfplumber 抽取表格，按页写入 XLSX；无表格时返回可读错误，不伪造数据。
- Markdown/HTML → Word：在服务端解析标题、段落、列表、引用、代码、图片和表格，写入 DOCX。
- 图片/扫描件 → Word：调用 Tesseract OCR（中文+英文），将识别文本按段落写入 DOCX，并保留原图作为文档附件页。
- 批量转换：每个输入文件单独转换，所有成功结果写入 ZIP；单文件失败写入 manifest，不影响其他文件完成。

## API

- `GET /health`：服务与依赖能力检查。
- `GET /api/v1/capabilities`：返回 LibreOffice、PDF、表格抽取和 OCR 是否可用。
- `POST /api/v1/convert`：单文件转换。表单字段 `file`、`target`。
- `POST /api/v1/convert/batch`：批量转换。表单字段 `files`、`target`，返回 ZIP。

目标值：`pdf-to-word-image`、`office-to-pdf`、`pdf-table-to-xlsx`、`markdown-to-docx`、`html-to-docx`、`scan-to-docx`。

## 安全与资源限制

- 只接受白名单扩展名；单文件默认 50 MiB，批量最多 20 个文件、总计 200 MiB。
- 所有任务使用独立临时目录；响应完成后清理中间文件。
- LibreOffice 使用独立 profile，避免并发锁冲突。
- 不保存用户文件，不把文件路径返回给客户端。
- ZIP 内包含 `manifest.json`，记录成功、失败和失败原因。

## 前端

新增 `DocumentConversionCenter` 工具，展示能力状态、目标选择、拖拽上传、单文件/批量模式、转换进度、失败明细和 ZIP 下载。旧的 Word 转 PDF、Markdown/HTML 和图片表格工具保留，避免破坏已有入口，并在描述中标注其适用边界。

## 部署

- 本地/宝塔后端端口：`127.0.0.1:8010`。
- Vite 开发代理：`/document-api` → `http://127.0.0.1:8010`。
- Nginx 生产代理：`/document-api/` → `http://127.0.0.1:8010/`，上传限制至少 220 MiB，读取超时 15 分钟。
- 运行依赖由 `document-converter/requirements.txt` 管理；系统依赖 LibreOffice、中文字体和可选的 Tesseract OCR。

## 验收标准

- 生成的 Office→PDF 可以被 `file` 识别为 PDF，并能打开中文内容。
- PDF→Word 生成的 DOCX 页数与输入 PDF 页数一致，每页有对应图片。
- PDF 表格→XLSX 能被 openpyxl 读取，页表分 sheet 保存。
- Markdown/HTML 标题、段落、表格和图片在 DOCX 中存在。
- OCR 未安装时接口返回明确的能力缺失信息，不返回伪造结果。
- 批量任务即使部分失败仍返回 ZIP 和 manifest。
