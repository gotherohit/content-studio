# Changelog

What changed in each release, newest first. Versions are the ones the app updates itself to.

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
