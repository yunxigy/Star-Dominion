"""论文查重服务 FastAPI 入口。"""

from pathlib import Path
import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from analyzer import compare_texts
from parser import parse_file


MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".txt", ".docx", ".pdf"}

app = FastAPI(title="Plagiarism Checker", version="1.0.0")
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "PLAGIARISM_ALLOWED_ORIGINS",
        "http://127.0.0.1:8013,http://localhost:8013,http://127.0.0.1:8014,http://localhost:8014,https://zhumenggy.top",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/plagiarism/health")
async def health() -> dict[str, object]:
    return {"ok": True, "service": "plagiarism", "port": 8005}


async def _validated_content(upload: UploadFile, label: str) -> bytes:
    filename = upload.filename or ""
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"{label} 仅支持 .txt、.docx、.pdf 文件",
        )
    content = await upload.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} 不能超过 10 MB")
    if not content:
        raise HTTPException(status_code=400, detail=f"{label} 为空")
    return content


@app.post("/api/plagiarism/compare")
async def compare(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
) -> dict[str, object]:
    content1 = await _validated_content(file1, "论文 1")
    content2 = await _validated_content(file2, "论文 2")
    try:
        text1 = parse_file(file1.filename or "", content1)
        text2 = parse_file(file2.filename or "", content2)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail="文件无法解析，请检查文件是否完整") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="文件无法解析，请更换文件后重试") from exc

    if len(text1.strip()) < 10:
        raise HTTPException(status_code=400, detail="论文 1 内容过短或为空")
    if len(text2.strip()) < 10:
        raise HTTPException(status_code=400, detail="论文 2 内容过短或为空")

    try:
        result = compare_texts(text1, text2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="分析失败，请稍后重试") from exc

    return {
        "similarity": result.overall_similarity,
        "level": result.level,
        "stats": {
            "totalSentences1": result.total_sentences_a,
            "totalSentences2": result.total_sentences_b,
            "matchedSentences": result.similar_sentence_count,
        },
        "matches": [
            {
                "text1": segment.text_a,
                "text2": segment.text_b,
                "similarity": round(segment.similarity / 100, 4),
            }
            for segment in result.segments
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8005)
