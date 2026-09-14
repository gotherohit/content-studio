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
  real videos. All testing goes in `D:	est content studio` — create the folder if it is
  not there, make a scratch project inside it, and delete it when done. **Confirm the open
  project's name before acting**: a selector that misses falls through to whatever was
  already open, which is how a saved snippet was overwritten and then deleted here. There
  are no backups of `project.json` and no shadow copies on this machine.
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
