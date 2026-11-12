"""A tiny deterministic smoke task for Token Factory model evaluations."""

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.model import GenerateConfig
from inspect_ai.scorer import match
from inspect_ai.solver import generate, system_message


@task
def token_factory_smoke() -> Task:
    """Check two simple outputs with a deterministic dataset and scorer."""

    return Task(
        dataset=[
            Sample(
                id="addition",
                input="What is 19 + 23? Return only the integer.",
                target="42",
            ),
            Sample(
                id="lowercase",
                input='Return the words "TOKEN FACTORY" in lowercase and nothing else.',
                target="token factory",
            ),
        ],
        solver=[
            system_message("Follow the requested output format exactly."),
            generate(),
        ],
        scorer=match(location="exact", ignore_case=False),
        config=GenerateConfig(temperature=0),
    )
