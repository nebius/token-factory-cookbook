import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


NOTEBOOK_PATH = Path(__file__).with_name("batch.ipynb")


class BatchNotebookHygieneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        cls.source = "\n".join(
            "".join(cell.get("source", [])) for cell in cls.notebook["cells"]
        )

    def test_notebook_has_no_committed_execution_state(self):
        for cell in self.notebook["cells"]:
            if cell["cell_type"] == "code":
                self.assertIsNone(cell["execution_count"])
                self.assertEqual(cell["outputs"], [])

    def test_code_cells_compile(self):
        for index, cell in enumerate(self.notebook["cells"]):
            if cell["cell_type"] == "code":
                compile("".join(cell["source"]), f"batch.ipynb:cell-{index}", "exec")

    def test_notebook_has_no_machine_specific_paths_or_stored_resource_ids(self):
        serialized = json.dumps(self.notebook)
        self.assertNotRegex(serialized, r"/(?:Users|home)/[^/\"\\]+/")
        self.assertNotRegex(serialized, r"batch_[0-9a-f]{8}-[0-9a-f-]{27,}")
        self.assertNotRegex(serialized, r"(?:file-|chat-)[0-9a-f]{12,}")

    def test_notebook_uses_configurable_portable_paths(self):
        self.assertIn("NEBIUS_BATCH_INPUT_PATH", self.source)
        self.assertIn("NEBIUS_BATCH_OUTPUT_PATH", self.source)
        self.assertIn("tempfile.gettempdir()", self.source)
        self.assertIn("Path(", self.source)

    def test_notebook_retrieves_the_batch_it_created(self):
        self.assertIn("client.batches.retrieve(batch.id)", self.source)
        self.assertNotIn("client.batches.list()", self.source)

    def test_notebook_uses_canonical_endpoint_and_environment_key(self):
        self.assertIn("https://api.tokenfactory.nebius.com/v1", self.source)
        self.assertIn('os.environ["NEBIUS_API_KEY"]', self.source)

    def test_notebook_flow_runs_offline_with_a_fake_client(self):
        calls = []

        class FakeFiles:
            def create(self, *, file, purpose):
                calls.append(("files.create", file.read(), purpose))
                return types.SimpleNamespace(id="file-example")

            def content(self, file_id):
                calls.append(("files.content", file_id))
                return types.SimpleNamespace(
                    content=b'{"custom_id":"request-1","response":{}}\n'
                )

        class FakeBatches:
            def create(self, **kwargs):
                calls.append(("batches.create", kwargs))
                return types.SimpleNamespace(id="batch-example", status="validating")

            def retrieve(self, batch_id):
                calls.append(("batches.retrieve", batch_id))
                return types.SimpleNamespace(
                    id=batch_id,
                    status="completed",
                    request_counts={"completed": 1, "failed": 0, "total": 1},
                    output_file_id="file-output-example",
                )

        class FakeOpenAI:
            def __init__(self, *, base_url, api_key):
                calls.append(("OpenAI", base_url, api_key))
                self.files = FakeFiles()
                self.batches = FakeBatches()

        fake_openai = types.ModuleType("openai")
        fake_openai.OpenAI = FakeOpenAI

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "requests.jsonl"
            output_path = Path(temp_dir) / "results.jsonl"
            input_path.write_text('{"custom_id":"request-1"}\n', encoding="utf-8")
            environment = {
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_BATCH_INPUT_PATH": str(input_path),
                "NEBIUS_BATCH_OUTPUT_PATH": str(output_path),
            }
            namespace = {}
            with (
                patch.dict(os.environ, environment, clear=False),
                patch.dict(sys.modules, {"openai": fake_openai}),
                redirect_stdout(StringIO()),
            ):
                for index, cell in enumerate(self.notebook["cells"]):
                    if cell["cell_type"] == "code":
                        exec(
                            compile(
                                "".join(cell["source"]),
                                f"batch.ipynb:cell-{index}",
                                "exec",
                            ),
                            namespace,
                        )

            self.assertEqual(
                output_path.read_text(encoding="utf-8"),
                '{"custom_id":"request-1","response":{}}\n',
            )

        self.assertIn(("batches.retrieve", "batch-example"), calls)
        self.assertNotIn("batches.list", [call[0] for call in calls])


if __name__ == "__main__":
    unittest.main()
