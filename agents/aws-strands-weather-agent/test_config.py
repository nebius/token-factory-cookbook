"""Offline validation for the Strands Token Factory configuration."""

import unittest

from strands.models.openai import OpenAIModel

from config import TOKEN_FACTORY_BASE_URL, load_settings


class StrandsConfigTest(unittest.TestCase):
    def test_builds_openai_model_kwargs(self):
        settings = load_settings(
            {
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_MODEL": "zai-org/GLM-5.1",
            }
        )

        self.assertEqual(
            settings.model_kwargs(),
            {
                "client_args": {
                    "api_key": "test-key",
                    "base_url": TOKEN_FACTORY_BASE_URL,
                },
                "model_id": "zai-org/GLM-5.1",
                "params": {"max_tokens": 512, "temperature": 0},
            },
        )

    def test_requires_key_and_model(self):
        with self.assertRaisesRegex(
            RuntimeError,
            "Missing required environment variables: NEBIUS_API_KEY, NEBIUS_MODEL",
        ):
            load_settings({})

    def test_formats_streaming_tool_request_offline(self):
        settings = load_settings(
            {
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_MODEL": "zai-org/GLM-5.1",
            }
        )
        model = OpenAIModel(**settings.model_kwargs())
        request = model.format_request(
            messages=[{"role": "user", "content": [{"text": "Paris temperature"}]}],
            tool_specs=[
                {
                    "name": "get_temperature",
                    "description": "Return a demo temperature.",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                            "required": ["city"],
                        }
                    },
                }
            ],
        )

        self.assertIs(request["stream"], True)
        self.assertEqual(request["stream_options"], {"include_usage": True})
        self.assertEqual(request["model"], "zai-org/GLM-5.1")
        self.assertEqual(request["tools"][0]["function"]["name"], "get_temperature")


if __name__ == "__main__":
    unittest.main()
