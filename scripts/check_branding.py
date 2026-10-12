"""Validate brand sources and optional SPA/wheel artifacts using the stdlib."""

from __future__ import annotations

import argparse
import base64
import json
import re
import string
import struct
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
BRAND_ROOT = ROOT / "src/octop/branding"
ASSET_ROOT = ROOT / "dashboard/branding/assets"
EXPECTED_ASSETS = {
    "logo_horizontal_dark.png": (798, 270),
    "logo_horizontal_white.png": (406, 154),
    "pwa-192.png": (192, 192),
    "pwa-512.png": (512, 512),
    "apple-touch-icon.png": (180, 180),
    "octop-mascot-empty.png": (512, 512),
    "octop-mascot-tasks.png": (512, 512),
}
SUPPLIED_PNGS = {
    "logo_horizontal_dark.png": "png/logo-bilingual.png",
    "logo_horizontal_white.png": "png/logo-bilingual-reverse.png",
    "pwa-192.png": "icons/app-icon-orange-192.png",
    "pwa-512.png": "icons/app-icon-orange-512.png",
    "apple-touch-icon.png": "icons/app-icon-orange-180.png",
}
SUPPLIED_SVGS = {
    "logo_vertical_dark.svg": "png/mark-orange.png",
    "logo_vertical_white.svg": "png/mark-white.png",
    "logo_horizontal_dark.svg": "png/logo-bilingual.png",
    "logo_horizontal_white.svg": "png/logo-bilingual-reverse.png",
    "favico.svg": "icons/app-icon-orange-64.png",
}
SVG_ASSETS = tuple(SUPPLIED_SVGS)
WEBP_ASSETS = ("octop-mascot-peek.webp", "octop-mascot-type.webp")


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def flatten(table: dict[str, Any], prefix: str = "") -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in table.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten(value, name))
        elif isinstance(value, str):
            result[name] = value
        else:
            raise ValueError(f"Locale value must be a string: {name}")
    return result


def placeholders(text: str, surface: str) -> set[str]:
    if surface == "frontend":
        return set(re.findall(r"\{\{\s*([^}]+?)\s*\}\}", text))
    return {field for _, field, _, _ in string.Formatter().parse(text) if field is not None}


def check_assets(directory: Path, problems: list[str]) -> None:
    for filename, expected in EXPECTED_ASSETS.items():
        asset = directory / filename
        if not asset.is_file():
            problems.append(f"Missing asset: {asset}")
            continue
        raw = asset.read_bytes()
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or len(raw) < 24:
            problems.append(f"Invalid PNG: {asset}")
        elif struct.unpack(">II", raw[16:24]) != expected:
            problems.append(f"Unexpected PNG dimensions: {asset}")
    for filename in SVG_ASSETS:
        asset = directory / filename
        if not asset.is_file() or "HiveWork" not in asset.read_text(encoding="utf-8"):
            problems.append(f"Missing brand SVG: {asset}")
    for filename in WEBP_ASSETS:
        asset = directory / filename
        raw = asset.read_bytes() if asset.is_file() else b""
        if raw[:4] != b"RIFF" or raw[8:12] != b"WEBP":
            problems.append(f"Invalid brand WebP: {asset}")


def check_sources(profile: dict[str, Any], problems: list[str]) -> None:
    if profile["name"] != {"en": "HiveWork", "zh": "蜂巢智工"}:
        problems.append("Product names do not match HiveWork / 蜂巢智工")
    if profile.get("allow_official_self_update") is not False:
        problems.append("HiveWork must not install upstream wheels through self-update")
    merged: dict[tuple[str, str], dict[str, str]] = {}
    changed: dict[tuple[str, str], set[str]] = {}
    for surface in ("frontend", "backend"):
        keys_by_locale = {}
        for locale in ("en", "zh"):
            original_path = (
                ROOT / f"dashboard/src/locales/{locale}.json"
                if surface == "frontend"
                else ROOT / f"src/octop/i18n/{locale}.json"
            )
            original = flatten(load(original_path))
            overlay = flatten(load(BRAND_ROOT / f"{surface}.{locale}.json"))
            keys_by_locale[locale] = set(overlay)
            changed[surface, locale] = set(overlay)
            for key, value in overlay.items():
                if key not in original:
                    if not key.startswith("brand."):
                        problems.append(f"Unknown overlay target: {surface}.{locale}.{key}")
                    continue
                if placeholders(original[key], surface) != placeholders(value, surface):
                    problems.append(f"Changed placeholders: {surface}.{locale}.{key}")
            merged[surface, locale] = original | overlay
        if keys_by_locale["en"] != keys_by_locale["zh"]:
            missing_en = sorted(keys_by_locale["zh"] - keys_by_locale["en"])
            missing_zh = sorted(keys_by_locale["en"] - keys_by_locale["zh"])
            problems.append(
                f"Unequal {surface} overlay keys: en lacks {missing_en}; zh lacks {missing_zh}"
            )
    for locale in ("en", "zh"):
        for key in changed["backend", locale] | changed["frontend", locale]:
            if (key.startswith("skills.") or key.startswith("tools.")) and (
                merged["frontend", locale].get(key) != merged["backend", locale].get(key)
            ):
                problems.append(f"Server-owned label differs: {locale}.{key}")
    check_assets(ASSET_ROOT, problems)
    for directory in (ASSET_ROOT, ROOT / "dashboard/public"):
        for filename, source in SUPPLIED_PNGS.items():
            asset = directory / filename
            if asset.read_bytes() != (ROOT / "hivework-logo-assets" / source).read_bytes():
                problems.append(f"Logo differs from supplied PNG: {asset}")
        for filename, source in SUPPLIED_SVGS.items():
            asset = directory / filename
            svg = ElementTree.parse(asset).getroot()
            image = svg.find("{http://www.w3.org/2000/svg}image")
            href = image.get("href", "") if image is not None else ""
            prefix = "data:image/png;base64,"
            if (
                not href.startswith(prefix)
                or base64.b64decode(href[len(prefix) :], validate=True)
                != (ROOT / "hivework-logo-assets" / source).read_bytes()
            ):
                problems.append(f"SVG does not embed the supplied PNG: {asset}")


def check_built(profile: dict[str, Any], problems: list[str]) -> None:
    directory = ROOT / "src/octop/dashboard"
    if not (directory / "index.html").is_file():
        problems.append("SPA is missing; run the default frontend build first")
        return
    index = (directory / "index.html").read_text(encoding="utf-8")
    if f"<title>{profile['name']['zh']}（{profile['name']['en']}）</title>" not in index:
        problems.append("SPA HTML title is not HiveWork")
    if not re.search(r'name="apple-mobile-web-app-title"\s+content="蜂巢智工"', index):
        problems.append("Apple app title is not HiveWork")
    manifest = load(directory / "manifest.json")
    original = load(ROOT / "dashboard/public/manifest.json")
    for field in ("id", "start_url", "scope"):
        if manifest.get(field) != original.get(field):
            problems.append(f"PWA identity changed: {field}")
    if manifest.get("name") != "蜂巢智工（HiveWork）" or manifest.get("short_name") != "蜂巢智工":
        problems.append("PWA installation names are not HiveWork")
    offline = (directory / "offline.html").read_text(encoding="utf-8")
    if "蜂巢智工" not in offline or re.search(r"\bOctop\b", offline):
        problems.append("Offline page contains unexpected product branding")
    if not (directory / "sw.js").is_file():
        problems.append("Service Worker missing from branded build")
    check_assets(directory, problems)
    for filename in (*EXPECTED_ASSETS, *SVG_ASSETS, *WEBP_ASSETS):
        target = directory / filename
        if target.is_file() and target.read_bytes() != (ASSET_ROOT / filename).read_bytes():
            problems.append(f"Built asset differs from brand source: {filename}")
    for filename in ("octop-mascot-type.webm", "octop-mascot-peek.webm"):
        if (directory / filename).exists():
            problems.append(f"Unused upstream mascot remains in build: {filename}")


def check_wheel(wheel: Path, problems: list[str]) -> None:
    with zipfile.ZipFile(wheel) as archive:
        members = set(archive.namelist())
        required = [
            "octop/branding/profile.json",
            *[
                f"octop/branding/{surface}.{locale}.json"
                for surface in ("frontend", "backend")
                for locale in ("en", "zh")
            ],
            "octop/dashboard/index.html",
            "octop/dashboard/manifest.json",
            "octop/dashboard/sw.js",
            *[f"octop/dashboard/{name}" for name in (*EXPECTED_ASSETS, *SVG_ASSETS, *WEBP_ASSETS)],
        ]
        for member in required:
            if member not in members:
                problems.append(f"Wheel resource missing: {member}")
        if "octop/dashboard/index.html" in members:
            index = archive.read("octop/dashboard/index.html").decode("utf-8")
            if "蜂巢智工（HiveWork）" not in index:
                problems.append("Wheel SPA is not HiveWork")
            for asset in re.findall(r"(?:src|href)=[\"\'](/assets/[^\"\'?#]+)", index):
                if f"octop/dashboard{asset}" not in members:
                    problems.append(f"Wheel HTML references a missing asset: {asset}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--built", action="store_true", help="Also check the default SPA output")
    parser.add_argument("--wheel", type=Path, help="Also inspect a built wheel archive")
    args = parser.parse_args()
    problems: list[str] = []
    try:
        profile = load(BRAND_ROOT / "profile.json")
        check_sources(profile, problems)
        if args.built:
            check_built(profile, problems)
        if args.wheel:
            check_wheel(args.wheel, problems)
    except (OSError, KeyError, ValueError, ElementTree.ParseError, zipfile.BadZipFile) as exc:
        problems.append(str(exc))
    for problem in problems:
        print(f"ERROR: {problem}")
    if not problems:
        print(
            "HiveWork branding checks passed" + (" (source + SPA)" if args.built else " (source)")
        )
    return int(bool(problems))


if __name__ == "__main__":
    raise SystemExit(main())
