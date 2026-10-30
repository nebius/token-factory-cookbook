[Cookbook](../README.md) / Coding agents

# Using Token Factory Models with Coding Agents

Token Factory has integrations with many coding agents and allows you to run state-of-the-art open-source models.

References:

- Check out [integrations docs](https://docs.tokenfactory.nebius.com/integrations/overview).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Top Coding Models @ Token Factory](#top-coding-models--token-factory)
- [Coding Agent Integrations](#coding-agent-integrations)
  - [Cursor](#cursor)
  - [Cline](#cline)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
  - [OpenCode](#opencode)
- [Proxies](#proxies)

## Prerequisites

- A [Token Factory](https://tokenfactory.nebius.com/) account and API key.
- A supported coding agent installed (Cursor, Cline, Claude Code, Codex, or OpenCode).

## Top Coding Models @ Token Factory

| Model | Context Window | Parameters |
| --- | --- | --- |
| `zai-org/GLM-5.3-Flash` | 1 M | 320 B (18 B active) |
| `moonshotai/Kimi-K3` | 1M | 2.8T (104B active) |
| `moonshotai/Kimi-K2.7-Code` | 256K | 1T (32B active) |
| `zai-org/GLM-5.2` | 1M | 753B (17B active) |
| `MiniMaxAI/MiniMax-M3` | 1M | 428B (23B active) |

## Coding Agent Integrations


| Coding Agent | Native support | Add as a provider | via proxy | Instructions |
| --- | --- | --- | --- | --- |
| Cursor | - | ✅ | ✅ | [instructions](#cursor) |
| Cline | ✅ | ✅ | ✅ | [instructions](#cline) |
| Claude Code | - | - | ✅ | [instructions](#claude-code) |
| Codex | - | - | ✅ | [instructions](#codex) |
| OpenCode | ✅ | ✅ | ✅ | [instructions](opencode.md) |


## Cursor

Native integration.

- [instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cursor)
- [🎥 howto video](https://www.youtube.com/watch?v=wsLn2vZdrHw)


## Cline

Native integration.

- [instructions](https://docs.tokenfactory.nebius.com/integrations/coding/cline)
- [🎥 howto video](https://www.youtube.com/watch?v=q-oCalBP6lk)


## Claude Code

Integrates using the following proxies:

- [Claude Codex proxy server](https://github.com/KiranChilledOut/claude-codex-nebius-proxy)
- [Nebius TF Relay](https://nebius-tf-relay.vercel.app/) — [how to video](https://www.youtube.com/watch?v=u8c_exTe2To)


## Codex

Integrates using the following proxies:

- [Claude Codex proxy server](https://github.com/KiranChilledOut/claude-codex-nebius-proxy)
- [Nebius TF Relay](https://nebius-tf-relay.vercel.app/)

## OpenCode

See the [OpenCode integration guide](opencode.md) — setup walkthrough with screenshots, model picker, and what one real agent run costs.

## Proxies

These proxies support connecting coding agents to Token Factory.

| Proxy | Supports | Link |
| --- | --- | --- |
| Claude Codex proxy server | Claude Code, Codex | [GitHub](https://github.com/KiranChilledOut/claude-codex-nebius-proxy) |
| Nebius TF Relay | Claude Code, Codex, OpenCode | [Nebius TF Relay](https://nebius-tf-relay.vercel.app/) · [how to video](https://www.youtube.com/watch?v=u8c_exTe2To) |

