from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from responses_stateless import (
    create_stateless_response,
    probe_unsupported_continuation,
    required_environment,
    stream_stateless_response,
)


class FakeResponses:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result


class FakeClient:
    def __init__(self, results):
        self.responses = FakeResponses(results)


class FakeAPIError(Exception):
    def __init__(self, status_code: int):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


class ResponsesStatelessTests(unittest.TestCase):
    def test_first_turn_disables_storage(self):
        response = SimpleNamespace(id="resp_1", output_text="hello")
        client = FakeClient([response])

        self.assertIs(create_stateless_response(client, "model-id", "hello"), response)
        self.assertEqual(
            client.responses.calls,
            [{"model": "model-id", "input": "hello", "store": False}],
        )

    def test_stream_collects_only_text_deltas(self):
        events = [
            SimpleNamespace(type="response.created"),
            SimpleNamespace(type="response.output_text.delta", delta="stateless "),
            SimpleNamespace(type="response.output_text.delta", delta="response"),
        ]
        client = FakeClient([events])

        self.assertEqual(stream_stateless_response(client, "model-id", "hello"), "stateless response")
        self.assertEqual(client.responses.calls[0]["store"], False)
        self.assertEqual(client.responses.calls[0]["stream"], True)

    def test_continuation_probe_requires_rejection(self):
        client = FakeClient([FakeAPIError(422)])

        self.assertEqual(probe_unsupported_continuation(client, "model-id", "resp_1"), 422)
        self.assertEqual(client.responses.calls[0]["previous_response_id"], "resp_1")
        self.assertEqual(client.responses.calls[0]["store"], False)

    def test_continuation_probe_fails_if_contract_changes(self):
        client = FakeClient([SimpleNamespace(id="resp_2")])

        with self.assertRaisesRegex(RuntimeError, "contract may have changed"):
            probe_unsupported_continuation(client, "model-id", "resp_1")

    def test_required_environment_names_missing_values(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "NEBIUS_API_KEY, NEBIUS_MODEL"):
                required_environment()


if __name__ == "__main__":
    unittest.main()
