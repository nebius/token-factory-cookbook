"""A minimal coding agent: six tools and the per-task limits in the README, on any OpenAI-compatible endpoint.

The same loop collects teacher trajectories on Token Factory and evaluates the student on vLLM; only the client and
the model name change. Every tool returns a JSON object with "status": "ok" or "error".
"""
from __future__ import annotations

import difflib
import json
import time
from dataclasses import dataclass
from pathlib import Path

import openai

PROMPT = (Path(__file__).parent / 'prompt.md').read_text()


@dataclass
class Limits:
    tool_calls: int = 28          # every tool call except submit_patch and get_status
    minutes: float = 8.0          # wall-clock time of the agent loop; the tests run afterwards
    turns: int = 80               # model calls
    command_timeout: int = 300    # seconds per run_command
    output_chars: int = 5000      # stdout and stderr, each
    read_lines: int = 150         # per read_file call
    read_chars: int = 10_000


def _tool(name, description, properties=None, required=()):
    return {'type': 'function', 'function': {'name': name, 'description': description, 'parameters': {
        'type': 'object', 'properties': properties or {}, 'required': list(required)}}}


S, I = {'type': 'string'}, {'type': 'integer'}
TOOLS = [
    _tool('run_command', 'Run a shell command in the repository (python, tests, git, grep). No network access.',
          {'command': S}, ['command']),
    _tool('read_file', 'Read a file, or lines start_line..end_line (1-indexed, inclusive). Long reads are truncated.',
          {'filepath': S, 'start_line': I, 'end_line': I}, ['filepath']),
    _tool('edit_file', 'Replace old_string with new_string in a file. old_string must match exactly, including '
          'indentation, and be unique unless allow_multiple is true.',
          {'filepath': S, 'old_string': S, 'new_string': S, 'allow_multiple': {'type': 'boolean'}},
          ['filepath', 'old_string', 'new_string']),
    _tool('write_file', 'Create or overwrite a file with the given content.', {'filepath': S, 'content': S},
          ['filepath', 'content']),
    _tool('get_status', 'Show tool calls and time remaining, and whether a patch has been submitted.'),
    _tool('submit_patch', 'Capture the working-tree diff as the submission. The last submission counts.'),
]
FREE = {'submit_patch', 'get_status'}   # not counted against the tool-call limit


def ok(**fields):
    return {'status': 'ok', **fields}


def err(kind, message, **details):
    out = {'status': 'error', 'error_type': kind, 'error_message': message}
    return {**out, 'details': details} if details else out


class Tools:
    def __init__(self, box, limits: Limits):
        self.box, self.limits = box, limits
        self.start, self.used, self.patch = time.monotonic(), 0, None

    def seconds_left(self) -> float:
        return self.limits.minutes * 60 - (time.monotonic() - self.start)

    def call(self, name: str, args: dict) -> dict:
        if name not in {t['function']['name'] for t in TOOLS}:
            return err('UnknownTool', f'Unknown tool {name!r}.')
        if name not in FREE:
            self.used += 1
        try:
            out = getattr(self, name)(**args)
        except TypeError as e:
            out = err('ArgumentError', str(e))
        left = self.limits.tool_calls - self.used
        if left <= 10:
            out['budget_warning'] = (f'{left} tool call(s) left ({self.used}/{self.limits.tool_calls} used). '
                                     'Finish your edit and call submit_patch.')
        return out

    def run_command(self, command: str):
        timeout = int(max(5, min(self.limits.command_timeout, self.seconds_left())))
        code, out, errs = self.box.exec(command, timeout=timeout)
        if code is None:
            return err('TimeoutExceeded', f'Command timed out after {timeout} seconds')
        out, errs = out[:self.limits.output_chars], errs[:self.limits.output_chars]
        if code != 0:
            return err('CommandError', errs or out, stdout=out, stderr=errs, exit_code=code)
        return ok(stdout=out, stderr=errs, exit_code=0)

    def read_file(self, filepath: str, start_line: int | None = None, end_line: int | None = None):
        try:
            lines = self.box.read(_path(filepath)).splitlines()
        except FileNotFoundError:
            return err('FileReadError', f"File '{filepath}' not found in workspace.")
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line or len(lines)))
        if lines and start > end:
            return err('ValueError', f'start_line ({start}) cannot be greater than end_line ({end})')
        truncated = end - start + 1 > self.limits.read_lines
        if truncated:
            end = start + self.limits.read_lines - 1
        text = '\n'.join(lines[start - 1:end])
        if len(text) > self.limits.read_chars:
            text, truncated = text[:self.limits.read_chars], True
        return ok(filepath=filepath, content=text, start_line=start, end_line=end, total_lines=len(lines),
                  is_truncated=truncated)

    def edit_file(self, filepath: str, old_string: str, new_string: str, allow_multiple: bool = False):
        try:
            before = self.box.read(_path(filepath))
        except FileNotFoundError:
            return err('FileEditError', f"File '{filepath}' not found in workspace.")
        n = before.count(old_string) if old_string else 0
        if n == 0:
            return err('FileEditError', f'old_string not found in {filepath}.')
        if n > 1 and not allow_multiple:
            return err('FileEditError', f'old_string occurs {n} times in {filepath}. Add context or set allow_multiple.')
        after = before.replace(old_string, new_string)
        self.box.write(_path(filepath), after)
        diff = ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), filepath, filepath))
        return ok(filepath=filepath, occurrences=n, diff=diff[:self.limits.output_chars])

    def write_file(self, filepath: str, content: str):
        self.box.write(_path(filepath), content)
        return ok(filepath=filepath, size=len(content))

    def get_status(self):
        return ok(tool_calls_used=self.used, tool_calls_remaining=max(0, self.limits.tool_calls - self.used),
                  max_tool_calls=self.limits.tool_calls, time_seconds_remaining=round(self.seconds_left(), 1),
                  max_time_minutes=self.limits.minutes, patch_submitted=self.patch is not None,
                  patch_size=len(self.patch or ''))

    def submit_patch(self):
        self.patch = self.box.diff()
        return ok(patch_size=len(self.patch), files_changed=self.patch.count('diff --git'))


def _path(filepath: str) -> str:
    return filepath if filepath.startswith('/') else f'/workspace/{filepath}'


def task_message(task: dict, limits: Limits, tree: str) -> str:
    return (f'You are working on a software engineering task for repository {task["repo"]}.\n\n'
            f'Problem Statement:\n{task["problem_statement"]}\n\n'
            '## Budget (the session ends when any limit is reached)\n'
            f'- Time: {limits.minutes} minutes\n- Tool calls: {limits.tool_calls}\n- Model calls: {limits.turns}\n\n'
            '## Environment\n'
            f'- One command may run for at most {limits.command_timeout} seconds\n'
            f'- Command output is cut at {limits.output_chars} characters (stdout and stderr each)\n'
            f'- read_file returns at most {limits.read_lines} lines and {limits.read_chars} characters\n'
            '- No network access. All dependencies are installed; do not pip install.\n\n'
            '## Workspace\nThe repository is at `/workspace`. Directory tree (3 levels):\n```\n' + tree + '```\n')


def run_agent(client: openai.OpenAI, model: str, task: dict, box, limits: Limits = Limits(),
              sampling: dict | None = None) -> dict:
    """Solve one task. Returns the trajectory (OpenAI-format messages), the final diff and usage counters."""
    tools = Tools(box, limits)
    tree = box.exec("find . -maxdepth 3 -not -path './.git*' | sort | head -n 400")[1]
    messages = [{'role': 'system', 'content': PROMPT.replace('{problem_description}', task['problem_statement'])},
                {'role': 'user', 'content': task_message(task, limits, tree)}]
    usage = {'prompt_tokens': 0, 'cached_tokens': 0, 'completion_tokens': 0}
    stop, model_calls = 'turns', 0
    while model_calls < limits.turns:
        if tools.seconds_left() <= 0:
            stop = 'time'
            break
        if tools.used >= limits.tool_calls:
            stop = 'tool_calls'
            break
        try:
            resp = client.chat.completions.create(model=model, messages=messages, tools=TOOLS,
                                                  timeout=max(1.0, tools.seconds_left()), **(sampling or {}))
        except openai.APITimeoutError:
            stop = 'time'
            break
        except openai.BadRequestError:              # e.g. the history no longer fits the server's context window
            stop = 'rejected'
            break
        model_calls += 1
        if resp.usage:
            usage['prompt_tokens'] += resp.usage.prompt_tokens
            usage['completion_tokens'] += resp.usage.completion_tokens
            details = getattr(resp.usage, 'prompt_tokens_details', None)
            usage['cached_tokens'] += (getattr(details, 'cached_tokens', 0) or 0) if details else 0
        msg = resp.choices[0].message
        turn = {'role': 'assistant', 'content': msg.content or ''}
        # vLLM returns the thought as `reasoning` (older versions: `reasoning_content`). Sent back in the history, it
        # is rendered by Gemma 4's chat template as the thought channel.
        reasoning = getattr(msg, 'reasoning', None) or getattr(msg, 'reasoning_content', None)
        if reasoning:
            turn['reasoning_content'] = reasoning
        if msg.tool_calls:
            turn['tool_calls'] = [{'id': c.id, 'type': 'function',
                                   'function': {'name': c.function.name, 'arguments': c.function.arguments}}
                                  for c in msg.tool_calls]
        messages.append(turn)
        if not msg.tool_calls:
            stop = 'answer'
            break
        for c in msg.tool_calls:
            try:
                result = tools.call(c.function.name, json.loads(c.function.arguments or '{}'))
            except json.JSONDecodeError as e:
                result = err('ArgumentError', f'Arguments are not valid JSON: {e}')
            messages.append({'role': 'tool', 'tool_call_id': c.id, 'content': json.dumps(result, ensure_ascii=False)})
    # when a limit is hit, the working tree is evaluated as it is, with or without submit_patch
    return dict(instance_id=task['instance_id'], repo=task['repo'], model=model, messages=messages, tools=TOOLS,
                patch=box.diff(),
                stop=stop, tool_calls=tools.used, model_calls=model_calls,
                seconds=round(time.monotonic() - tools.start, 1), usage=usage)
