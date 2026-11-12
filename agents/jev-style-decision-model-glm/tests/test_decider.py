import math
import re
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402
from decider import Decider, Question, apply_temperature, build_prompt, label_mass, rotations  # noqa: E402


class FakeCompletions:
    """Answers with the letter that sits next to `favorite` in the prompt."""

    def __init__(self, favorite="billing", first_letter_bias=0.0):
        self.favorite = favorite
        self.bias = first_letter_bias
        self.prompts = []

    def create(self, model, prompt, max_tokens, temperature, logprobs):
        self.prompts.append(prompt)
        match = re.search(rf"([A-Z])\) {self.favorite}\b", prompt)
        if match:
            key = match.group(1)
            top = {key: math.log(0.8 - self.bias), "A": math.log(0.1 + self.bias), "The": math.log(0.1)}
            if key == "A":
                top = {"A": math.log(0.9), "The": math.log(0.1)}
        elif "yes" in self.favorite:
            top = {"A": math.log(0.95), "B": math.log(0.05)}
        else:  # score question
            top = {"4": math.log(0.6), "5": math.log(0.3), "3": math.log(0.1)}
        choice = SimpleNamespace(logprobs=SimpleNamespace(top_logprobs=[top]))
        return SimpleNamespace(choices=[choice], usage=SimpleNamespace(prompt_tokens=50, completion_tokens=1))


def fake_client(**kwargs):
    return SimpleNamespace(completions=FakeCompletions(**kwargs))


ROUTE = Question.choice("team", "Which team?", ["billing", "technical", "sales"])


def test_prompt_ends_on_the_answer_token():
    prompt = build_prompt("Ticket: hi", ROUTE, ["billing", "technical", "sales"])
    assert prompt.startswith("[gMASK]<sop><|user|>")
    assert prompt.endswith("<|assistant|>\n</think>")
    assert "A) billing\nB) technical\nC) sales" in prompt


def test_label_mass_merges_keys_and_option_text():
    top = {" A": math.log(0.5), "a": math.log(0.1), "billing": math.log(0.2), "The": math.log(0.2)}
    mass = label_mass(top, ROUTE, ["billing", "technical", "sales"])
    assert math.isclose(mass["billing"], 0.8)
    assert mass["technical"] == 0.0


def test_rotations_put_every_option_in_every_position():
    orders = rotations(("a", "b", "c"), 3)
    for position in range(3):
        assert {order[position] for order in orders} == {"a", "b", "c"}


def test_rotation_cancels_first_position_bias():
    decider = Decider(client=fake_client(favorite="sales", first_letter_bias=0.3), model="m", rotations=3)
    one = decider.combine(ROUTE, decider.label_masses("Ticket: x", ROUTE)[:1])
    decider.k = 3
    three = decider.decide("Ticket: x", [ROUTE])["team"]
    assert three.answer == "sales"
    assert three.distribution["billing"] < one.distribution["billing"]


def test_decide_returns_typed_answers_for_each_question_kind():
    decider = Decider(client=fake_client(favorite="billing"), model="m")
    urgent = Question.yes_no("urgent", "Blocked?")
    mood = Question.score("mood", "How upset?")
    result = decider.decide("Ticket: x", [ROUTE, urgent, mood])
    assert result["team"].answer == "billing"
    assert result["team"].answer in ROUTE.options
    assert math.isclose(sum(result["team"].distribution.values()), 1.0)
    assert result["mood"].answer == "4"
    assert math.isclose(result["mood"].expected, 4.2)
    assert decider.usage["requests"] == 3 + 2 + 1


def test_temperature_sharpens_or_softens():
    dist = {"a": 0.6, "b": 0.4}
    assert apply_temperature(dist, 0.5)["a"] > 0.6
    assert apply_temperature(dist, 2.0)["a"] < 0.6


def test_calibrate_softens_an_overconfident_model():
    decider = Decider(client=fake_client(), model="m")
    dists = [{"billing": 0.99, "technical": 0.005, "sales": 0.005}] * 10
    labels = ["billing"] * 7 + ["technical"] * 3
    assert decider.calibrate(ROUTE, dists, labels) > 1.0


def test_app_prints_the_decision_marker(monkeypatch, capsys):
    monkeypatch.setattr(app, "Decider", lambda: Decider(client=fake_client(favorite="technical"), model="m"))
    monkeypatch.setattr(sys, "argv", ["app.py", "The API is down."])
    app.main()
    out = capsys.readouterr().out
    assert "Decision: route to technical" in out
