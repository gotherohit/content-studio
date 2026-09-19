# Changelog

What changed in each release, newest first. Versions are the ones the app updates itself to.

## 0.13.0

- **Link sources to each other.** Link a highlighted passage — or a whole source — to another source, or to one passage in it, as *supports*, *contradicts*, *cites*, *same claim as* or *related to*, with an optional note. The other source shows it as a backlink. Click either end to jump to the passage.
- **The source map.** **Map** beside Sources shows every source and every link as a graph: click a source to open it, hover to see what it connects to, hover or click a line to read or open the passages behind it, drag, pan and zoom. **Source map** is also a pane kind, so the map can be part of a beat and shown on camera; it is laid out the same way every time.
- Deleting a linked highlight keeps the link to the whole source; removing a source removes its links.
- Regression tests for links, backlinks, pruning, the map's edges and its deterministic layout.

## 0.12.1

- **A tidier Source toolbar.** Page scripts, Re-download and Open in your browser move into a **⋯** menu. When scripts are off, a **scripts off** marker stays visible and turns them back on.
- **The summary opens from a toolbar button** instead of taking a row of its own. A dot shows which sources have one. It starts closed, stays closed until you open it, and neither button nor summary appears in Present mode.

## 0.12.0

- **Beats keep their passage when the sidebar collapses or Present mode starts.** Both widen the article pane, and the page used to keep its old scroll distance while the text reflowed, so a beat that restored correctly drifted to a different passage a moment later — only sometimes, when the browser's own scroll anchoring happened not to cover it. The pane now puts the same passage back after any change of width, in Original and Reader views.
- **Capturing a beat says what it captured.** A short message confirms the beat and names the passage each article pane is at. If a pane had not reported its place, it says which one, so it is caught now rather than mid-take. A capture that fails says so.
- **Links within a site open in the same pane.** Docs sidebars and "next page" links no longer create a source per click. The pane has its own Back and Forward, beats remember the page it was on and where, and **Save as source** keeps a page you want to highlight. Links to another site still become sources; Ctrl+click still opens your browser. Highlights only ever appear on the page they were made on.
- **Sources remember where they came from.** One created from a link, or saved from a browsed page, links back to it from its toolbar.
- **A summary for each source.** A Markdown summary bar at the top of the Source pane; its first line shows in the sources list. Once collapsed it stays collapsed until you open it, and it is hidden in Present mode.
- Regression tests for pane width changes, page identity and the pane's own history, and capture reporting.

## 0.11.4

- **Beats return to the right passage on sites with a fixed header.** In a wide pane, capture anchored to the site's own header — the first visible block at every scroll depth — so restoring the beat left the article wherever the previous beat had left it. Headers, sticky contents lists, hidden elements and empty blocks are no longer used as anchors, and repeated text such as a heading also listed in the contents resolves to the copy that was read.
- Beats already captured against a header, or with an empty anchor, now return to their saved scroll distance instead of staying put or jumping to the top. Re-capture them once for an exact anchor.
- **The presenter window recovers when its page does not come up.** It is shown only once its page can paint, reloads itself once if the page fails to load, crashes or never starts, and if that also fails the studio explains why. The original blank window was not reproduced, so this covers the failures that can cause one rather than a confirmed single cause.

## 0.11.3

- Fixed highlights saved in the Highlights pane but missing from the article: hidden duplicates and script content no longer capture the match, and website styles cannot erase the selected colour.
- Highlights recover after an article updates its DOM, including selections spanning formatted text and partially replaced passages.
- Reader and Original now share selection and replay logic, including whitespace-tolerant matching and correct paragraph boundaries.

## 0.11.2

- Fixed Jupyter's missing-path dialog: the pane now opens the project root directly instead of appending the obsolete `project-id/files` path.
- Fixed embedded kernels stuck connecting because Jupyter used `localhost` while Studio used `127.0.0.1`. The hosts now match so authenticated kernel WebSockets retain their login cookie.
- Jupyter runs directly as a managed Python process, binds loopback, chooses an available port, and reports failed startup. Concurrent starts are serialised and an old process exiting cannot clear the new server's state.
- Jupyter tab layouts are now saved per project. Notebook files stay in their existing project folder.

## 0.11.1

- Launching Studio again now explicitly shows its existing window, fixing a silent no-op when a hidden instance already holds the app's single-instance lock.

## 0.11.0

- Replaced single-response AI chat with a research agent that streams progress, calls file, shell, public-page and web-search tools, and continues through a bounded research workflow.
- Added review cards for file writes and shell commands, cancellation, durable tool results, interrupted-run recovery and whole-turn conversation history management.
- Added project and global conversations, a conversation picker, explicit import of previous project chat and a Files shortcut. Project outputs live in `research/`; conversations live separately from project autosave.
- Added Tavily web-search settings with encrypted, masked keys. Public URL reading works without a search key.
- Window handoff now explicitly places Studio behind the selected app while keeping the preview rendering. Its return toolbar identifies the selected app.
- Added research regression tests covering both provider protocols, persistence, approvals, cancellation, credential storage and file boundaries.

## 0.10.0

- Added a desktop capture picker, fixing Electron's unsupported capture request and automatically matching a chosen window to its application.
- Window panes now offer **Interact with app**: use the real desktop application, then return to the same Studio layout with a movable floating toolbar or **Ctrl+Shift+F12**. The toolbar can be hidden when the shortcut is available.
- Removed pointer and keyboard forwarding from Window previews, which could move the Windows cursor unexpectedly and lose focus or drag releases. Failed focus requests now show an error.
- Clarified **Window** (native desktop preview) versus **Embed** (directly interactive web and localhost apps).

## 0.9.0

- **Beats return each article pane to its own passage, without animated scrolling.** Captures now include independent reading positions and Reader/Original modes, including two panes showing different parts of the same source. Content anchors account for text reflow and brief late layout changes. Older beats retain highlight-based navigation and can be re-captured to gain reading positions.
- **Restoring a beat no longer resets a source's slide state on mount.** Presentation keys advance the running order without also advancing source slides.
- **Canvas views restore after the drawing API is ready**, including newly mounted panes; multiple canvas panes remember independent views of the shared drawing.
- Missing pinned sources show an error and an empty pane instead of silently substituting another article. Original pages that cannot confirm restoration show an error rather than remaining concealed.
- **A clearer beat list:** titles have their own row, new beats insert after the current one, and Duplicate reuses an arrangement and script. Deleting a beat or replacing its arrangement offers Undo.
- **The current beat keeps its identity when the running order changes.** Reordering other beats no longer changes the current selection or adds a false chapter marker in the presenter log.
- Presentation keys work inside Original articles, without interfering with text fields. Home/End jump to the first/last beat, and starting Present without a selection opens the first beat.
- **Fast beat switches keep the latest canvas edits.** Multiple canvas panes synchronise the shared drawing; viewport-only changes preserve newer scene content.
- Added eight beat regression tests, also run by the release workflow.

## 0.8.1

- **The canvas pane shows its drawing tools again — and the drawing.** The container Excalidraw sits in never grew into the pane, so it had zero height: every tool and the whole drawing surface were rendered, just invisibly. It now fills the pane.

## 0.8.0

- **A beat now frames its own part of the canvas.** There is still one drawing per project, but each beat remembers where it was looking — pan and zoom — and returns there when the beat comes up. Draw the whole diagram once, then let beat 3 sit on the left half and beat 7 zoom into the detail.

## 0.7.2

- **A project can finally be deleted.** 0.7.1 shut down the JupyterLab *this* run of the app had started; the one blocking the folder was usually left behind by an earlier run, which the app knew nothing about. Delete now finds any JupyterLab rooted at exactly that folder, whoever started it, and stops it.
- **The app no longer leaves JupyterLab running when it closes.** `python -m jupyter lab` hands off to `jupyter-lab.exe` and exits, so the real server was re-parented out of the app's process tree and survived — sitting in a project folder and keeping it undeletable for the rest of the day. Quitting now waits for the server to stop what it started.

## 0.7.1

- **Deleting a project no longer fails because the app itself is holding the folder.** JupyterLab is rooted in the project folder and the Terminal pane's shells sit in it, and Windows will not delete a folder a process is working in — so Content Studio was reliably blocking its own delete. It now shuts those down first, kills the whole process tree rather than just the process it launched, and retries.
- The sidebar shows *deleting…* while that happens, since shutting Jupyter down takes a few seconds.
- If something outside the app still holds the folder, the message now says so specifically.

## 0.7.0

- **A new project gets its own folder inside the one you pick.** Choosing `D:\Videos` and naming a project *How Git Actually Stores Your Code* creates `D:\Videos\how-git-actually-stores-your-code`. The dialog shows the path before you commit to it, and a name already in use gets a number rather than clashing.
- **Deleting a project can no longer take anything else with it.** Previously the folder you chose *was* the project folder, so everything beside it went too. Moving a project applies the same rule.
- Delete now refuses outright to remove a folder that has no `project.json` in it, whatever the index says.

## 0.6.1

- **Deleting a project now says why when it cannot.** A failure used to leave the request hanging with nothing shown, so the button appeared to do nothing at all. If a file is held open by another program, it says so and names the folder.
- A save that arrives just after a delete is refused instead of recreating the project's folder, or writing `project.json` into `~/.content-studio` once the index has forgotten it.
- Deleting the open project cancels its pending save first, so it cannot come back.

## 0.6.0

- **A script for each beat.** The scroll icon on a beat opens a Markdown editor with a preview — what the segment must cover, the phrase to use, what not to say. It saves as you type.
- The script appears in the **presenter window only**, never inside the studio window, so it cannot reach a screen recording. `-` and `+` there set a text size you can read from where you sit, and it is remembered.

## 0.5.1

- Documentation: [the guide](docs/guide.md) now holds the full feature reference, this changelog records each release, and `CLAUDE.md` carries the invariants and gotchas for anyone working on the code.
- The Updates panel says, while downloading, that closing the app throws the download away — which is the usual reason an update never seems to arrive.

## 0.5.0

- **The presenter window.** A second, small, always-on-top window for your other monitor, placed on a different display automatically. It is outside whatever captures the studio window, which is the point of it: the beat you are on, its point in large type, what comes next, and a clock. `→` and `←` work in either window.
- **A chapter log.** Start the clock and every beat change is timed; `f` or **Redo** marks a moment to fix. Stop, copy, and you have chapters and an edit map from the take you just did.

## 0.4.0

- **Beats.** A beat is one step in your argument plus the stage that serves it: panes, sizes, which source in which pane, the view mode, deck paging, and the highlight to scroll to. Captured from what is already on screen rather than filled in on a form.
- In Present mode `→` applies the next beat and `←` the previous, so recording is talking and one key.
- A stage stores references, never copies, so improving your material improves every beat pointing at it. A reference that has gone is reported rather than silently ignored.
- `h` hides the in-window beat strip, which screen capture would otherwise record.

## 0.3.0

- **Updates on demand.** Settings → Updates shows the version you are running and checks immediately, rather than waiting for the six-hourly check. Download progress is visible; nothing installs until you ask, or until you next quit normally.
- Every outcome is stated rather than implied: up to date, downloading, ready, failed and why, or running from source.

## 0.2.0

- **Providers and keys are settings, not a `.env` file.** Anthropic, OpenAI, OpenRouter, DeepSeek, Groq, Together, Gemini and xAI as one-click presets; Ollama and LM Studio without a key; a form for any other gateway or self-hosted model. The AI pane picks between whatever is configured.
- Any Anthropic-compatible (`/v1/messages`) or OpenAI-compatible (`/chat/completions`) endpoint works, both streamed.
- **Keys are encrypted at rest** with the operating system's own facility — DPAPI on Windows — so the file is unusable from another account or machine. A key is sent once and never comes back; the UI sees only that one exists and its last four characters.
- A key echoed inside a provider's error message is scrubbed before it is shown.

## 0.1.0

First desktop release.

- Content Studio is a Windows app rather than a localhost page, so panes can be real Chromium views: Colab, Drive and Kaggle load and stay signed in, and a local harness works from the URL it printed, token and all.
- The folder picker is the window's own dialog.
- Updates come from GitHub Releases and are applied only when asked for.
- Its own icon, rather than the Electron default.

## Before 0.1.0

Built as a localhost web app: projects as folders, web and file sources, highlighting with
comments, the pane layout, reader and original views, slide decks rendered through
PowerPoint, Jupyter, a terminal, the Excalidraw canvas, window capture and control, and the
reverse proxy that makes a page look exactly as it does in a browser.

The API server was also made loopback-only in this period, after it was found to be
listening on every interface with no authentication — which had exposed a shell and desktop
control to the local network.
