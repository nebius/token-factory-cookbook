from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import DEFAULT_BASE_URL, SnakeGameServer, resolve_config

DEMO_DIR = Path(__file__).resolve().parent


class RecordingUpstreamHandler(BaseHTTPRequestHandler):
    requests: ClassVar[list[dict]] = []

    def do_GET(self) -> None:
        self._record_and_reply({"data": [{"id": "test/model"}]})

    def do_POST(self) -> None:
        length = int(self.headers["Content-Length"])
        payload = json.loads(self.rfile.read(length))
        self._record_and_reply({"choices": [{"message": {"content": "up"}}]}, payload)

    def _record_and_reply(self, response: dict, payload: dict | None = None) -> None:
        self.requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "payload": payload,
            }
        )
        body = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args) -> None:
        pass


class SnakeGameProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        RecordingUpstreamHandler.requests.clear()
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), RecordingUpstreamHandler)
        upstream_port = cls.upstream.server_address[1]
        cls.proxy = SnakeGameServer(
            ("127.0.0.1", 0),
            "server-only-secret",
            f"http://127.0.0.1:{upstream_port}/v1/",
        )
        cls.upstream_thread = threading.Thread(
            target=cls.upstream.serve_forever, daemon=True
        )
        cls.proxy_thread = threading.Thread(target=cls.proxy.serve_forever, daemon=True)
        cls.upstream_thread.start()
        cls.proxy_thread.start()
        cls.proxy_url = f"http://127.0.0.1:{cls.proxy.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.proxy.shutdown()
        cls.upstream.shutdown()
        cls.proxy.server_close()
        cls.upstream.server_close()

    def test_models_route_uses_server_side_authorization(self) -> None:
        request = Request(
            self.proxy_url + "/api/models?verbose=true",
            headers={"Authorization": "Bearer browser-secret"},
        )
        with urlopen(request) as response:
            self.assertEqual(json.load(response)["data"][0]["id"], "test/model")

        recorded = RecordingUpstreamHandler.requests[-1]
        self.assertEqual(recorded["path"], "/v1/models?verbose=true")
        self.assertEqual(recorded["authorization"], "Bearer server-only-secret")

    def test_chat_route_forwards_json_without_trusting_browser_auth(self) -> None:
        payload = {
            "model": "test/model",
            "messages": [{"role": "user", "content": "move"}],
        }
        request = Request(
            self.proxy_url + "/api/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer browser-secret",
            },
            method="POST",
        )
        with urlopen(request) as response:
            self.assertEqual(
                json.load(response)["choices"][0]["message"]["content"], "up"
            )

        recorded = RecordingUpstreamHandler.requests[-1]
        self.assertEqual(recorded["authorization"], "Bearer server-only-secret")
        self.assertEqual(recorded["payload"], payload)

    def test_unknown_api_routes_and_cors_are_rejected(self) -> None:
        for request in (
            Request(self.proxy_url + "/api/arbitrary"),
            Request(self.proxy_url + "/api/models", method="OPTIONS"),
        ):
            with self.assertRaises(HTTPError) as raised:
                urlopen(request)
            self.assertIn(raised.exception.code, {404, 405})
            raised.exception.close()

    def test_non_local_host_header_is_rejected(self) -> None:
        request = Request(
            self.proxy_url + "/api/models", headers={"Host": "attacker.example"}
        )
        with self.assertRaises(HTTPError) as raised:
            urlopen(request)
        self.assertEqual(raised.exception.code, 403)
        raised.exception.close()

    def test_static_demo_contains_no_client_side_secret_controls(self) -> None:
        combined = "\n".join(
            (DEMO_DIR / filename).read_text()
            for filename in ("snake.html", "game.js", "benchmark.js")
        )
        self.assertNotIn('id="api-key"', combined)
        self.assertNotIn("Authorization", combined)
        self.assertNotIn("Bearer ", combined)
        self.assertNotIn("api.tokenfactory.nebius.com", combined)
        self.assertIn("/api/", combined)

        with urlopen(self.proxy_url + "/snake.html") as response:
            self.assertIn(
                "connect-src 'self'", response.headers["Content-Security-Policy"]
            )
            self.assertEqual(
                response.headers["Cross-Origin-Resource-Policy"], "same-origin"
            )

    def test_default_endpoint_never_uses_an_ambient_openai_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "NEBIUS_API_KEY"):
            resolve_config({"OPENAI_API_KEY": "must-not-go-to-nebius"})

        api_key, base_url = resolve_config({"NEBIUS_API_KEY": "nebius-secret"})
        self.assertEqual(api_key, "nebius-secret")
        self.assertEqual(base_url, DEFAULT_BASE_URL)

    def test_custom_endpoint_explicitly_enables_openai_key(self) -> None:
        api_key, base_url = resolve_config(
            {
                "TOKEN_FACTORY_BASE_URL": "https://provider.example/v1",
                "OPENAI_API_KEY": "provider-secret",
            }
        )
        self.assertEqual(api_key, "provider-secret")
        self.assertEqual(base_url, "https://provider.example/v1/")


if __name__ == "__main__":
    unittest.main()
