"""Sanity checks for the bundled general-assistant template."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import yaml
from tests.support.fakes import FakeHarnessAgent

from octop.infra.agents.experts.catalog import default_library_root, seed_expert_directory
from octop.infra.skills.presentation import apply_skill_presentation

_DIR = default_library_root() / "general-assistant"


def test_all_required_files_present() -> None:
    for name in ("SOUL.md", "manifest.json", "skills/octop-assistant/SKILL.md"):
        assert (_DIR / name).is_file(), f"missing {name}"


def test_meta_yaml_has_id_and_display_name() -> None:
    meta = json.loads((_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert meta["id"] == "general-assistant"
    label = meta.get("label")
    assert isinstance(label, dict) and isinstance(label.get("en"), str) and label["en"]


def test_skills_json_is_a_list() -> None:
    meta = json.loads((_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert isinstance(meta.get("prompt_files", []), list)


@pytest.mark.asyncio
async def test_new_assistant_seeds_branded_skill(tmp_path: Path) -> None:
    workspace = FakeHarnessAgent(workspace_dir=tmp_path, system_files_path=".octop").workspace
    await seed_expert_directory(expert_dir=_DIR, workspace=workspace)
    content = await workspace.aread_text("skills/octop-assistant/SKILL.md")
    assert content is not None
    metadata = yaml.safe_load(content.split("---", 2)[1])
    assert metadata["name"] == "octop-assistant"
    for locale, label in (("zh", "HiveWork 助手"), ("en", "HiveWork Assistant")):
        summary = apply_skill_presentation(
            {"slug": "octop-assistant", "name": "octop-assistant"}, metadata, locale=locale
        )
        assert summary["name"] == label
        assert "HiveWork" in summary["description"]
        assert "Octop" not in summary["description"]
        assert summary["emoji"] == "🐝"
        assert summary["slug"] == "octop-assistant"
    assert "`octop`" in content and "metadata:\n  octop:" in content
    assert "你是 HiveWork 助手" in content
    assert "https://finnie-1258344699.cos.ap-guangzhou.myqcloud.com/octop/install" not in content


def test_brand_revision_allowlist_excludes_current_template() -> None:
    from importlib import resources

    revisions = json.loads(
        resources.files("octop.branding")
        .joinpath("skill-revisions.json")
        .read_text(encoding="utf-8")
    )
    legacy = revisions["octop-assistant"]["legacy_sha256"]
    content = (_DIR / "skills/octop-assistant/SKILL.md").read_bytes().replace(b"\r\n", b"\n")
    assert legacy and all(len(digest) == 64 for digest in legacy)
    assert hashlib.sha256(content).hexdigest() not in legacy
