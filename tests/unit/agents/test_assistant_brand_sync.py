"""Default assistant branding upgrades must preserve user-owned instructions."""

from __future__ import annotations

import hashlib
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from tests.support.fakes import FakeHarnessAgent

from octop.infra.agents.experts import brand_sync

_SKILL_PATH = "skills/octop-assistant/SKILL.md"
_LEGACY = "---\nname: octop-assistant\ndescription: Octop assistant\n---\n# Octop\n"
_TEMPLATE = "---\nname: octop-assistant\ndescription: HiveWork assistant\n---\n# HiveWork\n"


@pytest.fixture
def branded_library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    library = tmp_path / "library"
    template = library / "general-assistant" / _SKILL_PATH
    template.parent.mkdir(parents=True)
    template.write_text(_TEMPLATE, encoding="utf-8")
    monkeypatch.setattr(brand_sync, "default_library_root", lambda: library)
    monkeypatch.setattr(brand_sync, "get_profile", lambda: {"id": "hivework"})
    # Fixture digests belong only to this mocked resource reader, never the
    # packaged allowlist of official, released skill revisions.
    monkeypatch.setattr(
        brand_sync,
        "_legacy_sha256",
        lambda: frozenset({hashlib.sha256(_LEGACY.encode("utf-8")).hexdigest()}),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("system_files_path", ["", ".octop"])
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
async def test_upgrade_legacy_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    branded_library: None,
    system_files_path: str,
    newline: str,
) -> None:
    root = tmp_path / "workspace"
    workspace = FakeHarnessAgent(
        workspace_dir=root,
        virtual_mode=False,
        system_files_path=system_files_path,
    ).workspace
    await workspace.awrite_text(_SKILL_PATH, _LEGACY.replace("\n", newline), force=True)
    write = AsyncMock(wraps=workspace.awrite_text)
    monkeypatch.setattr(workspace, "awrite_text", write)

    assert await brand_sync.sync_default_assistant_branding(workspace) is True
    assert await workspace.aread_text(_SKILL_PATH) == _TEMPLATE
    assert (root / system_files_path / _SKILL_PATH).is_file()
    if system_files_path:
        assert not (root / _SKILL_PATH).exists()
    assert await brand_sync.sync_default_assistant_branding(workspace) is False
    write.assert_awaited_once_with(_SKILL_PATH, _TEMPLATE, force=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [_LEGACY + "User notes\n", _TEMPLATE, None])
async def test_preserves_unknown_current_or_missing_skill(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    branded_library: None,
    content: str | None,
) -> None:
    workspace = FakeHarnessAgent(workspace_dir=tmp_path / "workspace").workspace
    if content is not None:
        await workspace.awrite_text(_SKILL_PATH, content, force=True)
    write = AsyncMock(wraps=workspace.awrite_text)
    monkeypatch.setattr(workspace, "awrite_text", write)

    assert await brand_sync.sync_default_assistant_branding(workspace) is False
    assert await workspace.aread_text(_SKILL_PATH) == content
    write.assert_not_awaited()


@pytest.mark.asyncio
async def test_other_brand_keeps_legacy_skill(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, branded_library: None
) -> None:
    workspace = FakeHarnessAgent(workspace_dir=tmp_path / "workspace").workspace
    await workspace.awrite_text(_SKILL_PATH, _LEGACY, force=True)
    monkeypatch.setattr(brand_sync, "get_profile", lambda: {"id": "octop"})
    write = AsyncMock(wraps=workspace.awrite_text)
    monkeypatch.setattr(workspace, "awrite_text", write)

    assert await brand_sync.sync_default_assistant_branding(workspace) is False
    assert await workspace.aread_text(_SKILL_PATH) == _LEGACY
    write.assert_not_awaited()


@pytest.mark.asyncio
async def test_full_length_legacy_uses_packaged_template(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Exceeds the original skill's 665 lines / 26 KB: digest matching must use
    # the complete document, not a preview of its frontmatter or first lines.
    legacy = _LEGACY + "Original packaged assistant instruction.\n" * 1000
    monkeypatch.setattr(brand_sync, "get_profile", lambda: {"id": "hivework"})
    monkeypatch.setattr(
        brand_sync,
        "_legacy_sha256",
        lambda: frozenset({hashlib.sha256(legacy.encode("utf-8")).hexdigest()}),
    )
    workspace = FakeHarnessAgent(workspace_dir=tmp_path / "workspace").workspace
    await workspace.awrite_text(_SKILL_PATH, legacy, force=True)

    assert await brand_sync.sync_default_assistant_branding(workspace) is True
    actual = await workspace.aread_text(_SKILL_PATH)
    assert actual == brand_sync._read_template()
    assert actual is not None and "HiveWork 助手" in actual
    assert "HiveWork Assistant" in actual and "🐝" in actual
