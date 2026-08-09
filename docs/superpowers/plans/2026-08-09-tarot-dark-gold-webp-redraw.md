# Tarot Dark Gold WebP Redraw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and integrate a coherent 78-card dark-gold WebP tarot deck while retaining the current SVG deck as an automatic fallback.

**Architecture:** `tarot-data.ts` remains the single runtime metadata source and exposes display labels plus WebP/SVG paths. A small Pillow-based utility converts generated sources and validates all project assets. The frontend continues using SVG until every WebP passes validation, then `TarotCardVisual` switches to WebP-first rendering with labels, reversed-card rotation, and SVG fallback.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, ReactDOM server rendering, Python 3, Pillow/WebP, built-in `image_gen`.

---

## File map

**Existing files to modify**

- `SD/components/tools/tarot/tarot-data.ts` — canonical card names, English labels, display numbers, and image paths.
- `SD/components/tools/tarot/TarotCardVisual.tsx` — WebP-first rendering, SVG fallback, labels, and reversed-card rotation.

**Existing source to track without changing its content**

- `SD/components/tools/tarot/tarot_78_dark_gold_prompts.md` — approved global and per-card generation prompts.

**Files to create**

- `SD/components/tools/tarot/tarot-data.test.ts` — metadata and path contract tests.
- `SD/components/tools/tarot/TarotCardVisual.test.tsx` — server-rendered card markup tests.
- `SD/scripts/convert_tarot_webp.py` — deterministic WebP conversion and asset validation.
- `SD/scripts/requirements-tarot.txt` — pinned Pillow dependency for the asset utility.
- `SD/scripts/tests/test_convert_tarot_webp.py` — conversion and validation tests.
- `SD/public/assets/tarot/cards/*.webp` — 78 final card faces.

**Files intentionally retained**

- `SD/public/assets/tarot/cards/*.svg` — 78 card-face fallbacks plus `tarot_back.svg`.

## Task 1: Establish the canonical tarot metadata contract

**Files:**

- Track: `SD/components/tools/tarot/tarot_78_dark_gold_prompts.md`
- Modify: `SD/components/tools/tarot/tarot-data.ts:3`
- Create: `SD/components/tools/tarot/tarot-data.test.ts`

- [ ] **Step 1: Write the failing metadata tests**

Create `tarot-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  ALL_CARDS,
  getCardDisplayNumber,
  getCardImagePaths,
} from './tarot-data'

describe('tarot card metadata', () => {
  it('defines 78 uniquely numbered cards with English names', () => {
    expect(ALL_CARDS).toHaveLength(78)
    expect(new Set(ALL_CARDS.map(card => card.number)).size).toBe(78)
    expect(ALL_CARDS.every(card => card.nameEn.length > 0)).toBe(true)
  })

  it('builds stable WebP and SVG paths for major and minor cards', () => {
    expect(getCardImagePaths(ALL_CARDS[0])).toEqual({
      webp: '/assets/tarot/cards/tarot_00_fool.webp',
      svg: '/assets/tarot/cards/tarot_00_fool.svg',
    })
    expect(getCardImagePaths(ALL_CARDS[22])).toEqual({
      webp: '/assets/tarot/cards/tarot_cups_ace.webp',
      svg: '/assets/tarot/cards/tarot_cups_ace.svg',
    })
    expect(getCardImagePaths(ALL_CARDS[77])).toEqual({
      webp: '/assets/tarot/cards/tarot_wands_king.webp',
      svg: '/assets/tarot/cards/tarot_wands_king.svg',
    })
  })

  it('provides the display labels used by the card frame', () => {
    expect(ALL_CARDS[0].nameEn).toBe('The Fool')
    expect(ALL_CARDS[22].nameEn).toBe('Ace of Cups')
    expect(getCardDisplayNumber(ALL_CARDS[0])).toBe('0')
    expect(getCardDisplayNumber(ALL_CARDS[21])).toBe('XXI')
    expect(getCardDisplayNumber(ALL_CARDS[22])).toBe('A')
    expect(getCardDisplayNumber(ALL_CARDS[32])).toBe('侍从')
  })
})
```

- [ ] **Step 2: Run the test and verify the new contract is missing**

Run:

```powershell
cd E:\AI\gp\SD
npm test -- components/tools/tarot/tarot-data.test.ts
```

Expected: FAIL because `nameEn`, `getCardDisplayNumber`, and `getCardImagePaths` do not exist.

- [ ] **Step 3: Add English labels and stable asset metadata**

In `tarot-data.ts`, add:

```ts
export type TarotSuit = 'cups' | 'pentacles' | 'swords' | 'wands'

export interface TarotCard {
  number: number
  name: string
  nameEn: string
  emoji: string
  suit?: TarotSuit
  keywords: string[]
  upright: string
  reversed: string
  uprightMessage: string
  reversedMessage: string
}

const MAJOR_META = [
  ['The Fool', 'fool'],
  ['The Magician', 'magician'],
  ['The High Priestess', 'high_priestess'],
  ['The Empress', 'empress'],
  ['The Emperor', 'emperor'],
  ['The Hierophant', 'hierophant'],
  ['The Lovers', 'lovers'],
  ['The Chariot', 'chariot'],
  ['Strength', 'strength'],
  ['The Hermit', 'hermit'],
  ['Wheel of Fortune', 'wheel_of_fortune'],
  ['Justice', 'justice'],
  ['The Hanged Man', 'hanged_man'],
  ['Death', 'death'],
  ['Temperance', 'temperance'],
  ['The Devil', 'devil'],
  ['The Tower', 'tower'],
  ['The Star', 'star'],
  ['The Moon', 'moon'],
  ['The Sun', 'sun'],
  ['Judgement', 'judgement'],
  ['The World', 'world'],
] as const

const MAJOR_ROMAN = [
  '0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI',
] as const
```

Change the declaration on the current major array from `export const MAJOR_ARCANA: TarotCard[] = [` to `const MAJOR_ARCANA_BASE: Omit<TarotCard, 'nameEn'>[] = [`. Keep its existing 22 object literals verbatim. Immediately after that array's closing bracket, export the enriched array:

```ts
export const MAJOR_ARCANA: TarotCard[] = MAJOR_ARCANA_BASE.map(card => ({
  ...card,
  nameEn: MAJOR_META[card.number][0],
}))
```

Extend `SUIT_DATA` and `RANK_DATA` with exact English labels and type the suit object:

```ts
const SUIT_DATA: Record<TarotSuit, {
  name: string
  nameEn: string
  emoji: string
  theme: string
}> = {
  cups: { name: '圣杯', nameEn: 'Cups', emoji: '🏆', theme: '情感/直觉/关系' },
  pentacles: { name: '金币', nameEn: 'Pentacles', emoji: '🪙', theme: '物质/财富/健康' },
  swords: { name: '宝剑', nameEn: 'Swords', emoji: '⚔️', theme: '思维/冲突/真相' },
  wands: { name: '权杖', nameEn: 'Wands', emoji: '🪄', theme: '行动/创造/激情' },
}

const RANK_DATA = {
  ace: { name: 'A', nameEn: 'Ace', slug: 'ace', num: 1, keywords: ['新开始', '潜力', '机会'] },
  two: { name: '2', nameEn: 'Two', slug: 'two', num: 2, keywords: ['选择', '平衡', '决定'] },
  three: { name: '3', nameEn: 'Three', slug: 'three', num: 3, keywords: ['成长', '合作', '创造力'] },
  four: { name: '4', nameEn: 'Four', slug: 'four', num: 4, keywords: ['稳定', '基础', '休息'] },
  five: { name: '5', nameEn: 'Five', slug: 'five', num: 5, keywords: ['冲突', '变化', '挑战'] },
  six: { name: '6', nameEn: 'Six', slug: 'six', num: 6, keywords: ['和谐', '给予', '平衡'] },
  seven: { name: '7', nameEn: 'Seven', slug: 'seven', num: 7, keywords: ['反思', '选择', '内在'] },
  eight: { name: '8', nameEn: 'Eight', slug: 'eight', num: 8, keywords: ['行动', '变化', '进展'] },
  nine: { name: '9', nameEn: 'Nine', slug: 'nine', num: 9, keywords: ['完成', '满足', '收获'] },
  ten: { name: '10', nameEn: 'Ten', slug: 'ten', num: 10, keywords: ['结束', '循环', '圆满'] },
  page: { name: '侍从', nameEn: 'Page', slug: 'page', num: 11, keywords: ['消息', '学习', '好奇'] },
  knight: { name: '骑士', nameEn: 'Knight', slug: 'knight', num: 12, keywords: ['行动', '追求', '变化'] },
  queen: { name: '王后', nameEn: 'Queen', slug: 'queen', num: 13, keywords: ['智慧', '关怀', '直觉'] },
  king: { name: '国王', nameEn: 'King', slug: 'king', num: 14, keywords: ['权威', '掌控', '成熟'] },
} as const
```

Before iterating suits in `generateMinorArcana`, preserve the suit key's union type:

```ts
const suits = Object.entries(SUIT_DATA) as [
  TarotSuit,
  (typeof SUIT_DATA)[TarotSuit],
][]
```

Add `nameEn` while generating minor cards and replace the current image mapping with:

```ts
nameEn: `${rank.nameEn} of ${suit.nameEn}`,
```

```ts
export function getCardDisplayNumber(card: TarotCard): string {
  if (card.number <= 21) return MAJOR_ROMAN[card.number]
  const rankIndex = (card.number - 22) % 14
  return Object.values(RANK_DATA)[rankIndex].name
}

export function getCardImagePaths(card: TarotCard): { webp: string; svg: string } {
  let baseName: string

  if (card.number <= 21) {
    baseName = `tarot_${String(card.number).padStart(2, '0')}_${MAJOR_META[card.number][1]}`
  } else {
    if (!card.suit) throw new Error(`Minor Arcana card ${card.number} has no suit`)
    const rankIndex = (card.number - 22) % 14
    const rank = Object.values(RANK_DATA)[rankIndex]
    baseName = `tarot_${card.suit}_${rank.slug}`
  }

  const root = `/assets/tarot/cards/${baseName}`
  return { webp: `${root}.webp`, svg: `${root}.svg` }
}

export function getCardImagePath(card: TarotCard): string {
  return getCardImagePaths(card).svg
}
```

- [ ] **Step 4: Run the metadata tests**

Run:

```powershell
cd E:\AI\gp\SD
npm test -- components/tools/tarot/tarot-data.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Type-check the metadata changes**

Run:

```powershell
cd E:\AI\gp\SD
npm run lint
```

Expected: exit code 0.

- [ ] **Step 6: Commit the metadata contract and prompt source**

```powershell
git add SD/components/tools/tarot/tarot-data.ts SD/components/tools/tarot/tarot-data.test.ts SD/components/tools/tarot/tarot_78_dark_gold_prompts.md
git commit -m "feat: define tarot WebP metadata"
```

## Task 2: Add deterministic WebP conversion and validation

**Files:**

- Create: `SD/scripts/convert_tarot_webp.py`
- Create: `SD/scripts/requirements-tarot.txt`
- Create: `SD/scripts/tests/test_convert_tarot_webp.py`

- [ ] **Step 1: Pin the image dependency**

Create `requirements-tarot.txt`:

```text
Pillow==12.2.0
```

- [ ] **Step 2: Write failing conversion tests**

Create `test_convert_tarot_webp.py`:

```python
import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).parents[1] / "convert_tarot_webp.py"
SPEC = importlib.util.spec_from_file_location("convert_tarot_webp", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class TarotWebpTests(unittest.TestCase):
    def test_convert_writes_1024_by_1536_webp_without_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.png"
            target = root / "tarot_00_fool.webp"
            image = Image.new("RGB", (900, 1400), "#221713")
            exif = Image.Exif()
            exif[0x010E] = "temporary source metadata"
            image.save(source, exif=exif)

            MODULE.convert_image(source, target)

            with Image.open(target) as result:
                self.assertEqual(result.format, "WEBP")
                self.assertEqual(result.size, (1024, 1536))
                self.assertEqual(len(result.getexif()), 0)

    def test_validation_reports_missing_and_wrong_sized_assets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            Image.new("RGB", (10, 10), "black").save(root / "tarot_00_fool.webp", "WEBP")

            errors = MODULE.validate_directory(root, allow_partial=True)

            self.assertIn("tarot_00_fool.webp: expected 1024x1536, got 10x10", errors)

    def test_strict_validation_requires_all_78_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            errors = MODULE.validate_directory(Path(temp_dir), allow_partial=False)

            self.assertTrue(any("missing 78 expected WebP files" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests and verify the utility is missing**

Run:

```powershell
cd E:\AI\gp\SD
python -m unittest discover -s scripts/tests -p "test_*.py" -v
```

Expected: FAIL because `convert_tarot_webp.py` does not exist.

- [ ] **Step 4: Implement conversion and validation**

Create `convert_tarot_webp.py`:

```python
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps, features


TARGET_SIZE = (1024, 1536)
MAJOR_SLUGS = (
    "fool", "magician", "high_priestess", "empress", "emperor",
    "hierophant", "lovers", "chariot", "strength", "hermit",
    "wheel_of_fortune", "justice", "hanged_man", "death", "temperance",
    "devil", "tower", "star", "moon", "sun", "judgement", "world",
)
SUITS = ("cups", "pentacles", "swords", "wands")
RANKS = (
    "ace", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "page", "knight", "queen", "king",
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
                        f"{name}: expected 1024x1536, got {image.width}x{image.height}"
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
```

- [ ] **Step 5: Run the utility tests**

Run:

```powershell
cd E:\AI\gp\SD
python -m unittest discover -s scripts/tests -p "test_*.py" -v
```

Expected: 3 tests PASS.

- [ ] **Step 6: Verify strict validation fails before the deck exists**

Run:

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards
```

Expected: FAIL with `missing 78 expected WebP files`.

- [ ] **Step 7: Commit the asset tooling**

```powershell
git add SD/scripts/convert_tarot_webp.py SD/scripts/requirements-tarot.txt SD/scripts/tests/test_convert_tarot_webp.py
git commit -m "test: add tarot WebP asset validation"
```

## Task 3: Generate and approve the three representative sample cards

**Files:**

- Source prompts: `SD/components/tools/tarot/tarot_78_dark_gold_prompts.md`
- Create: `SD/public/assets/tarot/cards/tarot_00_fool.webp`
- Create: `SD/public/assets/tarot/cards/tarot_13_death.webp`
- Create: `SD/public/assets/tarot/cards/tarot_cups_ace.webp`

- [ ] **Step 1: Compose the three final prompts exactly**

For each card, concatenate these four blocks from the prompt document without adding readable card text:

```text
1. Section 1.3 推荐统一前缀 Prompt
2. The card's 专属画面 Prompt under 愚者 / 死神 / 圣杯A
3. Section 1.4 推荐统一后缀 Prompt
4. Section 1.5 统一 Negative Prompt
```

Add only this production constraint to each final prompt:

```text
The artwork must include a very thin symmetrical antique-gold ornamental border, with clear empty safe areas at the top and bottom for frontend labels. Do not render any letters, words, numbers, card titles, captions, logos, or watermarks.
```

- [ ] **Step 2: Generate one image per prompt with built-in `image_gen`**

Use three distinct built-in generation calls. Do not use `n` to combine distinct cards. Copy the returned source images from the built-in generated-images directory into these exact workspace temporary paths before conversion:

```text
SD/tmp/imagegen/tarot/fool.png
SD/tmp/imagegen/tarot/death.png
SD/tmp/imagegen/tarot/cups-ace.png
```

Expected: three portrait source images representing the Fool, Death, and Ace of Cups.

- [ ] **Step 3: Convert the three sources to final WebP files**

For each source, run the corresponding command:

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py convert --input tmp/imagegen/tarot/fool.png --output public/assets/tarot/cards/tarot_00_fool.webp
python scripts/convert_tarot_webp.py convert --input tmp/imagegen/tarot/death.png --output public/assets/tarot/cards/tarot_13_death.webp
python scripts/convert_tarot_webp.py convert --input tmp/imagegen/tarot/cups-ace.png --output public/assets/tarot/cards/tarot_cups_ace.webp
```

Expected: each command reports `1024x1536 WebP quality 90`.

- [ ] **Step 4: Run partial automated validation**

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards --allow-partial
```

Expected: `tarot WebP assets are valid`.

- [ ] **Step 5: Inspect the three WebP files visually**

Open each final WebP at original detail and check:

- the dark-gold palette is aged and muted rather than yellow;
- faces, hands, horse anatomy, cup geometry, and border are coherent;
- the specified classic symbols are present;
- no readable text, random letters, logo, or watermark appears;
- top and bottom label-safe areas remain usable;
- all three cards clearly belong to one deck.

- [ ] **Step 6: Present the three samples for user approval**

Stop after showing all three samples. Do not generate the other 75 cards until the user explicitly approves the sample style.

- [ ] **Step 7: Commit approved sample assets**

```powershell
git add SD/public/assets/tarot/cards/tarot_00_fool.webp SD/public/assets/tarot/cards/tarot_13_death.webp SD/public/assets/tarot/cards/tarot_cups_ace.webp
git commit -m "feat: add approved tarot WebP samples"
```

## Task 4: Generate the complete Major Arcana batch

**Files:**

- Create: the remaining 19 `SD/public/assets/tarot/cards/tarot_00_*.webp` through `tarot_21_*.webp` files.

- [ ] **Step 1: Generate the remaining 19 Major Arcana images**

Use one built-in `image_gen` call per Major Arcana prompt, excluding the approved Fool and Death samples. Preserve the approved global style, border, safe-area, and no-text constraints verbatim.

- [ ] **Step 2: Convert each source using `convert_tarot_webp.py convert`**

Write each output beside its same-basename SVG, using the names returned by `getCardImagePaths`.

- [ ] **Step 3: Check Major Arcana completeness**

Run:

```powershell
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter 'tarot_??_*.webp').Count
```

Expected: `22`.

- [ ] **Step 4: Run partial validation and inspect all 22 cards**

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards --allow-partial
```

Expected: PASS. Regenerate only cards with anatomy, symbol, text, palette, border, or composition failures.

- [ ] **Step 5: Commit the Major Arcana batch**

```powershell
git add SD/public/assets/tarot/cards/tarot_??_*.webp
git commit -m "feat: add dark gold Major Arcana deck"
```

## Task 5: Generate the complete Cups batch

**Files:**

- Create: the remaining 13 `SD/public/assets/tarot/cards/tarot_cups_*.webp` files.

- [ ] **Step 1: Generate and convert Cups Two through Cups King**

Use the approved style and each Cups-specific prompt. Keep midnight-blue, silver-white, water, moonlight, and dark-gold cup materials consistent with the approved Ace of Cups.

- [ ] **Step 2: Check Cups completeness**

```powershell
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter 'tarot_cups_*.webp').Count
```

Expected: `14`.

- [ ] **Step 3: Validate and visually inspect the suit**

Run partial validation. Confirm numbered cards contain the correct count of primary cups and that court-card anatomy, cup identity, palette, border, and safe areas match the approved samples.

- [ ] **Step 4: Commit the Cups batch**

```powershell
git add SD/public/assets/tarot/cards/tarot_cups_*.webp
git commit -m "feat: add dark gold Cups deck"
```

## Task 6: Generate the complete Pentacles batch

**Files:**

- Create: 14 `SD/public/assets/tarot/cards/tarot_pentacles_*.webp` files.

- [ ] **Step 1: Generate and convert Pentacles Ace through King**

Use the approved style and each Pentacles-specific prompt. Keep moss green, deep brown, estates, workshops, stone, velvet, and dark-gold coins consistent across the suit.

- [ ] **Step 2: Check Pentacles completeness**

```powershell
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter 'tarot_pentacles_*.webp').Count
```

Expected: `14`.

- [ ] **Step 3: Validate and visually inspect the suit**

Run partial validation. Confirm numbered cards contain the correct count of primary pentacles and that no coin contains readable letters or currency marks.

- [ ] **Step 4: Commit the Pentacles batch**

```powershell
git add SD/public/assets/tarot/cards/tarot_pentacles_*.webp
git commit -m "feat: add dark gold Pentacles deck"
```

## Task 7: Generate the complete Swords batch

**Files:**

- Create: 14 `SD/public/assets/tarot/cards/tarot_swords_*.webp` files.

- [ ] **Step 1: Generate and convert Swords Ace through King**

Use the approved style and each Swords-specific prompt. Keep silver-gray, cold blue, storm, high-air architecture, blackened steel, and restrained cold-gold highlights consistent.

- [ ] **Step 2: Check Swords completeness**

```powershell
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter 'tarot_swords_*.webp').Count
```

Expected: `14`.

- [ ] **Step 3: Validate and visually inspect the suit**

Run partial validation. Confirm numbered cards contain the correct count of primary swords, blades are structurally coherent, and repeated blades are not fused or duplicated.

- [ ] **Step 4: Commit the Swords batch**

```powershell
git add SD/public/assets/tarot/cards/tarot_swords_*.webp
git commit -m "feat: add dark gold Swords deck"
```

## Task 8: Generate the complete Wands batch

**Files:**

- Create: 14 `SD/public/assets/tarot/cards/tarot_wands_*.webp` files.

- [ ] **Step 1: Generate and convert Wands Ace through King**

Use the approved style and each Wands-specific prompt. Keep deep red, warm brown, wilderness, mountains, fire, old wood, and antique-gold sparks consistent.

- [ ] **Step 2: Check Wands completeness**

```powershell
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter 'tarot_wands_*.webp').Count
```

Expected: `14`.

- [ ] **Step 3: Run strict full-deck validation**

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards
```

Expected: `tarot WebP assets are valid` with exactly 78 expected WebP files.

- [ ] **Step 4: Inspect the full deck together**

Open `SD/public/assets/tarot/cards/` in thumbnail view so all 78 WebP files are visible together, then open any outlier at original detail. Check deck-wide face style, antique-gold tone, border weight, dark density, label-safe areas, suit distinction, background variety, and the absence of modern objects or text. Regenerate individual failures and rerun strict validation.

- [ ] **Step 5: Commit the Wands batch and any approved corrections**

```powershell
git add SD/public/assets/tarot/cards/*.webp
git commit -m "feat: complete dark gold tarot WebP deck"
```

## Task 9: Switch the card component to WebP-first rendering

**Files:**

- Create: `SD/components/tools/tarot/TarotCardVisual.test.tsx`
- Modify: `SD/components/tools/tarot/TarotCardVisual.tsx:1`

- [ ] **Step 1: Write failing server-rendered component tests**

Create `TarotCardVisual.test.tsx`:

```tsx
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ALL_CARDS } from './tarot-data'
import { TarotCardBack, TarotCardVisual } from './TarotCardVisual'

const renderCard = (number: number, reversed = false) => {
  const card = ALL_CARDS[number]
  return renderToStaticMarkup(
    <TarotCardVisual
      number={card.number}
      name={card.name}
      emoji={card.emoji}
      suit={card.suit}
      reversed={reversed}
    />,
  )
}

describe('TarotCardVisual', () => {
  it('renders WebP-first artwork with frontend labels', () => {
    const html = renderCard(0)

    expect(html).toContain('tarot_00_fool.webp')
    expect(html).toContain('愚者')
    expect(html).toContain('The Fool')
    expect(html).toContain('data-card-number="0"')
    expect(html).toContain('aspect-[2/3]')
  })

  it('rotates only the artwork for reversed cards', () => {
    const html = renderCard(13, true)

    expect(html).toContain('rotate-180')
    expect(html).toContain('死神')
    expect(html).toContain('Death')
    expect(html).toContain('逆位')
  })

  it('keeps the existing SVG card back without face labels', () => {
    const html = renderToStaticMarkup(<TarotCardBack />)

    expect(html).toContain('tarot_back.svg')
    expect(html).not.toContain('The Fool')
  })
})
```

- [ ] **Step 2: Run the component test and verify it fails**

```powershell
cd E:\AI\gp\SD
npm test -- components/tools/tarot/TarotCardVisual.test.tsx
```

Expected: FAIL because the component still loads SVG card faces and does not render English labels or rotate artwork.

- [ ] **Step 3: Replace duplicate path metadata and add WebP fallback state**

At the top of `TarotCardVisual.tsx`, import `useEffect` and the canonical helpers, then delete the local Roman, Major slug, Minor rank slug, suit, and `getCardImage` maps:

```tsx
import React, { useEffect, useState } from 'react'

import { ALL_CARDS, getCardDisplayNumber, getCardImagePaths } from './tarot-data'
```

Inside the component, resolve metadata and reset fallback state whenever the card changes:

```tsx
const card = ALL_CARDS.find(item => item.number === number)
const paths = card ? getCardImagePaths(card) : null
const [webpFailed, setWebpFailed] = useState(false)

useEffect(() => {
  setWebpFailed(false)
}, [paths?.webp])

const imageSrc = faceDown
  ? '/assets/tarot/cards/tarot_back.svg'
  : webpFailed
    ? paths?.svg
    : paths?.webp
const displayNumber = card ? getCardDisplayNumber(card) : String(number)
const englishName = card?.nameEn ?? ''
```

Use exact 2:3 size classes:

```tsx
const sizeClasses = {
  sm: 'w-32 aspect-[2/3]',
  md: 'w-44 aspect-[2/3]',
  lg: 'w-64 aspect-[2/3]',
}
```

- [ ] **Step 4: Render artwork, fallback, labels, and reversed state**

Apply the rotation and fallback to both card and preview artwork:

```tsx
<img
  src={imageSrc}
  alt={faceDown ? 'Tarot card back' : `${name} tarot card`}
  className={`h-full w-full object-cover transition-transform duration-500 ${
    reversed && !faceDown ? 'rotate-180' : ''
  }`}
  onError={() => {
    if (!faceDown && !webpFailed) setWebpFailed(true)
  }}
  draggable={false}
/>
```

Define one reusable label overlay so the button and preview use identical non-rotating labels:

```tsx
const CardLabels: React.FC<{
  displayNumber: string
  name: string
  englishName: string
}> = ({ displayNumber, name, englishName }) => (
  <>
    <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-[#120d0b]/90 to-transparent px-3 pb-8 pt-3 text-center">
      <span data-card-number={displayNumber} className="font-serif text-xs tracking-[0.3em] text-[#ead3a1]">
        {displayNumber}
      </span>
    </div>
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#120d0b]/95 via-[#120d0b]/75 to-transparent px-3 pb-3 pt-10 text-center">
      <div className="font-serif text-sm tracking-[0.16em] text-[#fff2cf]">{name}</div>
      <div className="mt-1 font-serif text-[10px] uppercase tracking-[0.12em] text-[#d8b57c]">
        {englishName}
      </div>
    </div>
  </>
)
```

Render it inside both face-up image containers:

```tsx
{!faceDown && (
  <CardLabels
    displayNumber={displayNumber}
    name={name}
    englishName={englishName}
  />
)}
```

Keep the existing `逆位` badge outside the rotated `<img>` and do not render face labels for `TarotCardBack`.

- [ ] **Step 5: Run focused tests and type-check**

```powershell
cd E:\AI\gp\SD
npm test -- components/tools/tarot/tarot-data.test.ts components/tools/tarot/TarotCardVisual.test.tsx
npm run lint
```

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 6: Run the production build**

```powershell
cd E:\AI\gp\SD
npm run build
```

Expected: Vite production build exits 0.

- [ ] **Step 7: Commit the frontend switch**

```powershell
git add SD/components/tools/tarot/TarotCardVisual.tsx SD/components/tools/tarot/TarotCardVisual.test.tsx
git commit -m "feat: render tarot cards from WebP assets"
```

## Task 10: Complete end-to-end verification

**Files:**

- Verify: `SD/public/assets/tarot/cards/*.webp`
- Verify: `SD/components/tools/tarot/tarot-data.ts`
- Verify: `SD/components/tools/tarot/TarotCardVisual.tsx`

- [ ] **Step 1: Run all automated checks**

```powershell
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards
npm test
npm run lint
npm run build
```

Expected: asset validation, all Vitest tests, TypeScript, and production build PASS.

- [ ] **Step 2: Start the local site and inspect all tarot entry points**

Open Daily Tarot, Three-card Tarot, Love Tarot, Career Tarot, and Yes/No Tarot. Draw repeatedly until Major and Minor Arcana examples appear in each applicable flow.

Verify:

- WebP is the loaded face resource;
- Chinese and English names remain upright and readable;
- reversed artwork rotates 180° while labels do not;
- preview displays the same card and orientation;
- card frames keep a true 2:3 ratio at all component sizes;
- no layout shift or clipped labels occur.

- [ ] **Step 3: Exercise SVG fallback deliberately**

Temporarily rename the Fool WebP, load the Fool, then restore the filename:

```powershell
Rename-Item -LiteralPath E:\AI\gp\SD\public\assets\tarot\cards\tarot_00_fool.webp -NewName tarot_00_fool.webp.disabled
```

Confirm the browser requests and displays `tarot_00_fool.svg`, then restore the WebP:

```powershell
Rename-Item -LiteralPath E:\AI\gp\SD\public\assets\tarot\cards\tarot_00_fool.webp.disabled -NewName tarot_00_fool.webp
cd E:\AI\gp\SD
python scripts/convert_tarot_webp.py validate --directory public/assets/tarot/cards
```

Expected: the card remains visible through SVG fallback; final strict validation passes after restoration.

- [ ] **Step 4: Review the final Git diff and asset counts**

```powershell
git diff --check
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter '*.webp').Count
(Get-ChildItem E:\AI\gp\SD\public\assets\tarot\cards -Filter '*.svg').Count
```

Expected: no whitespace errors, `78` WebP files, and `79` SVG files including the card back.

- [ ] **Step 5: Commit only any verification fixes**

If verification required changes, stage only the in-scope tarot files and commit:

```powershell
git add SD/components/tools/tarot SD/public/assets/tarot/cards SD/scripts/convert_tarot_webp.py SD/scripts/tests/test_convert_tarot_webp.py
git commit -m "fix: finish tarot WebP verification"
```

If verification required no changes, do not create an empty commit.
