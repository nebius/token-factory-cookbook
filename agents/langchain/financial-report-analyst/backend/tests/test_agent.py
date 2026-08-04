from app import agent as agent_module
from app.agent import (
    AgentContext,
    ModelUnavailableError,
    _financial_visual_relevance,
    _format_kpi_value,
    _human_review_checkpointer,
    _metric_display_name,
    _normalize_generic_citation_text,
    _prioritize_answer_citations,
    _reasoning_model,
    generate_research_plan,
    get_financial_agent,
    stream_chat_response,
)
from app.config import settings
from app.models import AgentAnswer, ChatResponse, CitationRead, EvidenceCitation
from types import SimpleNamespace


def test_reasoning_model_uses_nebius_extra_body(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    model = _reasoning_model()
    assert model.model_name == settings.reasoning_model
    assert model.openai_api_base == settings.reasoning_base_url
    assert model.extra_body["chat_template_kwargs"]["enable_thinking"] is True
    assert model.extra_body["chat_template_kwargs"]["force_nonempty_content"] is True


def test_deep_agent_compiles_with_narrow_subagents(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    get_financial_agent.cache_clear()
    graph = get_financial_agent()
    assert "tools" in graph.nodes
    assert {subagent["name"] for subagent in agent_module.FINANCIAL_SUBAGENTS} == {
        "kpi-analyst",
        "visual-auditor",
        "filing-synthesizer",
        "risk-strategy-analyst",
    }


def test_missing_key_requires_model(monkeypatch) -> None:
    monkeypatch.setattr(settings, "nebius_api_key", "")
    try:
        agent_module._try_deep_agent(AgentContext(project_id="missing"), "What changed?")
    except ModelUnavailableError as exc:
        assert "Nebius API key is required" in str(exc)
    else:
        raise AssertionError("missing Nebius key should block AI-only chat")


def test_financial_tool_set_is_complete() -> None:
    assert {tool.name for tool in agent_module.FINANCIAL_AGENT_TOOLS} == {
        "agent_search_corpus",
        "agent_get_page_context",
        "agent_get_table",
        "agent_get_visual",
        "agent_compare_kpi",
        "agent_verify_chart_against_table",
        "agent_calculate_margin_bridge",
        "agent_document_inventory",
    }
    for tool in agent_module.FINANCIAL_AGENT_TOOLS:
        schema = tool.tool_call_schema.model_json_schema()
        assert "runtime" not in schema.get("properties", {})


def test_human_review_uses_persistent_sqlite_checkpointer(monkeypatch, tmp_path) -> None:
    from langgraph.checkpoint.sqlite import SqliteSaver

    checkpoint_path = tmp_path / "hitl.sqlite"
    monkeypatch.setattr(settings, "checkpoint_db_path", checkpoint_path)
    _human_review_checkpointer.cache_clear()
    checkpointer = _human_review_checkpointer()

    assert isinstance(checkpointer, SqliteSaver)
    assert checkpoint_path.exists()


def test_visual_answer_replaces_generic_document_citation() -> None:
    answer = _normalize_generic_citation_text(
        "The chart shows stronger sales but weaker cash flow. Document name p.11",
        [
            CitationRead(
                document_id="doc",
                document_name="Q1 2026 Earnings Conference Call Slides - Final.pdf",
                page_number=11,
                source_kind="visual",
                label="Overview",
            )
        ],
    )

    assert "Document name" not in answer
    assert "Q1 2026 Earnings Conference Call Slides - Final.pdf p.11" in answer


def test_answer_mentioned_citation_page_is_prioritized() -> None:
    citations = [
        CitationRead(document_id="doc", document_name="Deck.pdf", page_number=20, source_kind="visual", label="p20"),
        CitationRead(document_id="doc", document_name="Deck.pdf", page_number=11, source_kind="visual", label="p11"),
    ]

    ordered = _prioritize_answer_citations("The key source is Deck.pdf p.11.", citations)

    assert ordered[0].page_number == 11


def test_adjusted_results_visual_scores_above_non_chart_slide() -> None:
    query = "Does the Brunswick adjusted results chart agree with the figures in the table?"
    adjusted_results = "Overview of First Quarter 2026 Adjusted Results chart Net Sales Operating Earnings EPS Free Cash Flow"
    non_chart = "This image does not contain a chart, graph, or table. Awards secured in Q1 2026."

    assert _financial_visual_relevance(adjusted_results.lower(), query.lower()) > _financial_visual_relevance(
        non_chart.lower(), query.lower()
    )


def test_kpi_values_format_for_analyst_readability() -> None:
    assert _format_kpi_value("revenue", 111184, "$m") == "$111.2B"
    assert _format_kpi_value("gross margin", 487, "m") == "$487M"
    assert _format_kpi_value("operating margin", 9.5, "%") == "9.5%"
    assert _metric_display_name("operating income") == "Operating income"


def test_stream_chat_response_emits_real_subagent_token_and_final_events(monkeypatch) -> None:
    class FakeAgent:
        def stream(self, *args, **kwargs):
            assert kwargs["stream_mode"] == ["updates", "messages", "values"]
            assert kwargs["subgraphs"] is True
            assert kwargs["version"] == "v2"
            yield {"type": "updates", "ns": (), "data": {"model_request": {}}}
            yield {"type": "updates", "ns": ("tools:abc",), "data": {"model_request": {}}}
            yield {"type": "messages", "ns": ("tools:abc",), "data": (SimpleNamespace(content="working"), {})}
            yield {
                "type": "values",
                "ns": (),
                "data": {
                    "structured_response": AgentAnswer(
                        summary="Final streamed answer.",
                        citations=[
                            EvidenceCitation(
                                document_id="doc",
                                document_name="Report.pdf",
                                page_number=1,
                                source_kind="page",
                                label="page",
                            )
                        ],
                    )
                },
            }

    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr(settings, "enable_model_calls", True)
    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 1)
    monkeypatch.setattr(agent_module, "_project_brief", lambda project_id, document_ids=None: "brief")
    monkeypatch.setattr(agent_module, "get_financial_agent", lambda human_review=False: FakeAgent())
    monkeypatch.setattr(
        agent_module,
        "_persist_answer",
        lambda project_id, question, answer, citations, thread_id, structured_answer=None: ChatResponse(
            thread_id=thread_id or project_id,
            answer=answer,
            citations=citations,
            structured_answer=structured_answer,
        ),
    )

    events = list(stream_chat_response("project", "Why did operating margin decline?", "thread", False))

    assert any(event["type"] == "main" for event in events)
    assert any(event["type"] == "subagent" for event in events)
    assert any(event["type"] == "token" and event["source"] == "subagent" for event in events)
    final = next(event for event in events if event["type"] == "final")
    assert final["response"]["answer"] == "Final streamed answer.\n\nReferences: Report.pdf p.1 (page)"


def test_human_review_forces_deep_agent_stream_for_direct_routes(monkeypatch) -> None:
    calls: list[tuple[str, bool]] = []

    def fake_stream(project_id: str, question: str, thread_id: str | None = None, human_review: bool = False):
        calls.append((question, human_review))
        yield {"type": "review", "message": "Deep Agent paused for evidence tool review.", "review_actions": [{"name": "agent_compare_kpi"}]}
        yield {
            "type": "final",
            "response": ChatResponse(
                thread_id=thread_id or project_id,
                answer="Evidence tool review is active.",
                citations=[],
                interrupted=True,
                review_actions=[{"name": "agent_compare_kpi"}],
            ).model_dump(mode="json"),
        }
        yield {"type": "done"}

    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 1)
    monkeypatch.setattr(agent_module, "_stream_deep_agent_response", fake_stream)

    events = list(
        stream_chat_response(
            "project",
            "Compare Apple revenue, gross margin, and operating income across the uploaded Apple reports.",
            "thread",
            human_review=True,
        )
    )

    assert calls
    assert calls[0][1] is True
    assert calls[0][0] == "Compare Apple revenue, gross margin, and operating income across the uploaded Apple reports."
    assert any(event["type"] == "review" for event in events)


def test_human_review_forces_deep_agent_stream_for_inventory_route(monkeypatch) -> None:
    calls: list[tuple[str, bool]] = []

    def fake_stream(project_id: str, question: str, thread_id: str | None = None, human_review: bool = False):
        calls.append((question, human_review))
        yield {"type": "review", "message": "Deep Agent paused for evidence tool review.", "review_actions": [{"name": "agent_document_inventory"}]}
        yield {
            "type": "final",
            "response": ChatResponse(
                thread_id=thread_id or project_id,
                answer="Evidence tool review is active.",
                citations=[],
                interrupted=True,
                review_actions=[{"name": "agent_document_inventory"}],
            ).model_dump(mode="json"),
        }
        yield {"type": "done"}

    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 1)
    monkeypatch.setattr(agent_module, "_stream_deep_agent_response", fake_stream)

    events = list(stream_chat_response("project", "Map the uploaded evidence: companies and periods covered.", "thread", human_review=True))

    assert calls == [("Map the uploaded evidence: companies and periods covered.", True)]
    assert any(event["type"] == "review" for event in events)


def test_stream_stops_on_deep_agent_interrupt_update(monkeypatch) -> None:
    class FakeAgent:
        def stream(self, *args, **kwargs):
            yield {
                "type": "updates",
                "ns": (),
                "data": {
                    "__interrupt__": [
                        SimpleNamespace(
                            value={
                                "action_requests": [
                                    {"name": "agent_compare_kpi", "args": {"metric": "operating margin"}},
                                    {"name": "agent_get_table", "args": {"page_number": 1}},
                                ]
                            }
                        )
                    ]
                },
            }
            yield {
                "type": "values",
                "ns": (),
                "data": {
                    "structured_response": AgentAnswer(summary="This should not be returned before review."),
                },
            }

    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr(settings, "enable_model_calls", True)
    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 1)
    monkeypatch.setattr(agent_module, "_project_brief", lambda project_id, document_ids=None: "brief")
    monkeypatch.setattr(agent_module, "get_financial_agent", lambda human_review=False: FakeAgent())

    events = list(stream_chat_response("project", "Compare operating margin.", "thread-for-review", True))

    review = next(event for event in events if event["type"] == "review")
    final = next(event for event in events if event["type"] == "final")
    assert len(review["review_actions"]) == 2
    assert final["response"]["thread_id"] == "thread-for-review"
    assert final["response"]["interrupted"] is True
    assert "This should not be returned" not in final["response"]["answer"]


def test_research_plan_is_model_generated_and_normalized(monkeypatch) -> None:
    class FakeModel:
        def invoke(self, messages):
            assert "Workspace evidence brief" in messages[1]["content"]
            return SimpleNamespace(
                content="""{
                  "summary": "Build a cited investment diligence plan for the uploaded reports.",
                  "steps": ["Map documents", "Compare KPIs", "Separate facts from inference"],
                  "tools": ["search_corpus", "compare_kpi", "not_a_tool"],
                  "subagents": ["kpi-analyst", "risk-strategy-analyst", "invalid-agent"],
                  "evidence_needed": ["income statement", "cash flow"],
                  "output_format": ["facts", "inference", "missing evidence"],
                  "guardrails": ["no live market data"],
                  "confidence": "high"
                }"""
            )

    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr(settings, "enable_model_calls", True)
    monkeypatch.setattr(agent_module, "_project_brief", lambda project_id, document_ids=None: "brief")
    monkeypatch.setattr(agent_module, "_reasoning_model", lambda: FakeModel())

    plan = generate_research_plan("project", "Build an evidence-based investment diligence framework.", ["deck.pdf"])

    assert plan.summary.startswith("Build a cited")
    assert plan.tools == ["search_corpus", "compare_kpi"]
    assert plan.subagents == ["kpi-analyst", "risk-strategy-analyst"]
    assert plan.confidence == "high"


def test_company_data_prompt_goes_through_deep_agent_document_inventory(monkeypatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 2)
    monkeypatch.setattr(
        agent_module,
        "_try_deep_agent",
        lambda context, question, human_review=False: (
            calls.append(question) or "Apple FY25 Q4 and Apple FY26 Q2 are ready.",
            [],
            None,
            False,
            [],
        ),
    )
    monkeypatch.setattr(
        agent_module,
        "_persist_answer",
        lambda project_id, question, answer, citations, thread_id, structured_answer=None: ChatResponse(
            thread_id=thread_id or project_id,
            answer=answer,
            citations=citations,
            structured_answer=structured_answer,
        ),
    )

    response = agent_module.answer_question("project", "what companies data we have here for financial analysis")

    assert calls == ["what companies data we have here for financial analysis"]
    assert "Apple FY25 Q4" in response.answer


def test_apple_china_prompt_routes_to_deep_agent(monkeypatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(agent_module, "_ready_document_count", lambda project_id: 2)
    monkeypatch.setattr(
        agent_module,
        "_try_deep_agent",
        lambda context, question, human_review=False: (
            calls.append(question) or "Apple China exposure answer with citations.",
            [],
            None,
            False,
            [],
        ),
    )
    monkeypatch.setattr(
        agent_module,
        "_persist_answer",
        lambda project_id, question, answer, citations, thread_id, structured_answer=None: ChatResponse(
            thread_id=thread_id or project_id,
            answer=answer,
            citations=citations,
            structured_answer=structured_answer,
        ),
    )

    response = agent_module.answer_question("project", "ok apple has any china connection? based on docs we have")

    assert calls == ["ok apple has any china connection? based on docs we have"]
    assert "China exposure" in response.answer
