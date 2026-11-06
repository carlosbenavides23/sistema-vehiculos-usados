"""Generate the app's local SVG sprite from pinned upstream Lucide SVGs."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "lucide" / "1.62.0"
SOURCE = VENDOR / "icons"
MANIFEST = VENDOR / "manifest.json"
OUTPUT = ROOT / "static" / "img" / "icons" / "lucide-sprite.svg"
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def generate_sprite(source: Path = SOURCE, manifest_path: Path = MANIFEST, output: Path = OUTPUT) -> int:
    # Keep generated repository assets LF-only on Windows and Unix alike.
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != "1.62.0":
        raise ValueError("The pinned Lucide manifest version must remain 1.62.0.")

    expected = {item["name"]: item["sha256"] for item in manifest.get("icons", [])}
    if not expected or len(expected) != len(manifest["icons"]):
        raise ValueError("The Lucide manifest must contain unique icon names.")
    actual_files = {path.stem: path for path in source.glob("*.svg")}
    if set(actual_files) != set(expected):
        raise ValueError("The vendored Lucide SVG set does not match its manifest.")

    sprite = ET.Element(f"{{{SVG_NS}}}svg", {"version": "1.1"})
    sprite.append(ET.Comment(" Generated from pinned upstream Lucide 1.62.0 SVGs; do not edit manually. "))
    for name in sorted(expected):
        source_file = actual_files[name]
        raw = source_file.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected[name]:
            raise ValueError(f"Pinned Lucide source hash mismatch: {name}.")
        root = ET.fromstring(raw)
        if root.tag != f"{{{SVG_NS}}}svg" or root.get("viewBox") != "0 0 24 24":
            raise ValueError(f"Unexpected official SVG root or viewBox: {name}.")
        if not len(root):
            raise ValueError(f"Lucide icon has no vector shapes: {name}.")

        symbol = ET.SubElement(
            sprite,
            f"{{{SVG_NS}}}symbol",
            {
                "id": name,
                "viewBox": "0 0 24 24",
                "fill": root.get("fill", "none"),
                "stroke": root.get("stroke", "currentColor"),
                "stroke-width": root.get("stroke-width", "2"),
                "stroke-linecap": root.get("stroke-linecap", "round"),
                "stroke-linejoin": root.get("stroke-linejoin", "round"),
            },
        )
        for shape in root:
            if shape.tag.rsplit("}", 1)[-1] not in {"path", "circle", "rect", "line", "polyline", "polygon", "ellipse"}:
                raise ValueError(f"Unsupported SVG element in Lucide icon {name}.")
            symbol.append(deepcopy(shape))

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(ET.tostring(sprite, encoding="utf-8", xml_declaration=True) + b"\n")
    return len(expected)


if __name__ == "__main__":
    print(f"Lucide 1.62.0 sprite generated: {generate_sprite()} icons.")
