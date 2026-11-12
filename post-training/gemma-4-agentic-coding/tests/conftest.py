"""Shared fakes for the offline tests: a scripted model and a local git repository instead of Docker."""

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agent  # noqa: E402


class LocalBox:
    """The Sandbox interface of tasks.py on a temporary git repository; /workspace maps to its root."""

    def __init__(self, root: Path):
        self.root = root
        (root / 'pkg').mkdir()
        (root / 'pkg' / 'calc.py').write_text('def add(a, b):\n    return a - b\n')
        (root / 'tests').mkdir()
        (root / 'tests' / 'test_calc.py').write_text(
            'from pkg.calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n')
        for c in ('git init -q', 'git add .', 'git -c user.email=a@b -c user.name=a commit -qm base'):
            subprocess.run(c, shell=True, cwd=root, check=True)

    def _p(self, path):
        return path.replace('/workspace', str(self.root), 1)

    def exec(self, command, timeout=300, cwd='/workspace'):
        try:
            p = subprocess.run(['bash', '-c', command], cwd=self._p(cwd), capture_output=True, text=True,
                               timeout=timeout)
        except subprocess.TimeoutExpired:
            return None, '', ''
        return p.returncode, p.stdout, p.stderr

    def read(self, path):
        f = Path(self._p(path))
        if not f.exists():
            raise FileNotFoundError(path)
        return f.read_bytes().decode()

    def write(self, path, content):
        f = Path(self._p(path))
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(content.encode())

    def diff(self):
        return self.exec('git add -N . && git diff --binary HEAD')[1]

    def close(self):
        pass


def call(name, **args):
    return NS(name=name, arguments=json.dumps(args))


# (thought, tool calls) per model call; None ends the run with a text answer
SCRIPT = [
    ('Find add.', [call('run_command', command="git grep -n 'def add' -- '*.py'")]),
    ('Read it.', [call('read_file', filepath='pkg/calc.py', start_line=1, end_line=20)]),
    ('Wrong operator.', [call('edit_file', filepath='pkg/calc.py', old_string='return a - b', new_string='return a + b')]),
    ('Same edit again.', [call('edit_file', filepath='pkg/calc.py', old_string='return a - b', new_string='return a + b')]),
    ('Check.', [call('run_command', command='python3 -c "from pkg.calc import add; assert add(2, 3) == 5; print(1)"')]),
    ('Status.', [call('get_status')]),
    ('Submit.', [call('submit_patch')]),
    ('Done.', None),
]


class FakeClient:
    """Plays SCRIPT back through the OpenAI client interface, with reasoning the way vLLM returns it."""

    def __init__(self):
        self.k = 0
        self.chat = NS(completions=NS(create=self.create))

    def create(self, model, messages, tools, timeout, **kw):
        thought, calls = SCRIPT[self.k]
        self.k += 1
        tool_calls = [NS(id=f'call_{self.k}_{i}', function=f) for i, f in enumerate(calls)] if calls else None
        msg = NS(content='Done.' if calls is None else '', reasoning=thought, tool_calls=tool_calls)
        usage = NS(prompt_tokens=1000, completion_tokens=50, prompt_tokens_details=NS(cached_tokens=800))
        return NS(choices=[NS(message=msg)], usage=usage)


TASK = dict(instance_id='demo__calc-1', repo='demo/calc', problem_statement='add(2, 3) returns -1 instead of 5.')


@pytest.fixture
def run(tmp_path):
    """Run the scripted model on a fresh repository with the given limits."""
    n = 0

    def go(limits=agent.Limits()):
        nonlocal n
        n += 1
        root = tmp_path / f'repo{n}'
        root.mkdir()
        return agent.run_agent(FakeClient(), 'fake', TASK, LocalBox(root), limits)
    return go
