"""Offline checks for the Mattermost Agents configuration recipe."""

import json
import unittest
from pathlib import Path
from urllib.parse import urlparse

RECIPE_DIR = Path(__file__).parent
CONFIG_PATH = RECIPE_DIR / "service-config.example.json"


class MattermostRecipeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    def test_uses_builtin_openai_compatible_service(self):
        self.assertEqual(self.config["type"], "openaicompatible")

    def test_uses_canonical_token_factory_url(self):
        parsed = urlparse(self.config["apiURL"])
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "api.tokenfactory.nebius.com")
        self.assertEqual(parsed.path, "/v1")

    def test_requires_explicit_credentials_and_model(self):
        self.assertEqual(self.config["apiKey"], "<NEBIUS_API_KEY>")
        self.assertRegex(self.config["defaultModel"], r"^[^/]+/[^/]+$")

    def test_keeps_responses_api_disabled(self):
        self.assertIs(self.config["useResponsesAPI"], False)


if __name__ == "__main__":
    unittest.main()
