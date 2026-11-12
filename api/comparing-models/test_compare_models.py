import csv
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from openai import OpenAI

from compare_models import BASE_URL, compare


def completion(content="An answer", finish_reason="stop", usage=True):
    response = {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": finish_reason,
        }],
    }
    if usage:
        response["usage"] = {
            "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30
        }
    return response


class ComparisonTests(unittest.TestCase):
    def run_comparison(self, handler, models=None, runs=1):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        output_dir = Path(directory.name) / "run"
        with OpenAI(
            api_key="test-only-placeholder",
            base_url=BASE_URL,
            max_retries=0,
            timeout=120,
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        ) as client:
            results = compare(
                client, "A task", models or ["test/model"], runs, 8192, output_dir
            )
        return results, output_dir

    def test_repetitions_preserve_requests_answers_and_metrics(self):
        requests = []

        def handler(request):
            self.assertEqual(str(request.url), BASE_URL + "chat/completions")
            requests.append(json.loads(request.content))
            return httpx.Response(200, json=completion())

        results, output_dir = self.run_comparison(
            handler, models=["first/model", "second/model"], runs=2
        )
        self.assertEqual(len(results), 4)
        self.assertEqual([r["model"] for r in requests], [
            "first/model", "second/model", "first/model", "second/model"
        ])
        self.assertTrue(all(r["max_tokens"] == 8192 for r in requests))
        self.assertTrue(all(r["messages"] == [
            {"role": "user", "content": "A task"}
        ] for r in requests))
        self.assertEqual((output_dir / "task.md").read_text(), "A task")
        self.assertEqual(json.loads((output_dir / "metrics.json").read_text()), results)
        with (output_dir / "metrics.csv").open(newline="") as file:
            self.assertEqual(len(list(csv.DictReader(file))), 4)
        self.assertEqual(len({r["answer_file"] for r in results}), 4)
        for result in results:
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["prompt_tokens"], 10)
            self.assertEqual(result["completion_tokens"], 20)
            self.assertEqual(result["total_tokens"], 30)
            self.assertEqual(
                (output_dir / result["answer_file"]).read_text(), "An answer"
            )
            self.assertEqual(
                json.loads((output_dir / result["response_file"]).read_text())["id"],
                "chatcmpl-test",
            )
        config = json.loads((output_dir / "config.json").read_text())
        self.assertEqual(config["sdk_retries"], 0)
        self.assertNotIn("test-only-placeholder", (output_dir / "config.json").read_text())

    def test_api_error_is_recorded_without_retry_and_next_model_still_runs(self):
        requests = []

        def handler(request):
            model = json.loads(request.content)["model"]
            requests.append(model)
            if model == "unavailable":
                return httpx.Response(404, json={"error": {"message": "Not found"}})
            return httpx.Response(200, json=completion())

        results, output_dir = self.run_comparison(
            handler, models=["unavailable", "available"]
        )
        self.assertEqual(requests, ["unavailable", "available"])
        self.assertEqual(results[0]["status"], "error")
        self.assertEqual(results[0]["http_status"], 404)
        self.assertEqual(results[0]["error_type"], "NotFoundError")
        self.assertIsNone(results[0]["answer_file"])
        self.assertIsNone(results[0]["prompt_tokens"])
        self.assertEqual(results[1]["status"], "completed")
        self.assertEqual(len(json.loads((output_dir / "metrics.json").read_text())), 2)

    def test_empty_truncated_missing_choices_and_missing_usage_need_no_guesswork(self):
        responses = [
            completion(content=None),
            completion(content="Partial answer", finish_reason="length"),
            {**completion(), "choices": []},
            completion(usage=False),
        ]

        def handler(request):
            return httpx.Response(200, json=responses.pop(0))

        results, _ = self.run_comparison(handler, runs=4)
        self.assertEqual([r["status"] for r in results], [
            "needs_review", "needs_review", "needs_review", "completed"
        ])
        self.assertEqual(results[1]["finish_reason"], "length")
        self.assertIsNone(results[2]["answer_file"])
        self.assertIsNone(results[3]["prompt_tokens"])


if __name__ == "__main__":
    unittest.main()
