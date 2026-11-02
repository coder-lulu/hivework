"""Brand defaults protect existing installations and user-visible surfaces."""

from __future__ import annotations

import json
from pathlib import Path
from string import Formatter
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from click.testing import CliRunner
from fastapi import Request

from octop.branding import brand_name, get_profile
from octop.i18n import tr
from octop.i18n.loader import _load_all, _merge_overrides
from octop.infra.setup import self_update


@pytest.mark.parametrize(
    "locale,name", [("en", "HiveWork"), ("zh-CN", "蜂巢智工"), ("fr", "HiveWork")]
)
def test_brand_name_and_packaged_locales(locale: str, name: str) -> None:
    assert brand_name(locale) == name
    assert name in tr("memory_slim.not_ready", locale)


def test_overrides_preserve_source_and_placeholders() -> None:
    source = {"a": {"one": "before", "two": "unchanged"}}
    assert _merge_overrides(source, {"a": {"one": "after"}}) == {
        "a": {"one": "after", "two": "unchanged"}
    }
    assert source["a"]["one"] == "before"
    root = Path(__file__).resolve().parents[3] / "src/octop"
    formatter = Formatter()

    def fields(text: str) -> set[str]:
        return {field for _, field, _, _ in formatter.parse(text) if field is not None}

    def check(original: dict, override: dict) -> None:
        for key, value in override.items():
            assert key in original
            if isinstance(value, dict):
                check(original[key], value)
            else:
                assert fields(value) == fields(original[key])

    for locale in ("en", "zh"):
        check(
            json.loads((root / f"i18n/{locale}.json").read_text(encoding="utf-8")),
            json.loads((root / f"branding/backend.{locale}.json").read_text(encoding="utf-8")),
        )
    assert "7" in tr(
        "errors.BACKUP_SCHEMA_INCOMPATIBLE",
        "en",
        archive_schema_version=7,
        runtime_schema_version=6,
    )


def test_brand_locale_falls_back_to_english(monkeypatch: pytest.MonkeyPatch) -> None:
    import octop.i18n.loader as loader

    tables = _load_all()
    monkeypatch.setattr(loader, "_load_all", lambda: {"en": tables["en"], "zh": {}})
    assert loader.lookup("memory_slim.not_ready", "zh") == "HiveWork runtime is not ready."


@pytest.mark.parametrize("fpk", [False, True])
@pytest.mark.parametrize("locale", ["en", "zh"])
def test_default_upgrade_guard_has_no_install_or_stash_side_effects(
    monkeypatch: pytest.MonkeyPatch, fpk: bool, locale: str
) -> None:
    if fpk:
        monkeypatch.setenv("OCTOP_FPK_SITE_PACKAGES", "must-not-access")
    assert get_profile()["allow_official_self_update"] is False
    hooks = [
        "_run_fpk_upgrade",
        "stash_console_scripts",
        "_run_managed_upgrade",
        "fetch_pypi_info",
        "get_local_version",
    ]
    for hook in hooks:
        monkeypatch.setattr(self_update, hook, Mock(side_effect=AssertionError(hook)))
    result = self_update.run_upgrade(locale=locale, version="99.0")
    assert result.success is False
    assert brand_name(locale) in result.error
    assert get_profile()["repository_url"] in result.error


@pytest.mark.asyncio
async def test_update_api_refuses_before_checking_pypi_or_creating_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from octop.api.routers import update
    from octop.infra.errors import ErrorCode, OctopError

    for hook in ("fetch_pypi_info", "create_task", "get_editable_path"):
        monkeypatch.setattr(update, hook, Mock(side_effect=AssertionError(hook)))
    request = Request({"type": "http", "headers": [(b"accept-language", b"en")]})
    with pytest.raises(OctopError) as caught:
        await update.trigger_upgrade(
            request, body=update.UpgradeBody(), server=None, _=SimpleNamespace(locale="zh")
        )
    assert caught.value.code is ErrorCode.UPDATE_BRAND_MANAGED
    assert caught.value.status == 403
    assert "蜂巢智工" in caught.value.to_envelope(locale="zh")["error"]["message"]


@pytest.mark.asyncio
async def test_status_and_check_never_advertise_upstream_release(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from octop.api.routers import update, update_store

    monkeypatch.setattr(update, "fetch_pypi_info", Mock(side_effect=AssertionError("network")))
    monkeypatch.setattr(update, "get_local_version", lambda: "1.0")
    server = SimpleNamespace(
        services=SimpleNamespace(settings_repo=SimpleNamespace(get=lambda _: None))
    )
    update_store.cache_status(
        {
            "current_version": "1.0",
            "latest_any": "99.0",
            "latest_version": "99.0",
            "has_update": True,
        }
    )
    try:
        for result in (
            await update.update_status(_=None, server=server),
            await update.check_for_updates(_=None, server=server),
        ):
            assert result["has_update"] is False
            assert result["latest_version"] is None
            assert result["self_update_allowed"] is False
            assert result["update_url"] == get_profile()["repository_url"]
    finally:
        update_store.clear_cached_status()


@pytest.mark.parametrize("args,code", [(["--check"], 0), (["--yes"], 1)])
def test_cli_brand_upgrade_guidance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, args: list[str], code: int
) -> None:
    from octop.cli.commands import update

    monkeypatch.setenv("OCTOP_HOME", str(tmp_path))
    monkeypatch.setattr(update, "resolve_cli_locale", lambda: "zh")
    monkeypatch.setattr(update, "fetch_pypi_info", Mock(side_effect=AssertionError("network")))
    result = CliRunner().invoke(update.update, args)
    assert result.exit_code == code
    assert self_update.brand_update_error("zh").message in result.output
