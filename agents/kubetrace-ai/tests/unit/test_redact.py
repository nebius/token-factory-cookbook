from kubetrace_agent.redact import MASK, Redactor, truncate


def test_known_secret_values_are_masked_everywhere():
    r = Redactor(["sk-live-1234567890abcdef", "civo-key-abcdefgh"])
    out = r.value({"log": "auth with sk-live-1234567890abcdef ok", "nested": ["civo-key-abcdefgh"]})
    assert "sk-live" not in str(out) and "civo-key" not in str(out)
    assert MASK in out["log"]


def test_credential_patterns_are_masked():
    r = Redactor()
    text = ("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456\n"
            "token: eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQifQ.c2lnbmF0dXJlc2lnbmF0dXJl\n"
            "client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQ==\n"
            'DB_PASSWORD="hunter2hunter2"\n'
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----")
    out = r.text(text)
    for leaked in ("abcdefghijklmnopqrstuvwxyz123456", "eyJhbGci", "LS0tLS1CRUdJTi", "hunter2hunter2", "MIIEow"):
        assert leaked not in out, leaked


def test_secret_named_keys_are_masked_but_ordinary_values_are_kept():
    out = Redactor().value({"api_key": "short-but-real", "replicas": 2, "image": "storefront:abc"})
    assert out["api_key"] == MASK and out["replicas"] == 2 and out["image"] == "storefront:abc"


def test_truncate_keeps_head_and_tail():
    text = "A" * 500 + "B" * 500
    out = truncate(text, 300)
    assert out.startswith("A") and out.endswith("B") and "omitted" in out and len(out) < 400
