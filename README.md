# Content Studio

A single-screen local workspace for building a video from research. A **project** is one video: its sources, highlights, notes, slides, whiteboard, code, terminal, notebooks and AI chat all live together in one folder on your disk.

It ships as a Windows desktop app. Nothing is stored inside this codebase.

## Install

Download the latest `ContentStudio-Setup-<version>.exe` from [Releases](https://github.com/gotherohit/content-studio/releases) and run it. The installer is unsigned, so Windows will show a SmartScreen warning the first time: choose **More info → Run anyway**.

### Updates

**Settings → Updates** shows the version you are running, and **Check for updates** asks GitHub straight away — no waiting for the periodic check when a fix has just been pushed. It also checks at launch and every six hours.

A new version downloads in the background with the progress visible, then stops and waits: it is installed when you click **Restart and install**, or on the next launch if you simply quit. Nothing ever restarts the app mid-recording. If there is nothing new, it says so rather than leaving you guessing.

## Run from source

```bash
npm install
npm --prefix client install
cp .env.example .env      # add ANTHROPIC_API_KEY if you want the AI pane
npm run desktop           # build the client, then open the desktop app
```

For front-end work with hot reload, `npm run dev:desktop` runs Vite and points the app at it.

It still runs in a browser if you prefer — `npm run dev`, then http://localhost:5173 — but the Browser and Embed panes are weaker there, for the reasons below, and updates and key encryption belong to the desktop app.

Working on the code? Start with [CLAUDE.md](CLAUDE.md): the invariants, the gotchas that cost a day each, and how to cut a release. Coding agents should read [AGENTS.md](AGENTS.md) first — it points there and adds the rules for testing safely on a machine that also holds real work.

Build an installer of your own:

```bash
npm run dist          # writes release/ContentStudio-Setup-<version>.exe
```

## Why a desktop app

The whole studio is one window, and panes inside it are real Chromium views rather than frames. That difference is most of the app:

* **Colab, Drive, OneDrive and Kaggle just load**, with a real sign-in that is remembered. In a browser they refuse to be framed at all. Your password goes straight to the site; Content Studio never sees it.
* **A local harness works from the URL it printed**, token and all, because the pane has the true origin and its own cookies — no proxy, no cookie jar, no header rewriting.
* **The folder picker is the operating system's own**, opened by the window that asked for it.

## What it does

| | |
|---|---|
| [Projects are folders](docs/guide.md#projects-are-folders) | One project is one video. Everything for it lives in a folder you choose. |
| [Sources](docs/guide.md#sources) | Web pages as they really look, plus slides, notebooks, PDFs, documents. Highlight and comment on any of them. PDFs page with the arrow keys. |
| [Beats](docs/guide.md#beats) | The running order. Capture an arrangement per point you make; one key walks them while recording. |
| [The presenter window](docs/guide.md#the-presenter-window) | A second window for your other monitor, outside any screen capture, with the clock and a chapter log. |
| [Layout](docs/guide.md#layout) | Up to four panes, each showing a different source or tool. |
| [Research with AI](docs/guide.md#research-with-ai) | A tool-using research agent with reviewed file/shell actions, web search and persistent project or global conversations. |
| [Models and keys](docs/guide.md#models-and-keys) | Anthropic- or OpenAI-compatible providers; research requires a tool-capable model. Keys encrypted at rest, never shown again. |
| [A real browser pane](docs/guide.md#embedding-a-running-app) | Colab, Drive, Kaggle and your own local harnesses, signed in, in a pane. |
| [Controlling a window](docs/guide.md#controlling-a-window) | Capture and drive another desktop application from inside the studio. |
| [Linking sources](docs/guide.md#linking-sources) | Link passages across sources — supports, contradicts, cites — with backlinks and a clickable source map. |
| [Files and code](docs/guide.md#files-and-code) | Browse a folder; create, edit, rename and delete files (deletes go to the Recycle Bin); highlight lines, link them to sources, and put exact lines in a beat. |

Jupyter, a terminal, an Excalidraw canvas, code snippets and an AI chat are panes too.

New to it? **[A video, step by step](docs/guide.md#a-video-step-by-step)** walks through the whole workflow once. **[The full guide](docs/guide.md)** documents all of it. **[Changelog](CHANGELOG.md)** lists what changed in each release.

## Security

Content Studio has no login, because it is built for one person: whoever is sitting at
the machine. To make that safe it is deliberately unreachable from anywhere else.

* The server binds to `127.0.0.1` and refuses any connection that did not come from this
  computer, so nobody on your network or WiFi can reach it.
* That matters because the app deliberately does powerful things on your behalf: the
  Terminal pane is a real shell, the Code pane runs scripts, the Files pane can change any
  file in the folder you give it, and the Window pane can move
  your mouse and type for you. Those would be a remote takeover if they were exposed.
* `HOST` can override the bind address, and the server prints a warning when you do. Only
  set it if you understand that it hands a shell and desktop control to your network.
* Cookies for embedded apps are kept in memory, never written to disk, and are forgotten
  when the server stops.
* Nothing about your machine or your projects is in this repository: project material
  lives in folders you choose, and the project index and page cache live in
  `~/.content-studio/`. Cloning this repo gets you the program, not anyone's data, and a
  clone runs entirely against the cloner's own machine.
