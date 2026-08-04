from app.config import settings
from app.ingestion import determine_vision_coverage, should_analyze_visual_page
from app.models import Document


def test_page_within_cap_goes_to_vision(monkeypatch) -> None:
    monkeypatch.setattr(settings, "max_vision_pages", 20)

    assert should_analyze_visual_page(page_number=1, text="", tables=[]) is True


def test_document_under_cap_gets_full_vision_coverage(monkeypatch) -> None:
    monkeypatch.setattr(settings, "max_vision_pages", 4)
    document = Document(project_id="p", filename="deck.pdf", content_type="application/pdf", storage_path="/tmp/deck.pdf")

    assert determine_vision_coverage(document, [{"page_number": 1, "image_path": "/tmp/1.png"}, {"page_number": 2, "image_path": "/tmp/2.png"}]) == "full"


def test_document_over_cap_gets_capped_vision_coverage(monkeypatch) -> None:
    monkeypatch.setattr(settings, "max_vision_pages", 1)
    document = Document(project_id="p", filename="deck.pdf", content_type="application/pdf", storage_path="/tmp/deck.pdf")

    assert determine_vision_coverage(document, [{"page_number": 1, "image_path": "/tmp/1.png"}, {"page_number": 2, "image_path": "/tmp/2.png"}]) == "capped"


def test_page_past_cap_skips_vision(monkeypatch) -> None:
    monkeypatch.setattr(settings, "max_vision_pages", 1)

    assert should_analyze_visual_page(page_number=2, text="", tables=[]) is False
