[Cookbook](../../README.md) / [APIs](../README.md) / Prompt caching

# Measure prompt caching on Token Factory

Token Factory caches the prefix of recent prompts and bills tokens served from that cache at a
per-model cached input price. Nothing is configured: the engine matches the start of your prompt
against recently processed prompts. This script proves it with numbers. For every model in
`NEBIUS_MODEL`, three by default, it sends one warm-up call and then several questions that share a
35k-token prefix, prints `cached_tokens`, latency and list-price cost per call, and shows what a
timestamp in the system prompt does to the cache. Then it lines the models up in a comparison block
and prints the cached input discount of every model in the public catalog. The full walkthrough is on
[dev.nebius.com](https://dev.nebius.com/cookbook/prompt-caching-token-factory).

## Run it

Python 3.10 or newer is required.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export NEBIUS_API_KEY="your-key"
.venv/bin/python measure.py
```

Or put `NEBIUS_API_KEY=your-key` in a `.env` file (git-ignored) and load it with `set -a; . .env; set +a`.

With uv instead: `uv venv --python 3.12 .venv && uv pip install -r requirements.txt`.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEBIUS_API_KEY` | required | Token Factory API key |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` | API base URL |
| `NEBIUS_MODEL` | `moonshotai/Kimi-K3.1-Pro,zai-org/GLM-5.3-Flash,deepseek-ai/DeepSeek-V4.1-Flash-1017` | Models to measure, comma separated |
| `CACHE_PARAGRAPHS` | `400` | Size of the generated document (about 35k tokens, the exact count depends on the model's tokenizer) |
| `CACHE_QUESTIONS` | `6` | Questions asked after the warm-up call |
| `CATALOG_URL` | `https://tokenfactory.nebius.com/api/public/models_info` | Where prices are read from |
| `NEBIUS_INPUT_PRICE`, `NEBIUS_CACHED_PRICE`, `NEBIUS_OUTPUT_PRICE` | unset | USD per 1M; set all three to skip the catalog |

Measured on November 5, 2026 with the default settings:

```
model: moonshotai/Kimi-K3.1-Pro  prices: in=$2 cached=$0.2 out=$10 per 1M (catalog, 2026-11-05)
call 0  prompt=34512  cached=0      miss   5.1s  $0.069424  (warm-up)
call 1  prompt=34512  cached=33408  hit    2.3s  $0.009290
call 2  prompt=34512  cached=33408  hit    1.8s  $0.009290
call 3  prompt=34512  cached=33408  hit    1.6s  $0.009290
call 4  prompt=34512  cached=33408  hit    1.5s  $0.009290
call 5  prompt=34512  cached=33408  hit    1.5s  $0.009290
call 6  prompt=34512  cached=33408  hit    4.2s  $0.009290
summary: 7 calls, 6 hits, 200448 cached tokens, $0.1252 total vs $0.4860 uncached, 74% saved
anti-pattern: timestamp in system prompt -> prompt=34529 cached=0 miss 3.3s

model: zai-org/GLM-5.3-Flash  prices: in=$0.15 cached=$0.03 out=$0.5 per 1M (catalog, 2026-11-05)
call 0  prompt=35029  cached=35008  hit    1.3s  $0.001073  (warm-up)
call 1  prompt=35029  cached=35008  hit    1.3s  $0.001073
call 2  prompt=35029  cached=35008  hit    1.3s  $0.001073
call 3  prompt=35029  cached=35008  hit    1.4s  $0.001073
call 4  prompt=35029  cached=35008  hit    1.0s  $0.001073
call 5  prompt=35030  cached=35008  hit    7.3s  $0.001074
call 6  prompt=35029  cached=35008  hit    1.4s  $0.001073
summary: 7 calls, 7 hits, 245056 cached tokens, $0.0075 total vs $0.0369 uncached, 80% saved
anti-pattern: timestamp in system prompt -> prompt=35046 cached=0 miss 2.4s

model: deepseek-ai/DeepSeek-V4.1-Flash-1017  prices: in=$0.3 cached=$0.006 out=$1.2 per 1M (catalog, 2026-11-05)
call 0  prompt=35647  cached=35584  hit    1.6s  $0.000280  (warm-up)
call 1  prompt=35647  cached=35584  hit    0.9s  $0.000280
call 2  prompt=35647  cached=35584  hit    1.2s  $0.000280
call 3  prompt=35647  cached=35584  hit    0.9s  $0.000280
call 4  prompt=35647  cached=35584  hit    2.4s  $0.000280
call 5  prompt=35647  cached=35584  hit    0.9s  $0.000280
call 6  prompt=35647  cached=35584  hit    1.9s  $0.000280
summary: 7 calls, 7 hits, 249088 cached tokens, $0.0020 total vs $0.0752 uncached, 97% saved
anti-pattern: timestamp in system prompt -> prompt=35664 cached=0 miss 1.4s

compare: hits, cached tokens and cost per model
  moonshotai/Kimi-K3.1-Pro                 6/7 hits  cached=200448  $0.1252 vs $0.4860   74% saved
  zai-org/GLM-5.3-Flash                    7/7 hits  cached=245056  $0.0075 vs $0.0369   80% saved
  deepseek-ai/DeepSeek-V4.1-Flash-1017     7/7 hits  cached=249088  $0.0020 vs $0.0752   97% saved

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

Costs are list prices from the catalog on the run date and will change. The full three-model run cost
about $0.22 at list price on November 5, 2026, nearly all of it Kimi K3.1 Pro: $0.1252 for its seven
measured calls plus about $0.069 for its anti-pattern miss.

## Read the numbers

- `cached` is `usage.prompt_tokens_details.cached_tokens`. On November 5, 2026 `cached` was always a
  multiple of 64 on all three models, so the last partial block, including the changing question,
  stayed uncached.
- Kimi K3.1 Pro shows the cold pattern. Its warm-up missed, took 5.1 s and cost $0.069424. The six
  calls after it hit with 33,408 of 34,512 prompt tokens cached and cost $0.009290 each.
- GLM-5.3-Flash and DeepSeek V4.1 Flash 1017 hit on the warm-up too, 7 of 7. The same 400-paragraph
  document had been sent to both models in earlier runs that day, and the prefix was still cached.
  The warm-up misses unless the same prefix was sent recently.
- The `compare:` block puts the three summaries side by side. In this run Kimi saved 74%, GLM 80% and
  DeepSeek 97% against the same calls without the cache. The percentages follow each model's cached
  price and how many calls hit.
- A longer document still reuses the shorter cached prefix. A run with `CACHE_PARAGRAPHS=401` on
  November 5, 2026 sent a document no earlier run had sent. Every warm-up still hit, with the
  400-paragraph cached counts, because the first 400 paragraphs are a prefix of the longer document:

  ```
  call 0  prompt=34598  cached=33408  hit    2.1s  $0.009462  (warm-up)
  call 0  prompt=35115  cached=35008  hit    1.0s  $0.001086  (warm-up)
  call 0  prompt=35736  cached=35584  hit    1.0s  $0.000307  (warm-up)
  ```

  Those are Kimi, GLM and DeepSeek in that order. Later calls cached the longer prefix: 34,560 on
  Kimi, 35,072 on GLM and 35,712 on DeepSeek.
- `cached=0` on a repeat is a valid answer. The cache is best effort, the docs say the Serverless cache
  is shared per model, and an idle prefix can be evicted at any time.
- Each anti-pattern line shows a timestamp placed before the document dropping the cached count to
  zero, because the prefix no longer matches byte for byte.

## Tests

```bash
.venv/bin/python -m pytest -q -p no:cacheprovider
```

Fourteen tests run against a fake client and a fixture catalog. None of them call the network.

## Troubleshooting

- `error: NEBIUS_API_KEY is not set`, exit code 2: export the key or load your `.env` file into the shell you run from.
- `error: AuthenticationError: ...`, exit code 1: the API returned 401. The key is wrong or revoked. Check `NEBIUS_API_KEY`.
- `error: RateLimitError: ...`, exit code 1: the API returned 429. Wait and rerun. The cached prefix may have been
  evicted by the time you retry, so the first call may miss again.
- `error: CACHE_QUESTIONS must be at least 1` or `error: CACHE_PARAGRAPHS and CACHE_QUESTIONS must be integers`,
  exit code 2: fix the variable the line names.
- Every call shows `cached=0`: the prefix was evicted, another replica served the call, or something changed the
  prefix between calls. Rerun once before you debug. On November 5, 2026 a 300-token prefix hit once in four
  calls, while the 35k-token prefix hit six times out of six after the warm-up.
- `warning: could not read ...` followed by `error: no catalog price for <model>`, exit code 2: the public catalog
  was unreachable. Set `NEBIUS_INPUT_PRICE`, `NEBIUS_CACHED_PRICE` and `NEBIUS_OUTPUT_PRICE`. With those set, the
  run completes and ends with `catalog: skipped (catalog unavailable)`.
- `error: no catalog price for <model>` with no warning before it, exit code 2: `NEBIUS_MODEL` names a model
  that the catalog does not list with a cached price. With several models, any one missing model stops
  the run before the first call, and the line names it. Fix the name or set the three price variables,
  which then apply to every listed model.
- Usage is missing when you stream in your own code: pass `stream_options={"include_usage": True}`.

## Clean up

```bash
rm -rf .venv
rm -f .env
```
