"""Prepare platform icons from the supplied HiveWork logos, keeping app identities."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "dashboard/branding/assets"
SOURCE = ROOT / "hivework-logo-assets"


def generate_desktop_assets() -> None:
    from PIL import Image

    resources = ROOT / "desktop/src/resources"
    renderer = ROOT / "desktop/src/renderer/src/assets"
    resources.mkdir(parents=True, exist_ok=True)
    renderer.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE / "icons/app-icon-orange-512.png", resources / "icon.png")
    with Image.open(ASSETS / "pwa-512.png") as source:
        source.save(
            resources / "icon.ico",
            sizes=[(size, size) for size in (16, 32, 48, 64, 128, 256)],
        )
    with Image.open(SOURCE / "icons/app-icon-orange-1024.png") as source:
        # Keep the macOS 824/1024 icon grid rather than a full-bleed Dock icon.
        icon = Image.new("RGBA", (1024, 1024))
        icon.alpha_composite(source.resize((824, 824), Image.Resampling.LANCZOS), (100, 100))
        icon.save(resources / "icon.icns")
    for source_name, filename in [
        ("logo-bilingual.png", "logo_horizontal_dark.png"),
        ("logo-bilingual-reverse.png", "logo_horizontal_white.png"),
        ("mark-orange.png", "hivework-mark.png"),
    ]:
        shutil.copyfile(SOURCE / "png" / source_name, renderer / filename)


def generate_assets() -> None:
    from PIL import Image

    generate_desktop_assets()
    fpk_icons = ROOT / "fnos/branding"
    fpk_icons.mkdir(exist_ok=True)
    shutil.copyfile(SOURCE / "icons/app-icon-orange-64.png", fpk_icons / "icon_64.png")
    with Image.open(ASSETS / "pwa-512.png") as source:
        source.resize((256, 256), Image.Resampling.LANCZOS).save(fpk_icons / "icon_256.png")
    for kind in ("docker", "native"):
        staging = ROOT / "fnos" / kind
        for source, name in [
            (ASSETS / "pwa-512.png", "ICON.PNG"),
            (fpk_icons / "icon_256.png", "ICON_256.PNG"),
            (fpk_icons / "icon_64.png", "app/ui/images/icon_64.png"),
            (fpk_icons / "icon_256.png", "app/ui/images/icon_256.png"),
        ]:
            shutil.copyfile(source, staging / name)
    shutil.copyfile(
        SOURCE / "icons/app-icon-orange-48.png",
        ROOT / "src/octop/infra/control/desktop/scripts/linux/v1.0/start-menu.png",
    )
    shutil.copyfile(
        SOURCE / "wallpapers/hivework-tech.png",
        ROOT / "src/octop/infra/control/desktop/scripts/linux/v1.0/wallpaper.png",
    )


def fpk_assets(staging: Path, kind: str) -> None:
    if kind == "docker":
        tag = os.environ.get("FPK_IMAGE_TAG", "")
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", tag):
            raise ValueError("Set FPK_IMAGE_TAG to an explicitly reviewed HiveWork image tag")
        compose = staging / "app/docker/docker-compose.yaml"
        content, count = re.subn(
            r"(?m)^    image: .+$",
            f"    image: ghcr.io/coder-lulu/hivework:{tag}",
            compose.read_text(encoding="utf-8"),
        )
        if count != 1:
            raise ValueError("Expected exactly one Docker FPK image reference")
        compose.write_text(content, encoding="utf-8")
    else:
        package = staging / "app/site-packages/octop"
        profile = json.loads((package / "branding/profile.json").read_text(encoding="utf-8"))
        if profile["id"] != "hivework" or "HiveWork" not in (
            package / "dashboard/index.html"
        ).read_text(encoding="utf-8"):
            raise ValueError("Native FPK requires a verified HiveWork package and built SPA")
    for source, name in [
        (ASSETS / "pwa-512.png", "ICON.PNG"),
        (ROOT / "fnos/branding/icon_256.png", "ICON_256.PNG"),
        (ROOT / "fnos/branding/icon_64.png", "app/ui/images/icon_64.png"),
        (ROOT / "fnos/branding/icon_256.png", "app/ui/images/icon_256.png"),
    ]:
        shutil.copyfile(source, staging / name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--generate-assets", action="store_true")
    action.add_argument("--fpk", type=Path)
    parser.add_argument("--kind", choices=["docker", "native"])
    args = parser.parse_args()
    if args.generate_assets:
        generate_assets()
    elif args.kind:
        fpk_assets(args.fpk, args.kind)
    else:
        parser.error("--fpk requires --kind")


if __name__ == "__main__":
    main()
