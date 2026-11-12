from kubetrace_agent.executor import Executor, json_merge


def test_json_merge_patch_semantics():
    target = {"a": 1, "b": {"c": 2, "d": 3}, "l": [1, 2]}
    assert json_merge(target, {"b": {"c": None, "e": 4}, "l": [9]}) == {"a": 1, "b": {"d": 3, "e": 4}, "l": [9]}


class FakeExecutor(Executor):
    def __init__(self, live):
        super().__init__(api=None, namespace="kubetrace-demo", mode="auto")
        self._live = live

    def read(self, kind, name):
        return self._live


def test_manifest_replaces_the_service_selector_whole():
    live = {"metadata": {"name": "storefront", "namespace": "kubetrace-demo", "resourceVersion": "7", "labels": {"a": "b"}},
            "spec": {"clusterIP": "10.0.0.1", "selector": {"app": "storefront-api", "tier": "web"}, "ports": [{"port": 80}]}}
    manifest = {"apiVersion": "v1", "kind": "Service", "metadata": {"name": "storefront", "labels": {"a": "b"}},
                "spec": {"selector": {"app.kubernetes.io/name": "storefront"}, "ports": [{"port": 80}]}}
    kind, name, _, proposed = FakeExecutor(live).from_manifest(manifest)
    assert proposed["spec"]["selector"] == {"app.kubernetes.io/name": "storefront"}   # wrong keys do not survive
    assert proposed["spec"]["clusterIP"] == "10.0.0.1"                             # immutable field kept
    assert proposed["metadata"]["resourceVersion"] == "7"                           # staleness precondition


def test_manifest_for_another_namespace_is_refused():
    live = {"metadata": {"name": "x", "namespace": "kubetrace-demo", "resourceVersion": "1"}}
    try:
        FakeExecutor(live).from_manifest({"kind": "ConfigMap", "metadata": {"name": "x", "namespace": "default"}})
    except Exception as exc:  # noqa: BLE001
        assert "namespace" in str(exc)
    else:
        raise AssertionError("expected a refusal")


def test_named_lists_merge_by_name_so_a_partial_container_patch_keeps_the_image():
    from kubetrace_agent.executor import named_merge
    live = {"spec": {"template": {"spec": {"containers": [
        {"name": "storefront", "image": "img:1", "resources": {"limits": {"memory": "128Mi"}}},
        {"name": "sidecar", "image": "side:1"}]}}}}
    patch = {"spec": {"template": {"spec": {"containers": [{"name": "storefront", "resources": {"limits": {"memory": "256Mi"}}}]}}}}
    out = named_merge(live, patch)["spec"]["template"]["spec"]["containers"]
    assert out[0] == {"name": "storefront", "image": "img:1", "resources": {"limits": {"memory": "256Mi"}}}
    assert out[1] == {"name": "sidecar", "image": "side:1"}
    removed = named_merge(live, {"spec": {"template": {"spec": {"containers": [{"name": "sidecar", "$patch": "delete"}]}}}})
    assert [c["name"] for c in removed["spec"]["template"]["spec"]["containers"]] == ["storefront"]
