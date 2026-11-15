"""RedVoice: the upstream contributor-agreement (CLA) bot stays switched off.

RedVoice is a personal fork with no contributor agreement. Upstream's CLA
workflows (cla.yml, cla-reminders.yml, cla-backfill.yml) commented on every pull
request, turned it into a draft and set a failing ``CLA`` status; they are
removed. ``.github/scripts/cla_check.py`` stays because the commit-identity gate
(``identity_check.py``) and ``ci_scope.py`` import helpers from it.

These tests keep the bot from coming back by accident, keep CI from waiting for
a signature nobody can give, and keep upstream's general guard that workflows
holding a write token on untrusted events never run pull-request code.
"""
from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path

import yaml

_REPO = Path(__file__).resolve().parents[1]
_WORKFLOWS = _REPO / ".github" / "workflows"
# Triggers that run with a write token and repository secrets, even on fork PRs.
_PRIVILEGED_TRIGGERS = {"pull_request_target", "issue_comment", "workflow_run"}
# Upstream's agreements stay as published (VoiceStudio's legal texts, pinned by hash).
_PUBLISHED_AGREEMENTS = {
    ".github/CLA-1.0.md": "b21cab097b9ea9b7f9d938724910276bd1253083800f42d5e176c9d335086b84",
    ".github/CCLA-1.0.md": "4207f055243a9c4c87f89dcb1de49e61b46ffb1605ae020e848709c8705c9d5c",
}
_BOT_SCRIPTS = ("cla_check.py", "cla_reminders.py", "cla_backfill.py")


def _load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    # PyYAML reads the bare `on:` key as boolean True.
    data["on"] = data.pop(True, data.get("on")) or {}
    return data


def _triggers(workflow: dict) -> set[str]:
    on = workflow["on"]
    return set(on) if isinstance(on, (dict, list)) else {on}


def test_no_workflow_runs_the_contributor_agreement_bot():
    for name in ("cla.yml", "cla-reminders.yml", "cla-backfill.yml"):
        assert not (_WORKFLOWS / name).exists(), f"{name} is back"
    for path in sorted(_WORKFLOWS.glob("*.y*ml")):
        text = path.read_text(encoding="utf-8")
        for script in _BOT_SCRIPTS:
            assert script not in text, f"{path.name} runs {script}"


def test_ci_never_waits_for_a_signature():
    spec = importlib.util.spec_from_file_location("ci_scope_cla_off", _REPO / ".github" / "scripts" / "ci_scope.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(_REPO / ".github" / "scripts"))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    assert module.CLA_HOLD_ENABLED is False
    assert module.held_or_clear("pull_request", {"number": 1, "pull_request": {"user": {}}}, "o/r") is False


def test_pull_request_template_asks_for_no_signature():
    template = (_REPO / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
    assert "CLA" not in template and "Contributor License Agreement" not in template
    assert "agent" not in template.lower()


def test_published_agreements_are_never_edited():
    for path, expected in _PUBLISHED_AGREEMENTS.items():
        text = (_REPO / path).read_text(encoding="utf-8").replace("\r\n", "\n")
        assert hashlib.sha256(text.encode()).hexdigest() == expected, f"{path} changed"


def test_privileged_workflows_never_run_pull_request_code():
    """Allow privileged checkouts to use only the trusted event base commit."""
    for path in sorted(_WORKFLOWS.glob("*.y*ml")):
        workflow = _load(path)
        if not _triggers(workflow) & _PRIVILEGED_TRIGGERS:
            continue
        text = path.read_text(encoding="utf-8")
        assert "pull_request.head" not in text and "head_sha" not in text, f"{path.name} references PR head code"
        for name, job in (workflow.get("jobs") or {}).items():
            where = f"{path.name}:{name}"
            assert "uses" not in job, f"{where} calls a reusable workflow"
            for step in job.get("steps", []):
                uses = step.get("uses", "")
                assert not uses.startswith("actions/download-artifact@"), f"{where} downloads artifacts"
                if uses.startswith("actions/checkout@"):
                    options = step.get("with") or {}
                    assert "repository" not in options, f"{where} checks out another repository"
                    assert options.get("ref", "${{ github.sha }}") in {
                        "${{ github.sha }}",
                        "${{ github.event.pull_request.base.sha }}",
                    }, f"{where} checks out a non-base ref"
                    assert options.get("persist-credentials") is False, f"{where} keeps credentials"
                assert "${{ github.event" not in str(step.get("run", "")), f"{where} interpolates event data"
