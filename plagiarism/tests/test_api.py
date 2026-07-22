import asyncio

import httpx

from main import MAX_FILE_BYTES, app


def request(method: str, path: str, **kwargs: object) -> httpx.Response:
    async def run() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(run())


def test_compare_accepts_frontend_field_names_and_returns_camel_case() -> None:
    response = request(
        "POST",
        "/api/plagiarism/compare",
        files={
            "file1": ("one.txt", "这是第一篇论文。这里包含一个用于比对的完整句子。".encode()),
            "file2": ("two.txt", "这是第二篇论文。这里包含一个用于比对的完整句子。".encode()),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"similarity", "level", "stats", "matches"}
    assert set(body["stats"]) == {
        "totalSentences1",
        "totalSentences2",
        "matchedSentences",
    }
    assert all(set(item) == {"text1", "text2", "similarity"} for item in body["matches"])
    assert all(0 <= item["similarity"] <= 1 for item in body["matches"])


def test_rejects_unsupported_extension_and_oversized_upload() -> None:
    unsupported = request(
        "POST",
        "/api/plagiarism/compare",
        files={
            "file1": ("one.exe", b"this file must not be parsed"),
            "file2": ("two.txt", b"valid text content for comparison"),
        },
    )
    oversized = request(
        "POST",
        "/api/plagiarism/compare",
        files={
            "file1": ("one.txt", b"a" * (MAX_FILE_BYTES + 1)),
            "file2": ("two.txt", b"valid text content for comparison"),
        },
    )

    assert unsupported.status_code == 415
    assert oversized.status_code == 413


def test_health_identifies_port_contract() -> None:
    response = request("GET", "/api/plagiarism/health")

    assert response.json() == {"ok": True, "service": "plagiarism", "port": 8005}
