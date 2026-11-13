"""Exercise the cookbook guard with runnable regressions and negative fixtures."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "api_contracts", Path(__file__).parent / ".github/scripts/check_api_contracts.py"
)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class APIContractGuardTests(unittest.TestCase):
    def test_checks_environment_files_and_templates(self):
        for name in (".env", "example.env", "env.example", ".env.example"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / name).write_text(
                    "NEBIUS_BASE_URL=https://api.studio.nebius.ai/v1\n"
                    "NEBIUS_MODEL=moonshotai/Kimi-K2.5\n"
                )
                with patch.object(guard, "ROOT", root):
                    failures = guard.scan()
                self.assertEqual(len(failures), 2)
                self.assertTrue(all(failure.startswith(f"{name}:") for failure in failures))

    def test_rejects_legacy_host_in_runnable_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "example.py").write_text(
                'base_url = "https://api.studio.nebius.ai/v1"'
            )
            with patch.object(guard, "ROOT", root):
                self.assertEqual(len(guard.scan()), 1)

    def test_negative_test_fixtures_do_not_block_real_recipes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "example.py").write_text(
                'base_url = "https://api.tokenfactory.nebius.com/v1"'
            )
            (root / "test_example.py").write_text(
                'old_url = "https://api.studio.nebius.ai/v1"'
            )
            (root / "fixtures").mkdir()
            (root / "fixtures/old.json").write_text('{"model": "moonshotai/Kimi-K2.5"}')
            with patch.object(guard, "ROOT", root):
                self.assertEqual(guard.scan(), [])

    def test_active_model_default_fails_but_archived_history_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "example.py").write_text('model = "moonshotai/Kimi-K2.5"')
            archive = root / "models/archived"
            archive.mkdir(parents=True)
            (archive / "old.md").write_text("Historical model: moonshotai/Kimi-K2.5")
            with patch.object(guard, "ROOT", root):
                failures = guard.scan()
            self.assertEqual(len(failures), 1)
            self.assertTrue(failures[0].startswith("example.py:"))
