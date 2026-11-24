"""Offline tests: no network, no Droid, no key."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

RECIPE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RECIPE_DIR / "scripts"))

import make_settings  # noqa: E402
import smoke_test  # noqa: E402
import tf_models  # noqa: E402

URL = "https://api.tokenfactory.nebius.com/v1"
CATALOG = [
    {
        "id": "example-lab/text-coder",
        "context_length": 262144,
        "supported_features": ["tools", "reasoning"],
        "architecture": {"modality": "text->text"},
    },
    {
        "id": "example-lab/vision-coder",
        "context_length": 1048576,
        "supported_features": ["tools"],
        "architecture": {"modality": "text+image->text"},
    },
    {
        "id": "example-lab/no-tools",
        "context_length": 131072,
        "supported_features": ["json_mode"],
        "architecture": {"modality": "text->text"},
    },
    {
        "id": "example-lab/embedder",
        "context_length": 40960,
        "supported_features": [],
        "architecture": {"modality": "text->embedding"},
    },
]


class CatalogHelpersTest(unittest.TestCase):
    def test_only_text_models_with_tools_are_agent_capable(self) -> None:
        capable = [m["id"] for m in CATALOG if tf_models.is_agent_capable(m)]
        self.assertEqual(capable, ["example-lab/text-coder", "example-lab/vision-coder"])

    def test_requested_models_trims_and_drops_duplicates(self) -> None:
        with mock.patch.dict(os.environ, {"TF_MODELS": " a/one , b/two,,a/one "}):
            self.assertEqual(tf_models.requested_models(), ["a/one", "b/two"])

    def test_base_url_override_drops_trailing_slash(self) -> None:
        with mock.patch.dict(os.environ, {"NEBIUS_BASE_URL": "https://example.test/v1/"}):
            self.assertEqual(tf_models.base_url(), "https://example.test/v1")


class EnvFileTest(unittest.TestCase):
    def load(self, text: str) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text(text, encoding="utf-8")
            tf_models.load_env_file(path)

    def test_file_wins_over_a_stale_shell_value(self) -> None:
        # The trap this guards against: .env was loaded into the shell while
        # TF_MODELS was still blank, then edited.
        with mock.patch.dict(os.environ, {"TF_MODELS": ""}):
            self.load("# comment\nTF_MODELS=a/one,b/two\n")
            self.assertEqual(tf_models.requested_models(), ["a/one", "b/two"])

    def test_blank_line_in_file_keeps_the_shell_value(self) -> None:
        with mock.patch.dict(os.environ, {"TF_MODELS": "a/one"}):
            self.load("TF_MODELS=\n")
            self.assertEqual(os.environ["TF_MODELS"], "a/one")

    def test_quotes_export_prefix_and_spacing_are_handled(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            self.load('export TF_MODELS="a/one, b/two"\n  TF_MAX_OUTPUT_TOKENS = 32000  \nnot a setting\n')
            self.assertEqual(tf_models.requested_models(), ["a/one", "b/two"])
            self.assertEqual(os.environ["TF_MAX_OUTPUT_TOKENS"], "32000")

    def test_missing_file_is_fine(self) -> None:
        tf_models.load_env_file(Path("/nonexistent/.env"))


class BuildEntriesTest(unittest.TestCase):
    def test_entry_matches_droid_custom_model_contract(self) -> None:
        (entry,) = make_settings.build_entries(CATALOG, ["example-lab/text-coder"], URL, 16384)
        self.assertEqual(
            entry,
            {
                "model": "example-lab/text-coder",
                "displayName": "Nebius text-coder",
                "baseUrl": URL,
                "apiKey": "${NEBIUS_API_KEY}",
                "provider": "generic-chat-completion-api",
                "maxOutputTokens": 16384,
                "maxContextLimit": 262144 - 16384,
                "noImageSupport": True,
            },
        )

    def test_image_models_keep_image_input(self) -> None:
        (entry,) = make_settings.build_entries(CATALOG, ["example-lab/vision-coder"], URL, 16384)
        self.assertFalse(entry["noImageSupport"])

    def test_order_follows_tf_models(self) -> None:
        wanted = ["example-lab/vision-coder", "example-lab/text-coder"]
        entries = make_settings.build_entries(CATALOG, wanted, URL, 16384)
        self.assertEqual([e["model"] for e in entries], wanted)

    def test_unknown_and_tool_less_models_are_rejected_together(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            make_settings.build_entries(
                CATALOG, ["example-lab/retired", "example-lab/no-tools"], URL, 16384
            )
        message = str(raised.exception)
        self.assertIn("example-lab/retired: not in the live catalog", message)
        self.assertIn("example-lab/no-tools: does not advertise tool calling", message)

    def test_allow_missing_thinking_is_set_per_model(self) -> None:
        wanted = ["example-lab/text-coder", "example-lab/vision-coder"]
        plain, flagged = make_settings.build_entries(
            CATALOG, wanted, URL, 16384, {"example-lab/vision-coder"}
        )
        self.assertNotIn("extraArgs", plain)
        self.assertEqual(
            flagged["extraArgs"], {"chat_template_kwargs": {"allow_missing_thinking": True}}
        )

    def test_allow_missing_thinking_must_name_a_configured_model(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            make_settings.build_entries(
                CATALOG, ["example-lab/text-coder"], URL, 16384, {"example-lab/typo"}
            )
        self.assertIn("example-lab/typo: in TF_ALLOW_MISSING_THINKING", str(raised.exception))

    def test_base_model_id_is_set_per_model(self) -> None:
        wanted = ["example-lab/text-coder", "example-lab/vision-coder"]
        plain, mapped = make_settings.build_entries(
            CATALOG, wanted, URL, 16384, base_models={"example-lab/vision-coder": "vision-1.0"}
        )
        self.assertNotIn("baseModelId", plain)
        self.assertEqual(mapped["baseModelId"], "vision-1.0")

    def test_base_model_id_must_name_a_configured_model(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            make_settings.build_entries(
                CATALOG, ["example-lab/text-coder"], URL, 16384, base_models={"example-lab/typo": "x"}
            )
        self.assertIn("example-lab/typo: in TF_BASE_MODEL_IDS", str(raised.exception))

    def test_base_model_ids_parses_pairs(self) -> None:
        with mock.patch.dict(os.environ, {"TF_BASE_MODEL_IDS": " a/one = one-1.0 ,b/two=two-2,"}):
            self.assertEqual(make_settings.base_model_ids(), {"a/one": "one-1.0", "b/two": "two-2"})
        with mock.patch.dict(os.environ, {"TF_BASE_MODEL_IDS": ""}):
            self.assertEqual(make_settings.base_model_ids(), {})
        with mock.patch.dict(os.environ, {"TF_BASE_MODEL_IDS": "a/one"}):
            with self.assertRaises(SystemExit):
                make_settings.base_model_ids()

    def test_output_budget_must_fit_the_window(self) -> None:
        with self.assertRaises(SystemExit):
            make_settings.build_entries(CATALOG, ["example-lab/text-coder"], URL, 262144)

    def test_no_key_material_is_written(self) -> None:
        entries = make_settings.build_entries(CATALOG, ["example-lab/text-coder"], URL, 16384)
        with mock.patch.dict(os.environ, {"NEBIUS_API_KEY": "not-a-real-key-123"}):
            self.assertNotIn("not-a-real-key-123", json.dumps(entries))

    def test_max_output_tokens_reads_the_environment(self) -> None:
        with mock.patch.dict(os.environ, {"TF_MAX_OUTPUT_TOKENS": "32000"}):
            self.assertEqual(make_settings.max_output_tokens(), 32000)
        with mock.patch.dict(os.environ, {"TF_MAX_OUTPUT_TOKENS": ""}):
            self.assertEqual(make_settings.max_output_tokens(), 16384)
        with mock.patch.dict(os.environ, {"TF_MAX_OUTPUT_TOKENS": "lots"}):
            with self.assertRaises(SystemExit):
                make_settings.max_output_tokens()


class MergeTest(unittest.TestCase):
    def test_merge_replaces_only_this_recipes_entries(self) -> None:
        other = {"model": "other", "baseUrl": "https://other.example/v1", "provider": "openai"}
        stale = {"model": "example-lab/old", "baseUrl": URL + "/", "provider": "generic-chat-completion-api"}
        settings = {"theme": "dark", "customModels": [other, stale]}
        entries = make_settings.build_entries(CATALOG, ["example-lab/text-coder"], URL, 16384)

        merged = make_settings.merge_custom_models(settings, entries, URL)

        self.assertEqual(merged["theme"], "dark")
        self.assertEqual(merged["customModels"], [other] + entries)
        self.assertEqual(settings["customModels"], [other, stale], "input must not be mutated")

    def test_merge_into_empty_settings(self) -> None:
        entries = make_settings.build_entries(CATALOG, ["example-lab/text-coder"], URL, 16384)
        self.assertEqual(make_settings.merge_custom_models({}, entries, URL), {"customModels": entries})


class SmokeTestParsingTest(unittest.TestCase):
    def test_counts_tool_calls_and_collects_cli_errors(self) -> None:
        stream = "\n".join(
            [
                json.dumps({"type": "system", "subtype": "init"}),
                json.dumps({"type": "tool_call", "toolName": "Read"}),
                json.dumps({"type": "tool_result", "isError": True}),
                json.dumps({"type": "tool_call", "toolName": "Edit"}),
                "not json",
                json.dumps({"type": "message", "role": "user", "text": "fix it"}),
                json.dumps({"type": "message", "role": "assistant", "text": "Done."}),
                json.dumps({"type": "error", "message": "400 upstream said no"}),
            ]
        )
        self.assertEqual(
            smoke_test.summarize_events(stream),
            {"tool_calls": 2, "cli_errors": ["400 upstream said no"], "last_reply": "Done."},
        )

    def test_fixture_project_starts_with_exactly_one_bug(self) -> None:
        namespace: dict = {}
        exec(smoke_test.CALC, namespace)  # noqa: S102 - fixed fixture text from this recipe
        self.assertEqual(namespace["add"](2, 3), -1)
        exec(smoke_test.CALC.replace("a - b", "a + b"), namespace)  # noqa: S102
        self.assertEqual(namespace["add"](2, 3), 5)
        self.assertEqual(namespace["mean"]([2, 4, 6]), 4)


class RecipeFilesTest(unittest.TestCase):
    def test_env_template_has_no_values(self) -> None:
        for line in (RECIPE_DIR / "env.example").read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#"):
                name, _, value = line.partition("=")
                self.assertEqual(value, "", f"{name} must be blank in env.example")

    def test_scripts_name_no_model(self) -> None:
        for script in sorted((RECIPE_DIR / "scripts").glob("*.py")):
            text = script.read_text(encoding="utf-8")
            for vendor in ("moonshotai/", "zai-org/", "deepseek-ai/", "Qwen/", "MiniMaxAI/", "nvidia/"):
                self.assertNotIn(vendor, text, f"{script.name} hardcodes a model ID")


if __name__ == "__main__":
    unittest.main()
