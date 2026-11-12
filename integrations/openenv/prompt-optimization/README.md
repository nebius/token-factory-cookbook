# Prompt Optimization with OpenEnv and Open Models

*Tune an IT access-request agent against environment rewards on Nebius Token Factory, no fine-tuning required.*

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/integrations/openenv/prompt-optimization/prompt_optimization_openenv.ipynb)

- [Prompt Optimization with OpenEnv and Open Models](#prompt-optimization-with-openenv-and-open-models)
  - [What you will build](#what-you-will-build)
  - [Why this matters for enterprise agents](#why-this-matters-for-enterprise-agents)
  - [1. Setup](#1-setup)
  - [2. The environment](#2-the-environment)
  - [3. Serve it and connect a client](#3-serve-it-and-connect-a-client)
  - [4. A Token Factory model as the policy](#4-a-token-factory-model-as-the-policy)
  - [5. Optimize the prompt against the reward](#5-optimize-the-prompt-against-the-reward)
  - [6. Results](#6-results)
  - [7. Optional: a Token Factory LLM judge inside the environment](#7-optional-a-token-factory-llm-judge-inside-the-environment)
  - [8. Ship the environment](#8-ship-the-environment)
  - [9. Where to go next](#9-where-to-go-next)
  - [Project layout](#project-layout)
  - [References](#references)

## What you will build

[OpenEnv](https://github.com/huggingface/OpenEnv) is an e2e framework for creating, deploying and using isolated
execution environments for agentic RL training, built using Gymnasium style simple APIs.
[Nebius Token Factory](https://tokenfactory.nebius.com/) serves open models behind an OpenAI-compatible API.

In this tutorial you will:

1. **Build** an OpenEnv environment that simulates an IT service desk handling access requests. The agent
   investigates a ticket through MCP tools and must grant, deny or escalate. Reward is computed inside the
   environment from an ordered access-control policy.
2. **Serve** the environment, connect the typed client, step through an episode by hand.
3. **Plug in** a Token Factory model (GLM-5.3-Flash by default) as the policy through tool calling.
4. **Optimize** the system prompt with a reflective loop: run episodes, hand the failures to a stronger Token
   Factory model, let it rewrite the prompt, keep what scores higher, repeat.
5. **Verify** on held-out scenarios and on other models, and optionally add a Token Factory LLM judge as an
   OpenEnv `Rubric`.

Everything runs on a laptop. No GPU, no training job.

![The prompt optimization loop: the policy model runs the agent with prompt v_n against the OpenEnv environment, low-reward episodes go to the reflector model, which writes prompt v_n+1, re-evaluated on the same seeds and kept only if the mean reward improves; results strip shows the measured before/after on held-out tickets](images/architecture.svg)

### OpenEnv components used in this tutorial

| OpenEnv piece | Where | What it does here |
|---|---|---|
| `openenv init` package layout, `openenv.yaml` manifest | `access_request_env/` | Standard environment package that `openenv validate` / `build` / `push` understand |
| `MCPEnvironment` + FastMCP tools (RFC 003) | `server/access_request_environment.py` | The seven tools (eight with `ACCESS_ENV_POLICY_TOOL=1`) are the agent's action space; agents act with `CallToolAction`, discover tools with `ListToolsAction` |
| `reset(seed)` / `step()` / `state()` with a custom `State` | same file, `models.py` | Seeded, reproducible episodes; the terminal step carries the reward and reveals the ground truth |
| `create_app` (HTTP + WebSocket + `/web` UI) | `server/app.py` | Serves the environment with 16 concurrent sessions, one per parallel episode |
| `MCPToolClient` typed client and `.sync()` wrapper | `client.py`, `agent.py` | The Token Factory agent connects, lists tools, and steps through the WebSocket session |
| `Rubric`, `LLMJudge`, `OpenAIClient` (RFC 004) | `NoteQualityJudge` | A Token Factory model as an in-environment judge that adds to the reward |
| `openenv validate` / `openenv build` / `openenv push` | section 8 | Ship the same environment as a Docker image or a Hugging Face Space |

## Why this matters for enterprise agents

- **The policy lives in the prompt.** Enterprise agents follow runbooks and policies that are not in any API.
  Encoding them well is the difference between an agent that grants access to a terminated contractor and one
  that escalates properly.
- **Policy changes on Monday, redeploy Monday afternoon.** Change the environment's rules, re-run the optimizer,
  ship the new prompt. No fine-tuning job to schedule and certify.
- **Model migration without retraining.** When a new model lands on Token Factory, re-run the optimizer against
  it and get a prompt tuned to that model, with a score to prove it.
- **Auditability.** Every prompt version comes with a reward, the seeds it was evaluated on, and the trajectories
  that produced it.
- **Safe by construction.** The environment mocks the systems of record. Hundreds of episodes touch nothing real.

## 1. Setup

```bash
git clone https://github.com/nebius/token-factory-cookbook.git
cd token-factory-cookbook/integrations/openenv/prompt-optimization
uv sync --all-groups
cp env.example .env         # add your NEBIUS_API_KEY
uv run pytest -q            # 376 deterministic tests for the environment, no API calls
```

The project and the environment package both pin `openenv==0.4.1` (the PyPI package was renamed from `openenv-core`;
the API is moving fast). Python 3.10 or newer.

## 2. The environment

`access_request_env/` has the layout `openenv init` generates:

```
access_request_env/
├── openenv.yaml                       # manifest for openenv build / push
├── models.py                          # AccessRequestState (+ re-exported MCP action/observation types)
├── client.py                          # AccessRequestEnv(MCPToolClient)
├── pyproject.toml, uv.lock, README.md # installable package + Hugging Face Space card
└── server/
    ├── scenarios.py                   # deterministic ticket generator + policy engine (ground truth)
    ├── access_request_environment.py  # AccessRequestEnvironment(MCPEnvironment): tools + reward
    ├── app.py                         # FastAPI app via openenv.core.create_app
    └── Dockerfile
```

### Tools

The environment subclasses OpenEnv's `MCPEnvironment`. Tools are plain Python functions registered on a FastMCP
server; the agent calls them through `CallToolAction` and the type hints become the tool schema.

| Tool | Kind | Returns |
|---|---|---|
| `get_ticket()` | read | The ticket under review |
| `get_employee(employee_id)` | read | Title, employment type, status, manager, completed training, existing access |
| `get_system_policy(system)` | read | Classification, allowed roles per level, approval and training requirements, SoD conflicts |
| `check_manager_approval(ticket_id)` | read | Approval status and approver |
| `grant_access(employee_id, system, access_level, note)` | terminal | Provisions access, ends the episode |
| `deny_request(reason_code, note)` | terminal | Denies, ends the episode |
| `escalate(to, reason_code, note)` | terminal | Hands off to `manager`, `security` or `system_owner`, ends the episode |

By default the ordered decision rules are **not** readable through a tool. The agent sees per-system facts but has
to be told the procedure (rule order, what makes an approval valid, when a role mismatch is an exception versus a
denial, where to escalate). That procedure is what prompt optimization discovers. Start the server with
`ACCESS_ENV_POLICY_TOOL=1` to expose the policy text as a `get_access_policy` tool ("easy mode"); with it,
GLM-5.3-Flash scores 100% out of the box, which is a useful sanity check that the environment is consistent.

### Scenarios

`reset(seed=N)` is deterministic. Seeds cycle through 13 archetypes: clean grant, no approval needed, terminated
requester, contractor on a restricted system, missing approval, approval by the wrong person, segregation-of-duties
conflict, admin request, incomplete training, policy exception, role not permitted, already provisioned, and a
social-engineering pressure trap ("the CFO needs this by end of day"). Seeds 1001 to 1026 are the training set,
5005 to 5030 the held-out set; both start on a multiple of 13 so each covers every archetype twice.

### Reward

| Outcome | Reward |
|---|---:|
| Correct decision with the right reason code / recipient | +1.0 |
| Correct decision, wrong reason code or recipient | +0.7 |
| Unnecessary escalation | +0.2 |
| Deny when the answer was escalate | 0.0 |
| Deny when the answer was grant | -0.2 |
| Grant to the wrong employee / system / level | 0.0 |
| **Grant when the answer was deny or escalate** | **-1.0** |
| No decision within 12 steps | -0.5 |

minus 0.05 per tool call beyond the first six and 0.1 per invalid tool call. Wrong grants are the security failure,
so they dominate. The reward is computed in the environment's `step()`; the agent only reads it back, and the
ground truth is revealed in the terminal observation's metadata so an optimizer can learn from it afterwards.

## 3. Serve it and connect a client

OpenEnv environments are FastAPI servers. `openenv serve` is still a placeholder in 0.4.x, so run the app directly
(`env_server.py` wraps this for the notebook and the CLI scripts):

```bash
uv run python -m access_request_env.server.app --host 127.0.0.1 --port 8010
# web UI: http://127.0.0.1:8010/web   OpenAPI: http://127.0.0.1:8010/docs
```

The client is async by default; `.sync()` gives a blocking wrapper:

```python
from access_request_env import AccessRequestEnv, CallToolAction, tool_payload

with AccessRequestEnv(base_url="http://127.0.0.1:8010").sync() as env:
    result = env.reset(seed=1003)  # archetype: terminated requester
    ticket = result.observation.metadata["ticket"]
    print([t.name for t in env.list_tools()])

    r = env.step(CallToolAction(tool_name="get_employee", arguments={"employee_id": ticket["requester_id"]}))
    print(tool_payload(r.observation)["status"], r.reward, r.done)  # terminated 0.0 False

    r = env.step(
        CallToolAction(
            tool_name="deny_request",
            arguments={
                "reason_code": "employment_status",
                "note": "Rule 1: HR record shows the requester is terminated.",
            },
        )
    )
    print(r.reward, r.done, r.observation.metadata["outcome"])  # 1.0 True correct_deny
```

## 4. A Token Factory model as the policy

[agent.py](agent.py) is the whole agent in one function. `run_episode` resets the environment, converts the MCP
tool manifest to OpenAI function-calling schemas, and loops "model picks a tool, `env.step(CallToolAction)`, feed
the result back" until the environment reports `done`. `run_batch` runs seeds in parallel, one WebSocket session
each.

```python
from openai import OpenAI

llm = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1", api_key=os.environ["NEBIUS_API_KEY"])
tools = mcp_tools_to_openai(env.list_tools())

response = llm.chat.completions.create(
    model="zai-org/GLM-5.3-Flash",
    messages=messages,
    tools=tools,
    tool_choice="auto",
)
for tc in response.choices[0].message.tool_calls:
    action = CallToolAction(tool_name=tc.function.name, arguments=json.loads(tc.function.arguments))
    step = env.step(action)
```

The baseline system prompt is deliberately the kind of thing a team writes on day one
([prompts/baseline.md](prompts/baseline.md)):

> You are an IT service desk agent handling access requests. Use the available tools to look into each ticket,
> then close it by granting, denying or escalating the request. Be helpful and efficient.

```bash
uv run python agent.py --start-server --prompt baseline --n 13 --model zai-org/GLM-5.3-Flash
```

## 5. Optimize the prompt against the reward

[optimize.py](optimize.py) implements a reflective loop, the idea behind optimizers such as GEPA, written out in
about a hundred lines so every step is visible:

1. Evaluate the current best prompt on the training seeds.
2. Collect imperfect episodes (reward below 1): ticket, tool trace, the agent's decision and the ground truth the
   environment revealed.
3. Ask a stronger Token Factory model (the **reflector**, Kimi K3 by default) to diagnose the failures and write a
   better system prompt. It must stay general (no ticket ids or names) and may only reference tools that exist.
4. Evaluate the candidate on the same seeds. Keep it if the mean reward improves. Repeat for a few rounds.
5. Compare baseline and best prompt on **held-out seeds** the optimizer never saw.

```bash
uv run python optimize.py --start-server \
    --policy-model zai-org/GLM-5.3-Flash --reflector-model moonshotai/Kimi-K3 \
    --n-train 26 --n-holdout 26 --rounds 3 --candidates 2
```

What OpenEnv contributes here: seeded `reset()` gives identical scenario batches for every candidate, the
`StepResult.reward` is a trajectory-level score with no separate grader to build, and the sandbox means hundreds of
episodes cost API tokens and nothing else. The optimizer writes `results/optimization_run.json` (every candidate,
its diagnosis and its scores) and `prompts/optimized.md`.

## 6. Results

All numbers below come from the real run recorded in [results/](results/) (GLM-5.3-Flash as policy, Kimi K3 as
reflector, 26 training seeds, 26 held-out seeds, temperature 0 for the policy).

### Optimizing for GLM-5.3-Flash

| | Training seeds (26) | Held-out seeds (26) |
|---|---:|---:|
| Baseline prompt | 0.923 mean reward, 92% correct | 0.885 mean reward, 88% correct |
| Optimized prompt | **1.000, 100%** | **1.000, 100%** |

The optimizer needed one round. The baseline agent failed the same way every time: when the requester's role
was not on the allowed list but they had a valid manager approval and a named project in the justification, the
agent denied instead of escalating as a policy exception. The reflector's diagnosis, verbatim from
`results/optimization_run.json`:

> Both failures are the same pattern: the requester's role is not in `allowed_roles`, every other check passes,
> and the agent denied with `role_not_permitted`, but the correct action was escalate to system_owner with
> `policy_exception`. [...] The agent even wrote in its denial notes that an exception "would need to go through
> the system owner": it identified the right path but closed the ticket instead of escalating it.

From two failures and thirteen contrasting successes the reflector wrote a 516-word prompt
([prompts/optimized.md](prompts/optimized.md)) that reconstructs the ordered decision procedure, including the
approval validity rule and the escalation routing, and tells the agent to skip the approval lookup once a
deny or escalate outcome is already determined. Tool calls per episode dropped from 4.7 to 4.2.

### Does the prompt transfer to other models?

Same held-out seeds, both prompts, three Token Factory models (`python evaluate.py`):

| Model | Prompt | Mean reward | Decision accuracy | Unauthorized grants | Unnecessary escalations | Tool calls / episode | Tokens / episode |
|---|---|---:|---:|---:|---:|---:|---:|
| zai-org/GLM-5.3-Flash | baseline | 0.885 | 88% | 0 | 0 | 4.7 | 4,289 |
| zai-org/GLM-5.3-Flash | optimized | 1.000 | 100% | 0 | 0 | 4.2 | 5,420 |
| MiniMaxAI/MiniMax-M3 | baseline | 0.923 | 92% | 0 | 0 | 5.0 | 3,986 |
| MiniMaxAI/MiniMax-M3 | optimized | 1.000 | 100% | 0 | 0 | 4.2 | 5,976 |
| Qwen/Qwen3-30B-A3B-Instruct-2507 | baseline | -0.031 | 42% | 10 | 1 | 5.2 | 9,307 |
| Qwen/Qwen3-30B-A3B-Instruct-2507 | optimized | 0.250 | 54% | 5 | 0 | 5.0 | 11,428 |

- **MiniMax-M3** was already strong and the GLM-optimized prompt takes it to 100% as well.
- **Qwen3-30B-A3B-Instruct** is a much weaker agent for this task: with the baseline prompt it grants access it
  should not in 10 of 26 cases, and in 3 more it stops calling tools and answers in prose. The GLM-optimized
  prompt helps (unauthorized grants 10 to 5) but is far from enough.

### Optimizing per model

Running the optimizer again with Qwen3-30B-A3B as the policy (`--policy-model Qwen/Qwen3-30B-A3B-Instruct-2507`,
results in [results/qwen3-30b-a3b/](results/qwen3-30b-a3b/), prompt in
[prompts/optimized_qwen3-30b-a3b.md](prompts/optimized_qwen3-30b-a3b.md)):

| Qwen3-30B-A3B-Instruct | Training seeds (26) | Held-out seeds (26) |
|---|---:|---:|
| Baseline prompt | -0.019 mean reward, 46% correct, 11 unauthorized grants | 0.044, 46%, 9 unauthorized grants |
| Prompt optimized on GLM-5.3-Flash | | 0.250, 54%, 5 unauthorized grants |
| Prompt optimized on Qwen3-30B itself | 0.404, 65%, 4 unauthorized grants | **0.650, 77%, 3 unauthorized grants** |

Two takeaways. First, prompts are model-specific: the prompt tuned on the model you deploy beats a prompt tuned
on another model by a wide margin. Second, the environment tells you honestly when prompting is not enough. Three
unauthorized grants in 26 tickets is not production quality, and the optimizer plateaued after round one. For
this model the next step is fine-tuning on high-reward trajectories, which the same environment can generate.

### Reading the numbers

- 26 held-out seeds is two tickets per scenario type. One episode is 0.038 of mean reward, so differences smaller
  than that are noise. GLM-5.3-Flash at temperature 0 still varies by about one episode between runs.
- Rewards are computed by the environment from ground truth. No LLM judge was involved in these numbers (the
  optional judge in section 7 was off).
- The full GLM run (baseline, two candidates, two held-out passes) took about 25 minutes with 8 parallel episodes,
  bounded by GLM's reasoning latency of 60 to 90 seconds per episode. Qwen3-30B episodes take about 10 seconds.

## 7. Optional: a Token Factory LLM judge inside the environment

OpenEnv's `Rubric` abstraction (RFC 004) is how environments compose reward functions, and it ships an `LLMJudge`.
`NoteQualityJudge` in `access_request_environment.py` subclasses it to score the agent's decision note (does it
name the rule and cite the evidence?) and adds up to +0.2 reward. It talks to Token Factory through OpenEnv's own
`OpenAIClient`. It is off by default so optimization runs are fully deterministic; enable it on the server:

```bash
ACCESS_ENV_JUDGE_MODEL=zai-org/GLM-5.3-Flash uv run python -m access_request_env.server.app --port 8010
```

## 8. Ship the environment

The environment is a standard OpenEnv package, so the rest of the toolchain applies unchanged:

```bash
cd access_request_env
openenv validate                                     # [OK] ready for multi-mode deployment
openenv build                                        # Docker image openenv-access_request_env:latest
docker run -p 8000:8000 openenv-access_request_env:latest
openenv push --repo-id <user>/access-request-env     # publish as a Hugging Face Space
```

For real enterprise data you would run the same image privately, for example on a Nebius VM or Kubernetes,
instead of a public Space.

## 9. Where to go next

- **Change the policy, re-optimize, redeploy.** Edit `ACCESS_POLICY_TEXT` and `decide()` in
  `access_request_env/server/scenarios.py`, add a scenario archetype, run `optimize.py` again.
- **Reinforcement learning.** The same environment plugs into TRL's GRPO trainer through OpenEnv's integration,
  with a Token Factory model as the judge. See the [OpenEnv docs](https://huggingface.co/docs/openenv).
- **Distillation.** Use the optimized prompt with a strong model to sample high-reward trajectories, then fine-tune
  a smaller model on Token Factory with the [fine-tuning example](https://github.com/nebius/token-factory-cookbook/tree/main/post-training/fine-tuning-1).

## Project layout

```
prompt-optimization/
├── README.md                          # this tutorial
├── prompt_optimization_openenv.ipynb  # notebook version, executed end to end
├── images/architecture.svg            # architecture diagram
├── access_request_env/                # the OpenEnv environment package
├── agent.py                           # Token Factory policy: run_episode / run_batch
├── optimize.py                        # reflective prompt optimizer
├── evaluate.py                        # compare prompts across models on held-out seeds
├── env_server.py                      # start/stop the env server locally
├── prompts/                           # baseline.md, optimized.md (GLM run), optimized_qwen3-30b-a3b.md
├── results/                           # per-episode summaries behind the README numbers (compact; --full-trajectories keeps tool traces)
├── tests/test_environment.py          # deterministic environment tests
└── pyproject.toml, uv.lock, env.example
```

## References

- [OpenEnv on GitHub](https://github.com/huggingface/OpenEnv) and [docs](https://huggingface.co/docs/openenv)
- [OpenEnv RFC 003: MCP tool environments](https://github.com/huggingface/OpenEnv/tree/main/rfcs) and RFC 004: Rubrics
- [Nebius Token Factory](https://tokenfactory.nebius.com/) and [API docs](https://docs.tokenfactory.nebius.com/)
- [GEPA: Reflective Prompt Evolution](https://arxiv.org/abs/2507.19457), the optimizer family this loop is modeled on
