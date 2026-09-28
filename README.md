# Odysseus

A fast, keyboard-driven desktop Git client with Git hooks treated as a first-class citizen.

## Keyboard first

Press **Ctrl+P** (Cmd+P on macOS) to open the command palette. Every action lives there, with fuzzy matching (`chk` finds *Branch: Checkout*, `nb` finds *New Branch*). Choosing a command shows its options before anything runs, each with the exact git command next to it: *Push* offers push / set upstream / force-with-lease / no-verify / tags, *Pull* offers merge / rebase / fast-forward only, *Merge* asks for a branch and then `--no-ff` / `--ff-only` / `--squash`. Inputs come pre-filled with suggestions: your draft commit message and conventional-commit prefixes, the next semantic version for tags, `feature/` and `fix/` prefixes for branches. Up/Down fills the input from the suggestions, Tab completes, Backspace on an empty input steps back, and the chosen command shows as a breadcrumb. The commands and options you pick most often rise to the top, per list: your usual push option or your most-used branch comes first.

### Keymaps

The shortcuts below are the default. **Settings > Keymap** (or *Preferences: Keymap* in the palette) switches to **VS Code**, **JetBrains** (IntelliJ, Rider, WebStorm: double-Shift for the palette, Ctrl+K commit, Ctrl+Shift+K push, Ctrl+T pull) or **Visual Studio + ReSharper** (Ctrl+T / Ctrl+Shift+A palette). *Preferences: Keyboard Shortcuts* (Ctrl+/) lists every binding of the active keymap.

| Key (default) | Action |
|---|---|
| Ctrl+P / Ctrl+Shift+P | Command palette |
| Ctrl+K | Commit (options, then message) |
| Ctrl+Shift+C | Write commit message in the editor |
| Ctrl+Enter / Ctrl+Shift+Enter | Commit staged changes / commit without hooks |
| Ctrl+Shift+A / Ctrl+Shift+U | Stage all / unstage all |
| Ctrl+B / Ctrl+Shift+B | New branch / checkout branch |
| Alt+F / Alt+L / Alt+P | Fetch / pull / push (with options) |
| Alt+S / Alt+Shift+S | Stash / pop stash |
| Ctrl+F | Find commits |
| Ctrl+G / Ctrl+Shift+G | Go to branch / go to commit |
| Ctrl+0 | Working directory |
| Ctrl+H | Command history |
| Ctrl+Shift+H | Hooks |
| Ctrl+T / Ctrl+W | Open repository in a new tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+1..9 | Next / previous / nth tab |
| Ctrl+O / Ctrl+Shift+O | Open repository / open recent |
| Ctrl+\` | Toggle console |
| Ctrl+\\ | Toggle sidebar |
| Ctrl+, / Ctrl+/ | Settings / keyboard shortcuts |
| F5 | Refresh |
| Up / Down | Move through commits |

The window uses a custom title bar: repository **tabs** on the left, the branch switcher, the command bar in the middle (it shows the running command, the hook inside it, and how many commands are queued) and window controls on the right.

## Tabs

Open as many repositories as you like, each in its own tab with its own state, console and command queue. Tabs are restored on launch. Background tabs don't touch git until you switch to them. Opening a submodule opens it in a tab.

## Command queue and history

Every git command is queued per repository and runs strictly in order, never two at once. Pull, checkout another branch, pull, checkout, pull: fire them as fast as you like and they execute exactly in that sequence. Staging and other index writes wait their turn too, so git never trips over its own lock. The console lists the queue (with position numbers and a button to drop a waiting command), the running command, and the history: every command with its output, exit code and failing hook, kept across restarts. *View: Command History* (Ctrl+H) searches it.

When a command is blocked by local changes, Odysseus offers to stash them, retry, and restore them. When git has no author identity yet, it asks for your name and email right there instead of failing.

## Context menus

Right-click a commit for the full menu: checkout / delete / rename / copy / set or unset upstream / search for the branches on that commit, delete or copy remote branches, checkout commit, revert, cherry-pick, copy the hash, **Create** (branch or tag here), **Edit** (edit the message of any commit, amend with staged changes, drop a commit) and **Reset to this commit** (soft, mixed, hard), plus hiding branches. Right-click a branch (sidebar or ref label) for checkout, delete, rename, copy, hide, hide all others, set / unset upstream, search (show only that branch's history), merge, rebase, new branch and push.

## Conflicts

Merge, rebase and cherry-pick conflicts are listed separately. Each conflicted file shows its conflict regions and resolves with *use ours* / *use theirs* (labelled for rebases, where the sides are swapped) or *mark resolved* after editing. Abort or continue the operation from the banner.

## Submodules

A **Submodules** section in the sidebar (always there, like Stashes, with an *Add submodule* entry when empty) shows each submodule's state: up to date, checked out at a different commit, not initialized, or conflicted, including nested submodules. Double-click to open a submodule as its own repository (the title bar shows the parent so you can jump back), or initialize it if it isn't checked out. Changed submodules are flagged in the working directory with what changed inside them (new commits, modified or untracked content) and can be updated in place. The palette covers update (recorded or latest remote commit), add, sync URLs and deinit, and pull / fetch can recurse into submodules.

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

- Stage, unstage and discard files, **hunks, or individual lines** (click lines, shift-click for a range) with buttons; the UI updates instantly and git confirms right after
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
