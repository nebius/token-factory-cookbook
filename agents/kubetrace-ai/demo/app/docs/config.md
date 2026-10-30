# Configuration

The service reads JSON from `/etc/storefront/config.json` (the `storefront-config` ConfigMap, key `config.json`) at startup. If the file is invalid, the service logs the reason and exits, and the Pod restarts.

| Key | Type | Allowed values | Example |
|---|---|---|---|
| `currency` | string | 3-letter uppercase ISO 4217 code | `"USD"` |
| `tax_rate` | number | decimal fraction from 0 to 0.5 (8% is `0.08`) | `0.08` |
| `shipping_flat` | number | 0 to 100 | `6.00` |
| `free_shipping_threshold` | number | 0 to 100000 | `75` |
| `cache_warm_mb` | integer | 0 to 256; MiB of product images preloaded at startup. The container needs this much memory plus about 40 MiB. | `32` |
| `payment_gateway_url` | string | URL of the partner payment gateway, or `""` to skip authorization | `"http://payments.kubetrace-partner.svc:80"` |

A config change needs a rollout to take effect: the Pods read the file only at startup.
