# Checkout pricing rules

`POST /api/checkout` with `{"items": [{"sku": "MUG-01", "qty": 2}], "coupon": "SAVE10"}`.

1. **Lines.** Each line is `price × qty`. `qty` is an integer from 1 to 500.
2. **Bulk discount, per line, by that line's quantity:**
   - 1–9 units: none
   - 10–19 units: 5%
   - 20 or more units, with no upper limit: 10%
3. **Coupon**, applied after bulk discounts: `SAVE10` takes 10% off, `WELCOME5` takes $5.00 off (never below zero), `FREESHIP` waives shipping.
4. **Shipping:** `shipping_flat` from the config, waived when the order after bulk discounts reaches `free_shipping_threshold`.
5. **Tax:** `tax_rate` × (goods after all discounts). Shipping is not taxed.
6. Every amount is rounded half-up to the cent.

An unknown SKU or coupon, or a bad quantity, is a client error (HTTP 400). Any valid order must price successfully.
