"""Platform artwork generation must follow the runtime package's current paths."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


def test_generate_assets_updates_the_current_desktop_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "platform_branding", root / "scripts/prepare_platform_branding.py"
    )
    assert spec is not None and spec.loader is not None
    module: ModuleType = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    desktop = Path("src/octop/infra/control/desktop/scripts/linux/v1.0")
    assert (root / desktop / "start-menu.png").is_file()
    for relative in ("fnos/docker/app/ui/images", "fnos/native/app/ui/images", desktop):
        (tmp_path / relative).mkdir(parents=True)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "generate_desktop_assets", lambda: None)

    module.generate_assets()

    for asset, source in (
        ("start-menu.png", "icons/app-icon-orange-48.png"),
        ("wallpaper.png", "wallpapers/hivework-tech.png"),
    ):
        assert (tmp_path / desktop / asset).read_bytes() == (
            root / "hivework-logo-assets" / source
        ).read_bytes()
    assert not (tmp_path / "src/octop/infra/desktop").exists()
