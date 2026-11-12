"""Checkout pricing for the storefront. See docs/pricing.md for the rules."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

CATALOG: dict[str, dict] = {
    "MUG-01": {"name": "Enamel mug", "price": Decimal("12.00")},
    "TEE-02": {"name": "Cotton tee", "price": Decimal("24.00")},
    "CAP-03": {"name": "Field cap", "price": Decimal("18.50")},
    "STK-04": {"name": "Sticker pack", "price": Decimal("4.25")},
}

# Bulk discount per line, by units of that SKU: 10-19 units 5%, 20 or more 10%.
BULK_TIERS = [Decimal("0"), Decimal("0.05"), Decimal("0.10")]

COUPONS: dict[str, dict] = {
    "SAVE10": {"kind": "percent", "value": Decimal("0.10")},
    "WELCOME5": {"kind": "amount", "value": Decimal("5.00")},
    "FREESHIP": {"kind": "shipping"},
}

CENT = Decimal("0.01")


class PricingError(ValueError):
    """A request the storefront rejects with HTTP 400."""


@dataclass(frozen=True)
class PricingConfig:
    currency: str
    tax_rate: Decimal
    shipping_flat: Decimal
    free_shipping_threshold: Decimal


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def bulk_rate(qty: int) -> Decimal:
    return BULK_TIERS[min(qty // 10, len(BULK_TIERS) - 1)]


def quote(items: list[dict], coupon: str | None, config: PricingConfig) -> dict:
    if not items:
        raise PricingError("order has no items")
    subtotal = Decimal("0")
    bulk_discount = Decimal("0")
    lines = []
    for item in items:
        sku = item.get("sku")
        qty = item.get("qty")
        if sku not in CATALOG:
            raise PricingError(f"unknown sku: {sku}")
        if not isinstance(qty, int) or isinstance(qty, bool) or qty < 1 or qty > 500:
            raise PricingError(f"qty must be an integer from 1 to 500, got {qty!r}")
        gross = CATALOG[sku]["price"] * qty
        line_discount = money(gross * bulk_rate(qty))
        subtotal += gross
        bulk_discount += line_discount
        lines.append({"sku": sku, "qty": qty, "gross": str(money(gross)), "bulk_discount": str(line_discount)})

    after_bulk = subtotal - bulk_discount
    coupon_discount = Decimal("0")
    free_shipping = after_bulk >= config.free_shipping_threshold
    if coupon:
        rule = COUPONS.get(coupon)
        if rule is None:
            raise PricingError(f"unknown coupon: {coupon}")
        if rule["kind"] == "percent":
            coupon_discount = money(after_bulk * rule["value"])
        elif rule["kind"] == "amount":
            coupon_discount = min(rule["value"], after_bulk)
        elif rule["kind"] == "shipping":
            free_shipping = True

    goods = after_bulk - coupon_discount
    shipping = Decimal("0") if free_shipping else config.shipping_flat
    tax = money(goods * config.tax_rate)
    total = money(goods + shipping + tax)
    return {
        "currency": config.currency,
        "lines": lines,
        "subtotal": str(money(subtotal)),
        "bulk_discount": str(money(bulk_discount)),
        "coupon_discount": str(money(coupon_discount)),
        "shipping": str(money(shipping)),
        "tax": str(tax),
        "total": str(total),
    }
