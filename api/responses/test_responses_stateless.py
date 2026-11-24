from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import httpx
from openai import OpenAI
from responses_stateless import (
    create_stateless_response,
    main,
    required_environment,
    stream_stateless_response,
)


def response_payload(status="completed"):
    return {
        "id": "resp_1",
        "object": "response",
        "created_at": 0,
        "model": "model-id",
        "parallel_tool_calls": False,
        "tool_choice": "auto",
        "tools": [],
        "status": status,
        "output": [
            {
                "type": "message",
                "id": "msg_1",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {"type": "output_text", "text": "hello", "annotations": []}
                ],
            }
        ],
    }


class ResponsesStatelessTests(unittest.TestCase):
    def client_for(self, response):
        self.requests = []

        def handle(request):
            self.requests.append(json.loads(request.content))
            return response

        client = OpenAI(
            api_key="test-key",
            http_client=httpx.Client(transport=httpx.MockTransport(handle)),
            max_retries=0,
        )
        self.addCleanup(client.close)
        return client

    def stream_for(self, events):
        body = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
        self.http_response = httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=httpx.ByteStream(body.encode()),
        )
        return self.client_for(self.http_response)

    def test_first_turn_disables_storage(self):
        client = self.client_for(httpx.Response(200, json=response_payload()))
        response = create_stateless_response(client, "model-id", "hello")
        self.assertEqual(response.output_text, "hello")
        self.assertEqual(
            self.requests, [{"model": "model-id", "input": "hello", "store": False}]
        )

    def test_nonstream_rejects_unfinished_responses(self):
        for status in (
            "failed",
            "incomplete",
            "cancelled",
            "in_progress",
            "queued",
            None,
        ):
            with self.subTest(status=status):
                client = self.client_for(
                    httpx.Response(200, json=response_payload(status))
                )
                with self.assertRaisesRegex(RuntimeError, "did not complete"):
                    create_stateless_response(client, "model-id", "hello")

    def test_stream_collects_only_text_deltas(self):
        client = self.stream_for(
            [
                {
                    "type": "response.created",
                    "response": response_payload("in_progress"),
                },
                {"type": "response.output_text.delta", "delta": "stateless "},
                {"type": "response.output_text.delta", "delta": "response"},
                {"type": "response.completed", "response": response_payload()},
            ]
        )
        with redirect_stdout(io.StringIO()) as output:
            result = stream_stateless_response(client, "model-id", "hello")
        self.assertEqual(result, "stateless response")
        self.assertEqual(output.getvalue(), "stateless response\n")
        self.assertEqual(
            self.requests,
            [{"model": "model-id", "input": "hello", "store": False, "stream": True}],
        )
        self.assertTrue(self.http_response.is_closed)

    def test_stream_rejects_failure_events_after_partial_text(self):
        for event_type in ("response.failed", "response.incomplete", "error"):
            with self.subTest(event_type=event_type):
                client = self.stream_for(
                    [
                        {"type": "response.output_text.delta", "delta": "partial"},
                        {
                            "type": event_type,
                            "response": response_payload(event_type.split(".")[-1]),
                            "message": "simulated error",
                            "code": "server_error",
                        },
                    ]
                )
                with redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                    stream_stateless_response(client, "model-id", "hello")
                self.assertTrue(self.http_response.is_closed)

    def test_stream_rejects_eof_without_completed_event(self):
        for events in (
            [],
            [{"type": "response.output_text.delta", "delta": "partial"}],
        ):
            with self.subTest(events=events):
                client = self.stream_for(events)
                with (
                    redirect_stdout(io.StringIO()),
                    self.assertRaisesRegex(RuntimeError, "before.*completed"),
                ):
                    stream_stateless_response(client, "model-id", "hello")
                self.assertTrue(self.http_response.is_closed)

    def test_stream_rejects_inconsistent_completion_status(self):
        client = self.stream_for(
            [{"type": "response.completed", "response": response_payload("failed")}]
        )
        with redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            stream_stateless_response(client, "model-id", "hello")

    def test_main_exits_nonzero_for_incomplete_output(self):
        for stream in (False, True):
            with self.subTest(stream=stream):
                client = (
                    self.stream_for([])
                    if stream
                    else self.client_for(
                        httpx.Response(200, json=response_payload("incomplete"))
                    )
                )
                argv = ["responses_stateless.py", "hello"] + (
                    ["--stream"] if stream else []
                )
                with (
                    patch.dict(
                        os.environ,
                        {"NEBIUS_API_KEY": "test-key", "NEBIUS_MODEL": "model-id"},
                        clear=True,
                    ),
                    patch("sys.argv", argv),
                    patch("responses_stateless.create_client", return_value=client),
                    redirect_stdout(io.StringIO()),
                    redirect_stderr(io.StringIO()) as errors,
                ):
                    self.assertEqual(main(), 1)
                self.assertTrue(client.is_closed())
                self.assertIn("Error:", errors.getvalue())

    def test_required_environment_names_missing_values(self):
        for value in ("", " \t\n"):
            with (
                self.subTest(value=value),
                patch.dict(
                    os.environ,
                    {"NEBIUS_API_KEY": value, "NEBIUS_MODEL": value},
                    clear=True,
                ),
                self.assertRaisesRegex(RuntimeError, "NEBIUS_API_KEY, NEBIUS_MODEL"),
            ):
                required_environment()


if __name__ == "__main__":
    unittest.main()
