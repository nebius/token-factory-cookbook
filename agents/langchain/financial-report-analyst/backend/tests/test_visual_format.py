from app.models import VisualBlock, json_dumps
from app.visual_format import format_visual_observation


def test_visual_formatter_unwraps_fenced_json_summary() -> None:
    visual = VisualBlock(
        document_id="doc",
        page_number=3,
        data_json=json_dumps(
            {
                "summary": """```json
{"title":"Revenue Bridge","visual_type":"chart","periods":["FY26"],"metrics":[{"label":"Revenue","value":"$10B","change":"+12%"}],"summary":"Revenue increased on product and services growth.","uncertainty":[]}
```"""
            }
        ),
    )

    formatted = format_visual_observation(visual)

    assert "```" not in formatted
    assert "{\"title\"" not in formatted
    assert "Revenue Bridge (chart)" in formatted
    assert "Revenue: $10B, +12%" in formatted


def test_visual_formatter_handles_truncated_jsonish_summary() -> None:
    visual = VisualBlock(
        document_id="doc",
        page_number=1,
        data_json=json_dumps(
            {
                "summary": """```json
{
  "title": "CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS",
  "visual_type": "table",
  "periods": ["Three Months Ended March 28, 2026", "Six Months Ended March 28, 2026"],
  "metrics": ["Net sales: Products", "Gross margin", "Operating income"],
  "series": [ { "label": "Net sales: Products", "values": [80208, 68714]
""",
                "uncertainty": "model returned non-json text",
            }
        ),
    )

    formatted = format_visual_observation(visual)

    assert "```" not in formatted
    assert "\"series\"" not in formatted
    assert "CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (table)" in formatted
    assert "Periods: Three Months Ended March 28, 2026, Six Months Ended March 28, 2026" in formatted
    assert "Metrics: Net sales: Products, Gross margin, Operating income" in formatted
