"""tests/unit/i18n/test_skills.py"""

from __future__ import annotations

import json
from pathlib import Path

from octop.i18n import all_skill_labels, skill_display_name
from octop.i18n.loader import _merge_overrides


def test_skill_display_name_known_zh():
    assert skill_display_name("pdf", "zh") == "PDF 处理"


def test_skill_display_name_octop_assistant_slug_zh():
    assert skill_display_name("octop-assistant", "zh") == "蜂巢智工助手"


def test_skill_display_name_octop_assistant_name_zh():
    assert skill_display_name("octop_assistant", "zh") == "蜂巢智工助手"


def test_skill_display_name_unknown_passthrough():
    assert skill_display_name("my-custom-skill", "en") == "my-custom-skill"


def test_skill_display_name_empty_passthrough():
    assert skill_display_name(None, "en") == ""


def test_all_skill_labels_includes_pdf():
    labels = all_skill_labels("en")
    assert labels["docx"] == "Word"
    assert labels["octop-assistant"] == "HiveWork Assistant"


def test_dashboard_skill_labels_match_backend():
    repo = Path(__file__).resolve().parents[3]
    for locale in ("en", "zh"):
        original = json.loads(
            (repo / f"dashboard/src/locales/{locale}.json").read_text(encoding="utf-8")
        )
        overrides = json.loads(
            (repo / f"src/octop/branding/frontend.{locale}.json").read_text(encoding="utf-8")
        )
        dashboard = _merge_overrides(original, {"skills": overrides["skills"]})
        for slug, label in all_skill_labels(locale).items():
            assert dashboard["skills"][slug] == label
