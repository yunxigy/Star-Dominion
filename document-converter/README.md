# 文档转换中心

独立的 FastAPI 文档转换服务，默认监听 `127.0.0.1:8010`，由主站通过 `/document-api/` 代理。

## 支持的转换

- PDF → Word：每页渲染为图片后写入 DOCX，优先保证视觉版式。
- Word/Excel/PPT → PDF：调用 LibreOffice headless 真实转换。
- PDF 表格 → Excel：pdfplumber 抽取表格并按页写入 XLSX。
- Markdown/HTML → Word：转换标题、段落、列表、引用、代码、图片和表格。
- 图片/扫描件 → Word：Tesseract OCR 输出可编辑段落，并保留原始页面图片。
- 批量转换：输出 ZIP，包含成功结果和 `manifest.json` 失败明细。

## 本地运行

```powershell
cd document-converter
python -m pip install -r requirements.txt
python -m uvicorn document_converter.app:app --host 127.0.0.1 --port 8010
```

## 系统依赖

Office 转 PDF 需要 LibreOffice；扫描件 OCR 需要 Tesseract 和 `chi_sim` 语言包。服务会通过 `/api/v1/capabilities` 报告缺失能力，不会伪造转换结果。

### OpenCloudOS 9.4 / 宝塔

LibreOffice 和 Noto CJK 字体安装完成后，继续安装 Python 依赖，并按仓库实际包名安装 Tesseract：

```bash
cd <SITE_ROOT>/document-converter
<PYTHON> -m pip install -r requirements.txt

dnf search tesseract
dnf install -y tesseract
dnf search 'tesseract*'
# 安装搜索结果中提供的中文语言包后验证：
tesseract --list-langs
```

`tesseract --list-langs` 应包含 `chi_sim`；如果只显示 `eng`，扫描件仍可处理英文，但中文 OCR 不应上线使用。LibreOffice 相关能力可用 `soffice --headless --version` 验证。

如果 LibreOffice 没有加入系统 `PATH`，可在启动服务前设置 `LIBREOFFICE_BIN`（也兼容 `SOFFICE_PATH`）指向 `soffice` 可执行文件的绝对路径；服务会先验证该路径，再回退到 PATH 查找。

## API

服务默认只监听本机，主站通过 `/document-api/` 代理；直接调试服务时使用 `http://127.0.0.1:8010`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务存活与依赖能力摘要 |
| `GET` | `/api/v1/capabilities` | 支持的目标、文件限制和依赖状态 |
| `POST` | `/api/v1/convert` | 表单字段 `file`、`target`，返回单个文件 |
| `POST` | `/api/v1/convert/batch` | 多个 `files`、`target`，返回带 `manifest.json` 的 ZIP |

宝塔/Linux 终端可以直接用 `curl` 验收：

```bash
# HTML → Word
curl -f -X POST \
  -F "target=html-to-docx" \
  -F "file=@./example.html" \
  http://127.0.0.1:8010/api/v1/convert \
  -o example.docx

# 多个 Markdown → ZIP
curl -f -X POST \
  -F "target=markdown-to-docx" \
  -F "files=@./a.md" \
  -F "files=@./b.md" \
  http://127.0.0.1:8010/api/v1/convert/batch \
  -o document-conversion-results.zip
```

单文件上限 50 MiB，批量最多 20 个文件、总大小 200 MiB。依赖缺失返回 `503`，文件格式或内容不合法返回 `400`，超过限制返回 `413`。
