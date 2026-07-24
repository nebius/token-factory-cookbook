# Insurance Claims Assistant

A multimodal claims-triage agent built on [Nebius Token Factory](https://tokenfactory.nebius.com/).
**Drop in a folder of claim documents — in any shape** — and the agent reads everything
(PDFs, photos, forms), works out what the claim is, confirms its understanding with you,
then reconciles what the claimant *stated* against what the evidence actually *shows* and
hands a human assessor a structured summary with a recommendation.

It wires **two** Token Factory models together, using **LangChain** to drive the reasoning:

- **`nvidia/Llama-3_1-Nemotron-Ultra-253B-v1`** — the reasoning brain. It classifies the
  documents, infers the claim, and produces the final typed assessment.
- **`nvidia/Cosmos3-Super-Reasoner`** — the eyes. The Cosmos 3 vision-language model that
  reads accident photos and any scanned/photographed documents.

## Features

- 📂 **Drop any folder** — no fixed filenames or structure. PDFs (invoices, policy
  declarations, verification records, incident reports), photos, JSON forms, loose text.
- 📄 **Reads PDFs** — extracts the text layer for exact amounts/names/dates, and falls back
  to the vision model for scanned/image-only PDFs.
- 🧠 **Auto-classifies documents & claim type** — figures out what each file is and whether
  it's an auto or property claim from *content*, not filenames.
- 🙋 **Confirms before judging** — shows you what it understood ("this looks like an auto
  claim by … for … — correct?"), takes your corrections, and asks follow-up questions.
- ⚖️ **Four assessor checks** — document completeness, damage-vs-description, amount
  consistency, and identity consistency — tuned for *materiality* (won't flag a $14 rounding
  difference, will flag a $350-vs-$5,000 one).
- 🚩 **Inconsistency & gap detection** — mismatched severity, inflated invoices, name
  mismatches, missing required documents.
- 📋 **Assessor-ready output** — a validated `ClaimAssessment` (JSON) + markdown report with
  a recommendation (`approve` / `request_more_info` / `manual_review` / `deny`), fraud-risk,
  and confidence.
- 🖥️ **Two interfaces** — an interactive CLI (with `--yes` for batch/CI) and a Streamlit app.

## Tech Stack

- **Nebius Token Factory** — `nvidia/Llama-3_1-Nemotron-Ultra-253B-v1` (reasoning) +
  `nvidia/Cosmos3-Super-Reasoner` (vision)
- **LangChain** — `langchain-openai` `ChatOpenAI` against the Token Factory OpenAI-compatible endpoint
- **PyMuPDF** — PDF text extraction + page rasterisation
- **Pydantic** — typed schemas, validated at every step
- **Streamlit** — the interactive UI

## How it works

```
   any claim folder            ┌─────────────── perceive ───────────────┐
  (pdf / jpg / json / txt) ──▶ │ text PDFs  → extract text               │
                               │ scanned PDF/images → Cosmos3 VLM        │
                               │ json / txt → read directly              │
                               └────────────────────┬────────────────────┘
                                                    ▼
                          ┌──────── understand (Nemotron) ────────┐
                          │ classify docs · infer claim type ·    │
                          │ "this looks like … — correct?" + Qs   │
                          └────────────────────┬───────────────────┘
                                       confirm / correct / answer  ◀── you
                                                    ▼
                          ┌──────── assess (Nemotron) ────────────┐
                          │ 4 checks · inconsistencies · verdict  │
                          └────────────────────┬───────────────────┘
                                                    ▼
                          ClaimAssessment (JSON) + assessor report
```

Perception reads *every* file up front, so the reasoning steps are always fully grounded —
the model never has to remember to look at a document, and can't fabricate one. Every model
call returns a single JSON object validated with Pydantic (with a retry on malformed output).

## Prerequisites

- Python 3.11 or higher
- Nebius API key (get it from [Nebius Token Factory](https://tokenfactory.nebius.com/))

## Installation

```bash
git clone https://github.com/nebius/token-factory-cookbook/
cd token-factory-cookbook/agents/langchain/insurance-claims-assistant

uv sync                         # or: pip install -r requirements.txt
cp env.example .env             # then edit .env and set NEBIUS_API_KEY
```

## Running

**CLI** (interactive — shows its understanding, asks you to confirm):

```bash
uv run python main.py --claim path/to/claim_folder/     # or: python main.py --claim …
```

Batch / non-interactive (auto-confirm), and JSON-only:

```bash
python main.py --claim path/to/claim_folder/ --yes
python main.py --claim path/to/claim_folder/ --yes --json-only
```

Running with no `--claim` uses the bundled `sample_claim/`.

**Try the showcase** — three full claim bundles (PDFs + photos) that demonstrate every
outcome, with expected verdicts included:

```bash
python main.py --claim showcase/CLM-2026-0142_clean_auto --yes        # → approve
python main.py --claim showcase/CLM-2026-0143_suspicious_auto --yes   # → deny
python main.py --claim showcase/CLM-2026-0144_property_manual_review  # → manual_review
```

See [`showcase/README.md`](showcase/README.md) for the story behind each one.

**Streamlit app** (drop a folder path, upload files, or run the sample):

```bash
uv run streamlit run app.py     # or: streamlit run app.py
```

## What goes in a claim folder

**Anything** — there is no required layout. Put in whatever the claimant submitted:

- **Damage photos** — `.jpg/.png/.webp` (vehicle or property).
- **Documents** — `.pdf` (repair invoice/estimate, policy declaration, identity/verification
  record, incident report, registration) or images of them.
- **A claim form** — `claim_form.json` if you have structured stated facts (optional), or
  just include the claim-form PDF.
- Loose `.txt` notes are read too.

Filenames don't matter — the agent classifies each document by its **content**. Files that
are clearly test scaffolding (`expected_verdict*`, `ground_truth*`, `README`, `MANIFEST`,
screenshots, dotfiles) are ignored so they can't leak answers.

The bundled `sample_claim/` is a small vehicle claim (a "minor scratch / $350" statement
against photos of severe damage and a $4,820 invoice, with no ID) — a good first run.

## Configuration

All configurable via `.env` (see `env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEBIUS_API_KEY` | — | Your Token Factory API key (required) |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1/` | Inference endpoint |
| `TEXT_MODEL` | `nvidia/Llama-3_1-Nemotron-Ultra-253B-v1` | Reasoning model |
| `VISION_MODEL` | `nvidia/Cosmos3-Super-Reasoner` | Vision model |

> If your workspace serves the Cosmos vision model under a different id (for example
> `nvidia/Cosmos3-Super`), just set `VISION_MODEL` in your `.env` — no code changes needed.

## Project layout

```
insurance-claims-assistant/
├── main.py                    # CLI (perceive → understand → confirm → assess)
├── app.py                     # Streamlit UI (staged confirm/assess)
├── claims_assistant/
│   ├── config.py              # endpoint, model ids, ChatOpenAI factories
│   ├── models.py              # Pydantic schemas (DocumentInsight, ClaimUnderstanding, ClaimAssessment)
│   ├── llm.py                 # vision (chat_vision) helper + JSON extraction
│   ├── ingest.py              # discover files, extract PDF text, rasterise, encode images
│   ├── perception.py          # read every file → DocumentInsight (deterministic)
│   ├── agent.py               # understand() + assess() reasoning steps
│   └── report.py              # understanding & assessment → markdown
└── sample_claim/              # a ready-to-run example claim
```

## Notes

- Not legal or underwriting advice — this is an educational example. Keep a human assessor
  in the loop for real claims, and never upload real identity documents to a demo.
- The sample photos are freely licensed; see [`sample_claim/ATTRIBUTIONS.md`](sample_claim/ATTRIBUTIONS.md).

## References

- [Nebius Token Factory](https://tokenfactory.nebius.com/)
- [LangChain](https://docs.langchain.com/) · [`ChatOpenAI`](https://python.langchain.com/docs/integrations/chat/openai/)
- [Nemotron Ultra 253B](https://tokenfactory.nebius.com/) · [NVIDIA Cosmos](https://developer.nvidia.com/cosmos)
