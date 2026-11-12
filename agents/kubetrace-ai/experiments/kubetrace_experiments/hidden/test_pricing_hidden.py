# Hidden acceptance test for the application-bug scenario. The agent never sees this file.
# It is copied into a throwaway snapshot of the final workspace and run in the sandbox.
from decimal import Decimal

import pytest

from storefront.pricing import PricingConfig, bulk_rate, quote

CFG = PricingConfig(currency="USD", tax_rate=Decimal("0.08"), shipping_flat=Decimal("6.00"),
                    free_shipping_threshold=Decimal("75"))


@pytest.mark.parametrize("qty,rate", [(1, "0"), (9, "0"), (10, "0.05"), (19, "0.05"), (20, "0.10"), (29, "0.10"),
                                      (30, "0.10"), (45, "0.10"), (100, "0.10"), (500, "0.10")])
def test_bulk_rate_follows_the_documented_tiers(qty, rate):
    assert bulk_rate(qty) == Decimal(rate)


@pytest.mark.parametrize("items,coupon,total", [
    ([{"sku": "MUG-01", "qty": 30}], None, "349.92"),
    ([{"sku": "TEE-02", "qty": 45}], "SAVE10", "944.78"),
    ([{"sku": "STK-04", "qty": 120}, {"sku": "CAP-03", "qty": 3}], "WELCOME5", "550.26"),
    ([{"sku": "CAP-03", "qty": 500}], None, "8991.00"),
    ([{"sku": "MUG-01", "qty": 25}], None, "291.60"),
    ([{"sku": "STK-04", "qty": 2}], "FREESHIP", "9.18"),
])
def test_orders_price_correctly(items, coupon, total):
    assert quote(items, coupon, CFG)["total"] == total
