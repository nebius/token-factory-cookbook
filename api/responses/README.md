# Stateless Responses API

Token Factory exposes the OpenAI-compatible `POST /v1/responses` endpoint. The
current supported contract is **stateless**: send each request as an independent
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

## Current negative contract

Do not use `previous_response_id` for server-side conversation continuation, and
do not replay prior assistant `output_text` or `reasoning_text` response items as
new input. Those stateful patterns are not supported by the current Token
Factory implementation even though fields may appear in the generated API
schema.

The optional probe below makes a second, billable request and passes only when
`previous_response_id` is rejected with a client error:

```bash
python api/responses/responses_stateless.py --probe-unsupported
```

If that probe starts succeeding, the API contract has changed. Update this guide
and its tests before recommending stateful usage.

See the [Responses API reference](https://docs.tokenfactory.nebius.com/api-reference/inference/create-a-response).
