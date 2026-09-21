import unittest

from config import TOKEN_FACTORY_API_BASE, load_token_factory_config


class TokenFactoryConfigTest(unittest.TestCase):
    def test_builds_explicit_openai_compatible_litellm_settings(self) -> None:
        config = load_token_factory_config(
            {
                "NEBIUS_API_KEY": "test-key",
                "NEBIUS_MODEL": "moonshotai/Kimi-K2.7-Code",
            }
        )

        self.assertEqual(
            config.litellm_kwargs(),
            {
                "model": "openai/moonshotai/Kimi-K2.7-Code",
                "api_base": TOKEN_FACTORY_API_BASE,
                "api_key": "test-key",
            },
        )

    def test_requires_key_and_model(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "NEBIUS_API_KEY, NEBIUS_MODEL",
        ):
            load_token_factory_config({})


if __name__ == "__main__":
    unittest.main()
