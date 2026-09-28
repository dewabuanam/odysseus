# Odysseus

A fast, keyboard-driven desktop Git client with Git hooks treated as a first-class citizen.

## Keyboard first

Press **Ctrl+P** (Cmd+P on macOS) to open the command palette. Every action lives there, with fuzzy matching (`chk` finds *Branch: Checkout*, `nb` finds *New Branch*). Choosing a command shows its options before anything runs, each with the exact git command next to it: *Push* offers push / set upstream / force-with-lease / no-verify / tags, *Pull* offers merge / rebase / fast-forward only, *Merge* asks for a branch and then `--no-ff` / `--ff-only` / `--squash`. Inputs come pre-filled with suggestions: your draft commit message and conventional-commit prefixes, the next semantic version for tags, `feature/` and `fix/` prefixes for branches. Up/Down fills the input from the suggestions, Tab completes, Backspace on an empty input steps back, and the chosen command shows as a breadcrumb. Recently used commands float to the top.

| Key | Action |
|---|---|
| Ctrl+P / Ctrl+Shift+P | Command palette |
| Ctrl+K | Commit (options, then message) |
| Ctrl+Shift+C | Write commit message in the editor |
| Ctrl+Enter | Commit staged changes |
| Ctrl+Shift+A / Ctrl+Shift+U | Stage all / unstage all |
| Ctrl+B / Ctrl+Shift+B | New branch / checkout branch |
| Alt+F / Alt+L / Alt+P | Fetch / pull / push (with options) |
| Alt+S / Alt+Shift+S | Stash / pop stash |
| Ctrl+G / Ctrl+Shift+G | Go to branch / go to commit |
| Ctrl+0 | Working directory |
| Ctrl+Shift+H | Hooks |
| Ctrl+O / Ctrl+Shift+O | Open repository / open recent |
| Ctrl+\` | Toggle Hook Console |
| Ctrl+\\ | Toggle sidebar |
| Ctrl+, | Settings |
| F5 | Refresh |
| Up / Down | Move through commits |

The window uses a custom title bar: repository and branch switchers on the left (both open the palette), the command bar in the middle (it also shows the hook that is currently running), and window controls on the right.

## Submodules

A **Submodules** section in the sidebar shows each submodule's state: up to date, checked out at a different commit, not initialized, or conflicted. Double-click to open a submodule as its own repository (the title bar shows the parent so you can jump back), or initialize it if it isn't checked out. Changed submodules are flagged in the working directory with what changed inside them (new commits, modified or untracked content) and can be updated in place. The palette covers update (recorded or latest remote commit), add, sync URLs and deinit, and pull / fetch can recurse into submodules.

## Hooks done right

Most GUI Git clients handle hooks poorly:

| Problem | Odysseus |
|---|---|
| Hooks fail with `command not found` (node, npx, pnpm, python) because GUI apps don't get your shell's PATH | Loads your login-shell environment (nvm, volta, asdf, pyenv, homebrew), adds Git for Windows' POSIX tools, and lets you add extra PATH entries. The Hooks view warns about commands your hooks use that can't be found. |
| You only see a blob of error text after the hook finishes | Output streams live, with ANSI colors, into the **Hook Console** |
| No idea *which* hook failed or how long it ran | Each hook is tracked through git's own `trace2` event stream: name, duration and exit code for every hook in a run |
| A hung hook freezes the commit | Cancel plus an optional per-hook timeout. The whole process tree is killed, including MSYS children on Windows. |
| Failed commit means lost message | The message is kept (drafts persist too). A failure card shows the hook's output with **Retry** and an explicit, confirmed **Commit without hooks** |
| Formatters in pre-commit silently leave changes unstaged | Detects files the hooks modified after staging and offers to stage them |
| Hooks are invisible | **Hooks view**: every hook, `core.hooksPath` support, husky / lefthook / pre-commit / overcommit / simple-git-hooks detection, edit, enable/disable, fix the exec bit, and **Run now** (via `git hook run`) to test a hook without committing |

Everything runs through the real `git` CLI, so hooks behave exactly as they do in your terminal.

## Built for speed

- File changes are classified: editing a file only re-runs `git status`; the log and graph reload only when refs move; hook edits only reload the hooks overview.
- The commit graph is cached behind a cheap ref fingerprint, so unchanged history is never recomputed or re-sent to the UI.
- Commit list is virtualized (thousands of commits scroll smoothly); huge diffs render a line budget with *Show all* on demand.
- Hook output is coalesced before crossing IPC, so chatty hooks don't flood the renderer.
- The window only shows once rendered, so there is no white flash at startup.

## Also

- Stage, unstage and discard files, **hunks, or individual lines** (click lines, shift-click for a range)
- Commit, amend; merge, rebase, cherry-pick, revert, reset, abort/continue operations
- Branches, remotes, tags, stashes; fetch / pull / push (with upstream setup and force-with-lease)
- Paper & pencil theme: black and white, hand-drawn borders, pencil hatching for deletions, colored-pencil graph lanes; plus a chalkboard dark variant
- Portable mode

## Develop

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck
npm test           # end-to-end tests of the git/hook engine against real temp repos
```

## Build

```bash
npm run dist:portable   # Windows: dist/Odysseus-<ver>-portable.exe, single file, no install
npm run dist            # all targets for the current OS (Windows: portable + zip, macOS: zip + dmg, Linux: AppImage + tar.gz)
```

### Portable mode

The portable `.exe` keeps all settings, recent repos and caches in an `odysseus-data` folder next to itself. Nothing is written to `%APPDATA%`, so it runs from a USB stick or a shared folder. With the `.zip` build, create an empty `odysseus-data` folder beside `Odysseus.exe` to enable the same behaviour.

Requires Git 2.36 or newer on the machine (for `git hook run`; hook tracking needs trace2, available since 2.27).
