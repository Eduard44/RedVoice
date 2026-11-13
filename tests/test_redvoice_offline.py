"""RedVoice ships with the upstream project's online services switched off."""

import json
from pathlib import Path

from core import analytics, app_config

ROOT = Path(__file__).resolve().parents[1]


def test_the_build_keeps_online_services_off():
    assert json.loads((ROOT / "config/app.json").read_text(encoding="utf-8"))["onlineServices"] is False
    assert app_config.ONLINE_SERVICES is False


def test_analytics_never_sends_while_online_services_are_off(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_ANALYTICS_DISABLED", raising=False)
    monkeypatch.setattr(analytics, "user_opted_in", lambda: True)
    assert analytics._kill_switched() is True
    assert analytics.enabled() is False
