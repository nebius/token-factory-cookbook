from app.kpi import extract_kpis_from_table, extract_kpis_from_text, growth_rate, normalize_metric


def test_extract_operating_margin_and_revenue() -> None:
    text = """
    FY2025 revenue was $12,400 million, up from prior year.
    Operating margin FY2025 18.4%
    Diluted EPS 2025 $3.21
    """
    records = extract_kpis_from_text(text, 7)
    by_metric = {record.metric: record for record in records}
    assert by_metric["revenue"].value == 12400
    assert by_metric["operating margin"].value == 18.4
    assert by_metric["eps"].value == 3.21
    assert by_metric["operating margin"].page_number == 7


def test_normalize_metric_alias() -> None:
    assert normalize_metric("Operating Profit Margin") == "operating margin"
    assert normalize_metric("FCF") == "free cash flow"


def test_growth_rate() -> None:
    assert round(growth_rate(120, 100) or 0, 2) == 20.0
    assert growth_rate(10, 0) is None


def test_extract_table_operating_margin_and_segments() -> None:
    text = """
    Three Months Ended
    Six Months Ended
    March 28,
    2026
    March 29,
    2025
    March 28,
    2026
    March 29,
    2025
    """
    rows = [
        ["Total net sales (1)", "111,184", "", "95,359", "", "254,940", "", "219,659"],
        ["Operating income", "35,885", "", "29,589", "", "86,737", "", "72,421"],
        ["(1) Net sales by reportable segment:", "", "", "", "", "", "", ""],
        ["Americas", "45,093", "", "40,315", "", "103,622", "", "92,963"],
        ["Total net sales", "111,184", "", "95,359", "", "254,940", "", "219,659"],
        ["(1) Net sales by category:", "", "", "", "", "", "", ""],
    ]

    records = extract_kpis_from_table(rows, 1, text)
    margins = [record for record in records if record.metric == "operating margin"]
    segments = [record for record in records if record.metric == "regional revenue"]

    assert margins[0].period == "Three Months Ended March 28, 2026"
    assert margins[0].value == 32.28
    assert segments[0].segment == "Americas"
    assert segments[0].value == 45093
