# Using Token Factory Models with Coding Agents

Token Factory has integrations with many coding agents and allows you to run state-of-the-art open-source models.

Check out [all coding integrations](https://docs.tokenfactory.nebius.com/integrations/overview#coding-assistants) for instructions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Top Coding Models @ Token Factory](#top-coding-models-token-factory)
- [Coding Agent Integrations](#coding-agent-integrations)
- [Cursor](#cursor)
- [Cline](#cline)
- [Claude Code](#claude-code)
- [Codex](#codex)
- [OpenCode](#opencode)
- [Qwen Code](qwen-code/)

## Prerequisites

- A [Token Factory](https://tokenfactory.nebius.com/) account and API key.
- A supported coding agent installed (Cursor, Cline, Claude Code, Codex, or OpenCode).

## Top Coding Models @ Token Factory

| Model | Context Window | Parameters |
| --- | --- | --- |
| `moonshotai/Kimi-K2.7-Code` | 256K | 1T (32B active) |
| `zai-org/GLM-5.2` | 1M | 753B |
| `moonshotai/Kimi-K3` | 1M | 2.8T (104B active) |
| `MiniMaxAI/MiniMax-M3` | 1M | 428B (23B active) |

## Coding Agent Integrations

| Agent | Integration | Notes |
| --- | --- | --- |
| Cursor | Native | [notes](#cursor) |
| Cline | Native | [notes](#cline) |
| Claude Code | via Proxy | [notes](#claude-code) |
| Codex | via Proxy | [notes](#codex) |
| OpenCode | Native | [notes](#opencode) |
| Qwen Code | OpenAI-compatible custom provider | [setup recipe](qwen-code/) |


## Cursor

Native integration.

- [instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cursor)
- [🎥 howto video](https://www.youtube.com/watch?v=wsLn2vZdrHw)


## Cline

Native integration.

- [instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cline)
- [🎥 howto video](https://www.youtube.com/watch?v=q-oCalBP6lk)


## Claude Code

### Using Claude Code with Proxy Server

Integrates using the following proxies:

- [Claude Codex proxy server](https://github.com/KiranChilledOut/claude-codex-nebius-proxy)
- [Nebius TF Relay](https://nebius-tf-relay.vercel.app/)  .   [how to video](https://www.youtube.com/watch?v=u8c_exTe2To)


## Codex

Integrates using the following proxies:

- [Claude Codex proxy server](https://github.com/KiranChilledOut/claude-codex-nebius-proxy)
- [Nebius TF Relay](https://nebius-tf-relay.vercel.app/)

## OpenCode

Native integration with Token Factory!
- [🎥 howto video](https://www.youtube.com/watch?v=216_T--JE0k)

Optionally, you can use this proxy: [Nebius TF Relay](https://nebius-tf-relay.vercel.app/)

## Qwen Code

Qwen Code supports Token Factory through its existing OpenAI-compatible custom-provider configuration. No adapter or proxy is required.

- [setup and offline configuration checks](qwen-code/)
