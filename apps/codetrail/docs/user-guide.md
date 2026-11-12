# Codetrail user guide

How to run Codetrail on your machine and use every part of it. For what it is and how it works, see the [README](../README.md).

- [Ways to use it](#ways-to-use-it)
- [1. Set it up](#1-set-it-up)
- [2. Open a repo](#2-open-a-repo)
- [3. Read it](#3-read-it)
- [4. The map](#4-the-map)
- [5. Tours](#5-tours)
- [6. Ask questions](#6-ask-questions)
- [7. Docs](#7-docs)
- [8. Files and search](#8-files-and-search)
- [9. Pull requests](#9-pull-requests)
- [10. Your own folders](#10-your-own-folders)
- [11. Costs and the cache](#11-costs-and-the-cache)
- [12. Sharing](#12-sharing)
- [13. Coding agents (MCP)](#13-coding-agents-mcp)
- [14. Keyboard shortcuts](#14-keyboard-shortcuts)
- [15. Troubleshooting](#15-troubleshooting)

## Ways to use it

| You want to… | Do this |
| --- | --- |
| **Get to know a new codebase** | Read it once, then play the main tour. Open the modules that matter on the [map](#4-the-map), and write the [docs](#7-docs) for a page per module. |
| **Find where something happens before you change it** | [Ask](#6-ask-questions) "where is X handled?", open the file's **Calls** view to see what calls it, and click a link on the map for the imports behind it. |
| **Review a pull request** | Open the PR's link. The [PR tour](#9-pull-requests) walks through the change in the order it runs, with the diff and notes on risks and missing tests. |
| **Onboard a teammate** | [Write a tour](#5-tours) of the parts they need, or edit a generated one, and send them the link. Export it to `.tours/` so it lives in the repo for VS Code CodeTour. |
| **Document a project** | Write the docs, export them as Markdown, and [embed](#4-the-map) the live architecture image and badge in the README. |
| **Settle a hard question** | Ask it in [Research](#6-ask-questions) mode: the model plans what to find out, looks in up to three rounds, then answers with checked references. |
| **Hand context to an AI chat** | **Copy as a prompt** (on a module, a tour, an answer, or the map's Export menu) gives the architecture and the code references, ready to paste. |
| **Present a codebase** | Open the [slides](#7-docs): the architecture, every module and the main tour, with keys and full screen, or downloaded as one HTML file. |
| **Keep tours useful as the code changes** | Read the newer commit. Every tour [comes along](#5-tours), its steps moved with their code and any changed step flagged. |
| **Give a coding agent context** | Connect the [MCP server](#13-coding-agents-mcp), or point the agent at `/owner/repo.md`, so it starts from the map and checked `file:line` references instead of searching. |
| **Work in a big monorepo** | **Choose folders** on the [Ready screen](#3-read-it) to read only the part you work on. |
| **Look at code that isn't on GitHub** | Self-host and open [your own folders](#10-your-own-folders), unpushed changes included. |

## 1. Set it up

You need a **Nebius Token Factory API key**: sign in at [tokenfactory.nebius.com](https://dub.sh/aistudio) and create one. Codetrail uses it for every model call. Nothing else is required.

**With Docker** (nothing else to install):

```bash
git clone https://github.com/Studio1-OSS/Codetrail.git
cd Codetrail
docker build -t codetrail .
docker run --name codetrail -p 3000:3000 \
  -e NEBIUS_API_KEY=your-key \
  -v codetrail-data:/data \
  -v ~/code:/repos:ro \
  codetrail
```

**From source** (Node.js 22.13+ and pnpm):

```bash
git clone https://github.com/Studio1-OSS/Codetrail.git
cd Codetrail
pnpm install
cp .env.example .env      # put your key in NEBIUS_API_KEY
pnpm dev
```

Open **http://localhost:3000**. There's no sign-up and no limit when you run it yourself.

Optional settings (in `.env`, or as `-e` flags with Docker):

| Setting | What it does |
| --- | --- |
| `GITHUB_TOKEN` | Raises GitHub's limit from 60 to 5,000 requests an hour, and opens private repos the token can read. A fine-grained token with "Contents: read" is enough. |
| `LOCAL_ROOT` | A folder of your projects (from source). Each folder inside it can be opened in Codetrail. Docker uses the `/repos` mount instead. |
| `NEBIUS_MODEL` | Which open model reads the code: `deepseek-ai/DeepSeek-V4.1-Flash-1017` (the default) or `moonshotai/Kimi-K3.1-Pro`, which costs about 7× as much per token. |
| `MAX_REPO_TOKENS` | The most of a repo sent in one read (default 700,000 tokens). |
| `DAILY_BUDGET_USD` | Stops new model calls for the day after this much spend. Empty means no cap. |

The rest are listed in [`.env.example`](../.env.example).

## 2. Open a repo

Paste any of these into the box on the home page:

- `owner/repo`, or a GitHub link: `https://github.com/owner/repo`
- a branch, tag or commit: `…/tree/v2`, `…/commit/<sha>`, `owner/repo@v2`
- a file link, which opens that file: `…/blob/main/src/app.ts#L10`
- a pull request: `…/pull/123`, or `owner/repo#123`
- a git remote: `git@github.com:owner/repo.git`

You can also swap the domain: `github.com/owner/repo` becomes `localhost:3000/owner/repo`.

Repos someone already read on your instance open straight away, and everything stored with them is free to replay. If the branch has new commits since that read, a bar at the top says how many, with a link to read the latest.

## 3. Read it

A repo you haven't read yet opens on the **Ready to read** screen. Nothing has been spent yet. It shows:

- how much of the model's 1M-token context the repo fills;
- every file that will be sent (click **See every file that will be read**), and what's skipped and why: lockfiles, binaries, generated files, anything that looks like a credential;
- the estimated cost of the first read, and of each question after it.

**Choose folders** reads only part of the repo, which helps with a big monorepo. Untick folders to leave them out, or type the only ones to read (folders or globs such as `packages/*/src`). The estimate follows as you choose; **Apply** opens that read at `/owner/repo?only=src&skip=src/legacy`. A read of some folders is stored apart from the full read, so the same commit can be read both ways; the header shows which folders a read covers, and clicking that label goes back to the whole repo.

Press **Read the repo**. The model (DeepSeek V4.1 Flash 1017, or Kimi K3.1 Pro if you set it) reads every file in one call, and you watch the map build as it writes: modules appear, then the links between them, then the steps of the first tour. A small repo takes 10–20 seconds.

## 4. The map

The middle of the screen is the map. It has four views:

- **Architecture** (the default): the modules as boxes, top to bottom in the order calls flow, grouped into layers such as "Entry points", "Routing" or "Storage", one colour per layer. Each box shows the folder most of its files live in. A **solid** arrow is confirmed by real imports in the code; a **dashed** one was inferred by the model. Hover a box to light up its links and read what each one does.
- **Modules**: the same map as a graph you can drag around.
- **Files**: the real import graph, file by file, grouped by module.
- **Calls**: one file's functions, what each one calls and who calls them, worked out from the code (no model call). Type a file name to pick another, or press **calls** in the code panel's header. Click a function to open it. JavaScript and TypeScript are read with the TypeScript compiler, so imports and aliases resolve exactly; Python and Go are matched by name to the files they import. Calls into libraries are counted, not drawn.

**Double-click a module** on the Architecture view (or select it and press `O`, or press **Show its files on the map** in its panel) to open it into its files, with the imports between them; links to other modules then start at the file that has the import. Double-click again, or **Close opened modules**, to fold it back. Opened modules stay in the address (`?open=core,router`).

**Click a link** to see the evidence for it: every import line in the code that backs it, each opening at that line, with the module's own files first. A dashed link says the model inferred it, with nothing in the imports behind it. A module's panel lists its links too, each opening the same evidence, and on a selected box `[` and `]` step through them.

**Find** (under the map, or press `F`) lights up the modules and files whose name matches, and on the Calls view the functions. Press Enter to go to the next match; a file inside a closed module opens it.

**List** (beside the view tabs) shows the current view as text: the layers and modules with their links (each opening its evidence), the files of opened modules, each file's imports on the Files view, and each function's callers and calls on the Calls view. It's the same map for screen readers, or for reading top to bottom.

**With the keyboard**: Tab moves through the boxes from top to bottom, Enter selects one, `O` opens or closes a module, and `[` `]` step through its links. With the map itself focused, `+` and `−` zoom, `0` fits it, and the arrow keys pan.

Click a box or node to see what the module does and its key files (and, once the docs are written, a link to its docs page). Zoom with the buttons or your trackpad. During a tour, the current step's box is highlighted, each visited box shows its step numbers, and the route between steps is drawn.

**Export** (under the map) has:

- **Copy as Mermaid**: the architecture as a Mermaid flowchart. Layers become subgraphs, colours are kept, and each box links to its folder on GitHub at the commit read.
- **Download SVG** and **Download PNG**: the whole diagram on the Architecture view (the visible part on the others), PNG at twice the size.
- **Download for draw.io**: an editable draw.io file with the layers, boxes and links as laid out.
- **Copy as a prompt for an AI chat**: the repo, the commit and the architecture as Mermaid, ready to paste into any chat, with "cite file:line" at the end.
- **Embed in a README (SVG)**: copies Markdown for a live diagram image (`/owner/repo/diagram.svg`, light, or `?theme=dark`) and an "Explore with Codetrail" badge, both linking to the repo's page. The image updates when the repo is read again. It uses the instance's `SITE_URL`, so set that to a public address first.
- **Embed in a README (PNG)**: the same as a 1200×630 card (`/owner/repo/diagram.png`), for places that don't show SVG. It's also the repo page's link preview.
- **Markdown for AI tools**: the repo's page at `/owner/repo.md` (see [Sharing](#12-sharing)).

Repos read before layers were added are grouped by kind (entry, core, data…) instead. **Group into layers** under the diagram names the layers with one small call that sends only the module list, not the repo (about $0.002), and saves them with the map.

**On a phone or tablet**, the step and its code come first and the map sits below them; **Bigger map** enlarges it. One finger scrolls the page, two fingers pan and zoom the map. The tours, Ask box, docs and PRs open from the panel button at the top left.

## 5. Tours

A tour walks through the code in the order it runs, one step at a time. The left sidebar lists the suggested tours; the first read already wrote one of them. Going back to a tour you left picks up at the step you were on.

- Each step shows its explanation and opens the code at the exact lines.
- **Lines checked** means the line the model quoted was found in that range. **Range corrected** means the model's line numbers were off and Codetrail moved the range to the quoted line.
- **Play** advances on its own; **←** and **→** step by hand.
- Under each step, **Link to this step** copies a link to that exact step, and **Share & export** opens:
  - **Read as text** (or `T`): the whole tour with its code, copyable as Markdown with the code included.
  - **Share card**: the image shown as the link preview.
  - **Copy as Mermaid sequence diagram**.
  - **Copy as a prompt for an AI chat**: the architecture and every step with its `file:lines`.
  - **Export for VS Code CodeTour**: a `.tour` file pinned to the commit, each step selecting its whole line range, with the next tour named so CodeTour offers it at the end.
- If the repo has its own CodeTour files (in `.tours`, `.github/tours` or `.vscode/tours`, subfolders included, or `main.tour`), they're listed under **Written by the maintainers** in CodeTour's order, checked the same way. Steps that point at a folder or carry text only come along as text steps. The first time you open such a repo, a note says how many there are and which one to start with.
- **Links in a step's text**: `[#3]` jumps to step 3, `[Tour title#2]` (or `[Tour title]`) opens another tour, and a backticked path such as `` `src/app.ts:12` `` opens that file. Code blocks and `>> command` lines get a copy button. This is CodeTour's own syntax, so tours written for it work here too.
- **Previous tour**: the first step offers the stored tour before this one, so a series of tours reads both ways.
- **Tour markers in the code**: wherever a stored tour stops in the file you're reading, a thin amber mark sits in the code panel's margin. Hover it for the tour and step; click it to open that tour there. The flag button in the code panel's header (with the count) hides or shows them.
- **Progress**: the sidebar shows how much of each tour you've seen ("4/9 seen", "✓ seen"), and the step bar marks the steps you've visited. It's kept in your browser only; **Reset progress** clears it.
- **Next tour**: the last step offers the next suggested tour you haven't finished, free when it's already stored (with its price when it isn't).

**Tours that follow the code.** When a newer commit of a repo is read, every tour of the earlier read comes along, free: each step is looked for again by the line it quotes, and moves with its code. A step whose line is gone stays where it was, marked **code changed**, and the tour's first step says how many moved and how many changed. For repos read before this was added, **Bring tours from the read at …** in the sidebar does the same.

**Open a tour from a link.** **Open a tour from a link** under the Tours heading takes a `.tour` file on GitHub (a file or raw link) or a raw gist link. Its steps are checked against this commit and it's saved under **Your tours**. Free.

**Write your own tour.** **+ Write a tour** in the sidebar, or **Edit a copy of this tour** in the Share & export menu, turns the step column into an editor. Give it a title, then add steps: open any file (press `/`) or step, and **Add the lines on screen as a step** takes what the code panel shows; adjust the lines, give the step a title and say what happens there. **Add a text step** writes one with no code, for an intro or a summary. Steps can be moved, shown and deleted. **Save the tour** is free: each step is checked against the code (the file must be in the commit and the lines must exist), and the tour is listed under **Your tours**, with markers, progress, a link and CodeTour export like any other. On a hosted instance it needs sign-in.

## 6. Ask questions

Type a question in **Ask how something works**, at the bottom of the sidebar.

- **Already answered · free**: while you type, anything stored that answers the question (a tour, an answer, a docs page or a conversation) shows up. Click it to open it at no cost.
- **The kind of answer** is picked from your wording, and you can switch it:
  - **Answer**: a short structured answer with tables, file lists, call sequences and code references, each checked against the code.
  - **Tour**: a step-by-step walk. "Walk me through…" and "what happens when…" pick this.
  - **Thorough**: a slower, more thorough answer that traces across every file involved. It costs more.
  - **Research**: for questions one pass can't settle. The model first plans what to find out, then looks in up to three rounds (each sees what the earlier ones found, and it stops early when there's nothing new), then writes the answer with every reference checked. You see each stage as it runs; afterwards the plan and each round stay openable under the answer. It's a few calls on the cached repo, so it costs a few answers, and its price shows before you ask. It answers new questions, not follow-ups.
- **The price** for that kind of question is shown under the box before you ask: what it costs if the repo is in the cache, and the most it can cost.
- **Stop** ends a question, tour, docs or read you no longer want. If no one else is waiting on the same call, the model stops writing; whatever it had already read may still be billed. A stopped or failed question goes back into the box, with **Start again** or **Retry** next to the message.

**Follow-ups.** Under every answer, **Copy as a prompt** gives the answer with the architecture, ready for any AI chat. Under every answer and repo tour there are suggested follow-up questions (each with its price) and an **Ask a follow-up** box. Pull-request tours don't take follow-ups: the model would see the repo before the change, not the PR's code. A follow-up gets a short recap of the conversation, so the answer builds on what was already said. A follow-up already asked from the same answer or tour (a suggested one, say) replays free, like any stored question. The conversation's questions appear as numbered pills, so you can go back to any of them. Conversations are listed in the sidebar and have their own link.

## 7. Docs

**Write the docs** in the sidebar writes one page for each module in a single call: an overview, how it works, key files and where to look, with every reference checked. After that, **Read the docs** is free.

Each page has a diagram of its module: its files and the imports between them, and the modules it links to. Click a file to open it, or a neighbouring module to go to its page. Open a page from the module's panel on the map (**Open its docs page**) or from the list at the top.

**Slides** (at the top of the docs, or `/owner/repo/slides`) turn what's stored into a deck: a title slide, the architecture, one slide per module (its overview, its diagram and key files) and the main tour's steps. They need no model call, so they're free and instant. Use `←` `→` or Space to move, `F` for full screen; the slide number stays in the link. **Download as HTML** saves them as one file that works anywhere, with the same keys.

Export **This page** or **All** as Markdown (each page's diagram included as Mermaid), or all of it as **.json**. Under each answer, **Copy as Markdown** and **Download .md** give the answer with its tables, file lists, call sequences (also as Mermaid) and the lines of every checked code reference, linked at the commit.

## 8. Files and search

Press `/` (or click **browse & search files**) to browse every text file in the commit, including those not sent to the model, and to search their contents. Search runs on Codetrail's own copy, so it's instant and doesn't use GitHub. GitHub file links (`/owner/repo/blob/<ref>/<path>#L10`) open the file at that line.

The code panel's header has **copy** (the highlighted lines, or the whole file), **path** (copies `path:start-end`), **calls** (this file on the Calls view) and the tour-marker toggle.

## 9. Pull requests

Open a PR with its link, `owner/repo#123`, or the **Tour a PR** box in the sidebar. The repo needs to be read once first, and the PR page offers that if it hasn't been.

- **Before anything is spent**, the PR page shows the title, author, size and state, how much will be sent (the patches and the PR's version of each changed file), and the estimate. Because Codetrail already has the repo, only the change is new input.
- **Tour this PR** walks through the change in the order it runs:
  - Changed lines are marked in the code: green for added, a red rule where lines were removed.
  - **diff** shows the patch.
  - Modules and files the PR touches get a **±** badge on the map.
- **For the reviewer** lists risks, missing tests, questions and small cleanups. Each note opens the line it's about; a note whose line couldn't be found says so.
- Tours are saved per head commit, so after a new push the PR gets a new tour and the old one stays, listed under the PR in the sidebar as an earlier push.

## 10. Your own folders

Useful for code that isn't on GitHub yet, a branch you haven't pushed, or a client project you can't share. With `LOCAL_ROOT` set (or a `/repos` mount in Docker), the home page lists **Your folders**. Each opens like a repo, read from disk with the same filters and secret scan, uncommitted changes included. After you edit files, the next visit offers a fresh read; an unchanged folder replays free. Folders are never available on an instance with sign-in turned on.

## 11. Costs and the cache

- **The cost pill** in the header shows what this repo has cost so far and what cached input saved. Click it for a receipt of every call: tokens sent, how many came from the cache, tokens written, time and cost.
- **Next question ≈ $…** (in the header and under the Ask box) is what the next question costs. One price means a recent call reused the repo, so the next one very likely will, at about 2% of the input price. A range means it hasn't lately: Token Factory's cache is best-effort, so a call can land on a server that doesn't hold the repo yet and cost up to the higher figure. Hover it for which case you're in.
- **The data page** (`/data`, linked as **Data** in the header) shows every repo read on your instance with its spend and savings, updated on each visit.

## 12. Sharing

Everything has a link: a tour step (`?tour=…&step=…`), an answer (`?answer=…`), a conversation (`?thread=…&turn=…`), a docs page (`?doc=<module>`), an open file (`?file=<path>&line=<n>`) and a PR (`/owner/repo/pull/123`). The browser's Back and Forward move between what you opened. A tour's link shows its share card as the preview image; the repo's own link shows its architecture diagram. Anyone opening a link on the same instance replays it free.

**Browse** (in the site header) lists every repo read on your instance, with search and sorting by newest, stars or name.

**For AI tools and plain text**, every read repo has a Markdown page at `/owner/repo.md`: the summary, the architecture as Mermaid, the modules with their files, every tour step by step with links to the lines, the docs with their diagrams, and the answers. `/llms.txt` lists them all. Both are built from what's stored, so they're free. Private repos and local folders only get one on a self-hosted instance without sign-in.

## 13. Coding agents (MCP)

Codetrail is also an MCP server, so Claude Code, Cursor and other agents can use it as a tool. It helps when an agent works in code it doesn't know: instead of searching file by file, it gets the module map (with its layers and a Mermaid diagram), a tour or an answer with exact `file:line` references, and it can ask follow-ups in the same thread. For reviews, `codetrail_pr` gives it the change in the order it runs, with notes. Local folders work too: use `_local/<folder>` as the repo. It offers six tools:

| Tool | What the agent gets |
| --- | --- |
| `codetrail_map(repo)` | The modules with their layers and key files, how they connect, the architecture as Mermaid, and suggested questions |
| `codetrail_tour(repo, question)` | Ordered steps with `path:Lx-Ly` and a link to each |
| `codetrail_ask(repo, question, thread?, thorough?, research?)` | A short answer with checked code references, follow-up questions and a thread id for follow-ups. `research` plans and looks in rounds first |
| `codetrail_pr(repo, number)` | A reviewer's tour of a pull request with review notes (`repo` can be the PR's URL) |
| `codetrail_docs(repo, module?)` | The stored docs, or one module's page. Free |
| `codetrail_search(query, repo?)` | Files of a read that contain the query, with the matching lines; without a repo, the repos already read. Free |

**Claude Code plugin.** The repo is a plugin marketplace. The plugin adds the MCP server and a skill that tells Claude when to use each tool:

```bash
claude plugin marketplace add Studio1-OSS/Codetrail
claude plugin install codetrail@codetrail
```

It connects to `http://localhost:3000/api/mcp`; set `CODETRAIL_MCP_URL` to use another address.

**Claude Code** without the plugin, with the app running (Docker or `pnpm dev`):

```bash
claude mcp add --transport http codetrail http://localhost:3000/api/mcp
```

Or without the app running, straight from the source folder:

```bash
claude mcp add codetrail -- pnpm --dir /path/to/Codetrail -s mcp
```

**VS Code**: [install in VS Code](https://insiders.vscode.dev/redirect/mcp/install?name=codetrail&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp%22%7D). **Cursor**: [install in Cursor](https://cursor.com/install-mcp?name=codetrail&config=eyJ1cmwiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvYXBpL21jcCJ9), or add it to `.cursor/mcp.json`:

```json
{ "mcpServers": { "codetrail": { "url": "http://localhost:3000/api/mcp" } } }
```

Then ask your agent things like "use codetrail to map lukeed/polka" or "use codetrail_pr to review https://github.com/owner/repo/pull/42". Results are stored like everything else, so repeats are free, and the web app shows what the agent asked.

## 14. Keyboard shortcuts

| Key | Does |
| --- | --- |
| `←` `→` | Previous / next step |
| `Space` | Play or pause the tour |
| `/` | Browse and search files |
| `F` | Find a module, file or function on the map |
| `T` | Read the tour as text |
| `?` | Show the shortcuts |
| `Esc` | Close a dialog, a menu, the docs, or an open module, file or link |
| `Tab`, then `Enter` | Move through the map's boxes and select one |
| `O` | Open the focused module into its files, or close it |
| `[` `]` | Step through the selected box's links and their imports |
| `+` `−` `0` | Zoom the map in, out, or to fit (with the map focused) |
| Arrow keys | Pan the map (with the map itself focused) |

Shortcuts don't fire while you type, while a dialog is open, or for a key the focused control uses itself (Space on a button). Single-key shortcuts (`/`, `?`, `T`, `F`) can be switched off in the shortcuts dialog (`?`), for speech input. On the slides, `←` `→`, Space, Home, End and `F` (full screen) work the same way.

## 15. Troubleshooting

| What you see | What to do |
| --- | --- |
| "No Nebius key is set" | Add `NEBIUS_API_KEY` to `.env` (or `-e` with Docker) and restart. |
| "GitHub's rate limit was reached" | Set `GITHUB_TOKEN`; without one, GitHub allows 60 requests an hour. |
| A private repo says it doesn't exist | The `GITHUB_TOKEN` can't read it. Give the token "Contents: read" on that repo. |
| A big repo shows files as "signatures" | It's over the size budget, so lower-priority files go in as their declarations only. The Ready screen lists which. |
| A question cost more than the "cached" estimate | The cache missed (see [Costs and the cache](#11-costs-and-the-cache)). The receipt shows the real cached share. |
| Your folders don't appear | Set `LOCAL_ROOT` (or mount `/repos` in Docker), and keep `AUTH_MODE=none`. Hidden folders are skipped. |
| Port 3000 is taken | `pnpm dev --port 3100`, or `-p 3100:3000` with Docker. |
