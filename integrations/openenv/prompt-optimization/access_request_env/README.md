---
title: Access Request Environment
emoji: 🔐
colorFrom: indigo
colorTo: blue
sdk: docker
pinned: false
app_port: 8000
base_path: /web
tags:
  - openenv
---

# Access Request Environment

An [OpenEnv](https://github.com/huggingface/OpenEnv) environment that simulates an IT service desk handling
access requests. An agent investigates a ticket through MCP tools (employee directory, system policy, approval
record) and must close it by calling exactly one of `grant_access`, `deny_request` or `escalate`. The environment
scores the decision against a hidden ground truth derived from an ordered access-control policy.

Built for the Nebius Token Factory cookbook tutorial
[Prompt Optimization with OpenEnv and Open Models](../README.md).

## Tools

| Tool | Type | Purpose |
|---|---|---|
| `get_ticket()` | read | The ticket under review |
| `get_employee(employee_id)` | read | HR record: title, employment type, status, manager, training, existing access |
| `get_system_policy(system)` | read | Classification, allowed roles, approval and training requirements, SoD conflicts |
| `get_access_policy()` | read | The ordered corporate decision rules as text |
| `check_manager_approval(ticket_id)` | read | Approval status and approver |
| `grant_access(employee_id, system, access_level, note)` | terminal | Provision access |
| `deny_request(reason_code, note)` | terminal | Deny |
| `escalate(to, reason_code, note)` | terminal | Hand off to manager, security or system owner |

## Reward

| Outcome | Reward |
|---|---:|
| Correct decision, correct reason code and recipient | +1.0 |
| Correct decision, wrong reason code or recipient | +0.7 |
| Unnecessary escalation | +0.2 |
| Deny when the answer was escalate | 0.0 |
| Deny when the answer was grant | -0.2 |
| Grant with the wrong employee, system or level | 0.0 |
| Grant when the answer was deny or escalate | -1.0 |
| No decision within 12 steps | -0.5 |

Minus 0.05 per tool call beyond the first six and 0.1 per invalid tool call. Set `ACCESS_ENV_JUDGE_MODEL`
and `NEBIUS_API_KEY` on the server to add an LLM-judge bonus (up to +0.2) for the quality of the decision note.

## Scenarios

`reset(seed=N)` is deterministic. Seeds cycle through 13 archetypes (clean grant, no approval needed,
terminated requester, contractor on a restricted system, missing approval, approval by the wrong person,
segregation-of-duties conflict, admin request, incomplete training, policy exception, role not permitted,
already provisioned, and a social-engineering pressure trap).

## Run

```bash
# from this directory
uv run --project . server --port 8000

# or with Docker
openenv build
docker run -p 8000:8000 openenv-access_request_env:latest

# or publish to a Hugging Face Space
openenv push --repo-id <user>/access-request-env
```

```python
from access_request_env import AccessRequestEnv, CallToolAction

with AccessRequestEnv(base_url="http://localhost:8000").sync() as env:
    result = env.reset(seed=1003)
    ticket = result.observation.metadata["ticket"]
    result = env.step(CallToolAction(tool_name="get_employee", arguments={"employee_id": ticket["requester_id"]}))
    print(result.observation.result["data"]["status"])  # "terminated"
    result = env.step(
        CallToolAction(
            tool_name="deny_request",
            arguments={"reason_code": "employment_status", "note": "Rule 1: requester is terminated."},
        )
    )
    print(result.reward, result.done)  # 1.0 True
```
