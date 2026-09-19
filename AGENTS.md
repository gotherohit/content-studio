# AGENTS.md

Instructions for any coding agent working in this repository — Codex, Gemini CLI, Copilot,
Cursor, Claude Code, or anything else.

## Read these first, in this order

1. **[CLAUDE.md](CLAUDE.md)** — the substance. What this app is, how the three processes fit
   together, the invariants that must not be broken, the gotchas that each cost a day, and
   how to cut a release. It is the single source of truth; this file does not repeat it.
2. **This file** — anything below applies on top, and to every agent.
3. **Any instruction inside the directory you are working in.** Nested `AGENTS.md` files
   take precedence over this one for the subtree they sit in.

If the two files ever disagree, CLAUDE.md wins on architecture and process; this file wins
on the sandbox rules below. Fix the disagreement rather than choosing silently.

## The rules that matter most

These are restated here so that an agent reading only this file still cannot cause harm.
CLAUDE.md explains why each exists.

**This machine both develops and uses the app.** Real video projects live on it. Treat every
existing project as production data.

**Never create, edit or delete a project that already exists.** Not to test a feature, not
to check a fix, not "just to look". A project may hold hours of research that exists nowhere
else — there are no backups of `project.json` and no shadow copies on this machine.

**All testing goes in a dedicated folder: `D:\test content studio`.** Create it if it is not
there. Make test projects inside it, use them, and delete them when finished. If a scratch
project you expect is missing, make a new one there — never fall back to a real project.

**Confirm which project is open before touching anything.** Read the title in the sidebar,
or the folder path, and check it is the test one. A selector that misses silently falls
through to whatever was already open; that has caused real data loss here.

**A second server instance is not isolated.** Every instance shares `~/.content-studio/`, so
a test server that registers or deletes a project rewrites the *real* index. Deleting a
*copy* of a project also unregisters the original, because the id lives inside its
`project.json`. Isolate with a scratch project folder, never by running a second copy
against real data.

**The server binds loopback only.** It runs shell commands, moves the mouse and reads files
with no authentication. Never widen the bind address or add anything that skips the peer
check.

**Nothing of the user's belongs in the repository.** No project data, no `config.json`, no
`credentials.json`, no `.env`, no absolute paths into personal folders. Check before
committing.

## How to work

- **Verify in the running app, not just the compiler.** A passing `tsc` says nothing about
  whether a pane works. Launch with `--remote-debugging-port`, drive the real UI, read the
  state back.
- **Clean up.** Remove test projects, providers, beats and files you created, and say so.
  Close development app instances you launched for verification too: a hidden copy holds
  the single-instance lock and can prevent the installed app from appearing.
- **Scope UI selectors to what you mean, and re-check the open project before every write.**
  Project rows in the sidebar have their folder path as a tooltip, so matching `.list-item`
  by title text finds a *project* whose path contains the word — this opened a real project
  during a test. Select source rows by their own markup, and confirm `.title-input` still
  names the scratch project before each action that could save.
- **Write scripts and edits that contain backslashes with the file tool, not a heredoc.** On
  this machine the shell collapses `\\` in heredocs and Python turned `\\r\\n` into real line
  breaks inside source files; the file tool also turned `\u` escapes such as the byte-order mark into raw characters. Build
  a backslash as `String.fromCharCode(92)` / `bytes([92])` when a script must emit one, and check
  edited files for raw control characters before committing.
- **Deleting in a Files test puts a real file in the Recycle Bin.** Only delete scratch files
  inside the sandbox, and say so in the report.
- **Add regression tests with every change.** A test that fails on the old code for each bug,
  tests for each new behaviour, and the full `npm test` suite passing. Re-run the existing
  flows the change touches in the running app, on a scratch project. See CLAUDE.md.
- **Report honestly.** Name what you did not test. Write down real limits rather than
  letting them be discovered mid-recording.
- **Keep the documentation current in the same commit** — `docs/guide.md` for features,
  `CHANGELOG.md` for anything in a release, `CLAUDE.md` and this file for hard-won rules.
  See the table at the end of CLAUDE.md.
