"""Secret redaction for everything that leaves the backend: tool results, events, logs, reports.

Two layers: exact known secret values (API keys, tokens from the environment), then
patterns for things that look like credentials wherever they come from.
"""
from __future__ import annotations

import re
from typing import Any

MASK = "[REDACTED]"

PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Authorization headers and bearer tokens.
    (re.compile(r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._~+/=-]{8,}"), r"\1" + MASK),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}"), "Bearer " + MASK),
    # JWTs (service-account tokens and similar).
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"), MASK),
    # kubeconfig material.
    (re.compile(r"(?i)((?:client-key-data|client-certificate-data|certificate-authority-data|token)\s*:\s*)\S+"), r"\1" + MASK),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), MASK),
    # key=value or "key": "value" where the key names a secret.
    (re.compile(r'(?i)("?[A-Za-z0-9_.-]*(?:api[_-]?key|secret|password|passwd|token|credential)[A-Za-z0-9_.-]*"?\s*[:=]\s*"?)([^\s",}]{6,})'),
     r"\1" + MASK),
    # Common provider key shapes.
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}"), MASK),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), MASK),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), MASK),
]


class Redactor:
    def __init__(self, secrets: list[str] | None = None) -> None:
        # Longest first, so a secret that contains another is masked whole.
        self.secrets = sorted({s for s in (secrets or []) if s and len(s) >= 8}, key=len, reverse=True)

    def text(self, value: str) -> str:
        for secret in self.secrets:
            value = value.replace(secret, MASK)
        for pattern, replacement in PATTERNS:
            value = pattern.sub(replacement, value)
        return value

    def value(self, obj: Any) -> Any:
        if isinstance(obj, str):
            return self.text(obj)
        if isinstance(obj, dict):
            out = {}
            for key, val in obj.items():
                if isinstance(key, str) and re.search(r"(?i)(api[_-]?key|secret|password|token|credential|kubeconfig)", key) \
                        and isinstance(val, str) and val:
                    out[key] = MASK
                else:
                    out[key] = self.value(val)
            return out
        if isinstance(obj, (list, tuple)):
            return [self.value(v) for v in obj]
        return obj


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit * 2 // 3]
    tail = text[-(limit // 3):]
    return f"{head}\n… [{len(text) - len(head) - len(tail)} characters omitted] …\n{tail}"
