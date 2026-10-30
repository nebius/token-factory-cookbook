import os
import time

import pytest

TERMINAL = {"resolved", "escalated", "unresolved", "blocked", "cancelled", "error"}


def pytest_collection_modifyitems(config, items):
    if os.environ.get("KUBETRACE_KIND") != "1":
        skip = pytest.mark.skip(reason="set KUBETRACE_KIND=1 with a kind cluster (see docs/TESTING.md)")
        for item in items:
            if "kind" in item.keywords:
                item.add_marker(skip)


@pytest.fixture(scope="session")
def stack(tmp_path_factory):
    from kubetrace_agent import settings as settings_module
    tmp = tmp_path_factory.mktemp("kt")
    settings = settings_module.reset_settings(data_dir=tmp, database_path=tmp / "it.db", cluster_kind="kind")
    from kubetrace_api.cluster import ClusterManager
    from kubetrace_api.db import Database
    from kubetrace_api.runs import RunManager
    clusters = ClusterManager(settings)
    clusters.connect_kubeconfig()
    db = Database(settings.database_path)
    return settings, db, clusters, RunManager(settings, db, clusters)


def wait_state(db, run_id, states, timeout=900):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = db.get_run(run_id)
        if run["state"] in states:
            return run
        time.sleep(2)
    raise AssertionError(f"run {run_id} stuck in {db.get_run(run_id)['state']}")
