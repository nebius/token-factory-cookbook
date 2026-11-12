"""Offline tests of the agent loop and the trajectory gates: no Docker, no network, no API key."""

import json

import httpx
import openai

import agent
import select_sft


def tool_results(traj):
    return [json.loads(m['content']) for m in traj['messages'] if m['role'] == 'tool']


def test_scripted_run_fixes_the_bug(run):
    traj = run()
    assert traj['stop'] == 'answer'
    assert 'return a + b' in traj['patch']
    assert traj['model_calls'] == 8
    assert traj['tool_calls'] == 5                      # get_status and submit_patch are free
    assert traj['usage']['cached_tokens'] == 8 * 800


def test_task_message_states_the_real_limits(run):
    user = run(agent.Limits(tool_calls=40, minutes=10))['messages'][1]['content']
    assert 'Tool calls: 40' in user and 'pkg/calc.py' in user


def test_reasoning_is_kept_for_the_next_turn(run):
    turns = [m for m in run()['messages'] if m['role'] == 'assistant']
    assert turns[2]['reasoning_content'] == 'Wrong operator.'


def test_repeated_edit_fails_and_tests_run_after_it(run):
    results = tool_results(run())
    assert results[2]['status'] == 'ok' and results[3]['status'] == 'error'
    assert results[4]['status'] == 'ok'                 # the check after the edit passes


def test_budget_warning_when_ten_or_fewer_calls_remain(run):
    warnings = [r.get('budget_warning') for r in tool_results(run(agent.Limits(tool_calls=12)))]
    assert warnings[0] is None and all(warnings[1:])    # 11 left after the first call, 10 after the second


def test_tool_call_limit_stops_the_loop(run):
    traj = run(agent.Limits(tool_calls=2))
    assert traj['stop'] == 'tool_calls' and traj['tool_calls'] == 2 and not traj['patch']


def test_a_rejected_request_ends_the_run_and_keeps_the_patch(run, monkeypatch):
    from conftest import FakeClient
    create = FakeClient.create

    def too_long(self, **kw):
        if self.k == 4:                             # after the edit, the server rejects the request
            response = httpx.Response(400, request=httpx.Request('POST', 'http://localhost/v1/chat/completions'))
            raise openai.BadRequestError('maximum context length exceeded', response=response, body=None)
        return create(self, **kw)
    monkeypatch.setattr(FakeClient, 'create', too_long)
    traj = run()
    assert traj['stop'] == 'rejected' and 'return a + b' in traj['patch']


def test_gates(run):
    traj = dict(run(), resolved=True)
    assert select_sft.gate(traj, set()) is None
    assert select_sft.retested(traj)
    assert select_sft.gate(dict(traj, resolved=False), set()) == 'resolved'
    assert select_sft.gate(traj, {'demo/calc'}) == 'leak'
    touches_tests = traj['patch'].replace('pkg/calc.py', 'tests/test_calc.py')
    assert select_sft.gate(dict(traj, patch=touches_tests), set()) == 'patch'


def test_selection_keeps_both_teachers_for_a_small_repo(run):
    traj = dict(run(), resolved=True, passed_gates=True)
    kimi = dict(traj, model='kimi', n_tokens=900, path='a')
    deepseek = dict(traj, model='deepseek', n_tokens=800, path='b')
    chosen = select_sft.select([kimi, deepseek])
    assert [t['path'] for t in chosen] == ['b', 'a']     # fewer tokens first, then the other teacher
