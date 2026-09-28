# Odysseus

A fast desktop Git client with Git hooks treated as a first-class citizen.

## Why

Most GUI Git clients handle hooks poorly:

| Problem | Odysseus |
|---|---|
| Hooks fail with `command not found` (node, npx, pnpm, python…) because GUI apps don't get your shell's PATH | Loads your login-shell environment (nvm, volta, asdf, pyenv, homebrew), adds Git for Windows' POSIX tools, and lets you add extra PATH entries. The Hooks view warns about commands your hooks use that can't be found. |
| You only see a blob of error text after the hook finishes | Output streams live, with ANSI colors, into the **Hook Console** |
| No idea *which* hook failed or how long it ran | Each hook is tracked through git's own `trace2` event stream: name, duration and exit code for every hook in a run |
| A hung hook freezes the commit | Cancel button plus an optional per-hook timeout. The whole process tree is killed, including MSYS children on Windows. |
| Failed commit = lost message | The message is kept (drafts persist too). A failure card shows the hook's output with **Retry** and an explicit, confirmed **Commit without hooks** |
| Formatters in pre-commit silently leave changes unstaged | Detects files the hooks modified after staging and offers to stage them |
| Hooks are invisible | **Hooks view**: see every hook, respect `core.hooksPath`, detect husky / lefthook / pre-commit / overcommit / simple-git-hooks, edit, enable/disable, fix the exec bit, and **Run now** (via `git hook run`) to test a hook without committing |

Everything runs through the real `git` CLI, so hooks behave exactly as they do in your terminal.

## Features

- Commit graph (virtualized, handles thousands of commits), filtering, keyboard navigation
- Working directory: stage/unstage/discard files, **hunks, or individual lines**
- Commit, amend, sign-off; merge, rebase, cherry-pick, revert, reset, abort/continue operations
- Branches, remotes, tags, stashes; fetch / pull / push (with upstream setup)
- Dark and light themes; portable mode

## Develop

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck
npm test           # end-to-end tests of the git/hook engine against real temp repos
```

## Build

```bash
npm run dist:portable   # Windows: dist/Odysseus-<ver>-portable.exe — single file, no install
npm run dist            # all targets for the current OS (Windows: portable + zip, macOS: zip + dmg, Linux: AppImage + tar.gz)
```

### Portable mode

The portable `.exe` keeps all settings, recent repos and caches in an `odysseus-data` folder next to itself — nothing is written to `%APPDATA%`, so it runs from a USB stick or a shared folder. With the `.zip` build, create an empty `odysseus-data` folder beside `Odysseus.exe` to enable the same behaviour.

Requires Git ≥ 2.36 on the machine (for `git hook run`; hook tracking needs trace2, available since 2.27).

## Shortcuts

| Key | Action |
|---|---|
| Ctrl+Enter | Commit |
| Ctrl+O | Open repository |
| Ctrl+\` | Toggle Hook Console |
| Ctrl+, | Settings |
| F5 / Ctrl+R | Refresh |
| ↑ / ↓ | Move through commits |
