# Changelog

What changed in each release, newest first. Versions are the ones the app updates itself to.

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
