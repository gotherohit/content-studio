# Working on Content Studio

Notes for whoever picks this up next — another session, another harness, or the author in
six months. Read this before changing anything.

**Also read [AGENTS.md](AGENTS.md)**, and any `AGENTS.md` in the directory you are working
in — the nearest one wins for that subtree. It carries the sandbox rules every agent must
follow, and it points back here for everything else. This file stays the source of truth
for architecture, invariants and process; AGENTS.md is the source of truth for how testing
is allowed to touch this machine. Keep them in step.

## What this is

The research pane is branded **Vajra**; its persisted pane kind remains `ai` for compatibility.
`update_plan` stores bounded model-reported steps alongside conversations, not in project autosave.
Conversation renames and runs share an exclusion check; never let a metadata write overwrite an
active transcript. A completed response does not automatically complete unfinished plan steps.
Vajra attachments store extracted text in the server-owned conversation, while visible user
messages and Markdown exports contain only attachment metadata. Keep attachment limits enforced
on the server. A later `read_history` tool call can reveal a bounded attachment excerpt in its
visible activity output so an agent can recover context after a long conversation.
The highlight popup deliberately focuses its note input. Pass its captured `selectionText` so
Ctrl/Cmd+C can copy the passage when that note is empty; preserve native copy for typed notes.
Highlight `noteWidth` stores a preferred comment-card width, not its height or position.
Clamp the displayed card to its current Source pane without overwriting the saved preference
on layout resize. Vajra's sidebar must never remount its chat or abort a run when toggled.

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

- **A file source is its file.** The project folder is the source of truth: `adoptFolderFiles`
  adds a source for anything in `sources/` and drops the sources whose files have gone. So
  removing a file source must delete the file (`removeAsset`, to the Recycle Bin) or the next
  open adopts it straight back, with a new id and no highlights — which is exactly what it did.
  A `kind: "code"` source points at a file outside the project and must never be deleted.
- **Adoption is decided inside `mutate`, against the project as it stands.** The listing is
  asynchronous, so a decision taken against the project handed in adopts a file that has
  already been adopted since: the same source twice. `adoptFiles` in `client/src/sources.ts`
  holds the rule and is unit-tested; it returns null when nothing changed, so an open does not
  mark the project dirty.
- **One JupyterLab serves the whole app, and its root cannot change without a restart.** A
  folder is therefore a restart, and a restart takes every kernel with it. `client/src/jupyter.ts`
  holds the rules — which folder a pane wants (beat, then project setting, then the project
  folder) and whether it may move the server (only with no kernel alive; otherwise it offers).
  `jupyter.kernels()` asks Jupyter, because kernels belong to it. Two Jupyter panes wanting
  different folders is the same situation: the second one shows the offer.
- **A beat captures the folder Jupyter is actually in**, reported by the pane through
  `onShowing`, not the one it asked for — otherwise a beat taken while the server was busy
  elsewhere would restore a folder that was never on screen.
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
- **Map filters change visibility, not coordinates.** Keep layout based on the whole graph so
  narrowing relationships or focusing a source does not make a beat's map jump. Fit changes
  only the viewport; restoring dragged nodes is a separate action. A route uses currently
  enabled relationship types and must fit its visible path when picked. Give every mounted
  map its own SVG marker IDs, because several map panes can appear at once.
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
- **PDFs are ours, not the browser's.** Chromium's viewer is a plugin in an iframe: it scrolls
  badly inside a pane, says nothing about which page is showing and swallows the keys, so a
  beat could not capture a page. `PdfView` rasterises with pdf.js, one canvas per page and only
  near the viewport, and reports the page through `PaneView.slideIndex` — the same field a
  Markdown deck uses, so beats, capture and restore work unchanged. Its geometry lives in
  `client/src/pdf.ts` and is unit-tested; the component holds no page maths of its own.
- **A link can be finished from the source rather than a list.** `pendingLink` in `App` holds
  the half-made link; `addHighlight` and `selectFromPage` both call `finishPending`, so a new
  quote, a new drawing or a click on something already there all complete it. Anything new that
  names a passage should call it too, or that route will quietly not work.
- **Passage dots on the map are placed deterministically**, in the order the passages were
  highlighted, over the top three quarters of the node — the bottom is where its name sits, and
  a dot there disappears under the label. Nothing about the map may depend on chance: a beat
  can show it, and it must look the same every take.
- **A link may have both ends in one source.** `buildGraph` already skips an edge whose ends
  are the same source, so the map ignores those links; they live on the cards and in the note
  markers. The link dialog demands a passage in that case — a source linked to itself with no
  passage would say nothing.
- **A marker is the only thing on a source that says "there is more here".** It appears for a
  comment or for either end of a link, in the app's own overlay and in `inject.js`; the app
  tells the frame which passages are linked by flagging them in the list it posts. Clicking one
  opens `NotePopover` in the pane, so the live page never draws the note itself — it sends the
  marker's position and the app puts the card over the frame.
- **A drawn shape is a highlight with a `shape` on it.** Same trick as code and PDF
  highlights: cards, comments, colours, links, the map, beats and Copy as markdown all work
  with no new plumbing. Everything that lays marks over text must therefore filter the list
  through `textHighlights()`, or `applyHighlights` would try to mark a shape's anchor quote.
- **A drawing may cover several blocks.** `blocks` stores their quote anchors, and `hostFor`
  returns their combined bounds. Choosing one paragraph (or falling back to the body) loses
  the drawing when stacked sections become columns. Keep `blocks: undefined` in a new
  single-block anchor so spreading an edit clears the old group. Old page-only drawings
  cannot be inferred safely; an explicit move/resize or redraw attaches them to content.
- **Highlights must resolve the displayed source, not only the sidebar selection.** A pinned
  Source pane can differ from the sidebar. `highlightSourceFor` resolves the closest Source
  pane; use that same source for rendering, editing, deleting, selecting and copying cards.
- **Source navigation changes a pane, not just sidebar state.** Queue a destination, choose
  the sole Source pane or ask when several exist, then use `navigateSourceLayout`. Before
  changing the active source, pin other following panes to their current source. Clear only
  the chosen pane's view and scope the highlight jump to it; otherwise old browsed pages and
  beat positions win over the navigation, or duplicate panes all jump. Cancel must not mutate
  project or selection state. With no Source pane the first pane is used.
- **Every outline, arrow head and default style lives in `server/public/shapes-geom.js`.** The
  app (`ShapeLayer`) and the live page (`inject.js`) both draw from `shapePath`, `shapeHeads`,
  `resolveStyle` and `paint`, so a drawing looks the same in Reader and Original; never draw a
  kind in one renderer only. The palette is hex in that file, not CSS variables: the strong
  shades are the same in both themes, and the framed page has no access to the app's CSS.
- **Style fields on a shape are optional, and their absence is the old look.** `resolveStyle`
  must keep returning an outline in the drawing's own colour, 2.5 px, no fill, for a shape
  without them — every drawing saved before 0.29.0 depends on it, and a test pins it.
- **A drawing is rebuilt from geometry when it is moved, and that loses its paint.** `fromDrag`
  returns only the kind and the box. Every edit path merges it over the old shape
  (`{ ...was.shape, ...shape }`) — Reader, PDF, image, the live page's `shapeEdited`, and the
  live drag preview. A new route that rewrites a shape must do the same.
- **New drawings take their kind's remembered style in one place:** `addHighlight` in
  `SourcePane`, where every surface's drawings arrive. `settings.drawStyles` holds only the
  fields the creator changed, per kind, so the kind's own defaults still apply to the rest.
- **`HighlightPopup` is rendered on its own by a test**, transpiled in isolation, so it must not
  import values from sibling modules. Callers hand it the palette.
- **A menu over the source must close on `pointerdown`, not `mousedown`.** Starting a drawing
  calls `preventDefault` on the press so the page underneath does not select text, and a
  cancelled press sends no `mousedown` at all.
- **The element being dragged must keep its identity.** Moving a drawing is a pointer capture
  on the shape; rendering the drag as a *different* element (a preview with another key) takes
  the captured node out of the document and the drag dies on the first move. The same element
  is re-rendered with the pulled geometry instead — resizing worked and moving did not, which
  is exactly this difference: the handles kept their keys.
- **What a drawing is anchored to must be what `hostFor` will find.** `anchorForRect` settles
  its choice by asking `hostFor` for the quote it just took: a container's first words belong
  to its first paragraph, so the two disagreed and the drawing was kept against one box and
  drawn against another.
- **A drawing that barely sits on a block belongs to the source.** Below 30 per cent overlap the
  anchor is the root with an empty quote; otherwise a drawing dragged into the white space is
  kept as fractions of a paragraph it no longer touches and the spill clamp squashes it.
- **Every scroll in a page reaches a capture listener, not just the page's own.** A scroll
  event does not bubble, so everything listens in the capture phase — and a carousel, a sticky
  column, a lazy image or an advert scrolling then looks exactly like the article moving. The
  note box was closed on that message, so on a real site it vanished mid-word and took the
  comment with it. `server/public/scrolls.js` decides: the target must be the page itself *and*
  the offset must really have changed.
- **A note in progress is the person's, not the page's.** Once anything has been typed into the
  highlight box, nothing the framed page does closes it — not a scroll, not a stray mouseup.
  Only committing it, `Esc`, the close button, or moving to another source does. The box also
  focuses itself in a layout effect and asks again on the next frame rather than using
  `autoFocus`: a live page can take the focus back as it settles, and the first word typed
  would go to the article.
- **Keys pressed inside the framed article never reach the app.** `inject.js` forwards
  Delete as `shapeDelete` when a drawing is chosen, the way it forwards presentation keys.
- **A drawing belongs to what it covers, not to where the drag began.** `anchorForRect` picks
  the element with the largest overlap with the drag rectangle, preferring a picture inside a
  figure. Anchoring to the element under the starting point bound a box drawn *around* a
  paragraph to the heading above it — the gap belongs to the heading — and the drawing came back
  as fractions of something one line tall. `fromDrag` also allows half a box of spill either
  side, or a box around a paragraph would be clamped to the paragraph itself.
- **The note markers open on `pointerdown`, not on click.** A marker is re-placed on every
  scroll of a PDF and every reflow of an article, and a click needs the press and the release to
  land on the same element, so most presses did nothing and the feature looked broken. The click
  handler stays for the keyboard. The card opens above the marker when there is no room below,
  or it is clipped out of sight by the pane.
- **A shape is fractions of what it was drawn on, never page coordinates.** A PDF page or an
  image is that thing; over prose it is the paragraph the drag started in, identified by the
  same kind of quote anchor a highlight uses (`shapes-dom.js`), or the picture by its `src`.
  That is what keeps a drawing on its paragraph when the pane changes width. The geometry is
  in `server/public/shapes-geom.js` so the injected script and the app share one definition.
- **The overlay must not eat the page.** `.shape-layer` takes the pointer only while a tool is
  out, and a shape is grabbed by its stroke (`pointer-events: stroke`), or an article would
  stop being clickable and text could not be selected. In Present mode the tool is forced to
  null: a tool left armed would swallow every click of a take.
- **The PDF canvas is written by hand, so the shapes cannot live in the page div.** `paint()`
  calls `replaceChildren`, which would remove them; the layer is a sibling inside
  `.pdf-page-wrap`.
- **Shapes in a live page are drawn relative to the overlay's measured origin.** A positioned,
  centred body makes document coordinates wrong: adding scroll offsets double-counts its
  margins, and resizing changes the error. Use `boxWithin` for drawings and note markers.
  Reflow without a DOM mutation (images loading, for example) needs resize/load listeners too.
  Placements are coalesced without resetting the timer, so a busy page cannot starve them.
  Shapes are placed again
  on resize, on mutations and when the fonts settle — with its own MutationObserver
  disconnected during its writes, or placing them would trigger another placement forever.
- **An inline background is taller than the line it sits on.** It fills the font's content
  area, not the line box, so on a site with tight leading a highlight covered the text above
  and below. Both `mark.hl` and the injected `rs-hl` paint the colour as a background band of
  `min(1.2em, calc(1lh - 3px))` with `box-decoration-break: clone`, never a plain
  `background-color`. The PDF text layer keeps the plain wash: one line per span, nothing to
  overlap.
- **A PDF highlight is anchored inside one page's text layer.** The layer pdf.js builds for
  selection is an ordinary DOM, so `captureRange`/`applyHighlights` work on it unchanged — the
  root is that page's layer, never the scroller, and the page number goes on the highlight
  (`page`, 1-based). A selection across two pages has no single root and is refused. Marks are
  re-applied whenever a page is painted, because a canvas is dropped as soon as it scrolls away.
  They sit over the canvas, so they carry opacity rather than an opaque colour, or the glyphs
  underneath would disappear.
- **Scrolling a chosen highlight into view uses `block: "nearest"`.** Centring it pushed its own
  page off the top of the pane, and the counter then named the page before it.
- **pdf.js fetches character maps, standard fonts and WASM decoders by URL at runtime.**
  `client/scripts/copy-pdfjs.mjs` copies them into `client/public/pdfjs/` before dev and every
  build (`predev`/`prebuild`); the copy is generated and gitignored. Without it, a PDF with
  embedded CJK or JPEG 2000 images renders blank with no error in the pane.
- **Measure the pane before the document arrives.** Returning a "loading" element instead of the
  host meant the `ResizeObserver` never attached, the width stayed zero and every page was laid
  out one pixel tall. The host is always rendered; the message sits over it.
- **The last page can never reach the top of the pane.** "Which page am I on" is the page under
  the top third of the viewport, except at the very bottom, where it is the last page —
  otherwise `End` on a short last page reports the one before it.
- **Rasterising is main-thread work, so it waits for the scroll to settle** (90 ms). Painting
  every intermediate position of a fling halves the frame rate for pages already scrolled past.
- **In Present mode the arrows belong to the beats.** Every pane that pages on arrow keys —
  Markdown slides, decks, PDFs — must stand down while presenting, or → both advances the beat
  and turns the page.
- **A key handler attached in an effect sees the state of the render that attached it.** The
  Markdown slide keys called a setter that computed "next" from the slide number captured at
  attach time, so → could never get past slide two. Read current state through a ref that is
  updated every render (`pageSlides` in `SourcePane`), or list what the handler reads as
  dependencies so it is re-attached.
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
- **The readiness check must be cheap.** `startServer()` waits for `/api/health`, which only
  answers. It used to wait for `/api/config`, which detects browsers, PowerPoint and
  LibreOffice — 4.5 s warm, and long enough on a freshly installed copy being scanned that the
  app gave up with "The studio server did not start in time" and quit. Never put discovery,
  the vault, or anything that spawns a process behind the route the app starts up against.
- **An update can be refused after the app has already quit.** electron-updater asks Windows
  to run the installer and quits immediately, so anything that refuses it afterwards looks
  like the button doing nothing. Windows 11 Smart App Control refuses unsigned installers —
  ours are unsigned — and refuses the elevated retry too, silently. `installUpdate()` in
  `electron/main.js` therefore starts the installer itself, falls back to `elevate.exe` the
  way electron-updater does, waits for the installer to appear in the process list, and only
  then quits; otherwise it reports it. Note the direct start fails with `UNKNOWN` on a healthy
  machine too — that is "needs elevation" — so the process list, not the error, is the proof.
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

Vajra extensions are scoped at the server boundary. Global skills are under the app folder's
`skills/<id>/SKILL.md` and project skills under `<project>/.ai/skills/<id>/SKILL.md`;
MCP configuration is `mcp.json` in the corresponding scope. Do not let extension reads follow
symlinks, expose secret environment values, or let MCP tool calls bypass per-call review.
Only server configurations fingerprinted in app-level `mcp-trust.json` by a Settings save may
connect automatically; importing a project or editing `mcp.json` invalidates that trust.
Connections belong to one agent run and must close on cancellation. `apply_patch` may change
an existing project text file after review, but must not change `project.json`, `.ai`, secrets,
or files outside the configured project. Verify both scope isolation and the approval event
when adding another extension transport or tool.

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
