import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).parents[1] / "convert_tarot_webp.py"


def load_module():
    if not MODULE_PATH.exists():
        raise AssertionError(f"missing production module: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("convert_tarot_webp", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TarotWebpTests(unittest.TestCase):
    def test_convert_writes_1024_by_1536_webp_without_metadata(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.png"
            target = root / "tarot_00_fool.webp"
            image = Image.new("RGB", (900, 1400), "#221713")
            exif = Image.Exif()
            exif[0x010E] = "temporary source metadata"
            image.save(source, exif=exif)

            module.convert_image(source, target)

            with Image.open(target) as result:
                self.assertEqual(result.format, "WEBP")
                self.assertEqual(result.size, (1024, 1536))
                self.assertEqual(len(result.getexif()), 0)

    def test_validation_reports_wrong_sized_assets(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            Image.new("RGB", (10, 10), "black").save(
                root / "tarot_00_fool.webp",
                "WEBP",
            )

            errors = module.validate_directory(root, allow_partial=True)

            self.assertIn(
                "tarot_00_fool.webp: expected 1024x1536, got 10x10",
                errors,
            )

    def test_strict_validation_requires_all_78_files(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            errors = module.validate_directory(Path(temp_dir), allow_partial=False)

            self.assertTrue(
                any("missing 78 expected WebP files" in error for error in errors)
            )


if __name__ == "__main__":
    unittest.main()
