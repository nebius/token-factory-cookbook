"""Rendering a scripted run into Gemma 4's chat format. Downloads the Gemma 4 tokenizer (a few MB) on first run;
set GEMMA_TOKENIZER to a local copy to run offline. Skipped when the tokenizer cannot be loaded."""

import os

import pytest

import render

TOKENIZER = os.environ.get('GEMMA_TOKENIZER', 'google/gemma-4-31B-it-qat-w4a16-ct')


@pytest.fixture(scope='module')
def tok():
    transformers = pytest.importorskip('transformers')
    try:
        return transformers.AutoTokenizer.from_pretrained(TOKENIZER)
    except Exception as e:
        pytest.skip(f'Gemma 4 tokenizer not available: {e!r}'[:200])


def labelled_spans(tok, row):
    spans, cur = [], []
    for i, label in zip(row['input_ids'], row['labels']):
        if label != -100:
            cur.append(i)
        elif cur:
            spans.append(tok.decode(cur))
            cur = []
    if cur:
        spans.append(tok.decode(cur))
    return spans


EDIT = ('Wrong operator.\n<channel|><|tool_call>call:edit_file{filepath:<|"|>pkg/calc.py<|"|>,new_string:<|"|>'
        'return a + b<|"|>,old_string:<|"|>return a - b<|"|>}<tool_call|><|tool_response>')


def test_labels_cover_exactly_what_the_model_generated(tok, run):
    row = render.render(tok, run())
    spans = labelled_spans(tok, row)
    assert len(spans) == 7                       # 8 model turns; the repeated edit is masked
    # older templates leave the thought opener to the model, newer ones put it in the prompt after a tool result
    assert spans[2] in (EDIT, render.THOUGHT_OPEN + EDIT)
    assert spans[-1].endswith('Done.\n<channel|>Done.<turn|>')
    assert tok.decode(row['input_ids']).count(render.THOUGHT_OPEN + 'Done.') == 1
    assert not any('add(2, 3) returns -1' in s for s in spans)   # the task text is context, never a label


def test_a_run_cut_before_its_last_edit_is_dropped(tok, run):
    assert render.render(tok, run(), max_len=1500) is None
