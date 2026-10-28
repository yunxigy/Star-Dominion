"""文件解析器 — 支持 txt / docx / pdf"""

from pathlib import Path


def parse_file(file_path: str, content: bytes) -> str:
    ext = Path(file_path).suffix.lower()
    if ext == ".txt":
        return _parse_txt(content)
    elif ext == ".docx":
        return _parse_docx(content)
    elif ext == ".pdf":
        return _parse_pdf(content)
    else:
        raise ValueError(f"不支持的文件格式: {ext}，请上传 .txt / .docx / .pdf 文件")


def _parse_txt(content: bytes) -> str:
    for enc in ("utf-8", "gbk", "gb2312", "latin-1"):
        try:
            return content.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return content.decode("utf-8", errors="ignore")


def _parse_docx(content: bytes) -> str:
    from docx import Document
    import io

    doc = Document(io.BytesIO(content))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _parse_pdf(content: bytes) -> str:
    from PyPDF2 import PdfReader
    import io

    reader = PdfReader(io.BytesIO(content))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n".join(pages)
