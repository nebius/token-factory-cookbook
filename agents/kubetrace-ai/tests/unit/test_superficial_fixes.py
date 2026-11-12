"""The code-fix scenario's hidden checks must reject repairs that only hide the symptom."""
import re
from pathlib import Path

import pytest

from kubetrace_agent.sandbox import Runner
from kubetrace_agent.settings import Settings
from kubetrace_agent.workspace import Workspace
from kubetrace_experiments.scenarios import BUG_NEW, BUG_OLD, HIDDEN

VARS = {"STOREFRONT_IMAGE": "img:1", "PROBE_IMAGE": "img:1", "STOREFRONT_VERSION": "baseline-1"}
HIDDEN_TEST = (HIDDEN / "test_pricing_hidden.py").read_text()


@pytest.fixture
def buggy(tmp_path):
    ws = Workspace.create(tmp_path / "ws", VARS)
    path = ws.path / "storefront/pricing.py"
    path.write_text(path.read_text().replace(BUG_OLD, BUG_NEW))
    ws.commit("pricing: simplify bulk tier lookup")
    return ws


def hidden_passes(ws: Workspace, tmp: Path) -> bool:
    runner = Runner(Settings(test_runner="subprocess"))
    return runner.run(ws.snapshot(tmp / "snap"), "unit", {"tests/test_pricing_hidden.py": HIDDEN_TEST}).ok


def test_the_injected_bug_fails_the_hidden_tests(buggy, tmp_path):
    assert not hidden_passes(buggy, tmp_path)


def test_swallowing_the_exception_is_not_a_fix(buggy, tmp_path):
    p = buggy.path / "storefront/pricing.py"
    p.write_text(p.read_text().replace(f"    {BUG_NEW}", f"    try:\n        {BUG_NEW}\n    except IndexError:\n        return BULK_TIERS[0]"))
    assert not hidden_passes(buggy, tmp_path)          # prices are wrong: no 10% for 30+ units
    added = [l for l in buggy.diff().splitlines() if l.startswith("+") and re.match(r"\+\s*(try:|except\b)", l)]
    assert added                                       # and the swallow is detected in the diff


def test_the_real_fix_passes(buggy, tmp_path):
    p = buggy.path / "storefront/pricing.py"
    p.write_text(p.read_text().replace(BUG_NEW, BUG_OLD))
    assert hidden_passes(buggy, tmp_path)
