"""Offline tests of the test-log parser and the run comparison."""

import json

import evaluate
from tasks import changed_files, parse_pytest


def test_parse_pytest_reads_the_short_summary():
    log = ('tests/test_a.py ..F\n=== short test summary info ===\n'
           'PASSED tests/test_a.py::test_one\nFAILED tests/test_a.py::test_two - assert 1 == 2\n'
           'ERROR tests/test_b.py::test_three\n')
    assert parse_pytest(log) == {'tests/test_a.py::test_one': 'PASSED', 'tests/test_a.py::test_two': 'FAILED',
                                 'tests/test_b.py::test_three': 'ERROR'}


def test_changed_files_lists_every_file_in_a_patch():
    patch = ('diff --git a/src/x.py b/src/x.py\n--- a/src/x.py\n+++ b/src/x.py\n'
             'diff --git a/tests/test_x.py b/tests/test_x.py\n--- a/tests/test_x.py\n+++ b/tests/test_x.py\n')
    assert changed_files(patch) == ['src/x.py', 'tests/test_x.py']


def test_compare_counts_gains_losses_and_relative_change(tmp_path, capsys):
    rows = lambda solved, calls: [dict(instance_id=f't{i}', resolved=s, tool_calls=c, model_calls=c + 1, seconds=10 * c)
                                  for i, (s, c) in enumerate(zip(solved, calls))]
    a, b = tmp_path / 'a.jsonl', tmp_path / 'b.jsonl'
    a.write_text(''.join(json.dumps(r) + '\n' for r in rows([1, 1, 0, 1], [20, 20, 20, 20])))
    b.write_text(''.join(json.dumps(r) + '\n' for r in rows([1, 0, 1, 1], [10, 10, 10, 10])))
    evaluate.compare(a, b, n=200)
    out = capsys.readouterr().out
    assert 'solved: 3/4 -> 3/4; gained 1, lost 1' in out
    assert 'tool_calls   -50%  (95% CI -50% to -50%)' in out
