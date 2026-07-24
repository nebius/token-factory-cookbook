# Using Token Factory Models with Coding Agents

Token Factory has integrations with many coding agents and allows you to run state of the art open source models.

Checkout [all coding integrations](https://docs.tokenfactory.nebius.com/integrations/overview#coding-assistants) for instrcutions

## Cursor

[instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cursor)

demo:

 [![Alt text](https://img.youtube.com/vi/wsLn2vZdrHw/0.jpg)](https://www.youtube.com/watch?v=wsLn2vZdrHw)


## Cline

[instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cline)

demo:

[![Alt text](https://img.youtube.com/vi/q-oCalBP6lk/0.jpg)](https://www.youtube.com/watch?v=q-oCalBP6lk)


## Claude Code

### Using Claude Code with Proxy Server

[Claude proxy server](https://github.com/KiranChilledOut/claude-code-proxy)

Follow the instructions there.

Recommended coding models on Token Factory (as of March 2026)
- `zai-org/GLM-5.1`
- `zai-org/GLM-4.7-FP8`
- `Qwen/Qwen3-Coder-480B-A35B-Instruct`

#### Sample `.env` file for `Qwen/Qwen3-Coder-480B-A35B-Instruct`


```text
OPENAI_API_KEY="your key goes here"

ANTHROPIC_API_KEY="dummy"

IGNORE_CLIENT_API_KEY=true

OPENAI_BASE_URL=https://api.tokenfactory.nebius.com/v1

BIG_MODEL=Qwen/Qwen3-Coder-480B-A35B-Instruct

MIDDLE_MODEL=Qwen/Qwen3-Coder-480B-A35B-Instruct

SMALL_MODEL=Qwen/Qwen3-Coder-480B-A35B-Instruct

VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct

# Optional: explicit context limits (tokens) for safer max_tokens auto-capping
BIG_MODEL_CONTEXT_LIMIT=204800
MIDDLE_MODEL_CONTEXT_LIMIT=204800
SMALL_MODEL_CONTEXT_LIMIT=204800
VISION_MODEL_CONTEXT_LIMIT=32768
STRIP_IMAGE_CONTEXT=true

HOST=0.0.0.0
PORT=8083
LOG_LEVEL=INFO #DEBUG

## testing this
MAX_TOKENS_LIMIT=64000
#MIN_TOKENS_LIMIT=4096
REQUEST_TIMEOUT=90
MAX_RETRIES=2
```