#!/usr/bin/env bash
# Evaluate a fresh base and locally saved adapter with the same decoder.
set -euo pipefail
cd "$(dirname "$0")"
for split in primary external; do
  name=test
  if [ "$split" = external ]; then name=external; fi
  test_sha=$(sha256sum "data/$name.jsonl" | cut -d' ' -f1)
  system_sha=$(sha256sum data/system.txt | cut -d' ' -f1)
  for arm in base adapted; do
    .venv/bin/python runner/evaluate.py "$arm" "$test_sha" "$system_sha" --split "$split"
  done
done
for arm in broken base tuned broken-external base-external tuned-external; do
  .venv/bin/python browser_check.py "$arm"
done
.venv/bin/python results_view.py
