from app.nebius import VisualObservation, _extract_json_object


def test_extract_json_object_from_fenced_response() -> None:
    content = """```json
    {"title":"Revenue by Region","visual_type":"chart","summary":"Revenue chart"}
    ```"""
    observation = VisualObservation.model_validate_json(_extract_json_object(content))
    assert observation.title == "Revenue by Region"
    assert observation.visual_type == "chart"
    assert observation.summary == "Revenue chart"


def test_visual_observation_accepts_rich_model_shapes() -> None:
    observation = VisualObservation.model_validate(
        {
            "title": "Cisco's structural advantages",
            "visual_type": "KPI Dashboard",
            "series": [{"label": "RPO", "values": ["$43.5B"]}],
            "visible_values": ["56%", "$43.5B"],
            "chart_table_conflicts": "",
            "summary": "Cisco strategic metrics slide",
        }
    )
    assert observation.series[0]["label"] == "RPO"
    assert observation.visible_values == ["56%", "$43.5B"]
    assert observation.chart_table_conflicts == []
