"""Upgrade untouched packaged assistant instructions to the distribution brand."""

from __future__ import annotations

import asyncio
import hashlib
import json
from importlib import resources

from octop_harness.backends.workspace import BackendWorkspace

from octop.branding import get_profile
from octop.infra.agents.experts.catalog import default_library_root

_SKILL_PATH = "skills/octop-assistant/SKILL.md"


def _legacy_sha256() -> frozenset[str]:
    raw = (
        resources.files("octop.branding")
        .joinpath("skill-revisions.json")
        .read_text(encoding="utf-8")
    )
    return frozenset(json.loads(raw)["octop-assistant"]["legacy_sha256"])


def _read_template() -> str:
    return (default_library_root() / "general-assistant" / _SKILL_PATH).read_text(encoding="utf-8")


async def sync_default_assistant_branding(workspace: BackendWorkspace) -> bool:
    """Replace only an allowlisted, unedited legacy skill; preserve user content."""
    if get_profile()["id"] != "hivework":
        return False
    current = await workspace.aread_text(_SKILL_PATH)
    if current is None:
        return False
    digest = hashlib.sha256(current.replace("\r\n", "\n").encode("utf-8")).hexdigest()
    loop = asyncio.get_running_loop()
    if digest not in await loop.run_in_executor(None, _legacy_sha256):
        return False
    template = await loop.run_in_executor(None, _read_template)
    await workspace.awrite_text(_SKILL_PATH, template, force=True)
    return True
