# Invoice Extraction with Confidence-Gated Human Validation

A vision model reading a blurred invoice does not stay silent. It produces a number.

On the sample invoice in this cookbook, [Qwen2.5-VL-72B-Instruct](https://tokenfactory.nebius.com/models/catalog/image2text/Qwen%2FQwen2.5-VL-72B-Instruct) read a total of **$2,148.75** and rated its own confidence at **0.70**. A human expert then looked at the same image and returned `null`: the total was too blurred to confirm, and the invoice number and issue date were hidden behind a PAID stamp. The model had not misread the total. It had invented one.

That gap is the entire subject of this cookbook. You will build a pipeline that treats a model's confidence as a routing decision rather than a footnote, and buys human judgment only for the documents that need it.

## What you will build

A batch invoice processor with three stages:

1. **Extract.** Every image goes to a Nebius vision model, which returns the invoice fields plus a self-reported confidence score.
2. **Route.** Ordinary Python — not another model call — decides which results are trustworthy. A record escalates if confidence falls below `0.95` or any required field is missing.
3. **Validate.** Escalated invoices become paid tasks for a vetted human expert through [Tendem by Toloka](https://nebius.com/solutions/tendem). The expert's answer replaces the draft, and every row in the output CSV carries a `source` column recording who finalized it.

The routing rule is deliberately boring code. That makes it deterministic, auditable, and unit-testable — three things a second model call would not give you.

## Prerequisites

- Python 3.11 or newer and [uv](https://docs.astral.sh/uv/)
- A [Nebius Token Factory](https://tokenfactory.nebius.com/) account with access to `Qwen/Qwen2.5-VL-72B-Instruct` — see [Getting Started](../../start-here/setup.md) for how to create an API key
- A Tendem account, and an API key from **Account Settings → Tendem MCP → Agent Builders**
- A funded Tendem balance. Human validation is paid work — the sample run below settled at **$3.00**.

## Run the cookbook

1. Clone the project and install dependencies:

   ```bash
   git clone https://github.com/amrrs/toloka-nebiustf-validation.git
   cd toloka-nebiustf-validation
   uv sync --extra dev
   ```

2. Provide both credentials. The recipe reads them from environment files:

   ```bash
   export NEBIUS_API_KEY="your-token-factory-key"
   export TENDEM_API_KEY="your-tendem-key"
   ```

3. Put invoice images in `documents/inbox/`. A deliberately poor-quality sample is included, so you can run the escalation path without supplying your own documents.

4. Run the recipe:

   ```bash
   uv run python use_cases/invoice_vision_human_validation.py
   ```

Results land in `documents/extracted.csv`, written after each invoice so an interrupted batch keeps completed work.

### The controls worth reading before you run

The configuration block at the top of the script holds the decisions that cost money:

```python
MIN_CONFIDENCE = 0.95          # below this, escalate to a human
MAX_HUMAN_PRICE_USD = 10.0     # quotes above this are refused, not approved
HUMAN_WAIT_SECONDS = 6 * 60 * 60
```

`MAX_HUMAN_PRICE_USD` is a hard stop. When a quote exceeds it the run raises rather than approving, so an unexpected price becomes a person's decision instead of a silent charge. Raising `MIN_CONFIDENCE` sends more work to humans and costs more; lowering it keeps more model output unchecked. That single number is the accuracy-versus-cost dial.

The script also keeps a journal in `documents/tendem-tasks.json` mapping each image to its Tendem task ID. Restart mid-batch and it resumes the existing task rather than buying the same validation twice.

## Verify the result

Open `documents/extracted.csv` and look at the `source` column. Rows finalized by the model read `nebius-vision`; rows a human corrected read `tendem-human`. On the bundled sample you should see one `tendem-human` row where `total_amount` is empty and the notes explain why the expert refused to guess.

Compare that against `documents/run-evidence/vision-invoice-live-run.json`, which records a complete run: the model's `2148.75` at `0.80` confidence, the `escalate_to_human` decision, the $3.00 quote, and the human's corrected output.

Reproducing the first stage on its own is fast and costs a fraction of a cent — a measured extraction on the sample used 342 prompt and 82 completion tokens, about **$0.000147**, in **3.8 seconds**.

## What a run costs

Two providers are billed, and they are not the same order of magnitude:

| Stage | Provider | Cost |
| --- | --- | --- |
| Vision extraction (per invoice) | Nebius Token Factory | ~$0.000147 |
| Human validation (per escalated invoice) | Tendem by Toloka | $3.00 on the sample run; capped at `MAX_HUMAN_PRICE_USD` |

A batch where nothing escalates costs well under a cent. The human stage is what you are budgeting for, and the confidence threshold is the dial that controls how often you pay it.

### Timing expectations

The Nebius pass returns in seconds. Human validation does not — it is an asynchronous task that a person picks up, and the script waits up to six hours for a result. Plan your first end-to-end run around that, and treat the human stage as a queue rather than a function call.

### Troubleshooting

- **401 from Token Factory** — check `NEBIUS_API_KEY`, and that your account has access to the vision model.
- **The run raises on a quote** — expected behavior, not a bug. The quote exceeded `MAX_HUMAN_PRICE_USD`. Review the task and raise the cap deliberately if the price is fair.
- **Nothing escalates** — your invoices are clean and the model is confident. Lower `MIN_CONFIDENCE` or use the bundled low-quality sample to exercise the human path.
- **A task seems stuck** — check `documents/tendem-tasks.json` for the task ID and inspect it in the Tendem console.

## Clean up

Completed tasks remove themselves from the journal. To reset local state:

```bash
rm -f documents/extracted.csv documents/tendem-tasks.json
rm -rf .venv
unset NEBIUS_API_KEY TENDEM_API_KEY
```

Paid Tendem tasks that already settled cannot be refunded by deleting local files. If you want to stop spending, clear `documents/inbox/` before the next run.

## Links

- [Source project](https://github.com/amrrs/toloka-nebiustf-validation/tree/main/use_cases)
- [Tendem by Toloka](https://nebius.com/solutions/tendem)
- [Qwen2.5-VL-72B-Instruct in the Token Factory catalog](https://tokenfactory.nebius.com/models/catalog/image2text/Qwen%2FQwen2.5-VL-72B-Instruct)
- [Token Factory documentation](https://docs.tokenfactory.nebius.com/)
