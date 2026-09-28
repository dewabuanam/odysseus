<p align="center">
  <img src="resources/icon.png" width="140" alt="Odysseus logo">
</p>

<h1 align="center">Odysseus</h1>

<p align="center">
  A fast, keyboard-driven Git client for the desktop.<br>
  Built around the one thing most Git GUIs get wrong: <b>Git hooks</b>.
</p>

<p align="center">
  <a href="https://github.com/dewabuanam/odysseus/releases/latest">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#search">Search</a> ·
  <a href="#keyboard">Keyboard</a> ·
  <a href="#building-from-source">Build</a>
</p>

![Odysseus](docs/screenshots/overview.png)

---

## Why Odysseus

Most Git GUIs treat hooks as an afterthought. A pre-commit hook that works in your terminal fails in the GUI with `command not found`, its output arrives as one unreadable blob after the fact, you can't tell which hook failed, and a hung hook freezes the app. Odysseus runs everything through the real `git` CLI, in your real shell environment, and shows you exactly what your hooks are doing while they do it.

It is also built to stay out of your way: every action is a keystroke away through the command palette, many repositories stay open in tabs, and every git command waits its turn in a per-repository queue.

## Download

Grab the latest build from [Releases](https://github.com/dewabuanam/odysseus/releases/latest):

| File | What it is |
|---|---|
| `Odysseus-<version>-portable.exe` | Windows, single file, **no install**. Keeps its settings in an `odysseus-data` folder next to the exe, so it runs from a USB stick. |
| `Odysseus-<version>-win.zip` | Windows, unzip and run `Odysseus.exe`. Add an empty `odysseus-data` folder beside it for portable mode. |

Requires **Git 2.36+** on your `PATH`. The builds aren't code-signed yet, so Windows SmartScreen asks for confirmation on first launch (*More info*, then *Run anyway*).

## Features

### Hooks, done right

![A failing pre-commit hook](docs/screenshots/hooks.png)

- **Live hook tracking.** Odysseus reads git's own `trace2` event stream, so it knows which hook is running, for how long, and how it exited: `pre-commit ✗ 1.2s · exit 1`.
- **Streaming output** with colors, in a console per repository.
- **Hooks find your tools.** Your login-shell environment is loaded (nvm, volta, asdf, pyenv, homebrew), Git for Windows' tools are on the path, extra PATH entries can be added in Settings, and the Hooks view warns about commands your hooks call that can't be found.
- **Cancel or time out** a hook and the whole process tree is killed, including MSYS children on Windows.
- **A failed commit keeps your message.** Retry, or commit with `--no-verify` after an explicit confirmation.
- **Formatter changes are caught.** When a pre-commit hook rewrites staged files, Odysseus tells you and offers to stage the result.
- **Hooks view.** Every hook in the repository, `core.hooksPath` support, husky / lefthook / pre-commit / overcommit / simple-git-hooks detection, edit, enable or disable, fix the executable bit, and **run a hook on its own** without committing.

### Command palette with options

![Push options in the palette](docs/screenshots/palette.png)

Press **Ctrl+P**. Every action lives there, with fuzzy matching (`chk` finds *Checkout*). Choosing a command shows its options with the exact git command next to each, before anything runs: push with or without upstream, force-with-lease, no-verify, tags; pull by merge, rebase or fast-forward; merge with `--no-ff`, `--ff-only` or `--squash`. Inputs come pre-filled: your draft commit message with conventional-commit prefixes, the next semantic version for a tag, `feature/` and `fix/` for branch names. Arrow keys fill the input from the suggestions, Tab completes, Backspace steps back. The commands and options you use most rise to the top.

### Tabs and a command queue

- Open any number of repositories in **tabs** on their own row. Tabs that don't fit go into the **▾** menu next to **+**, and the active tab always stays visible. Tabs are restored on launch.
- **Every git command is queued per repository** and runs strictly in order. Pull, checkout another branch, pull, checkout, pull: fire them as fast as you like and they run in exactly that sequence, never two at once. Queued commands show in the console with a button to drop them.
- **Command history** of every command, its output, exit code and failing hook, kept across restarts (Ctrl+H).

### Context menus

![Commit context menu](docs/screenshots/menu.png)

Right-click a commit or a branch for full context menus: checkout, delete, rename, copy, set or unset upstream, search a branch's history, hide branches, revert, cherry-pick, create a branch or tag, **edit the message of any commit**, amend, drop a commit, and reset (soft, mixed, hard).

### Everything else

- **Stage by file, hunk or line** with buttons. The UI updates instantly and git confirms right after.
- **Conflicts**: merge, rebase and cherry-pick conflicts with the ours and theirs regions marked, *use ours* / *use theirs*, *mark resolved*, abort and continue.
- **Submodules**, nested ones included: state at a glance, open in a tab, update, add, sync, deinit, and pull or fetch recursively.
- **Stashes, tags, remotes**, fetch / pull / push with upstream setup.
- **Recovery prompts**: when local changes block a command, stash them, retry, and restore them; when git has no author identity, set it in two keystrokes.
- **Paper & pencil look** in black and white, with colored-pencil graph lanes, and a **chalkboard** dark theme.

![Chalkboard theme](docs/screenshots/chalkboard.png)

## Search

![Search with autocomplete](docs/screenshots/search.png)

**Ctrl+F** opens commit search. It runs on git itself, so it covers the whole history, not just what's loaded. Combine keys and bare words; keys autocomplete as you type, and so do their values (branches, authors, dates).

```
author:"Sam Lee" branch:"main" after:"2 weeks ago" path:src/cart.ts rounding
```

| Key | Finds commits… |
|---|---|
| *bare words* | whose message contains every word (a hex word also matches a commit hash) |
| `author:` / `committer:` | by a name or email (`author:me` is you) |
| `after:` / `before:` | committed after / before a date (`yesterday`, `1 week ago`, `2026-01-01`) |
| `date:` | committed on one day |
| `branch:` / `tag:` | reachable from a branch, tag or commit |
| `path:` | touching a file or folder |
| `ext:` | touching files with an extension (`ext:vue`) |
| `message:` | whose message contains a phrase |
| `regex:` | whose message matches a regular expression (`regex:"^(feat\|fix)"`) |
| `hash:` | whose hash starts with |
| `contents:` | whose diff adds or removes lines matching a regex |
| `string:` | whose diff changes how often an exact string appears |
| `merges:` | `only` merge commits, or `none` |
| `max-parents:` / `min-parents:` | by number of parents (`max-parents:1` hides merges) |
| `first-parent:` | on the mainline only |
| `limit:` | at most N results (default 10000) |

## Keyboard

The default shortcuts are below. **Settings > Keymap** switches to **VS Code**, **JetBrains** (IntelliJ, Rider, WebStorm, with double-Shift for the palette) or **Visual Studio + ReSharper**. **Ctrl+/** lists every binding of the active keymap.

| Key | Action |
|---|---|
| Ctrl+P | Command palette |
| Ctrl+F | Search commits |
| Ctrl+K | Commit (options, then message) |
| Ctrl+Shift+C | Write the commit message in the editor |
| Ctrl+Enter / Ctrl+Shift+Enter | Commit / commit without hooks |
| Ctrl+Shift+A / Ctrl+Shift+U | Stage all / unstage all |
| Ctrl+B / Ctrl+Shift+B | New branch / checkout branch |
| Alt+F / Alt+L / Alt+P | Fetch / pull / push |
| Alt+S / Alt+Shift+S | Stash / pop stash |
| Ctrl+G / Ctrl+Shift+G | Go to branch / go to commit |
| Ctrl+0 | Working directory |
| Ctrl+H / Ctrl+Shift+H | Command history / hooks |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+1..9 | Next / previous / nth tab |
| Ctrl+\` / Ctrl+\\ | Toggle console / sidebar |
| Ctrl+, | Settings |
| F5 | Refresh |

## Building from source

```bash
git clone https://github.com/dewabuanam/odysseus.git
cd odysseus
npm install
npm run dev             # run with hot reload
npm test                # end-to-end tests of the git engine against real repositories
npm run dist:portable   # Windows portable .exe into dist/
npm run dist            # every target for the current OS
```

Odysseus is built with Electron, React and TypeScript. The git engine (`src/main/git`) drives the real `git` CLI; the test suite (`scripts/smoke-test.ts`) exercises it end to end: hooks, the queue, conflicts, history editing, submodules and search.

## License

MIT
