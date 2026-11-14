# Stateless Responses API

Token Factory exposes the OpenAI-compatible `POST /v1/responses` endpoint. This
example deliberately uses **stateless** requests: send each request as an independent
first turn and keep any conversation history in your application.

## Run the example

Choose a model that is currently available in your Token Factory project. The
example intentionally has no hard-coded model fallback, because Public
Serverless availability changes over time.

```bash
export NEBIUS_API_KEY="..."
export NEBIUS_MODEL="your-current-model-id"
python api/responses/responses_stateless.py "Why are stateless APIs easy to retry?"
```

Add `--stream` to print streaming text deltas.

## Scope and validation

This example sets `store=False` and does not use `previous_response_id` or replay
provider response items. Its offline tests verify request construction and text-delta
handling; they do not establish the server's current support for conversation persistence.

Install dependencies with `python -m pip install -r api/responses/requirements.txt`.
Run offline tests with `python -m unittest discover -s api/responses -p "test_*.py"`.
Both normal and streaming runs call a paid API; no authenticated inference was run
for this refresh.

See the [Responses API reference](https://docs.tokenfactory.nebius.com/api-reference/inference/create-a-response).
