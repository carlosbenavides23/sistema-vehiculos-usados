import hashlib
import json
import re
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
MANIFEST_PATH = ROOT / "vendor" / "lucide" / "1.62.0" / "manifest.json"


class LucideIconTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.icon_names = {item["name"] for item in cls.manifest["icons"]}
        cls.sprite_path = ROOT / "static" / "img" / "icons" / "lucide-sprite.svg"
        cls.sprite = ET.parse(cls.sprite_path).getroot()
        cls.symbols = {
            symbol.get("id"): symbol
            for symbol in cls.sprite.findall(f"{{{SVG_NS}}}symbol")
        }

    def test_vendor_sources_match_the_pinned_version_and_hashes(self):
        self.assertEqual(self.manifest["version"], "1.62.0")
        source_dir = ROOT / "vendor" / "lucide" / "1.62.0" / "icons"
        source_files = {path.stem: path for path in source_dir.glob("*.svg")}
        self.assertEqual(set(source_files), self.icon_names)
        for item in self.manifest["icons"]:
            with self.subTest(icon=item["name"]):
                self.assertEqual(
                    hashlib.sha256(source_files[item["name"]].read_bytes()).hexdigest(),
                    item["sha256"],
                )
        self.assertTrue((MANIFEST_PATH.parent / "LICENSE").is_file())

    def test_sprite_is_valid_and_contains_only_pinned_icons(self):
        self.assertEqual(self.sprite.tag, f"{{{SVG_NS}}}svg")
        self.assertEqual(set(self.symbols), self.icon_names)
        for name, symbol in self.symbols.items():
            with self.subTest(icon=name):
                self.assertEqual(symbol.get("viewBox"), "0 0 24 24")
                self.assertEqual(symbol.get("stroke"), "currentColor")
                self.assertEqual(symbol.get("stroke-width"), "2")
                self.assertEqual(symbol.get("stroke-linecap"), "round")
                self.assertEqual(symbol.get("stroke-linejoin"), "round")
                self.assertTrue(list(symbol))
                for element in symbol.iter():
                    self.assertNotIn("href", element.attrib)
                    self.assertFalse(any(key.lower().startswith("on") for key in element.attrib))

    def test_jinja_and_javascript_references_are_in_the_closed_set(self):
        macro = (ROOT / "templates" / "macros" / "icons.html").read_text(encoding="utf-8")
        supported_block = macro.split("{% set supported = [", 1)[1].split("] %}", 1)[0]
        macro_names = set(re.findall(r"'([a-z0-9-]+)'", supported_block))
        self.assertEqual(macro_names, self.icon_names)

        helper = (ROOT / "static" / "js" / "iconos.js").read_text(encoding="utf-8")
        js_block = helper.split("const ICON_NAMES = Object.freeze([", 1)[1].split("]);", 1)[0]
        js_names = set(re.findall(r'"([a-z0-9-]+)"', js_block))
        self.assertEqual(js_names, self.icon_names)

        template_names = set()
        for path in (ROOT / "templates").rglob("*.html"):
            template_names.update(re.findall(r"lucide_icon\(['\"]([a-z0-9-]+)['\"]", path.read_text(encoding="utf-8")))
        self.assertTrue(template_names)
        self.assertLessEqual(template_names, self.icon_names)
        self.assertIn("lucide-sprite.svg') }}#", macro)
        self.assertIn('aria-hidden="true"', macro)
        self.assertIn('focusable="false"', macro)

    def test_icon_only_controls_have_names_and_no_cdn_icon_loading(self):
        index = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        admin = (ROOT / "templates" / "admin_v6.html").read_text(encoding="utf-8")
        for template in (index, admin):
            buttons = re.findall(r"<button\b[^>]*>[\s\S]*?</button>", template)
            for button in buttons:
                if "lucide_icon" not in button:
                    continue
                if re.search(r"lucide_icon\([^)]*\)</button>", button):
                    self.assertRegex(button, r"aria-label=\"[^\"]+\"")

        searched = []
        for base in ("templates", "static/css", "static/js"):
            for path in (ROOT / base).rglob("*"):
                if path.suffix in {".html", ".css", ".js"}:
                    searched.append(path.read_text(encoding="utf-8", errors="replace").lower())
        joined = "\n".join(searched)
        self.assertNotRegex(joined, r"(?:lucide\.dev|unpkg\.com/lucide|cdn\.jsdelivr\.net/npm/lucide)")

    def test_old_ui_icon_asset_paths_are_not_referenced(self):
        for base in ("templates", "static/css", "static/js", "public/static/css", "public/static/js"):
            for path in (ROOT / base).rglob("*"):
                if path.suffix not in {".html", ".css", ".js"}:
                    continue
                content = path.read_text(encoding="utf-8", errors="replace")
                with self.subTest(path=path.relative_to(ROOT)):
                    self.assertNotRegex(content, r"img/(?:ui|admin-v6)/")

    def test_static_and_vercel_copies_are_identical(self):
        for source in (ROOT / "static").rglob("*"):
            if not source.is_file():
                continue
            public = ROOT / "public" / "static" / source.relative_to(ROOT / "static")
            with self.subTest(path=source.relative_to(ROOT / "static")):
                self.assertTrue(public.is_file())
                self.assertEqual(source.read_bytes(), public.read_bytes())


if __name__ == "__main__":
    unittest.main()
