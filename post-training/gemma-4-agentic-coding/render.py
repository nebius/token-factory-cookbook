"""Render trajectories into Gemma 4's chat format: token ids, plus labels on the model's own turns only.

Usage: python render.py selected.txt --tokenizer google/gemma-4-31B-it-qat-w4a16-ct --out train.jsonl
       python render.py all_paths.txt --tokenizer ... --count tokens.json   (token counts for select_sft.py)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from transformers import AutoTokenizer

MAX_LEN = 24_576            # what a LoRA-enabled 4x L4 server can hold, with room for the next reply
MAX_THOUGHT_TOKENS = 3_000  # longer teacher thoughts stay in the context but carry no loss
TOOL_RESPONSE = '<|tool_response>'
THOUGHT_OPEN = '<|channel>thought\n'
EDIT_TOOLS = {'edit_file', 'write_file'}


def to_gemma(messages: list[dict]) -> list[dict]:
    """Teacher text written next to a tool call goes into the thought: Gemma's template would render it after the
    tool results and close the turn, which Gemma never does. Thoughts are stripped, so the template's
    `thought + '\\n<channel|>'` is exactly what the model generates."""
    out = []
    for m in messages:
        m = json.loads(json.dumps(m))
        if m['role'] == 'assistant':
            thought = (m.pop('reasoning_content', None) or m.pop('reasoning', None) or '').strip()
            if m.get('tool_calls') and (m.get('content') or '').strip():
                thought = (thought + '\n\n' + m['content'].strip()).strip()
                m['content'] = ''
            if thought:
                m['reasoning_content'] = thought
            for c in m.get('tool_calls') or []:
                c['function']['arguments'] = json.loads(c['function']['arguments'] or '{}')
        out.append(m)
    return out


def no_loss(m: dict, prev: dict | None, results: dict, tok) -> bool:
    """Turns kept as context but not trained on: repeated calls, failed tool calls, empty turns, very long thoughts."""
    calls = m.get('tool_calls') or []
    if not calls and not (m.get('content') or '').strip():
        return True
    if prev and calls and [c['function'] for c in calls] == [c['function'] for c in prev.get('tool_calls') or []]:
        return True
    for c in calls:
        r = results.get(c['id'], {})
        if r.get('status') == 'error' and r.get('error_type') != 'CommandError':   # a failing test run is fine
            return True
    return len(tok(m.get('reasoning_content', ''), add_special_tokens=False)['input_ids']) > MAX_THOUGHT_TOKENS


def render(tok, traj: dict, max_len: int = MAX_LEN) -> dict | None:
    msgs = to_gemma(traj['messages'])
    results = {m['tool_call_id']: json.loads(m['content']) for m in msgs if m['role'] == 'tool'}
    chat = lambda ms, gen: tok.apply_chat_template(ms, tools=traj['tools'], tokenize=False, add_generation_prompt=gen,
                                                   enable_thinking=True)
    turns, prev = [], None   # (context before the turn, the turn as generated, train on it?, edits?)
    for i, m in enumerate(msgs):
        if m['role'] != 'assistant':
            continue
        context = chat(msgs[:i], True)
        if m.get('tool_calls'):
            full = chat(msgs[:i + 1], False)
            assert full.startswith(context), 'chat template is not prefix-stable'
            target = full[len(context):]                         # thought, tool call(s), stop token
            assert target.endswith(TOOL_RESPONSE)
        else:                                                    # final answer: thought, text, end of turn
            thought = m.get('reasoning_content', '')
            if context.endswith(THOUGHT_OPEN):                   # newer templates open the thought in the prompt
                target = f'{thought}\n<channel|>'
            else:
                target = f'{THOUGHT_OPEN}{thought}\n<channel|>' if thought else ''
            target += m['content'].strip() + '<turn|>'
        edits = any(c['function']['name'] in EDIT_TOOLS for c in m.get('tool_calls') or [])
        turns.append((context, target, not no_loss(m, prev, results, tok), edits))
        prev = m
    n_tokens = lambda s: len(tok(s, add_special_tokens=False)['input_ids'])
    last_edit = max((k for k, t in enumerate(turns) if t[3]), default=-1)
    while turns and n_tokens(turns[-1][0] + turns[-1][1]) > max_len:
        turns.pop()                                              # drop trailing turns that do not fit
    if len(turns) <= last_edit:
        return None                                              # cut before its last edit: fails the length gate
    text = turns[-1][0] + turns[-1][1]
    enc = tok(text, add_special_tokens=False, return_offsets_mapping=True)
    ids, offsets = enc['input_ids'], enc['offset_mapping']
    labels = [-100] * len(ids)
    for context, target, train, _ in turns:
        assert text.startswith(context) and text[len(context):len(context) + len(target)] == target
        if train:
            a, b = len(context), len(context) + len(target)
            for k, (s, _) in enumerate(offsets):
                if a <= s < b:
                    labels[k] = ids[k]
    return dict(id=f'{traj["model"]}:{traj["instance_id"]}', input_ids=ids, labels=labels)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('paths', help='file with one trajectory path per line')
    ap.add_argument('--tokenizer', default='google/gemma-4-31B-it-qat-w4a16-ct')
    ap.add_argument('--out', help='training rows (JSONL)')
    ap.add_argument('--count', help='write {path: token count or null} instead of rows')
    args = ap.parse_args()
    tok = AutoTokenizer.from_pretrained(args.tokenizer)
    counts, n = {}, 0
    with open(args.out or '/dev/null', 'w') as f:
        for p in Path(args.paths).read_text().split():
            row = render(tok, json.loads(Path(p).read_text()))
            counts[p] = len(row['input_ids']) if row else None
            if row and args.out:
                f.write(json.dumps(row) + '\n')
                n += 1
    if args.count:
        Path(args.count).write_text(json.dumps(counts))
    print(f'{n} rows written; {sum(v is None for v in counts.values())} trajectories cut before their last edit')


if __name__ == '__main__':
    main()
