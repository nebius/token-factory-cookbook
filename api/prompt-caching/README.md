[Cookbook](../../README.md) / [API](../README.md) / Prompt caching

# Measure prompt caching on Token Factory

Token Factory caches the prefix of recent prompts and bills tokens served from that cache at a
per-model cached input price. Nothing is configured: the engine matches the start of your prompt
against recently processed prompts. This script proves it with numbers. It sends one warm-up call and
then several questions that share a 35k-token prefix, prints `cached_tokens`, latency and list-price
cost per call, shows what a timestamp in the system prompt does to the cache, and prints the cached
input discount of every model in the public catalog. The full walkthrough is on
[dev.nebius.com](https://dev.nebius.com/cookbook/prompt-caching-token-factory).

## Run it

Python 3.10 or newer is required (`measure.py` uses `str | None`).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export NEBIUS_API_KEY="your-key"
.venv/bin/python measure.py
```

With uv instead: `uv venv --python 3.12 .venv && uv pip install -r requirements.txt`.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEBIUS_API_KEY` | required | Token Factory API key |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` | API base URL |
| `NEBIUS_MODEL` | `zai-org/GLM-5.3-Flash` | Model for the measured calls |
| `CACHE_PARAGRAPHS` | `400` | Size of the generated document (about 35k tokens on the default model) |
| `CACHE_QUESTIONS` | `6` | Questions asked after the warm-up call |
| `CATALOG_URL` | `https://tokenfactory.nebius.com/api/public/models_info` | Where prices are read from |
| `NEBIUS_INPUT_PRICE`, `NEBIUS_CACHED_PRICE`, `NEBIUS_OUTPUT_PRICE` | unset | USD per 1M; set all three to skip the catalog |

Measured on November 5, 2026 against the default model:

```
model: zai-org/GLM-5.3-Flash  prices: in=$0.15 cached=$0.03 out=$0.5 per 1M (catalog, 2026-11-05)
call 0  prompt=35029  cached=0      miss   3.8s  $0.005274  (warm-up)
call 1  prompt=35029  cached=35008  hit    1.3s  $0.001073
call 2  prompt=35029  cached=35008  hit    1.4s  $0.001073
call 3  prompt=35029  cached=35008  hit    1.3s  $0.001073
call 4  prompt=35029  cached=35008  hit    1.5s  $0.001073
call 5  prompt=35030  cached=35008  hit    2.2s  $0.001074
call 6  prompt=35029  cached=35008  hit    1.2s  $0.001073
summary: 7 calls, 6 hits, 210048 cached tokens, $0.0117 total vs $0.0369 uncached, 68% saved
anti-pattern: timestamp in system prompt -> prompt=35046 cached=0 miss 2.5s
catalog: cached input discounts (USD per 1M, read live)
  deepseek-ai/DeepSeek-V4.1-Flash-1017     in=0.3    cached=0.006    98%
  deepseek-ai/DeepSeek-V4-Pro-0813         in=1.32   cached=0.04     97%
  deepseek-ai/DeepSeek-V4.1-Flash          in=0.3    cached=0.01     97%
  deepseek-ai/DeepSeek-V4-Flash-0731       in=0.14   cached=0.01     93%
  MiniMaxAI/MiniMax-M3.1-Flash             in=0.15   cached=0.015    90%
  moonshotai/Kimi-K3                       in=3      cached=0.3      90%
  moonshotai/Kimi-K3.1-Pro                 in=2      cached=0.2      90%
  zai-org/GLM-5.2                          in=1.4    cached=0.14     90%
  meta-models/muse-spark-open              in=1.25   cached=0.15     88%
  nvidia/Nemotron-3-Ultra-550b-a55b        in=1      cached=0.12     88%
  ... 16 more rows; the script prints all 26 models.
```

Costs are list prices from the catalog on the run date and will change. The seven measured calls cost $0.0117 at list price on November 5, 2026, and the anti-pattern call
adds one more uncached call of about the warm-up's cost.

## Read the numbers

- `cached` is `usage.prompt_tokens_details.cached_tokens`. It is a multiple of 64 because the cache
  works in 64-token blocks, so the changing question at the end is always uncached.
- The warm-up call misses and writes the prefix. On November 5, 2026 the warm-up miss took 3.8 s and the six hits took 1.2 to 2.2 s.
- `cached=0` on a repeat is a valid answer. The cache is best effort, the docs say the Serverless cache
  is shared per model, and an idle prefix can be evicted at any time.
- The anti-pattern line shows a timestamp placed before the document dropping the cached count to
  zero, because the prefix no longer matches byte for byte.

## Tests

```bash
.venv/bin/python -m pytest -q -p no:cacheprovider
```

Eleven tests run against a fake client and a fixture catalog. None of them call the network.

## Troubleshooting

- `error: AuthenticationError: ...`, exit 1: the key is missing or wrong. Check `NEBIUS_API_KEY`.
- `error: RateLimitError: ...`, exit 1: you are over your rate limit. Wait and rerun; the cached prefix may be gone by then.
- Every call shows `cached=0`: the prefix was evicted, another replica served the call, or the prefix
  is too short. Rerun once; this run used a 35k-token prefix; much shorter prefixes hit less reliably.
- The catalog is unreachable: the script prints `warning: could not read ...` and then
  `catalog: skipped (catalog unavailable)`. Set the three price variables to run without it.
- `error: ...` with exit code 1 or 2: the line names the API exception or the setting that is wrong.
- Streaming callers: set `stream_options={"include_usage": True}` or usage, including cached tokens,
  may not be returned.

## Clean up

```bash
rm -rf .venv
```
