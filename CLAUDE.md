# Working on Content Studio

Notes for whoever picks this up next — another session, another harness, or the author in
six months. Read this before changing anything.

**Also read [AGENTS.md](AGENTS.md)**, and any `AGENTS.md` in the directory you are working
in — the nearest one wins for that subtree. It carries the sandbox rules every agent must
follow, and it points back here for everything else. This file stays the source of truth
for architecture, invariants and process; AGENTS.md is the source of truth for how testing
is allowed to touch this machine. Keep them in step.

## What this is

A Windows desktop app for one person: a YouTube creator who reads technical news and blog
posts, researches them, and records an explanation with his own analysis. Everything for
one video — sources, highlights, notes, slides, notebooks, terminal, canvas, AI chat and
the running order — lives in one project folder and one window.

It is used **live, while recording**. That shapes every decision below: a thing that
interrupts, restarts, or surprises during a take is worse than a missing feature.

## Shape

Three processes, one app.

```
Electron main  (electron/main.js)
  ├── forks the Express server as a child, ELECTRON_RUN_AS_NODE, first free port from 4700
  ├── studio window        → http://127.0.0.1:<port>/
  └── presenter window     → http://127.0.0.1:<port>/?presenter=1   (always on top)

Express server (server/)   → API, reverse proxy, PTY, Jupyter, slides, desktop input
React client   (client/)   → the whole UI, built by Vite into client/dist/
```

The server serves `client/dist` in production, so the window loads a real origin rather
than `file://`. That is why websockets, cookies and the `<sub>.localhost` proxy all work.

| File | What it owns |
|---|---|
| `electron/main.js` | windows, the server child, updates, DPAPI bridge, presenter relay |
| `electron/preload.cjs` | the only bridge between page and desktop |
| `server/index.js` | every route; the loopback guard is at the top |
| `server/site.js` | the reverse proxy: `read` mode caches an article, `app` mode pipes a live app |
| `server/credentials.js` | providers and keys, encrypted through `vault.js` |
| `server/ai.js` | both wire protocols, streamed |
| `server/research-agent.js` | durable conversations, bounded agent loop, approvals and cancellation |
| `server/agent-model.js` / `server/agent-tools.js` | provider tool calls and reviewed local tools |
| `server/research-search.js` | search credentials and Tavily requests |
| `server/slides.js` | PowerPoint COM, per-slide export |
| `server/files.js` | the Files pane: list, read, save, create, rename and delete, confined to the chosen folder |
| `client/src/App.tsx` | project state, layout, beats, the presenter bridge |
| `client/src/Presenter.tsx` | the second window; holds no project state |

## Invariants — do not break these

**The server is loopback-only.** It binds `127.0.0.1`, rejects non-loopback peers, and
limits CORS to local origins. It can run code, drive the mouse and read files with no
password, so this is the only thing standing between the user and anyone on their WiFi.
This was a real incident, not a hypothetical. `HOST` exists as a deliberate, warned
override. Never widen it, never add a convenience that skips the check.

**Nothing of the user's goes in the repo.** Projects live in folders they choose, app
state in `~/.content-studio/`. No project data, no
`config.json`, no `credentials.json`, no `.env`. Check before committing.

**Keys are write-only from the UI's point of view.** A key is sent once and never comes
back — the client sees `hasKey` and the last four characters. Errors from providers are
scrubbed before display. Do not add an endpoint that returns a key, however convenient.

**The raw-body upload route must stay above `express.json()`** in `server/index.js`.
Below it, the JSON parser eats the body and `fs.writeFile` gets an object and crashes the
process.

**A project owns a subfolder, never the folder that was picked.** `projectFolder()` puts
`<chosen>/<slug>` on disk, so deleting a project can only ever remove the project. Delete
also refuses any folder without a `project.json` in it. Both guards exist because the
chosen folder used to *be* the project folder, which put everything beside it one
confirmation away from `fs.rm`.

**A stage stores references, never copies.** Beats point at sources, highlights and files;
they never snapshot content. Improving the material must improve every beat that uses it.

**Every failure must be visible.** Express 4 does not catch async rejections, so a
route that throws leaves the request hanging and the UI showing nothing at all. Wrap
route bodies that touch the filesystem, and give the client a `catch` that calls
`setError`. A silent no-op is the worst outcome in an app used while recording.

**Nothing restarts or steals focus by itself.** Updates download in the background and
wait. The AI request aborts when the pane closes. Assume a recording is in progress.

## Gotchas that cost time

- **Count highlights by identity, never mark fragments.** A single selection across inline
  formatting creates several marks, so a fragment count cannot detect lost highlights.
  Reader and Original share `server/public/highlights.js`: capture and replay use the same
  visible-text index. Disconnect the repair observer during our own writes, and defer
  repairs while the user is selecting text.

- **Jupyter's iframe and Studio must use the same loopback hostname.** `localhost`
  inside `127.0.0.1` is cross-site: the page can load with a URL token while its kernel
  WebSocket is refused with 403 because the login cookie is missing. Keep token and XSRF
  authentication enabled; fix the host rather than disabling browser protections.
- **Jupyter already uses the project as its root.** Never append the old
  `<project-id>/files` URL. Keep Lab workspaces under that project's `.jupyter/` folder,
  and launch `python -m jupyterlab` directly to own the real server process. The legacy
  root-based process cleanup remains for servers orphaned by earlier versions.

- **A hidden development copy can block the installed app.** Both use the same
  single-instance lock. Close verification copies when finished, and explicitly `show()`
  the existing window before focusing it when the executable is launched again.

- **Research transcripts are server-owned**, under `<project>/.ai/conversations/` or
  `~/.content-studio/conversations/`. Never put them back in project autosave: a second
  pane can overwrite a running conversation. Reserve a run before asynchronous work,
  checkpoint tool calls/results, and await cancellation during shutdown. Moving or deleting
  a project must be refused while its research agent is running.
- **Share one vault instance across credential stores.** Its IPC request ids are local
  to the instance; independent instances can collide and resolve the wrong encryption reply.
- **Research shell cwd is not a sandbox.** File tools enforce project/workspace boundaries;
  shell commands need explicit review and run with the user's account. Keep that distinction
  visible in the approval UI and documentation.

- **`PORT` is taken by tooling.** The server reads `API_PORT`.
- **`node --watch` crashes node-pty** on Windows (conout worker). `dev:server` has no
  watcher on purpose.
- **node-pty needs no rebuild.** Its prebuilds are Node-API, so they run under Electron's
  ABI. `build.npmRebuild` is `false` because this machine has no Visual Studio, and
  `electron-builder install-app-deps` therefore fails.
- **`asar: false` is deliberate**, so `ROOT = resolve(electron/..)` still finds `server/`
  and `client/dist/`.
- **`DEV` is gated on `CS_DEV=1`**, not just `!app.isPackaged`, or an unpackaged run
  silently loads a stale Vite server.
- **PowerShell `-Command -` consumes stdin**; the input bridge must be launched with
  `-File`. The folder picker needs `-STA` and a plain `ShowDialog()`.
- **PowerPoint's `Presentation.Export` reports success and writes nothing.** Slides must be
  exported one at a time.
- **A window that subscribes late misses what was already published.** This bit both the
  update banner and the presenter window. Anything IPC-published needs a way to ask for the
  current state on mount.
- **Window previews must never forward pointer movement.** They share the physical
  desktop cursor with Studio, so forwarding causes feedback and lost drags. Native app
  interaction is an explicit handoff; Electron owns its return toolbar and temporary
  shortcut. Only hide the toolbar when the shortcut registered successfully. The input
  helper briefly attaches to the foreground input queue for that focus request and always
  detaches afterwards; a failed activation must remain visible to the user.
- **Beat restoration belongs to each pane, after its content is ready.** Keep reading
  positions separate from the live scroll reports, tag iframe replies with the restoration
  nonce, and use instant scrolling. Document scroll events fire on `document`, not the
  document's scrolling element. A concealed iframe may suspend animation frames, so
  acknowledge its synchronous restore without waiting for one. Excalidraw can expose its
  API after the initial effect: restore again when that API arrives.
- **A reading-position anchor must be article content.** Real sites put a fixed header and
  a sticky contents list first in the DOM; both intersect the viewport at every depth, so
  "first visible block" anchored to them and restoring "relative to the header" left the
  page wherever it was. Capture skips zero-height, empty and fixed/sticky blocks and records
  which copy of a repeated text it used. Test at desktop pane widths: below about 1000 px
  such sites collapse their header to 0 px and the bug disappears.
- **A pane that changes width must put its passage back.** Collapsing the sidebar and entering
  Present mode both widen the article pane; the scroll offset survives the reflow but the
  passage does not, and Chromium's scroll anchoring only sometimes saves it. The tracker holds
  the last captured position and restores it whenever the scroller's width differs from the
  width it was captured at — checked *before* any capture, so the scroll event the reflow
  itself causes cannot overwrite it. Reproduce by toggling the sidebar after the 2.5 s
  restore window, not during it.
- **A browsed page is not a source.** Same-site links navigate the Original frame and set
  `PaneView.page`; the frame's `src` only changes when the app asks for a different page, or it
  would reload pages that routed themselves. Page identity comes from `server/public/pages.js`,
  shared by the frame and the app. Highlights are gated to the source's own page inside
  `inject.js`, restore requests and acknowledgements carry the page, and live positions are
  tagged with it, so nothing from one page is applied to another. Back/Forward are the pane's
  own list: `history.back()` in the frame walks the studio window's joint history.
- **Anything drawn in the studio window can be recorded.** The source summary is hidden in
  Present mode and capture messages are not shown there; keep it that way for anything new.
- **A click inside an article frame never reaches the studio document.** A popover closed by
  an outside `mousedown` stays open when the click lands in the page; close it on the
  window's `blur` too, as the Source pane's ⋯ menu does.
- **Links live in `project.links`, not on highlights.** Backlinks are derived from the list, so
  there is one place to change. Every delete of a source or a highlight must run `pruneLinks`
  in the same `mutate`: a missing source removes the link, a missing highlight degrades it to
  the whole source. The map's layout (`layoutGraph`) is deterministic on purpose — beats can
  show it, so it must look the same every take; never seed it randomly.
- **The Files pane can write anywhere the creator points it.** Existing paths go through
  `resolveInside` and new names through `resolveNew`; both check the folder before *and after*
  following links, because a junction inside the folder can point anywhere. Saves carry the
  mtime the file was opened at and are refused on a mismatch. Create and rename never replace
  an existing name (`wx` for files; a case-only rename is the one exception). Delete only ever
  goes to the Recycle Bin. Never add a "just overwrite" or permanent-delete path.
- **The Recycle Bin is reached through PowerShell with the path in the environment**, never in
  the command text. `RECYCLE_SCRIPT` is a single `if … else` statement: joined with `; `, an
  `else` on its own is invalid PowerShell and every delete failed. A test parses the script
  without running it, because running it would fill the real Recycle Bin on every test run.
- **The editor's text is read, never copied per keystroke.** `onChange` carries no text and
  `handle.getDoc()` reads it when a save or highlight needs it — at 50 MB a copy per keystroke
  stalls typing. Highlights are located against `file.content` while there are no unsaved
  edits: right after a load the editor still holds the previous file until it renders.
- **A rename must move every reference.** `renameCodeRefs` moves code sources, beat views,
  pinned panes and links, and merges a source into an older one for the same file; `App`
  also moves live pane views and the selected source. Anything new that stores a file path
  belongs in it.
- **CodeMirror normalises line endings to `\n`.** The server reports each file's EOL and BOM
  and a save puts them back; without that a one-line edit rewrites every line of a CRLF file.
  The editor's document is only replaced when `docKey` changes, never from the `doc` prop on
  every render, or typing would be undone.
- **A code highlight is a highlight on a `kind: "code"` source**, created on first use, so
  links, backlinks, the map and beats work unchanged. It quotes its lines and relocates by
  them (`locateLines`). A focused beat restores without a text selection, so its lines live
  only in the saved view — `codeFor` keeps them on re-capture.
- **Beat rows are not clickable.** A beat is applied through its Show/Restore button or
  its number, so a verification script clicking `.beat-row` silently tests nothing.
- **The presenter proves it mounted by sending `sync`.** Main's watchdog resets that on every
  `did-start-loading`, reloads once on a failed load, crash or silent page, and then sends
  `presenter:failed` to the studio. A mounted flag that is never reset ignores later failures.
- **Closing the studio window does not quit while the presenter is open.** Close the
  presenter first when shutting down a verification instance, or its single-instance lock
  makes the next launch exit immediately.
- **A second server instance is not isolated.** Every instance shares
  `~/.content-studio/`, so a test server registering or deleting a project rewrites the
  *real* index. Deleting a clone of a project also unregisters the original, because the
  id lives inside `project.json`. Overriding `USERPROFILE` gives the server its own home
  but stops Electron starting, so isolate by using a scratch *project folder*, never by
  running a second copy against real data.
- **The app holds its own project folders open.** JupyterLab is rooted at the project dir
  and every Terminal PTY has it as `cwd`, and Windows will not delete a folder a process is
  working in. Deleting a project must call `jupyter.releaseUnder()` and
  `terminals.closeUnder()` first.
- **`child.kill()` does not kill a tree on Windows**, and a tree kill is not enough either.
  `python -m jupyter lab` hands off to `jupyter-lab.exe` and *exits*, re-parenting the real
  server out of the tree entirely. The only reliable handle is its command line: find
  `--ServerApp.root_dir=<folder>` through the OS and kill that. `jupyter.findRootedAt()`
  does this; `releaseUnder()` and `shutdown()` both use it.
- **Kill with `spawnSync`, not `spawn`, on any path that exits straight afterwards.** An
  async `taskkill` never gets to run before `process.exit()`.
- **Quitting is asynchronous.** `before-quit` calls `preventDefault()`, asks the server to
  shut down over IPC, and quits for real when it exits or after 8s. Without that, Jupyter
  is orphaned every time the app closes.
- **Updates are ~115 MB and do not resume.** Restarting the app mid-download throws it
  away. If a user reports "it never updates", check for a part-file in
  `%LOCALAPPDATA%\content-studio-updater\pending\` before assuming a bug.

## How to work here

- **Verify in the running app, not just the compiler.** `npx tsc -b` passing means nothing
  about whether a pane works. Launch the app with `--remote-debugging-port`, drive the real
  UI over CDP, and read the state back.
- **And look at it.** State can be right while the screen is wrong. The canvas viewport
  feature passed every state check — pan and zoom captured and restored exactly — on a
  canvas that was zero pixels tall and had been invisible all along. Take a screenshot of
  anything a person is meant to see.
- **Never test against a real project.** This machine develops the app *and* uses it for
  real videos. All testing goes in `D:\test content studio` — create the folder if it is
  not there, make a scratch project inside it, and delete it when done. **Confirm the open
  project's name before acting**: a selector that misses falls through to whatever was
  already open, which is how a saved snippet was overwritten and then deleted here. There
  are no backups of `project.json` and no shadow copies on this machine.
- **Every change comes with regression tests, and must not break what already works.** Add a
  test that fails on the old code for each bug fixed, and tests for each new behaviour; run the
  whole `npm test` suite, not only the new file. Where a unit test cannot reach — a real site in
  the Original frame, a pane resizing — repeat the scenario in the running app against a scratch
  project, including the existing flows the change touches (beat switching, highlights,
  Present mode), and report what was and was not covered.
- **If CDP key events stop reaching a dev instance, restart it.** Once, mid-session, typed text
  still arrived but no keydown did — not even to a capture listener on `document` — until the
  instance was restarted. Check with such a listener before debugging the app.
- **Report honestly.** If something is untested, say which part. If a limit is real —
  approximate timestamps, a log that is not persisted — write it down rather than letting
  it be discovered mid-recording.
- **Match the surrounding code.** Comments explain *why*, never *what*. British spelling.
  No decoration.

## Releasing

```bash
npm version minor && git push --follow-tags
```

That bumps `package.json`, tags, and pushes. `.github/workflows/release.yml` fires on a
`v*` tag, builds the installer on a Windows runner, creates the release and uploads it with
`latest.yml`. Installed copies update themselves from there.

- The release must be **created and published before electron-builder uploads**, or the
  builder makes invisible drafts — one per racing upload.
- Updates jump **straight to the newest version**, never through intermediates. So
  `normalize()` in `App.tsx` must default every new project field (`beats: p.beats ?? []`)
  rather than migrating one version at a time.
- `npm run dist` builds an installer locally without publishing.

## Keep the docs current — this is part of the work

Documentation drifts silently, and this app is used by someone who will not read the source
to find out what a button does. **In any session that changes behaviour, update the docs in
the same commit as the change:**

| Change | Update |
|---|---|
| A feature, or how one is used | `docs/guide.md` |
| Anything a release contains | `CHANGELOG.md`, under the version being cut |
| A new invariant, gotcha, or hard-won fix | this file |
| A rule about how agents may touch this machine | `AGENTS.md` |
| Install, updates, or the top-level picture | `README.md` |

A release with no changelog entry is a bug in the release. If a session ends without the
docs matching the code, say so explicitly rather than leaving it to be discovered later.
