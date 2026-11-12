import copy

import pytest

from kubetrace_agent import policy

NS = "kubetrace-demo"


def deployment(**container_overrides):
    container = {"name": "storefront", "image": "kubetrace/storefront:baseline-1",
                 "ports": [{"name": "http", "containerPort": 8080}],
                 "readinessProbe": {"httpGet": {"path": "/readyz", "port": "http"}},
                 "livenessProbe": {"httpGet": {"path": "/healthz", "port": "http"}},
                 "resources": {"requests": {"memory": "96Mi"}, "limits": {"memory": "128Mi", "cpu": "500m"}},
                 "securityContext": {"allowPrivilegeEscalation": False}}
    container.update(container_overrides)
    return {"kind": "Deployment", "metadata": {"name": "storefront", "namespace": NS, "labels": {policy.EXPERIMENT_LABEL: "true"},
                                               "resourceVersion": "1"},
            "spec": {"replicas": 2, "template": {"metadata": {"labels": {"app.kubernetes.io/name": "storefront"}},
                                                 "spec": {"containers": [container]}}}}


def evaluate(live, proposed, images=frozenset()):
    return policy.evaluate(live["kind"], live, proposed, namespace=NS, allowed_images=set(images))


def mutate(obj, fn):
    new = copy.deepcopy(obj)
    fn(new)
    return new


def c(obj):
    return obj["spec"]["template"]["spec"]["containers"][0]


def test_fixing_the_readiness_path_is_allowed():
    live = deployment(readinessProbe={"httpGet": {"path": "/ready", "port": "http"}})
    decision = evaluate(live, mutate(live, lambda o: c(o)["readinessProbe"]["httpGet"].update(path="/readyz")))
    assert decision.allowed, decision.reasons


@pytest.mark.parametrize("change,needle", [
    (lambda o: c(o).pop("readinessProbe"), "cannot be removed"),
    (lambda o: c(o).update(readinessProbe={"exec": {"command": ["true"]}}), "exec"),
    (lambda o: c(o)["securityContext"].update(privileged=True), "securityContext"),
    (lambda o: o["spec"]["template"]["spec"].update(hostNetwork=True), "hostNetwork"),
    (lambda o: o["spec"]["template"]["spec"].update(volumes=[{"name": "h", "hostPath": {"path": "/"}}]), "volumes"),
    (lambda o: o["spec"]["template"]["spec"].update(serviceAccountName="default"), "serviceAccountName"),
    (lambda o: c(o).update(command=["sh", "-c", "sleep infinity"]), "command"),
    (lambda o: c(o).update(image="docker.io/evil/miner:latest"), "not built by this run"),
    (lambda o: c(o)["resources"]["limits"].update(memory="4Gi"), "memory limit"),
    (lambda o: o["spec"].update(replicas=50), "replicas"),
    (lambda o: o["metadata"]["labels"].pop(policy.EXPERIMENT_LABEL), "label must stay"),
])
def test_dangerous_or_superficial_deployment_changes_are_denied(change, needle):
    live = deployment()
    decision = evaluate(live, mutate(live, change))
    assert not decision.allowed
    assert any(needle in r for r in decision.reasons), decision.reasons


def test_an_image_built_in_this_run_may_be_deployed():
    live = deployment()
    new = mutate(live, lambda o: c(o).update(image="kubetrace/storefront:run-abc-b1"))
    assert evaluate(live, new, {"kubetrace/storefront:run-abc-b1"}).allowed


def test_bounded_memory_increase_is_allowed():
    live = deployment()
    assert evaluate(live, mutate(live, lambda o: c(o)["resources"]["limits"].update(memory="256Mi"))).allowed


def test_service_selector_fix_allowed_but_exposure_denied():
    live = {"kind": "Service", "metadata": {"name": "storefront", "namespace": NS, "labels": {policy.EXPERIMENT_LABEL: "true"}},
            "spec": {"type": "ClusterIP", "selector": {"app.kubernetes.io/name": "storefront-api"}, "ports": [{"name": "http", "port": 80}]}}
    fixed = mutate(live, lambda o: o["spec"].update(selector={"app.kubernetes.io/name": "storefront"}))
    assert evaluate(live, fixed).allowed
    exposed = mutate(live, lambda o: o["spec"].update(type="LoadBalancer"))
    assert not evaluate(live, exposed).allowed
    emptied = mutate(live, lambda o: o["spec"].update(selector={}))
    assert not evaluate(live, emptied).allowed


def test_other_namespaces_kinds_and_unlabelled_resources_are_denied():
    live = deployment()
    other = mutate(live, lambda o: o["metadata"].update(namespace="kube-system"))
    assert not evaluate(other, other).allowed
    unlabelled = mutate(live, lambda o: o["metadata"].update(labels={}))
    assert not evaluate(unlabelled, mutate(unlabelled, lambda o: o["spec"].update(replicas=1))).allowed
    secret = {"kind": "Secret", "metadata": {"name": "x", "namespace": NS}}
    assert not policy.evaluate("Secret", secret, secret, namespace=NS, allowed_images=set()).allowed


def test_a_no_op_is_rejected():
    live = deployment()
    assert not evaluate(live, copy.deepcopy(live)).allowed


def test_configmap_only_config_json_may_change():
    live = {"kind": "ConfigMap", "metadata": {"name": "storefront-config", "namespace": NS, "labels": {policy.EXPERIMENT_LABEL: "true"}},
            "data": {"config.json": "{}"}}
    assert evaluate(live, mutate(live, lambda o: o["data"].update({"config.json": '{"tax_rate": 0.08}'}))).allowed
    assert not evaluate(live, mutate(live, lambda o: o["data"].update(extra="x"))).allowed


def test_payment_authorization_cannot_be_disabled_or_redirected():
    import json
    def cm(gateway):
        return {"kind": "ConfigMap", "metadata": {"name": "storefront-config", "namespace": NS, "labels": {policy.EXPERIMENT_LABEL: "true"}},
                "data": {"config.json": json.dumps({"tax_rate": 0.08, "payment_gateway_url": gateway})}}
    live = cm("http://payments.kubetrace-partner.svc:80")
    for bad in ("", "http://evil.example"):
        decision = evaluate(live, cm(bad))
        assert not decision.allowed and any("protected" in r for r in decision.reasons)
    other = {**live, "data": {"config.json": json.dumps({"tax_rate": 0.07, "payment_gateway_url": "http://payments.kubetrace-partner.svc:80"})}}
    assert evaluate(live, other).allowed
