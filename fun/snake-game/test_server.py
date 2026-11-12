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
        redirect_status = getattr(self.server, "redirect_status", None)
        if redirect_status is not None:
            self.send_response(redirect_status)
            self.send_header("Location", self.server.redirect_location)
            self.end_headers()
            return
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
        cls.destination = ThreadingHTTPServer(
            ("127.0.0.1", 0), RecordingUpstreamHandler
        )
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
        cls.destination_thread = threading.Thread(
            target=cls.destination.serve_forever, daemon=True
        )
        cls.upstream_thread.start()
        cls.proxy_thread.start()
        cls.destination_thread.start()
        cls.proxy_url = f"http://127.0.0.1:{cls.proxy.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.proxy.shutdown()
        cls.upstream.shutdown()
        cls.destination.shutdown()
        cls.proxy.server_close()
        cls.upstream.server_close()
        cls.destination.server_close()

    def setUp(self) -> None:
        self.upstream.redirect_status = None

    def _assert_redirect_rejected(self, destination: str) -> None:
        self.upstream.redirect_location = destination
        for status in (301, 302, 303, 307, 308):
            self.upstream.redirect_status = status
            for route, data in (("models", None), ("chat/completions", b"{}")):
                with self.subTest(status=status, route=route):
                    RecordingUpstreamHandler.requests.clear()
                    request = Request(
                        self.proxy_url + "/api/" + route,
                        data=data,
                        headers={"Content-Type": "application/json"},
                    )
                    with self.assertRaises(HTTPError) as raised:
                        with urlopen(request, timeout=5) as response:
                            response.read()
                    with raised.exception as response:
                        self.assertEqual(response.code, 502)
                        self.assertNotIn("Location", response.headers)
                        self.assertIn("redirect", json.load(response)["error"]["message"])
                    # Only the configured upstream receives a request; no hop is
                    # followed, even if it would retain the same origin.
                    self.assertEqual(len(RecordingUpstreamHandler.requests), 1)
                    self.assertEqual(
                        RecordingUpstreamHandler.requests[0]["authorization"],
                        "Bearer server-only-secret",
                    )

    def test_redirects_do_not_forward_credentials_to_another_origin(self) -> None:
        port = self.destination.server_address[1]
        self._assert_redirect_rejected(f"http://127.0.0.1:{port}/redirect-target")

    def test_redirects_do_not_bypass_the_route_allowlist(self) -> None:
        port = self.upstream.server_address[1]
        self._assert_redirect_rejected(f"http://127.0.0.1:{port}/redirect-target")

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

    def test_custom_endpoint_never_falls_back_to_nebius_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "OPENAI_API_KEY"):
            resolve_config(
                {
                    "TOKEN_FACTORY_BASE_URL": "https://provider.example/v1",
                    "NEBIUS_API_KEY": "must-not-go-to-custom-provider",
                }
            )

    def test_custom_endpoint_requires_https_except_for_loopback(self) -> None:
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            resolve_config(
                {
                    "TOKEN_FACTORY_BASE_URL": "http://provider.example/v1",
                    "OPENAI_API_KEY": "provider-secret",
                }
            )

        api_key, base_url = resolve_config(
            {
                "TOKEN_FACTORY_BASE_URL": "http://localhost:11434/v1",
                "OPENAI_API_KEY": "local-provider-secret",
            }
        )
        self.assertEqual(api_key, "local-provider-secret")
        self.assertEqual(base_url, "http://localhost:11434/v1/")


if __name__ == "__main__":
    unittest.main()
