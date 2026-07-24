"""Read a claim folder of *arbitrary* documents.

A claim is just a directory. The user drops in whatever they have — PDFs (invoices,
policy declarations, verification records, incident reports), photos, a JSON claim form,
loose text — in any naming scheme. This module discovers every file, skips obvious
test/packaging scaffolding, and turns each file into raw material the perception layer can
read: extracted text for PDFs/JSON/text, base64 data URLs for images, and rasterised page
images as a fallback for scanned PDFs.

Nothing here decides what a document *is* — that classification is the model's job.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
TEXT_EXTS = {".txt", ".md"}

# Files that are packaging / test oracles, not claim evidence. Feeding an "expected
# verdict" or a README describing the answer to the model would leak the ground truth, so
# they are excluded. Dotfiles (e.g. .DS_Store) are skipped too.
_SKIP = re.compile(
    r"(^\.)|expected_verdict|expected_output|ground_truth|manifest|readme|"
    r"sample_terminal|screenshot",
    re.IGNORECASE,
)

# Minimum characters of extractable text before we trust a PDF's text layer; below this we
# assume it's a scanned/image PDF and hand it to the vision model instead.
_MIN_PDF_TEXT = 40


@dataclass
class RawDoc:
    name: str  # path relative to the claim dir
    path: Path
    category: str  # "image" | "pdf" | "json" | "text" | "other"


def _categorise(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext == ".json":
        return "json"
    if ext in TEXT_EXTS:
        return "text"
    return "other"


def discover(claim_dir: str | Path) -> tuple[Path, list[RawDoc]]:
    """Return the resolved claim root and every candidate evidence file inside it."""
    root = Path(claim_dir).expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(f"Claim directory not found: {root}")
    docs: list[RawDoc] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if _SKIP.search(path.name):
            continue
        rel = path.relative_to(root).as_posix()
        docs.append(RawDoc(name=rel, path=path, category=_categorise(path)))
    return root, docs


def load_stated_claim(docs: list[RawDoc]) -> dict:
    """Return a JSON claim form if one was submitted (used as the claimant's stated facts).

    Not required — many claims won't include machine-readable JSON, in which case the
    stated facts are read out of the documents themselves.
    """
    for doc in docs:
        low = doc.name.lower()
        if doc.category == "json" and "claim" in low and "form" in low:
            try:
                return json.loads(doc.path.read_text())
            except (ValueError, OSError):
                continue
    # Fall back to any JSON that looks like a claim.
    for doc in docs:
        if doc.category == "json":
            try:
                data = json.loads(doc.path.read_text())
            except (ValueError, OSError):
                continue
            if isinstance(data, dict) and any(k in data for k in ("claim_id", "claimed_damage")):
                return data
    return {}


def read_text_file(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except OSError as exc:
        return f"(could not read {path.name}: {exc})"


def extract_pdf_text(path: Path) -> str:
    """Pull the text layer out of a PDF. Empty/short result means it's likely scanned."""
    try:
        with fitz.open(path) as pdf:
            return "\n".join(page.get_text() for page in pdf).strip()
    except Exception:  # corrupt/unsupported PDF
        return ""


def pdf_has_text(path: Path) -> bool:
    return len(extract_pdf_text(path)) >= _MIN_PDF_TEXT


def pdf_first_page_image(path: Path, zoom: float = 2.0) -> str:
    """Render a PDF's first page to a base64 PNG data URL (for scanned-PDF fallback)."""
    with fitz.open(path) as pdf:
        page = pdf[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        data = base64.b64encode(pix.tobytes("png")).decode("ascii")
    return f"data:image/png;base64,{data}"


def encode_image(path: str | Path) -> str:
    """Return a base64 `data:` URL for an image file, ready for the vision model."""
    path = Path(path)
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"
