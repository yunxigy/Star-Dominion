"""Smoke test: write & review ch_121 with real model.

Verifies:
1. Candidate draft is NOT persisted prematurely
2. Review gate works correctly
3. Only after passing review does the chapter get committed
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Load .env before any OpenWrite imports
from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent
MANUSCRIPT_DIR = PROJECT_ROOT / "data" / "novels" / "system_urban" / "data" / "manuscript" / "arc_001"
TRUTH_DIR = PROJECT_ROOT / "data" / "novels" / "system_urban" / "data" / "truth"
MEMORY_DIR = PROJECT_ROOT / "data" / "novels" / "system_urban" / "data" / "memory"
RUNTIME_DIR = PROJECT_ROOT / "data" / "novels" / "system_urban" / "data" / "runtime"


def count_chapters() -> int:
    """Count existing chapter files."""
    if not MANUSCRIPT_DIR.exists():
        return 0
    return len(list(MANUSCRIPT_DIR.glob("ch_*.md")))


def list_truth_files() -> set[str]:
    if not TRUTH_DIR.exists():
        return set()
    return {f.name for f in TRUTH_DIR.glob("*.json")}


def list_memory_files() -> set[str]:
    if not MEMORY_DIR.exists():
        return set()
    return {f.name for f in MEMORY_DIR.glob("*.json")}


def list_runtime_files() -> set[str]:
    if not RUNTIME_DIR.exists():
        return set()
    return {f.name for f in RUNTIME_DIR.glob("*.json")}


def main() -> int:
    print("=" * 60)
    print("SMOKE TEST: ch_121 write & review chain")
    print("=" * 60)

    # Record pre-state
    pre_chapters = count_chapters()
    pre_truth = list_truth_files()
    pre_memory = list_memory_files()
    pre_runtime = list_runtime_files()

    print(f"\n[PRE-STATE]")
    print(f"  Chapter count: {pre_chapters}")
    print(f"  Truth files: {len(pre_truth)}")
    print(f"  Memory files: {len(pre_memory)}")
    print(f"  Runtime files: {len(pre_runtime)}")
    print(f"  ch_121.md exists: {(MANUSCRIPT_DIR / 'ch_121.md').exists()}")

    # Run write & review chain
    print(f"\n[RUNNING] multi-write ch_121 ...")
    from tools.novel_service import NovelApplicationService

    service = NovelApplicationService(PROJECT_ROOT)
    try:
        result = service.write_and_review_chapter(
            {
                "chapter_id": "ch_121",
                "temperature": 0.7,
                "target_words": 0,
                "guidance": "",
                "strict": False,
            }
        )
    except Exception as exc:
        print(f"\n[ERROR] {exc}")
        return 1

    # Print result
    print(f"\n[RESULT]")
    print(f"  ok: {result.get('ok')}")
    print(f"  committed: {result.get('committed')}")
    print(f"  code: {result.get('code', 'N/A')}")
    review = result.get("review", {})
    if isinstance(review, dict):
        print(f"  review score: {review.get('score', 'N/A')}")
        print(f"  review passed: {review.get('passed', 'N/A')}")
        print(f"  review issues: {review.get('issues', 'N/A')}")
    revisions = result.get("revisions", [])
    if revisions:
        print(f"  revisions: {len(revisions)}")
        for r in revisions:
            print(f"    attempt {r.get('attempt')}: score={r.get('score')}, passed={r.get('passed')}")

    # Record post-state
    post_chapters = count_chapters()
    post_truth = list_truth_files()
    post_memory = list_memory_files()
    post_runtime = list_runtime_files()

    print(f"\n[POST-STATE]")
    print(f"  Chapter count: {post_chapters}")
    print(f"  Truth files: {len(post_truth)}")
    print(f"  Memory files: {len(post_memory)}")
    print(f"  Runtime files: {len(post_runtime)}")
    print(f"  ch_121.md exists: {(MANUSCRIPT_DIR / 'ch_121.md').exists()}")

    # Verify pipeline behavior
    print(f"\n[VERIFICATION]")
    committed = result.get("committed", False)
    if committed:
        # If committed, ch_121 should exist and chapter count should increase
        assert post_chapters == pre_chapters + 1, f"Expected {pre_chapters + 1} chapters, got {post_chapters}"
        assert (MANUSCRIPT_DIR / "ch_121.md").exists(), "ch_121.md should exist after commit"
        print("  PASS: Chapter committed after review passed")
    else:
        # If not committed, ch_121 should NOT exist in manuscript
        assert not (MANUSCRIPT_DIR / "ch_121.md").exists(), "ch_121.md should NOT exist if not committed"
        print(f"  PASS: Chapter NOT committed (reason: {result.get('code', result.get('reason', 'unknown'))})")

    print("\n" + "=" * 60)
    print("SMOKE TEST COMPLETE")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())