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

Add `--stream` to print streaming text deltas. A successful run requires a
completed response; failed, incomplete, or interrupted responses exit with a
nonzero status. Streaming can print partial text before an error, so check the
exit status before treating that text as a complete answer.

## Scope and validation

This example sets `store=False` and does not use `previous_response_id` or replay
provider response items. Its offline tests exercise the real SDK with mocked HTTP
and streaming responses, including failed and truncated streams. They do not
establish the server's current support for conversation persistence.

Install dependencies with `python -m pip install -r api/responses/requirements.txt`
(OpenAI Python SDK 1.66.3 or newer, below 3).
Run offline tests with `python -m unittest discover -s api/responses -p "test_*.py"`.
Both normal and streaming runs call a paid API. On November 12, 2026, both paths
were verified against Token Factory with `Qwen/Qwen3-30B-A3B-Instruct-2507`.
Model availability still depends on your project and can change.

See the [Responses API reference](https://docs.tokenfactory.nebius.com/api-reference/inference/create-a-response).
