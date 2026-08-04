from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

METRIC_ALIASES: dict[str, tuple[str, ...]] = {
    "revenue": ("revenue", "net sales", "sales"),
    "gross margin": ("gross margin", "gross profit margin"),
    "operating margin": ("operating margin", "operating profit margin", "operating income margin"),
    "operating income": ("operating income", "operating profit"),
    "ebitda": ("ebitda", "adjusted ebitda"),
    "eps": ("eps", "earnings per share", "diluted eps"),
    "capex": ("capex", "capital expenditures", "capital expenditure"),
    "free cash flow": ("free cash flow", "fcf"),
    "regional revenue": ("regional revenue", "revenue by region", "segment revenue"),
}

PERIOD_RE = re.compile(r"\b(FY\s?\d{2,4}|20\d{2}|19\d{2}|Q[1-4]\s?20?\d{2}|H[12]\s?20?\d{2})\b", re.I)
VALUE_RE = re.compile(r"(?<![A-Za-z0-9])[\$€£]?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(%|bps|bp|million|billion|m|bn)?", re.I)


@dataclass(frozen=True)
class KPIEvidence:
    metric: str
    period: str
    value: float
    unit: str
    segment: str
    page_number: int
    source_text: str
    confidence: float = 0.55


def normalize_metric(raw: str) -> str:
    raw_lower = raw.lower().strip()
    for metric, aliases in METRIC_ALIASES.items():
        if raw_lower == metric or raw_lower in aliases:
            return metric
    return raw_lower


def _line_metric(line: str) -> str | None:
    lowered = line.lower()
    for metric, aliases in METRIC_ALIASES.items():
        if any(alias in lowered for alias in aliases):
            return metric
    return None


def _parse_value(metric: str, line: str) -> tuple[float, str] | None:
    matches = VALUE_RE.findall(line)
    if not matches:
        return None
    if "margin" in metric:
        for raw_value, raw_unit in matches:
            if _is_year_like(raw_value, raw_unit):
                continue
            if raw_unit == "%":
                return float(raw_value.replace(",", "")), "%"
    for raw_value, raw_unit in matches:
        if _is_year_like(raw_value, raw_unit):
            continue
        value = float(raw_value.replace(",", ""))
        unit = raw_unit or ("%" if "margin" in metric else "")
        return value, unit
    return None


def _is_year_like(raw_value: str, raw_unit: str) -> bool:
    if raw_unit:
        return False
    try:
        value = int(raw_value.replace(",", ""))
    except ValueError:
        return False
    return 1900 <= value <= 2099


def _period(line: str) -> str:
    match = PERIOD_RE.search(line)
    return match.group(1).replace(" ", "").upper() if match else ""


def _segment(line: str) -> str:
    region_match = re.search(r"\b(americas|emea|europe|asia pacific|apac|china|india|north america|international)\b", line, re.I)
    return region_match.group(1).title() if region_match else ""


def extract_kpis_from_text(text: str, page_number: int) -> list[KPIEvidence]:
    records: list[KPIEvidence] = []
    seen: set[tuple[str, str, float, str]] = set()
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())
        if not line:
            continue
        metric = _line_metric(line)
        if not metric:
            continue
        parsed = _parse_value(metric, line)
        if not parsed:
            continue
        value, unit = parsed
        key = (metric, _period(line), value, _segment(line))
        if key in seen:
            continue
        seen.add(key)
        records.append(
            KPIEvidence(
                metric=metric,
                period=key[1],
                value=value,
                unit=unit,
                segment=key[3],
                page_number=page_number,
                source_text=line[:800],
            )
        )
    return records


def extract_kpis_from_table(rows: list[list[Any]], page_number: int, page_text: str = "") -> list[KPIEvidence]:
    records: list[KPIEvidence] = []
    periods = _period_columns(page_text, rows)
    row_values: dict[str, list[tuple[str, float]]] = {}
    in_region_section = False
    seen: set[tuple[str, str, float, str]] = set()

    for raw_row in rows:
        cells = ["" if value is None else str(value).strip() for value in raw_row]
        if not cells or not any(cells):
            continue
        label = " ".join(cells[0].split())
        lowered = label.lower()
        if "net sales by reportable segment" in lowered or "revenue by reportable segment" in lowered:
            in_region_section = True
            continue
        if "net sales by category" in lowered:
            in_region_section = False
            continue

        values = _row_numbers(cells[1:])
        if not values:
            continue
        metric = _table_metric(label, in_region_section)
        if not metric:
            continue
        period_values = _align_period_values(periods, values)
        row_values[metric] = period_values
        for period, value in period_values:
            segment = label if metric == "regional revenue" else ""
            key = (metric, period, value, segment)
            if key in seen:
                continue
            seen.add(key)
            records.append(
                KPIEvidence(
                    metric=metric,
                    period=period,
                    value=value,
                    unit="$m",
                    segment=segment,
                    page_number=page_number,
                    source_text=f"{label}: {_format_period_values(period_values)}",
                    confidence=0.82,
                )
            )

    revenue_by_period = dict(row_values.get("revenue", []))
    operating_income = row_values.get("operating income", [])
    for period, value in operating_income:
        revenue = revenue_by_period.get(period)
        if not revenue:
            continue
        margin = (value / revenue) * 100
        key = ("operating margin", period, round(margin, 4), "")
        if key in seen:
            continue
        seen.add(key)
        records.append(
            KPIEvidence(
                metric="operating margin",
                period=period,
                value=round(margin, 2),
                unit="%",
                segment="",
                page_number=page_number,
                source_text=f"Operating income {value:g} / revenue {revenue:g} = {margin:.2f}%",
                confidence=0.9,
            )
        )
    return records


def _table_metric(label: str, in_region_section: bool) -> str | None:
    lowered = label.lower()
    if in_region_section and lowered in {"americas", "europe", "greater china", "japan", "rest of asia pacific", "asia pacific", "north america"}:
        return "regional revenue"
    if lowered.startswith("total net sales") or lowered.startswith("total revenue"):
        return "revenue"
    if lowered == "gross margin":
        return "gross margin"
    if lowered == "operating income":
        return "operating income"
    if lowered in {"diluted", "diluted eps", "diluted earnings per share"}:
        return "eps"
    if lowered in {"capital expenditures", "payments for acquisition of property, plant and equipment"}:
        return "capex"
    return None


def _row_numbers(cells: list[str]) -> list[float]:
    values: list[float] = []
    for cell in cells:
        normalized = cell.replace("$", "").replace(",", "").replace(" ", "").strip()
        if not normalized or normalized in {"-", "—"}:
            continue
        negative = normalized.startswith("(") and normalized.endswith(")")
        normalized = normalized.strip("()")
        try:
            value = float(normalized)
        except ValueError:
            continue
        values.append(-value if negative else value)
    return values


def _period_columns(page_text: str, rows: list[list[Any]]) -> list[str]:
    periods = _period_columns_from_text(page_text)
    if periods:
        return periods
    width = max((len(row) for row in rows), default=1)
    value_columns = max(1, width - 1)
    return [f"column {index}" for index in range(1, value_columns + 1)]


def _period_columns_from_text(text: str) -> list[str]:
    normalized = [line.strip() for line in text.splitlines() if line.strip()]
    joined = "\n".join(normalized)
    durations = re.findall(r"\b(?:Three|Six|Nine|Twelve)\s+Months\s+Ended\b", joined, flags=re.I)
    dates: list[str] = []
    index = 0
    while index < len(normalized):
        line = normalized[index]
        if re.fullmatch(r"[A-Z][a-z]+ \d{1,2},", line) and index + 1 < len(normalized) and re.fullmatch(r"\d{4}", normalized[index + 1]):
            dates.append(f"{line} {normalized[index + 1]}")
            index += 2
            continue
        match = re.fullmatch(r"([A-Z][a-z]+ \d{1,2},)\s*(\d{4})", line)
        if match:
            dates.append(f"{match.group(1)} {match.group(2)}")
        index += 1
    if durations and dates and len(dates) >= len(durations):
        span = max(1, len(dates) // len(durations))
        labels: list[str] = []
        for duration_index, duration in enumerate(durations):
            for date in dates[duration_index * span : (duration_index + 1) * span]:
                labels.append(f"{duration.title()} {date}")
        return labels[: len(dates)]
    return dates


def _align_period_values(periods: list[str], values: list[float]) -> list[tuple[str, float]]:
    if not periods:
        periods = [f"column {index}" for index in range(1, len(values) + 1)]
    if len(periods) < len(values):
        periods = periods + [f"column {index}" for index in range(len(periods) + 1, len(values) + 1)]
    return list(zip(periods[: len(values)], values, strict=False))


def _format_period_values(values: list[tuple[str, float]]) -> str:
    return "; ".join(f"{period} {value:g}" for period, value in values)


def growth_rate(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return ((current - previous) / abs(previous)) * 100


def delta(current: float, previous: float) -> float:
    return current - previous
