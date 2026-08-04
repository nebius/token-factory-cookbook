from app.extraction import rows_to_markdown


def test_rows_to_markdown_pads_rows() -> None:
    markdown = rows_to_markdown([["Metric", "FY2025"], ["Revenue", "120"], ["Operating margin"]])
    assert "| Metric | FY2025 |" in markdown
    assert "| Operating margin |  |" in markdown
