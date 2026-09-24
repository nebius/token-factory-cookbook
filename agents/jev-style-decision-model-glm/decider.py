"""A Jev-style typed decision model on top of GLM-5.3 Flash.

State goes in, typed decisions come out: each question returns one of the
answers you declared, with a probability read from the model's next-token
distribution rather than from generated text.
"""

from __future__ import annotations

import math
import os
import string
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from openai import OpenAI

DEFAULT_MODEL = "zai-org/GLM-5.3-Flash"
DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
TOP_LOGPROBS = 20


@dataclass(frozen=True)
class Question:
    name: str
    text: str
    options: tuple[str, ...]
    kind: str = "choice"  # "choice", "yes_no", or "score"

    @classmethod
    def choice(cls, name: str, text: str, options: list[str]) -> "Question":
        return cls(name, text, tuple(options), "choice")

    @classmethod
    def yes_no(cls, name: str, text: str) -> "Question":
        return cls(name, text, ("yes", "no"), "yes_no")

    @classmethod
    def score(cls, name: str, text: str, low: int = 1, high: int = 5) -> "Question":
        return cls(name, text, tuple(str(i) for i in range(low, high + 1)), "score")


@dataclass
class Decision:
    answer: str
    probability: float
    distribution: dict[str, float]
    coverage: float  # probability mass that landed on a declared answer
    expected: float | None = None  # score questions only
    extras: dict = field(default_factory=dict)


def build_prompt(state: str, question: Question, order: list[str]) -> str:
    """Render one question in GLM's non-thinking chat format.

    The raw prompt ends right after the assistant turn opens with thinking
    closed, so the very next token is the answer key.
    """
    if question.kind == "score":
        keys = order
        listing = f"Answer with a single number from {order[0]} to {order[-1]}."
    else:
        keys = list(string.ascii_uppercase[: len(order)])
        listing = "\n".join(f"{k}) {opt}" for k, opt in zip(keys, order))
        listing += "\n\nReply with only the letter."
    user = f"{state}\n\n{question.text}\n{listing}"
    return f"[gMASK]<sop><|user|>\n{user}<|assistant|>\n</think>"


def label_mass(top_logprobs: dict[str, float], question: Question, order: list[str]) -> dict[str, float]:
    """Map raw next-token logprobs onto the declared options.

    Tokens are matched by answer key ("A", " a") and by option text
    ("billing"), so probability the model splits across spellings is merged.
    """
    if question.kind == "score":
        keys = order
    else:
        keys = list(string.ascii_uppercase[: len(order)])
    mass = {opt: 0.0 for opt in question.options}
    for token, logprob in top_logprobs.items():
        t = token.strip().lower()
        for key, opt in zip(keys, order):
            if t == key.lower() or t == opt.lower():
                mass[opt] += math.exp(logprob)
                break
    return mass


def rotations(options: tuple[str, ...], k: int) -> list[list[str]]:
    """Cyclic shifts of the option list, so each option visits each position."""
    n = len(options)
    return [list(options[i:] + options[:i]) for i in range(min(k, n))]


def apply_temperature(dist: dict[str, float], temperature: float) -> dict[str, float]:
    scaled = {k: max(v, 1e-9) ** (1.0 / temperature) for k, v in dist.items()}
    total = sum(scaled.values())
    return {k: v / total for k, v in scaled.items()}


class Decider:
    def __init__(self, client: OpenAI | None = None, model: str | None = None,
                 rotations: int = 4, max_workers: int = 8):
        self.client = client or OpenAI(
            api_key=os.environ["NEBIUS_API_KEY"],
            base_url=os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL),
        )
        self.model = model or os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)
        self.k = rotations
        self.pool = ThreadPoolExecutor(max_workers=max_workers)
        self.temperatures: dict[str, float] = {}
        self.usage = {"requests": 0, "prompt_tokens": 0, "completion_tokens": 0}

    def _next_token(self, prompt: str) -> dict[str, float]:
        response = self.client.completions.create(
            model=self.model,
            prompt=prompt,
            max_tokens=1,
            temperature=0,
            logprobs=TOP_LOGPROBS,
        )
        self.usage["requests"] += 1
        if response.usage:
            self.usage["prompt_tokens"] += response.usage.prompt_tokens
            self.usage["completion_tokens"] += response.usage.completion_tokens
        return response.choices[0].logprobs.top_logprobs[0]

    def label_masses(self, state: str, question: Question) -> list[dict[str, float]]:
        """One next-token read per option ordering, mapped onto the options."""
        # Scores are ordinal, so their order stays fixed; choices are rotated.
        orders = [list(question.options)] if question.kind == "score" else rotations(question.options, self.k)
        raw = list(self.pool.map(lambda o: self._next_token(build_prompt(state, question, o)), orders))
        return [label_mass(r, question, o) for r, o in zip(raw, orders)]

    def combine(self, question: Question, masses: list[dict[str, float]]) -> Decision:
        coverage = sum(sum(m.values()) for m in masses) / len(masses)
        # Average the renormalized distribution from each ordering.
        dist = {opt: 0.0 for opt in question.options}
        for m in masses:
            total = sum(m.values()) or 1.0
            for opt, p in m.items():
                dist[opt] += p / total / len(masses)
        if question.name in self.temperatures:
            dist = apply_temperature(dist, self.temperatures[question.name])

        answer = max(dist, key=dist.get)
        expected = None
        if question.kind == "score":
            expected = sum(int(k) * v for k, v in dist.items())
        return Decision(answer, dist[answer], dist, coverage, expected)

    def decide(self, state: str, questions: list[Question]) -> dict[str, Decision]:
        """Answer every question about one piece of state, in parallel."""
        with ThreadPoolExecutor(max_workers=len(questions)) as outer:
            results = outer.map(lambda q: self.combine(q, self.label_masses(state, q)), questions)
            return {q.name: d for q, d in zip(questions, results)}

    def calibrate(self, question: Question, distributions: list[dict[str, float]], labels: list[str]) -> float:
        """Fit one temperature per question by minimizing log loss on labeled data."""
        best_t, best_nll = 1.0, float("inf")
        for step in range(5, 501):
            t = step / 100
            nll = -sum(math.log(max(apply_temperature(d, t)[y], 1e-12)) for d, y in zip(distributions, labels))
            if nll < best_nll:
                best_t, best_nll = t, nll
        self.temperatures[question.name] = best_t
        return best_t
