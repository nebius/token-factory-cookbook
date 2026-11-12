"""List the Token Factory models that can drive Claude Code right now.

    uv run --env-file .env python scripts/list_models.py

Prints every live text model that advertises tool calling, with its context
window and price per million tokens, cheapest first. Pick IDs from this list
for TF_MAIN_MODEL / TF_FAST_MODEL in .env.
"""

from __future__ import annotations

from tf_models import fetch_models, is_agent_capable, price_per_token


def main() -> None:
    models = [m for m in fetch_models() if is_agent_capable(m)]
    models.sort(key=lambda m: price_per_token(m, "completion"))
    print(f"{'model id':46} {'context':>9} {'$in/M':>7} {'$cached/M':>9} {'$out/M':>7}  features")
    for m in models:
        print(
            f"{m['id']:46} {m.get('context_length', 0):>9} "
            f"{price_per_token(m, 'prompt') * 1e6:>7.2f} "
            f"{price_per_token(m, 'input_cache_read') * 1e6:>9.2f} "
            f"{price_per_token(m, 'completion') * 1e6:>7.2f}  "
            f"{','.join(m.get('supported_features') or [])}"
        )
    print(f"\n{len(models)} tool-capable text models live.")
    print("Check an ID against the deprecation notices before you rely on it:")
    print("https://docs.tokenfactory.nebius.com/llms.txt (search for 'deprecation')")


if __name__ == "__main__":
    main()
