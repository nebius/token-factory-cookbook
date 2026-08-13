import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
ENV_TEMPLATES = (
    ROOT / "agents/agno-agents-examples/env.example",
    ROOT / "agents/agno-hacker-news-agent/env.example",
    ROOT / "agents/camel-ai-model-comparison-agent/env.example",
    ROOT / "rag/chat-with-pdf/env.example",
    ROOT / "agents/langchain/nebius_travel_planner/env.example",
    ROOT / "workshops/deep-research-writing-agents-nebius-okahu/.env.example",
    ROOT
    / "workshops/deep-research-writing-agents-nebius-okahu/implement_yourself/.env.example",
)


class RecipeSecretHygieneTest(unittest.TestCase):
    def test_templates_exist_and_do_not_contain_secret_values(self) -> None:
        secret_assignment = re.compile(
            r"^(?:NEBIUS|OPENAI|CALCOM|COUCHBASE|EXA|GEMINI|OKAHU).*"
            r"(?:API_KEY|PASSWORD)=([^\n]*)$",
            re.MULTILINE,
        )

        for template in ENV_TEMPLATES:
            with self.subTest(template=template):
                text = template.read_text()
                for value in secret_assignment.findall(text):
                    self.assertEqual(value, "")

    def test_colab_notebook_prompts_without_echoing_secrets(self) -> None:
        notebook_path = ROOT / "agents/agno-hacker-news-agent/Agno_Nebius.ipynb"
        notebook = json.loads(notebook_path.read_text())
        source = "\n".join(
            "".join(cell.get("source", [])) for cell in notebook["cells"]
        )

        self.assertIn("from getpass import getpass", source)
        self.assertIn('getpass("Nebius API key: ")', source)
        self.assertIn('getpass("Cal.com API key: ")', source)
        self.assertNotIn('"Your Nebius API Key"', source)
        self.assertNotIn('"Your Cal.com API Key"', source)

    def test_travel_planner_does_not_collect_provider_key_in_browser(self) -> None:
        app = (ROOT / "agents/langchain/nebius_travel_planner/app.py").read_text()
        readme = (ROOT / "agents/langchain/nebius_travel_planner/README.md").read_text()

        self.assertNotIn('st.text_input(\n        "API key"', app)
        self.assertNotIn("sidebar_api_key", app)
        self.assertNotIn("paste the API key", readme)
        self.assertIn('_secret_or_env("NEBIUS_API_KEY")', app)
        self.assertIn(
            "never accepts provider credentials through the browser UI", readme
        )

    def test_readmes_wire_templates_instead_of_inline_secret_placeholders(self) -> None:
        for relative in (
            "agents/agno-agents-examples/README.md",
            "agents/agno-hacker-news-agent/README.md",
            "agents/camel-ai-model-comparison-agent/README.md",
            "rag/chat-with-pdf/README.md",
            "workshops/deep-research-writing-agents-nebius-okahu/README.md",
            "workshops/deep-research-writing-agents-nebius-okahu/implement_yourself/README.md",
        ):
            with self.subTest(relative=relative):
                self.assertIn("cp ", (ROOT / relative).read_text())


if __name__ == "__main__":
    unittest.main()
