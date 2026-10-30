from decimal import Decimal

import pytest

from storefront.pricing import PricingConfig, PricingError, quote

CFG = PricingConfig(currency="USD", tax_rate=Decimal("0.08"), shipping_flat=Decimal("6.00"),
                    free_shipping_threshold=Decimal("75"))


def test_small_order_pays_shipping_and_tax():
    q = quote([{"sku": "MUG-01", "qty": 2}], None, CFG)
    assert (q["subtotal"], q["shipping"], q["tax"], q["total"]) == ("24.00", "6.00", "1.92", "31.92")


def test_bulk_line_gets_five_percent_and_free_shipping():
    q = quote([{"sku": "CAP-03", "qty": 12}], None, CFG)
    assert (q["bulk_discount"], q["shipping"], q["total"]) == ("11.10", "0.00", "227.77")


def test_percent_coupon_after_bulk():
    q = quote([{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}], "SAVE10", CFG)
    assert (q["coupon_discount"], q["total"]) == ("3.68", "41.72")


def test_freeship_coupon():
    q = quote([{"sku": "MUG-01", "qty": 1}], "FREESHIP", CFG)
    assert q["shipping"] == "0.00"


@pytest.mark.parametrize("items", [[], [{"sku": "NOPE", "qty": 1}], [{"sku": "MUG-01", "qty": 0}]])
def test_bad_orders_are_rejected(items):
    with pytest.raises(PricingError):
        quote(items, None, CFG)
