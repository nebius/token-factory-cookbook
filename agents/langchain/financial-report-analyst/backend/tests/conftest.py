from __future__ import annotations

import os
import shutil
from pathlib import Path


TEST_STORAGE_ROOT = Path("/tmp/financial-report-analyst-tests")

shutil.rmtree(TEST_STORAGE_ROOT, ignore_errors=True)
TEST_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

os.environ["FRA_STORAGE_ROOT"] = str(TEST_STORAGE_ROOT)
os.environ["FRA_DATABASE_URL"] = f"sqlite:///{TEST_STORAGE_ROOT / 'test.db'}"
os.environ.setdefault("FRA_ENABLE_MODEL_CALLS", "1")
