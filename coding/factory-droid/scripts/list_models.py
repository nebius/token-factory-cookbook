#!/usr/bin/env python3
"""Print the live Token Factory models Droid can drive (text output, tool calling)."""

from __future__ import annotations

from tf_models import accepts_images, fetch_models, is_agent_capable, load_env_file


def main() -> None:
    load_env_file()
    models = sorted((m for m in fetch_models() if is_agent_capable(m)), key=lambda m: m["id"])
    if not models:
        raise SystemExit("The live catalog lists no text model that advertises tool calling.")
    width = max(len(m["id"]) for m in models)
    print(f"{'MODEL ID':<{width}}  {'CONTEXT':>9}  IMAGES")
    for model in models:
        images = "yes" if accepts_images(model) else "no"
        print(f"{model['id']:<{width}}  {model.get('context_length') or 0:>9,}  {images}")
    print(
        "\nPut the IDs you want in TF_MODELS in .env, comma separated, and save the file. Check each one against "
        "the deprecation notices listed in https://docs.tokenfactory.nebius.com/llms.txt first."
    )


if __name__ == "__main__":
    main()
