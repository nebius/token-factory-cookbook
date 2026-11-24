"""Exercise native Streamlit secrets without credentials or network calls."""

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from streamlit.testing.v1 import AppTest

RECIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RECIPE))

import agent  # noqa: E402
import kimi  # noqa: E402


def client_listing(*models):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.list.return_value = SimpleNamespace(
        data=[SimpleNamespace(id=model) for model in models]
    )
    return client


class ModelConfigurationTest(unittest.TestCase):
    def test_explicit_model_overrides_default_after_import(self):
        client = client_listing(kimi.PREFERRED_MODEL, "configured-model")
        self.assertEqual(kimi.pick_model(client, " configured-model "), "configured-model")

    def test_unavailable_preference_uses_listed_fallback(self):
        fallback = kimi.FALLBACK_MODELS[0]
        self.assertEqual(kimi.pick_model(client_listing(fallback), "unavailable"), fallback)

    def test_failed_listing_preserves_explicit_preference(self):
        client = client_listing()
        client.models.list.side_effect = RuntimeError("Listing unavailable")
        self.assertEqual(kimi.pick_model(client, "configured-model"), "configured-model")

    def test_invalid_model_fails_before_listing(self):
        client = client_listing()
        for model in ("", " \t\n", None, 123):
            with self.subTest(model=model), self.assertRaisesRegex(RuntimeError, "KIMI_MODEL"):
                kimi.pick_model(client, model)
        client.models.list.assert_not_called()

    def test_invalid_key_has_actionable_error(self):
        with patch.object(kimi, "OpenAI") as constructor:
            for key in ("", " \t\n", None, 123):
                with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, r"\.streamlit/secrets\.toml"):
                    kimi.get_client(key)
            constructor.assert_not_called()


class StreamlitSecretsTest(unittest.TestCase):
    def run_question(self, secrets, expected_model):
        app = AppTest.from_file(str(RECIPE / "app.py"), default_timeout=20)
        # These values are supplied after kimi is imported and do not rely on
        # Streamlit exporting root-level secrets into the process environment.
        app.secrets = secrets
        client = client_listing(kimi.PREFERRED_MODEL, "configured-model")
        with (
            patch.dict(os.environ, {"NEBIUS_API_KEY": "wrong-environment-key", "KIMI_MODEL": "wrong-environment-model"}),
            patch.object(kimi, "get_client", return_value=client) as factory,
            patch.object(agent, "ask", return_value=agent.Answer("Fixture answer", expected_model)) as ask,
        ):
            app.run()
            self.assertEqual(len(app.exception), 0)
            app.button[0].click().run()
            self.assertEqual(len(app.exception), 0)
            factory.assert_called_once_with("test-secret-key")
            self.assertEqual(ask.call_args.args[1], expected_model)
            self.assertEqual(app.session_state["model"], expected_model)
            client.__exit__.assert_called_once()

    def test_model_override_comes_from_streamlit_secrets(self):
        self.run_question(
            {"NEBIUS_API_KEY": "test-secret-key", "KIMI_MODEL": "configured-model"},
            "configured-model",
        )

    def test_optional_model_defaults_to_kimi_pro(self):
        self.run_question({"NEBIUS_API_KEY": "test-secret-key"}, kimi.PREFERRED_MODEL)


if __name__ == "__main__":
    unittest.main()
