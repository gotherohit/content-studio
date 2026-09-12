# Content Studio

A single-screen local workspace for building a video from research. A **project** is one video: its sources, highlights, notes, slides, whiteboard, code, terminal, notebooks and AI chat all live together in one folder on your disk.

Runs on localhost. Nothing is stored inside this codebase.

## Run

```bash
npm install
npm --prefix client install
cp .env.example .env      # add ANTHROPIC_API_KEY if you want the AI pane
npm run dev
```

Open http://localhost:5173. The API and proxy run on port 4700.

Production build (one server, no Vite):

```bash
npm run build
npm start
```

Then open http://localhost:4700.

## Projects are folders

Each project is a self-contained folder you choose:

```
<project folder>/
  project.json      sources, highlights, notes, slides, canvas, layout
  sources/          every file you add as a source
  .rendered/        slide images generated from decks (safe to delete)
  <anything else>   notebooks and scratch files you create
```

That folder is the working directory for the **Terminal**, **Code** and **Jupyter** panes, so a notebook you create sits beside the sources it analyses. You can move it, back it up, or open it in any other tool on its own.

App-level settings — the project index, the page cache — live in `~/.content-studio/`, never in this codebase and never inside a project folder.

When you create a project you name it and **Browse** to the folder it will live in, using your operating system's own folder dialog. There is no default location: a project exists exactly where you put it. Click the gear in the sidebar to:

* **Move a project** to a different folder, taking everything with it.
* **Open a project folder that already exists**, for instance one restored from a backup.

The sidebar shows each project's folder under its name; click it to open the folder in Explorer. Projects and Sources each fold away with the chevron beside their heading, so either list can be hidden while recording.

The folder is the source of truth. Drop a PDF into `sources/` from Explorer and it appears as a source next time you open the project; delete one and it disappears from the list.

## Sources

A source is anything you want on screen. Paste a URL in the top bar, click **File**, drop files on the window, or copy them into the project's `sources/` folder.

| Source | How it is shown |
|---|---|
| Web page | The live page, exactly as the site builds it, or a clean Reader view |
| PowerPoint (`.pptx`, `.ppt`) | Real slides rendered by PowerPoint: a filmstrip, a slideshow, or the live animated show |
| PDF | Page view, or a Slides mode that fills the pane |
| Markdown | Document view, or Slides — split on a line containing only `---` |
| Jupyter notebook | Rendered cells with code, stdout, errors and image outputs |
| Images, video, audio | Inline player or viewer |
| CSV, TSV | Data table |
| Text, code, JSON, HTML | Text or rendered view |
| Word, Excel | Export to PDF and add that instead |

Select text in a web page, markdown or text source to highlight it and attach a comment.

**Every Source pane picks its own source.** The dropdown at the left of a Source pane's toolbar either follows the sidebar selection or pins one source, so a slide deck can sit in one pane and the article it discusses in another.

### Slide decks

PowerPoint is the only thing that renders `.pptx` faithfully, so when it is installed Content Studio drives it to export each slide as an image. Fonts, charts and layout come out exactly as designed. Two ways to show a deck:

* **Slides** mode pages through the rendered slides inside the pane, and **Document** mode shows the whole deck as a filmstrip.
* **Play in PowerPoint** starts the real slideshow, so transitions and build animations play. Mirror that window with a **Window** pane to keep it on the same screen as everything else.

Without PowerPoint, LibreOffice is used to convert the deck to PDF. With neither, export to PDF yourself; PDFs get the same slideshow.

## Layout

Everything is a **pane**. Pick 1 to 4 panes from the layout buttons in the top bar, then choose what each shows from its header dropdown. Drag the gap between panes to resize. The arrangement is saved with the project.

```
┌──────────┬────────────────────────────────────────────────────┐
│ Projects │ URL bar · File · layout · text size · theme        │
│ Sources  ├──────────────────────────┬─────────────────────────┤
│          │ Source: slide deck       │ Embed: your harness     │
│          │ Document | Slides        ├─────────────────────────┤
│          │                          │ Terminal                │
└──────────┴──────────────────────────┴─────────────────────────┘
```

Pane types: **Source**, **Highlights**, **Notes**, **AI**, **Code**, **Terminal**, **Jupyter**, **Slides** (a scratch markdown deck), **Canvas** (Excalidraw), **Window**, **Embed**.

**Present mode** (Alt+P) hides the sidebar, top bar and pane headers so only your panes are on screen for recording.

## Embedding a running app

Paste any address into an Embed pane — a model harness, Streamlit, Gradio, Ollama, a dev server, or a public site. It is routed through Content Studio's own proxy, which:

* strips the headers that normally stop an app being framed (`X-Frame-Options`, `Content-Security-Policy`),
* holds the app's cookies server-side, because an embedded app sits in a cross-site frame where a normal SameSite session cookie would never be sent back,
* passes every HTTP method through, not just GET,
* and pipes websockets to the real server, so apps that stream over a socket keep working.

That is why an app loads here even though pasting its URL into a plain iframe shows nothing.

Many local harnesses print a URL containing a one-time token and reject the bare address. Paste the whole URL the tool printed, query string included. If the app refuses, the pane shows its actual reply rather than an empty frame.

## Controlling a window

The Window pane captures a desktop window or screen. That alone is a live view. To interact with it:

1. Click **Pick a window** and choose the window or screen.
2. Choose the same one from the **Match capture to…** dropdown, so clicks map to real desktop coordinates.
3. Switch **Control** on.

Clicks, right-clicks, scrolling and typing in the pane are forwarded to the real application. Windows only; elsewhere the pane stays a live view.

## Shortcuts

| Key | Action |
|---|---|
| `Alt+P` / `Esc` | Present mode |
| `Alt+B` | Show or hide the sidebar |
| Drag between panes | Resize columns and rows |
| `→` `←` `Space` | Navigate slides |
| `Ctrl+Enter` | Run the current code snippet |

## Config (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Needed for the AI pane |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model used by the AI pane |
| `API_PORT` | `4700` | API and proxy port |
| `JUPYTER_PORT` | `8890` | Port for the managed JupyterLab |
| `RS_SHELL` | `powershell.exe` | Shell used by the Terminal pane |

`~/.content-studio/config.json` is the index of where each project folder is. Delete a project folder by hand and the index repairs itself on the next refresh.

## Security

Content Studio has no login, because it is built for one person: whoever is sitting at
the machine. To make that safe it is deliberately unreachable from anywhere else.

* The server binds to `127.0.0.1` and refuses any connection that did not come from this
  computer, so nobody on your network or WiFi can reach it.
* That matters because the app deliberately does powerful things on your behalf: the
  Terminal pane is a real shell, the Code pane runs scripts, and the Window pane can move
  your mouse and type for you. Those would be a remote takeover if they were exposed.
* `HOST` can override the bind address, and the server prints a warning when you do. Only
  set it if you understand that it hands a shell and desktop control to your network.
* Cookies for embedded apps are kept in memory, never written to disk, and are forgotten
  when the server stops.
* Nothing about your machine or your projects is in this repository: project material
  lives in folders you choose, and the project index and page cache live in
  `~/.content-studio/`. Cloning this repo gets you the program, not anyone's data, and a
  clone runs entirely against the cloner's own machine.

## Notes

* Code snippets, the terminal and window control all act with your user's permissions; see Security above.
* Pages are downloaded once and cached in `~/.content-studio/cache`. Use the refresh button in the Source toolbar to re-download.
* The proxy relies on every `*.localhost` name resolving to 127.0.0.1, which Chrome, Edge and Firefox do by default.
* Sites that need a login, or that block server-side fetching, will not render. Try the print version, or use Reader.
* The API server deliberately runs without `node --watch`: node-pty's console worker crashes under watch mode on Windows. Restart `npm run dev` after changing server files.
