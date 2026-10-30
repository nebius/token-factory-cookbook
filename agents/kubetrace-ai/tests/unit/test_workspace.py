import pytest

from kubetrace_agent.workspace import Workspace, WorkspaceError

VARS = {"STOREFRONT_IMAGE": "img:1", "PROBE_IMAGE": "img:1", "STOREFRONT_VERSION": "baseline-1"}


@pytest.fixture
def ws(tmp_path):
    return Workspace.create(tmp_path / "ws", VARS)


def test_template_is_rendered_and_committed(ws):
    assert "image: img:1" in ws.read("k8s/deployment.yaml")
    assert ws.git("log", "--oneline").count("\n") == 1


def test_writes_are_limited_to_allowlisted_paths(ws):
    ws.write("tests/test_new.py", "def test_x():\n    assert True\n")
    for bad in ("k8s/probe.yaml", "Dockerfile", "docs/pricing.md", "../escape.py", ".git/config"):
        with pytest.raises(WorkspaceError):
            ws.write(bad, "x")


def test_reads_cannot_escape_or_see_git(ws):
    for bad in ("../../etc/passwd", ".git/HEAD"):
        with pytest.raises(WorkspaceError):
            ws.read(bad)


def test_edit_must_match_exactly_once(ws):
    with pytest.raises(WorkspaceError):
        ws.edit("storefront/pricing.py", "this text is not there", "x")
    with pytest.raises(WorkspaceError):
        ws.edit("storefront/pricing.py", "Decimal", "Decimal")  # many matches


def test_diff_includes_new_files_and_export_restores_old_tree(ws, tmp_path):
    first = ws.head()
    ws.write("tests/test_added.py", "x = 1\n")
    assert "tests/test_added.py" in ws.diff()
    ws.commit("add")
    old = ws.export_commit(first, tmp_path / "old")
    assert not (old / "tests" / "test_added.py").exists()
