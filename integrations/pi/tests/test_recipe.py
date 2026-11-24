"""Offline checks for the pi recipe. No key, no network and no pi needed.

    python3 -m unittest discover -s tests
"""

import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

RECIPE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RECIPE_DIR / "scripts"))

import make_models  # noqa: E402
import smoke_test  # noqa: E402
import tf_catalog  # noqa: E402


def catalog_model(model_id, *, tools=True, reasoning=False, modality="text->text", context=262144, **pricing):
    features = (["tools"] if tools else []) + (["reasoning"] if reasoning else [])
    return {
        "id": model_id,
        "name": model_id.split("/")[-1],
        "context_length": context,
        "architecture": {"modality": modality},
        "supported_features": features,
        "pricing": pricing or {"prompt": "0.000002", "input_cache_read": "0.0000002", "completion": "0.00001"},
    }


CATALOG = [
    catalog_model("org/thinker", reasoning=True, modality="text+image->text", context=1048576),
    catalog_model("org/plain", prompt="0.00000015", completion="0.0000005"),
    catalog_model("org/no-tools", tools=False),
    catalog_model("org/embedder", modality="text->embedding"),
]


class CatalogMappingTest(unittest.TestCase):
    def test_only_tool_capable_text_models_are_selected(self):
        self.assertEqual([m["id"] for m in tf_catalog.select_models(CATALOG, [])], ["org/plain", "org/thinker"])

    def test_wanted_models_keep_their_order(self):
        selected = tf_catalog.select_models(CATALOG, ["org/thinker", "org/plain"])
        self.assertEqual([m["id"] for m in selected], ["org/thinker", "org/plain"])

    def test_a_wanted_model_that_is_not_usable_stops_the_run(self):
        for bad in ("org/gone", "org/no-tools", "org/embedder"):
            with self.assertRaises(SystemExit) as raised:
                tf_catalog.select_models(CATALOG, [bad])
            self.assertIn(bad, str(raised.exception))

    def test_model_fields_come_from_the_catalog(self):
        entry = tf_catalog.to_pi_model(CATALOG[0])
        self.assertEqual(entry["id"], "org/thinker")
        self.assertIs(entry["reasoning"], True)
        self.assertEqual(entry["input"], ["text", "image"])
        self.assertEqual(entry["contextWindow"], 1048576)
        self.assertEqual(entry["maxTokens"], tf_catalog.MAX_OUTPUT_TOKENS)
        self.assertEqual(entry["cost"], {"input": 2.0, "output": 10.0, "cacheRead": 0.2, "cacheWrite": 0})

    def test_a_plain_model_has_no_thinking_and_no_images(self):
        entry = tf_catalog.to_pi_model(CATALOG[1])
        self.assertIs(entry["reasoning"], False)
        self.assertEqual(entry["input"], ["text"])
        self.assertEqual(entry["cost"]["cacheRead"], 0.0, "a missing cached price becomes zero, not an error")

    def test_output_cap_never_exceeds_a_small_context(self):
        entry = tf_catalog.to_pi_model(catalog_model("org/small", context=8192))
        self.assertEqual(entry["maxTokens"], 8192)

    def test_a_model_without_a_context_length_leaves_pi_defaults(self):
        entry = tf_catalog.to_pi_model(catalog_model("org/unknown", context=0))
        self.assertNotIn("contextWindow", entry)
        self.assertNotIn("maxTokens", entry)


class ProviderTest(unittest.TestCase):
    def setUp(self):
        self.provider = tf_catalog.build_provider(tf_catalog.select_models(CATALOG, []))

    def test_uses_chat_completions_on_the_current_endpoint(self):
        self.assertEqual(self.provider["api"], "openai-completions")
        self.assertEqual(self.provider["baseUrl"], "https://api.tokenfactory.nebius.com/v1")
        self.assertNotIn("responses", json.dumps(self.provider))

    def test_key_is_a_reference_and_never_a_value(self):
        self.assertEqual(self.provider["apiKey"], "$NEBIUS_API_KEY")

    def test_compat_matches_the_chat_completions_schema(self):
        self.assertEqual(self.provider["compat"], {"supportsDeveloperRole": False, "maxTokensField": "max_tokens"})

    def test_merge_keeps_other_providers_and_replaces_ours(self):
        existing = {
            "$schema": "https://pi.dev/schemas/models.schema.json",
            "providers": {"ollama": {"baseUrl": "http://localhost:11434/v1"}, tf_catalog.PROVIDER_ID: {"models": []}},
        }
        merged = tf_catalog.merge_provider(existing, self.provider)
        self.assertEqual(merged["$schema"], existing["$schema"])
        self.assertEqual(merged["providers"]["ollama"], existing["providers"]["ollama"])
        self.assertEqual(len(merged["providers"][tf_catalog.PROVIDER_ID]["models"]), 2)
        self.assertEqual(existing["providers"][tf_catalog.PROVIDER_ID], {"models": []}, "the input is not changed")


class InstallTest(unittest.TestCase):
    def test_install_backs_up_and_merges_into_pis_folder(self):
        provider = tf_catalog.build_provider(tf_catalog.select_models(CATALOG, []))
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "models.json"
            target.write_text(json.dumps({"providers": {"ollama": {"baseUrl": "http://localhost:11434/v1"}}}))
            with mock.patch.dict(os.environ, {"PI_CODING_AGENT_DIR": folder}):
                written = make_models.install(provider)
            self.assertEqual(written, target)
            merged = json.loads(target.read_text())
            self.assertEqual(sorted(merged["providers"]), ["nebius-token-factory", "ollama"])
            self.assertIn("ollama", json.loads((Path(folder) / "models.json.bak").read_text())["providers"])

    def test_install_refuses_a_file_it_cannot_parse(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "models.json").write_text("{ not json")
            with mock.patch.dict(os.environ, {"PI_CODING_AGENT_DIR": folder}):
                with self.assertRaises(SystemExit):
                    make_models.install({})
            self.assertEqual((Path(folder) / "models.json").read_text(), "{ not json", "the file is left alone")


class EnvFileTest(unittest.TestCase):
    def test_env_file_values_are_loaded_and_blank_lines_do_not_erase(self):
        with tempfile.TemporaryDirectory() as folder:
            env_file = Path(folder) / ".env"
            env_file.write_text("# comment\nNEBIUS_API_KEY='abc'\nTF_MODELS=\nexport OTHER=1\n")
            with mock.patch.dict(os.environ, {"TF_MODELS": "org/kept"}, clear=True):
                tf_catalog.load_env_file(env_file)
                self.assertEqual(os.environ["NEBIUS_API_KEY"], "abc")
                self.assertEqual(os.environ["TF_MODELS"], "org/kept")
                self.assertEqual(os.environ["OTHER"], "1")

    def test_requested_models_are_trimmed_and_deduplicated(self):
        with mock.patch.dict(os.environ, {"TF_MODELS": " org/a, org/b ,org/a,, "}):
            self.assertEqual(tf_catalog.requested_models(), ["org/a", "org/b"])


class SmokeTestParsingTest(unittest.TestCase):
    def test_an_api_error_is_found_even_though_pi_exits_zero(self):
        events = "\n".join(json.dumps(e) for e in [
            {"type": "message_end", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}},
            {"type": "message_end", "message": {"role": "assistant", "content": [], "stopReason": "error",
                                                "errorMessage": "404: The model `org/gone` does not exist."}},
        ])
        summary = smoke_test.summarize_events(events)
        self.assertEqual(summary["tool_calls"], 0)
        self.assertEqual(len(summary["errors"]), 1)
        self.assertIn("does not exist", summary["errors"][0])

    def test_tool_calls_and_the_last_reply_are_counted(self):
        events = "\n".join([
            "not json",
            json.dumps({"type": "tool_execution_start", "toolName": "bash"}),
            json.dumps({"type": "tool_execution_start", "toolName": "edit"}),
            json.dumps({"type": "message_end", "message": {"role": "assistant",
                                                             "content": [{"type": "text", "text": "Fixed."}]}}),
        ])
        summary = smoke_test.summarize_events(events)
        self.assertEqual(summary["tool_calls"], 2)
        self.assertEqual(summary["last_reply"], "Fixed.")
        self.assertEqual(summary["errors"], [])


class RecipeFilesTest(unittest.TestCase):
    def test_env_template_has_no_values(self):
        for line in (RECIPE_DIR / "env.example").read_text().splitlines():
            if line and not line.startswith("#"):
                self.assertTrue(line.endswith("="), f"env.example must not carry a value: {line}")

    def test_no_model_id_is_hardcoded_in_the_recipe(self):
        pattern = re.compile(r"\b(?:zai-org|moonshotai|deepseek-ai|Qwen|MiniMaxAI|nvidia|openai|meta-models)/[A-Za-z0-9._-]+")
        for path in [RECIPE_DIR / "env.example", *sorted((RECIPE_DIR / "scripts").glob("*.py"))]:
            self.assertEqual(pattern.findall(path.read_text()), [], f"{path.name} names a model ID")

    def test_docs_name_only_scripts_and_settings_that_exist(self):
        scripts = {p.name for p in (RECIPE_DIR / "scripts").glob("*.py")}
        settings = set(re.findall(r"^([A-Z_]+)=", (RECIPE_DIR / "env.example").read_text(), re.M))
        for name in ("README.md", "AGENTS.md"):
            text = (RECIPE_DIR / name).read_text()
            for script in re.findall(r"scripts/([a-z_]+\.py)", text):
                self.assertIn(script, scripts, f"{name} mentions scripts/{script}")
            for setting in re.findall(r"\b(TF_[A-Z_]+)\b", text):
                self.assertIn(setting, settings, f"{name} mentions {setting}")


if __name__ == "__main__":
    unittest.main()
