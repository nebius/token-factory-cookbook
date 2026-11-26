#!/usr/bin/env bash
# Render the recorded CSS predictions. All output goes to replay-results.
set -euo pipefail
cd "$(dirname "$0")"
export REPAIR_RESULTS_DIR="$PWD/replay-results"
mkdir -p "$REPAIR_RESULTS_DIR"
python pages.py
python independent.py
cp recorded/{base,adapted,base-external,tuned-external}.jsonl "$REPAIR_RESULTS_DIR/"
for arm in broken base tuned broken-external base-external tuned-external; do
  python browser_check.py "$arm"
done
python results_view.py
