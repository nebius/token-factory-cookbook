---
name: codetrail
description: Use before reading or changing unfamiliar code in a GitHub repo or a local folder, or when asked how something in a codebase works, where something lives, or what a pull request does. Gets the architecture, a step-by-step tour or an answer with checked file:line references from Codetrail instead of grepping around.
---

# Codetrail

Codetrail reads a whole repo in one prompt (DeepSeek V4.1 Flash 1017 or Kimi K3.1 Pro, 1M-token context) and checks every line it points at against the real file. Results are stored per commit, so asking again is free.

## Which tool

- **Getting oriented**: `codetrail_map` gives the modules, their key files, how they connect (marked when real imports confirm it) and suggested tours. Start here in a repo you don't know.
- **"How does X work?"**: `codetrail_tour` gives ordered steps through the code, each a file and a checked line range.
- **A specific question**: `codetrail_ask` gives a short answer with checked references. Pass the returned `thread` to follow up in context; set `thorough` for questions that span many files.
- **A module in depth**: `codetrail_docs` returns its stored docs page (overview, how it works, key files). Free.
- **Finding something**: `codetrail_search` searches the files of a read (or, with no repo, lists the repos already read). Free.
- **A pull request**: `codetrail_pr` gives a reviewer's tour: what changed, in the order it runs, with risks and missing tests tied to lines.

## Which repo

Pass `owner/repo`. Inside a git checkout, get it from the remote:

```sh
git remote get-url origin   # git@github.com:owner/repo.git or https://github.com/owner/repo
```

For a folder on the machine running Codetrail, pass `_local/<folder>`.

## Costs

`codetrail_map`, `codetrail_tour`, `codetrail_ask` and `codetrail_pr` call the model the first time (a small repo costs about a cent or two to read; later questions reuse the cached repo). Each reply says what it cost. Repeats, `codetrail_docs` and `codetrail_search` are free.

## Using the results

Open the `file:line` ranges before relying on them, and cite them when you explain the code. If a reply says a step's code changed, read the file at that place yourself.
