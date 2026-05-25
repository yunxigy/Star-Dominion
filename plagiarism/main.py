"""论文查重服务 — FastAPI 入口"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from parser import parse_file
from analyzer import compare_texts

app = FastAPI(title="Plagiarism Checker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/plagiarism/health")
async def health():
    return {"ok": True}


@app.post("/api/plagiarism/compare")
async def compare(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
):
    try:
        content_a = await file_a.read()
        content_b = await file_b.read()

        text_a = parse_file(file_a.filename, content_a)
        text_b = parse_file(file_b.filename, content_b)

        if len(text_a.strip()) < 10:
            raise HTTPException(400, "论文A 内容过短或为空")
        if len(text_b.strip()) < 10:
            raise HTTPException(400, "论文B 内容过短或为空")

        result = compare_texts(text_a, text_b)

        return {
            "ok": True,
            "overall_similarity": result.overall_similarity,
            "level": result.level,
            "stats": {
                "total_sentences_a": result.total_sentences_a,
                "total_sentences_b": result.total_sentences_b,
                "similar_sentence_count": result.similar_sentence_count,
            },
            "segments": [
                {
                    "text_a": s.text_a,
                    "text_b": s.text_b,
                    "similarity": s.similarity,
                }
                for s in result.segments
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"分析失败: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
