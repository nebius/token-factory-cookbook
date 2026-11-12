"""Offline tests for the Claude Code recipe. No key and no network are used.

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

RECIPE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RECIPE / "scripts"))

import make_config  # noqa: E402
import smoke_test  # noqa: E402
import tf_models  # noqa: E402


def model(model_id: str, context: int, features: list[str] | None, modality: str = "text->text") -> dict:
    return {
        "id": model_id,
        "context_length": context,
        "supported_features": features,
        "architecture": {"modality": modality},
        "pricing": {"prompt": "0.000001", "input_cache_read": "0.0000001", "completion": "0.000002"},
    }


CATALOG = [
    model("example/large-agent", 1_048_576, ["tools", "reasoning"]),
    model("example/small-agent", 131_072, ["tools"], "text+image->text"),
    model("example/no-tools", 262_144, ["json_mode"]),
    model("example/embedder", 40_960, None, "text->embedding"),
]


def sse(*events: dict) -> str:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


def tool_stream(*json_fragments: str) -> str:
    return sse(
        {"type": "message_start", "message": {}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "name": "get_weather"}},
        *(
            {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": part}}
            for part in json_fragments
        ),
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"input_tokens": 1, "output_tokens": 1}},
        {"type": "message_stop"},
    )


class CatalogFilterTest(unittest.TestCase):
    def test_only_text_models_with_tools_can_drive_claude_code(self) -> None:
        usable = [m["id"] for m in CATALOG if tf_models.is_agent_capable(m)]
        self.assertEqual(usable, ["example/large-agent", "example/small-agent"])

    def test_missing_price_fields_count_as_zero(self) -> None:
        self.assertEqual(tf_models.price_per_token({"pricing": {}}, "input_cache_read"), 0.0)
        self.assertEqual(tf_models.price_per_token({}, "prompt"), 0.0)

    def test_default_host_is_the_global_token_factory_endpoint(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(tf_models.base_url(), "https://api.tokenfactory.nebius.com/v1")


class MakeConfigTest(unittest.TestCase):
    def run_main(self, env: dict[str, str]) -> tuple[str, str]:
        with tempfile.TemporaryDirectory() as tmp:
            out, claude_env = Path(tmp) / "litellm_config.yaml", Path(tmp) / "claude_code.env"
            with (
                mock.patch.object(make_config, "fetch_models", return_value=CATALOG),
                mock.patch.object(make_config, "OUT", out),
                mock.patch.object(make_config, "CLAUDE_ENV", claude_env),
                mock.patch.dict(os.environ, env, clear=True),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                make_config.main()
            return out.read_text(), claude_env.read_text()

    def test_routes_use_the_nebius_provider_and_never_embed_a_key(self) -> None:
        config, _ = self.run_main(
            {"TF_MAIN_MODEL": "example/large-agent", "TF_FAST_MODEL": "example/small-agent", "NEBIUS_API_KEY": "secret-value"}
        )
        self.assertIn('model_name: "example/large-agent"', config)
        self.assertIn('model: "nebius/example/large-agent"', config)
        self.assertIn('api_base: "https://api.tokenfactory.nebius.com/v1"', config)
        self.assertIn("api_key: os.environ/NEBIUS_API_KEY", config)
        self.assertIn("master_key: os.environ/LITELLM_MASTER_KEY", config)
        self.assertIn("max_input_tokens: 131072", config)
        self.assertNotIn("secret-value", config)

    def test_context_window_is_the_smallest_route_capped_at_claude_codes_default(self) -> None:
        _, small = self.run_main({"TF_MAIN_MODEL": "example/large-agent", "TF_FAST_MODEL": "example/small-agent"})
        self.assertIn("TF_CONTEXT_TOKENS=131072", small)
        _, large = self.run_main({"TF_MAIN_MODEL": "example/large-agent", "TF_FAST_MODEL": "example/large-agent"})
        self.assertIn("TF_CONTEXT_TOKENS=200000", large)

    def test_extra_models_are_added_once(self) -> None:
        config, _ = self.run_main(
            {
                "TF_MAIN_MODEL": "example/large-agent",
                "TF_FAST_MODEL": "example/large-agent",
                "TF_EXTRA_MODELS": "example/small-agent, example/large-agent",
            }
        )
        self.assertEqual(config.count("- model_name:"), 2)

    def test_rejects_missing_retired_and_tool_less_models(self) -> None:
        for env in (
            {"TF_MAIN_MODEL": "", "TF_FAST_MODEL": "example/small-agent"},
            {"TF_MAIN_MODEL": "example/retired", "TF_FAST_MODEL": "example/small-agent"},
            {"TF_MAIN_MODEL": "example/no-tools", "TF_FAST_MODEL": "example/small-agent"},
        ):
            with self.subTest(env=env), self.assertRaises(SystemExit) as raised:
                self.run_main(env)
            self.assertNotIn(raised.exception.code, (0, None))


class SmokeTestChecksTest(unittest.TestCase):
    def check_tool(self, status: int, raw: str) -> str:
        with mock.patch.object(smoke_test, "call", return_value=(status, raw)):
            return smoke_test.check_stream_tool("example/large-agent")

    def test_streamed_tool_call_passes_when_fragments_join_into_json(self) -> None:
        self.assertTrue(self.check_tool(200, tool_stream('{"city": ', '"Nairobi"}')).startswith("PASS"))

    def test_streamed_tool_call_fails_on_truncated_arguments(self) -> None:
        result = self.check_tool(200, tool_stream('{"city": "Nairobi"'))
        self.assertTrue(result.startswith("FAIL"))
        self.assertIn("not valid JSON", result)

    def test_error_inside_a_200_stream_is_a_failure(self) -> None:
        raw = sse({"type": "message_start", "message": {}}, {"type": "error", "error": {"message": "overloaded"}})
        self.assertIn("error inside stream", self.check_tool(200, raw))
        with mock.patch.object(smoke_test, "call", return_value=(200, raw)):
            self.assertIn("error inside stream", smoke_test.check_stream("example/large-agent"))

    def test_http_errors_and_missing_tool_blocks_fail(self) -> None:
        self.assertTrue(self.check_tool(400, '{"error": "bad"}').startswith("FAIL HTTP 400"))
        no_tool = sse({"type": "message_start", "message": {}}, {"type": "message_stop"})
        self.assertIn("no tool_use block", self.check_tool(200, no_tool))

    def test_every_request_sets_max_tokens(self) -> None:
        bodies = []

        def fake_call(path: str, body: dict | None = None) -> tuple[int, str]:
            bodies.append((path, body))
            return 400, "{}"

        with mock.patch.object(smoke_test, "call", side_effect=fake_call):
            smoke_test.check_message("m")
            smoke_test.check_stream("m")
            smoke_test.check_stream_tool("m")
        self.assertEqual(len(bodies), 3)
        for _, body in bodies:
            self.assertGreater(body["max_tokens"], 0)


class ShippedFilesTest(unittest.TestCase):
    def test_environment_template_has_no_values(self) -> None:
        for line in (RECIPE / "env.example").read_text().splitlines():
            if line and not line.startswith("#"):
                name, _, value = line.partition("=")
                self.assertEqual(value, "", f"{name} must be empty in env.example")

    def test_settings_start_in_manual_mode_without_web_search_or_attribution(self) -> None:
        settings = json.loads((RECIPE / "claude_settings.json").read_text())
        self.assertEqual(settings["permissions"]["defaultMode"], "default")
        self.assertIn("WebSearch", settings["permissions"]["deny"])
        self.assertEqual(settings["attribution"], {"commit": "", "pr": ""})

    def test_shell_scripts_parse_and_launcher_maps_every_model_slot(self) -> None:
        for script in ("start_proxy.sh", "claude-tf.sh"):
            subprocess.run(["bash", "-n", str(RECIPE / "scripts" / script)], check=True)
        launcher = (RECIPE / "scripts/claude-tf.sh").read_text()
        for name in (
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
            "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
            "CLAUDE_CODE_DISABLE_1M_CONTEXT",
        ):
            self.assertIn(f"export {name}=", launcher)
        self.assertIn("unset NEBIUS_API_KEY", launcher)
        self.assertIn("127.0.0.1", (RECIPE / "scripts/start_proxy.sh").read_text())

    def test_readme_wires_the_environment_template(self) -> None:
        self.assertIn("cp env.example .env", (RECIPE / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
