import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.config import Settings


class ModelSettingsTests(unittest.TestCase):
    def settings(self, **kwargs):
        with patch.dict(os.environ, {}, clear=True):
            return Settings(
                _env_file=None,
                github_webhook_secret="test-secret",
                github_token="test-token",
                nebius_api_key="test-key",
                **kwargs,
            )

    def test_model_is_required(self):
        with self.assertRaises(ValidationError):
            self.settings()

    def test_blank_model_is_rejected(self):
        for model in ("", " ", "\t\n"):
            with self.subTest(model=model), self.assertRaises(ValidationError):
                self.settings(nebius_model=model)

    def test_model_whitespace_is_trimmed(self):
        self.assertEqual(
            self.settings(nebius_model=" current-model \n").nebius_model, "current-model"
        )
