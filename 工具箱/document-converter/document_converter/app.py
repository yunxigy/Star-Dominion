from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .converters import (
    MAX_BATCH_FILES,
    MAX_BATCH_SIZE,
    MAX_FILE_SIZE,
    ConversionError,
    SUPPORTED_TARGETS,
    convert_batch,
    convert_file,
    dependency_capabilities,
)

app = FastAPI(title="Dream Chaser Document Converter", version="0.1.0")


def _cleanup(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _safe_filename(name: str | None) -> str:
    candidate = Path(name or "upload.bin").name
    return candidate if candidate not in {"", ".", ".."} else "upload.bin"


async def _save_upload(upload: UploadFile, destination: Path, limit: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with destination.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=413, detail="文件超过大小限制")
            handle.write(chunk)
    return size


def _conversion_error(exc: ConversionError) -> HTTPException:
    message = str(exc)
    status = 503 if any(word in message for word in ("未安装", "缺少", "不可用")) else 400
    return HTTPException(status_code=status, detail=message)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "service": "document-converter", "capabilities": dependency_capabilities()}


@app.get("/api/v1/capabilities")
def capabilities() -> dict[str, object]:
    return {"targets": sorted(SUPPORTED_TARGETS), "limits": {"max_file_bytes": MAX_FILE_SIZE, "max_batch_files": MAX_BATCH_FILES, "max_batch_bytes": MAX_BATCH_SIZE}, "dependencies": dependency_capabilities()}


@app.post("/api/v1/convert")
async def convert_single(background_tasks: BackgroundTasks, file: UploadFile = File(...), target: str = Form(...)):
    work_dir = Path(tempfile.mkdtemp(prefix="document-conversion-"))
    try:
        source = work_dir / "input" / _safe_filename(file.filename)
        await _save_upload(file, source, MAX_FILE_SIZE)
        try:
            output = convert_file(source, target, work_dir / "output")
        except ConversionError as exc:
            raise _conversion_error(exc) from exc
        background_tasks.add_task(_cleanup, str(work_dir))
        media_type = "application/octet-stream"
        if output.suffix == ".pdf":
            media_type = "application/pdf"
        elif output.suffix == ".docx":
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif output.suffix == ".xlsx":
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return FileResponse(output, media_type=media_type, filename=output.name, background=background_tasks)
    except HTTPException:
        _cleanup(str(work_dir))
        raise
    except OSError as exc:
        _cleanup(str(work_dir))
        raise HTTPException(status_code=400, detail=f"文件处理失败：{exc}") from exc


@app.post("/api/v1/convert/batch")
async def convert_batch_files(background_tasks: BackgroundTasks, files: list[UploadFile] = File(...), target: str = Form(...)):
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=413, detail=f"批量转换最多支持 {MAX_BATCH_FILES} 个文件")
    work_dir = Path(tempfile.mkdtemp(prefix="document-batch-"))
    try:
        sources: list[Path] = []
        total = 0
        for index, upload in enumerate(files):
            source = work_dir / "input" / f"{index:03d}-{_safe_filename(upload.filename)}"
            total += await _save_upload(upload, source, MAX_FILE_SIZE)
            if total > MAX_BATCH_SIZE:
                raise HTTPException(status_code=413, detail="批量文件总大小不能超过 200 MiB")
            sources.append(source)
        try:
            archive = convert_batch(sources, target, work_dir)
        except ConversionError as exc:
            raise _conversion_error(exc) from exc
        background_tasks.add_task(_cleanup, str(work_dir))
        return FileResponse(archive, media_type="application/zip", filename="document-conversion-results.zip", background=background_tasks)
    except HTTPException:
        _cleanup(str(work_dir))
        raise
    except OSError as exc:
        _cleanup(str(work_dir))
        raise HTTPException(status_code=400, detail=f"批量文件处理失败：{exc}") from exc
