# Agent Cost Comparison 1 - Bug production

See the [project readme](../README.md) for benchmark

## Bug Production

`deepagents == 0.7.10` has a bug that causes Nemotron Ultra to fail.

how to reproduce

```bash
uv run python agent_cost_comparison_1_bug.py --data-dir ../data-1
```

You will see `Nemotron-3-Ultra-550b-a55b` failing the test.

## Workaround

The workaround is overriding the harness like this in [agent_cost_comparison_2_workaround.py](agent_cost_comparison_2_workaround.py)


```python
    # Register the Nemotron-3-Ultra harness profile override at runtime rather
    # than at import time, so importing the module does not mutate global state.
    register_harness_profile(
        HARNESS_PROFILE_MODEL,
        HarnessProfile(
            excluded_middleware={"NemotronPolicyNudgeMiddleware"},
        ),
    )
```

Run the fix

```bash
uv run python agent_cost_comparison_2_workaround.py --data-dir ../data-1
```

All tests pass.
