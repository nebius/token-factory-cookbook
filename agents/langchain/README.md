# LangChain Examples for Nebius TF Token Factory

Production-ready LangChain agent examples powered by [Nebius TF Token Factory](https://nebius.com/services/ai-model-studio). Each example demonstrates a real-world agentic pattern — tool-calling, RAG, safe SQL, voice, and more.

## Examples

(*Nebius TF = Nebius Token Factory*)

| Agent | Description | Tech Stack |
| ----- | ----------- | ---------- |
| [Customer Support Resolution Agent](customer_support_resolution_agent/) | Resolves support questions with order lookup, policy RAG, and human ticket escalation | LangChain · LangGraph · Nebius TF · FAISS · Streamlit |
| [Customer Support Resolution Agent (v2)](customer-support-resolution-agent/) | CX ticket resolution with KB search, order lookup, policy-grounded draft responses, and approval-aware workflow | LangChain · Nebius TF · Pydantic |
| [LangChain Data Agent PoC](langchain_data_agent_poc/) | Natural-language queries over business data with safe read-only SQL, domain routing, and chart suggestions | LangChain · LangGraph · Nebius TF · SQLGlot · Pandas · Plotly · Streamlit |
| [Nebius TF Travel Planner](nebius_travel_planner/) | Builds grounded itineraries with live weather, web research, budgets, currency conversion, and packing prep | LangChain · Nebius TF · DuckDuckGo Search · Streamlit |
| [Voice Agent with Gradium](voice-agent-gradium-nebius-langchain/) | Conversational pitch and public-speaking coach with browser voice turns and real-time feedback | LangChain · Nebius TF · Gradium STT/TTS · FastAPI · Streamlit |
| [Incident Response Agent](incident-response-agent/) | SRE incident triage via tool-driven log search, runbook lookup, deploy correlation, and typed mitigation plans | LangChain · Nebius TF · Pydantic |
| [Vendor Risk Compliance Agent](vendor-risk-compliance-agent/) | Inspects vendor questionnaires and produces risk registers grounded in internal controls and contract evidence | LangChain · Nebius TF · Pydantic |
| [Data Quality Ops Agent](data-quality-ops-agent/) | Investigates data pipeline issues with guarded read-only SQL, schema discovery, and reproducible quality reports | LangChain · Nebius TF · SQLite · Pydantic |

## Common Patterns

All examples share a consistent architecture:

- **Tool-calling agents** — LangChain agents with explicit tool definitions; the LLM decides which tool to invoke at each step
- **Read-only / draft-only** — agents recommend or draft responses but never mutate systems directly
- **Grounded responses** — tools fetch real data before the LLM generates answers
- **Typed outputs** — Pydantic models for structured, reproducible results
