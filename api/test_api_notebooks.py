from __future__ import annotations

import json
import unittest
from pathlib import Path


API_DIR = Path(__file__).parent
NOTEBOOKS = {
    "aisuite": API_DIR / "api_aisuite.ipynb",
    "litellm": API_DIR / "api_litellm.ipynb",
    "llamaindex": API_DIR / "api_llamaindex.ipynb",
}
BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
REMOVED_MODEL = "openai/gpt-oss-120b-Instruct-2507"


def notebook_text(path: Path) -> str:
    notebook = json.loads(path.read_text())
    return "\n".join(
        "".join(cell.get("source", [])) for cell in notebook["cells"]
    )


class APIFrameworkNotebookTests(unittest.TestCase):
    def test_notebooks_are_clean_and_portable(self):
        for name, path in NOTEBOOKS.items():
            with self.subTest(name=name):
                notebook = json.loads(path.read_text())
                self.assertEqual(notebook["nbformat"], 4)
                for cell in notebook["cells"]:
                    if cell["cell_type"] == "code":
                        self.assertIsNone(cell["execution_count"])
                        self.assertEqual(cell["outputs"], [])
                serialized = json.dumps(notebook)
                self.assertNotIn("/Users/", serialized)
                self.assertNotIn(REMOVED_MODEL, serialized)

    def test_python_cells_compile_after_notebook_magics_are_removed(self):
        for name, path in NOTEBOOKS.items():
            notebook = json.loads(path.read_text())
            for index, cell in enumerate(notebook["cells"]):
                if cell["cell_type"] != "code":
                    continue
                source = "".join(cell["source"])
                python_source = "\n".join(
                    line
                    for line in source.splitlines()
                    if not line.lstrip().startswith(("%", "!"))
                )
                with self.subTest(name=name, cell=index):
                    compile(python_source, f"{path.name}:cell-{index}", "exec")

    def test_each_notebook_uses_current_token_factory_contract(self):
        for name, path in NOTEBOOKS.items():
            with self.subTest(name=name):
                text = notebook_text(path)
                self.assertIn(BASE_URL, text)
                self.assertIn("NEBIUS_API_KEY", text)
                self.assertIn("NEBIUS_MODEL", text)

    def test_framework_specific_routing_is_explicit(self):
        aisuite = notebook_text(NOTEBOOKS["aisuite"])
        self.assertIn('"openai": {', aisuite)
        self.assertIn('provider = "openai"', aisuite)

        litellm = notebook_text(NOTEBOOKS["litellm"])
        self.assertIn('model=f"nebius/{NEBIUS_MODEL}"', litellm)
        self.assertIn("api_base=NEBIUS_BASE_URL", litellm)

        llamaindex = notebook_text(NOTEBOOKS["llamaindex"])
        self.assertIn("NebiusLLM(", llamaindex)
        self.assertIn("api_base=NEBIUS_BASE_URL", llamaindex)

    def test_framework_dependencies_are_separate(self):
        root = (API_DIR / "requirements.txt").read_text()
        self.assertNotIn("aisuite==", root)
        self.assertNotIn("litellm==", root)
        self.assertNotIn("llama-index-llms-nebius==", root)
        for name in NOTEBOOKS:
            requirements = API_DIR / f"requirements-{name}.txt"
            self.assertTrue(requirements.exists())


if __name__ == "__main__":
    unittest.main()
