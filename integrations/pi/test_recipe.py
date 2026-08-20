"""Offline checks for the pi coding-agent configuration recipe."""

import json
import unittest
from pathlib import Path
from urllib.parse import urlparse

RECIPE_DIR = Path(__file__).parent
CONFIG_PATH = RECIPE_DIR / "models.example.json"


class PiRecipeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        cls.provider = cls.config["providers"]["nebius-token-factory"]

    def test_uses_chat_completions_and_canonical_url(self):
        self.assertEqual(self.provider["api"], "openai-completions")
        self.assertNotIn("openai-responses", CONFIG_PATH.read_text(encoding="utf-8"))
        parsed = urlparse(self.provider["baseUrl"])
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "api.tokenfactory.nebius.com")
        self.assertEqual(parsed.path, "/v1")

    def test_requires_environment_key_reference(self):
        self.assertEqual(self.provider["apiKey"], "$NEBIUS_API_KEY")

    def test_pins_safe_chat_compatibility_fields(self):
        self.assertEqual(
            self.provider["compat"],
            {
                "supportsDeveloperRole": False,
                "supportsReasoningEffort": False,
                "maxTokensField": "max_tokens",
                "supportsLongCacheRetention": False,
            },
        )

    def test_defines_one_explicit_current_model(self):
        self.assertEqual(len(self.provider["models"]), 1)
        model = self.provider["models"][0]
        self.assertEqual(model["id"], "zai-org/GLM-5.1")
        self.assertIs(model["reasoning"], False)
        self.assertEqual(model["input"], ["text"])
        self.assertGreater(model["contextWindow"], 0)


if __name__ == "__main__":
    unittest.main()
