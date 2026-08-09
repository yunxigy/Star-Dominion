from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps, features


TARGET_SIZE = (1024, 1536)
MAJOR_SLUGS = (
    "fool",
    "magician",
    "high_priestess",
    "empress",
    "emperor",
    "hierophant",
    "lovers",
    "chariot",
    "strength",
    "hermit",
    "wheel_of_fortune",
    "justice",
    "hanged_man",
    "death",
    "temperance",
    "devil",
    "tower",
    "star",
    "moon",
    "sun",
    "judgement",
    "world",
)
SUITS = ("cups", "pentacles", "swords", "wands")
RANKS = (
    "ace",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "page",
    "knight",
    "queen",
    "king",
)


def expected_names() -> set[str]:
    major = {
        f"tarot_{number:02d}_{slug}.webp"
        for number, slug in enumerate(MAJOR_SLUGS)
    }
    minor = {
        f"tarot_{suit}_{rank}.webp"
        for suit in SUITS
        for rank in RANKS
    }
    return major | minor


def convert_image(source: Path, target: Path) -> None:
    if not features.check("webp"):
        raise RuntimeError("Pillow was built without WebP support")

    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        prepared = ImageOps.fit(
            image.convert("RGB"),
            TARGET_SIZE,
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
        prepared.save(target, "WEBP", quality=90, method=6, exif=b"")


def validate_directory(directory: Path, allow_partial: bool = False) -> list[str]:
    expected = expected_names()
    actual = {path.name for path in directory.glob("*.webp")}
    errors: list[str] = []

    unexpected = sorted(actual - expected)
    if unexpected:
        errors.append(f"unexpected WebP files: {', '.join(unexpected)}")

    missing = sorted(expected - actual)
    if missing and not allow_partial:
        errors.append(f"missing {len(missing)} expected WebP files")

    for name in sorted(actual & expected):
        path = directory / name
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                if image.format != "WEBP":
                    errors.append(f"{name}: expected WEBP, got {image.format}")
                if image.size != TARGET_SIZE:
                    errors.append(
                        f"{name}: expected 1024x1536, got "
                        f"{image.width}x{image.height}"
                    )
        except Exception as exc:
            errors.append(f"{name}: cannot decode: {exc}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    convert_parser = subparsers.add_parser("convert")
    convert_parser.add_argument("--input", type=Path, required=True)
    convert_parser.add_argument("--output", type=Path, required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--directory", type=Path, required=True)
    validate_parser.add_argument("--allow-partial", action="store_true")

    args = parser.parse_args()
    if args.command == "convert":
        convert_image(args.input, args.output)
        print(f"wrote {args.output} at 1024x1536 WebP quality 90")
        return 0

    errors = validate_directory(args.directory, args.allow_partial)
    if errors:
        for error in errors:
            print(error)
        return 1
    print("tarot WebP assets are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
