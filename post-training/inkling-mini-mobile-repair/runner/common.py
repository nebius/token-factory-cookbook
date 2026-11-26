"""Shared prompt construction and provenance for mobile layout repair."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "results"
BASE = "unsloth/Inkling-2-Mini-unsloth-bnb-4bit"
REV = "22035f8bf3fd71a588d78591f8b3ec45c0994524"
DATASET_REPO = "1littlecoder/inkling-mini-responsive-repair-data"
SYSTEM_PATH = ROOT / "data/system.txt"
if not SYSTEM_PATH.exists():
    SYSTEM_PATH = ROOT / "system.txt"
SYSTEM = SYSTEM_PATH.read_text()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_rows(path):
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def turns(row, training=False):
    msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": row["prompt"]},
    ]
    if training:
        msgs.append({"role": "assistant", "content": row["response"]})
    return msgs
