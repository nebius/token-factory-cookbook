import json

import pytest

from storefront.config import ConfigError, load

GOOD = {"currency": "USD", "tax_rate": 0.08, "shipping_flat": 6, "free_shipping_threshold": 75}


def write(tmp_path, data):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(data) if not isinstance(data, str) else data)
    return str(path)


def test_valid_config_loads(tmp_path):
    cfg = load(write(tmp_path, GOOD))
    assert str(cfg["pricing"].tax_rate) == "0.08"


@pytest.mark.parametrize("patch", [{"tax_rate": "8%"}, {"tax_rate": 8}, {"currency": "usd"}, {"cache_warm_mb": 999}])
def test_invalid_values_are_rejected(tmp_path, patch):
    with pytest.raises(ConfigError):
        load(write(tmp_path, {**GOOD, **patch}))


def test_malformed_json_is_rejected(tmp_path):
    with pytest.raises(ConfigError):
        load(write(tmp_path, "{not json"))
