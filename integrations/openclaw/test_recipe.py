import json
import re
import unittest
from pathlib import Path


RECIPE_DIR = Path(__file__).parent
PROVIDER_ID = "nebius-token-factory"
EXPECTED_MODEL_IDS = {
    "moonshotai/Kimi-K2.6",
    "deepseek-ai/DeepSeek-V4-Flash",
    "zai-org/GLM-5.1",
}


class OpenClawRecipeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config_text = (RECIPE_DIR / "openclaw.example.json").read_text()
        cls.config = json.loads(cls.config_text)
        cls.readme = (RECIPE_DIR / "README.md").read_text()

    def test_provider_uses_canonical_chat_completions_endpoint(self) -> None:
        provider = self.config["models"]["providers"][PROVIDER_ID]

        self.assertEqual(
            provider["baseUrl"], "https://api.tokenfactory.nebius.com/v1"
        )
        self.assertEqual(provider["api"], "openai-completions")
        self.assertEqual(provider["apiKey"], "${NEBIUS_API_KEY}")

    def test_registered_models_and_agent_references_match(self) -> None:
        provider = self.config["models"]["providers"][PROVIDER_ID]
        registered_ids = {model["id"] for model in provider["models"]}
        agent_models = set(self.config["agents"]["defaults"]["models"])
        expected_agent_models = {
            f"{PROVIDER_ID}/{model_id}" for model_id in EXPECTED_MODEL_IDS
        }

        self.assertEqual(registered_ids, EXPECTED_MODEL_IDS)
        self.assertEqual(agent_models, expected_agent_models)
        self.assertIn(
            self.config["agents"]["defaults"]["model"]["primary"], agent_models
        )

    def test_active_models_are_retained_until_public_lifecycle_changes(self) -> None:
        for model_id in ("moonshotai/Kimi-K2.6", "zai-org/GLM-5.1"):
            self.assertIn(model_id, self.config_text)
            self.assertIn(model_id, self.readme)

        self.assertIn("both had public `active` status", self.readme)
        self.assertIn("does not infer a deprecation or replacement", self.readme)
        self.assertIn("Last verified:** 2026-08-13", self.readme)

    def test_example_does_not_contain_a_literal_secret_or_legacy_host(self) -> None:
        combined = "\n".join(
            [
                self.config_text,
                self.readme,
                (RECIPE_DIR / ".env.example").read_text(),
            ]
        )

        self.assertNotIn("studio.nebius.ai", combined)
        self.assertNotIn("api.studio.nebius.ai", combined)
        self.assertNotRegex(combined, re.compile(r"(?:sk|nvapi)-[A-Za-z0-9_-]{16,}"))

    def test_readme_contains_offline_verification_and_lifecycle_sources(self) -> None:
        self.assertIn("openclaw config validate", self.readme)
        self.assertIn("openclaw models status", self.readme)
        self.assertIn("public/models_info", self.readme)
        self.assertIn("does not make a paid inference request", self.readme)


if __name__ == "__main__":
    unittest.main()
