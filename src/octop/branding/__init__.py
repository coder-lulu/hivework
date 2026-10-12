"""Packaged, build-time brand information shared by presentation layers."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any, cast


@lru_cache(maxsize=1)
def get_profile() -> dict[str, Any]:
    """Read the distribution's brand profile (not user configuration)."""
    raw = resources.files(__package__).joinpath("profile.json").read_text(encoding="utf-8")
    return cast(dict[str, Any], json.loads(raw))


def brand_name(locale: str = "en") -> str:
    loc = "zh" if locale.lower().replace("_", "-").startswith("zh") else "en"
    return str(get_profile()["name"][loc])
