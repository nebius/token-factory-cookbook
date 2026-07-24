# LangChain examples for Nebius Token Factory

This folder contains production-oriented LangChain examples powered by Nebius Token Factory. Each example is self-contained with its own `requirements.txt`, `.env.example`, source files, and sample data.

## Examples

| Example | Production use case | What it demonstrates |
| --- | --- | --- |
| [Voice Agent with Gradium](voice-agent-gradium-nebius-langchain/) | Conversational pitch and public-speaking coach | Browser voice turns, Gradium STT/TTS, LangChain prompt orchestration, Nebius reasoning |
| [Incident Response Agent](incident-response-agent/) | SRE incident triage | Tool-driven log search, runbook lookup, deploy correlation, typed mitigation plan |
| [Customer Support Resolution Agent](customer-support-resolution-agent/) | CX ticket resolution | KB search, order lookup, policy-grounded draft responses, approval-aware workflow recommendations |
| [Vendor Risk Compliance Agent](vendor-risk-compliance-agent/) | Security/privacy vendor review | Policy control search, contract evidence review, data-residency checks, risk register output |
| [Data Quality Ops Agent](data-quality-ops-agent/) | Data operations investigation | Guarded read-only SQL, schema discovery, pipeline change correlation, reproducible data quality report |

## Setup pattern

Each project can be run independently:

```bash
cd langchain/<example-folder>
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# add NEBIUS_API_KEY and any project-specific keys
python main.py
```

The voice agent also includes a FastAPI browser UI:

```bash
cd langchain/voice-agent-gradium-nebius-langchain
uvicorn voice_agent_server:app --host 127.0.0.1 --port 8501
```

## Safety notes

- All examples are designed to use local fixtures and read-only or draft-only tools.
- No real infrastructure, refunds, shipments, or vendor approvals are executed.
- `.env.example` files contain placeholders only; add real keys locally.
