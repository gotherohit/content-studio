# Content Studio — the guide

Everything the app does, and how to do it. [README](../README.md) covers installing it;
this is the reference you come back to.

- [A video, step by step](#a-video-step-by-step) — start here
- [Projects are folders](#projects-are-folders)
- [Sources](#sources) — web pages, files, browsing a site, summaries
  - [Linking sources](#linking-sources) and [the source map](#the-source-map)
- [Beats](#beats) — the running order for a video
  - [What to say on a beat](#what-to-say-on-a-beat) and [the presenter window](#the-presenter-window)
- [Files and code](#files-and-code) — browse, edit, highlight and show code
- [Layout](#layout)
- [Embedding a running app](#embedding-a-running-app)
- [Jupyter notebooks](#jupyter-notebooks)
- [Controlling a window](#controlling-a-window)
- [Research with AI](#research-with-ai)
- [Models and keys](#models-and-keys)
- [Shortcuts](#shortcuts)
- [Settings that live in `.env`](#settings-that-live-in-env)
- [Where everything is stored](#where-everything-is-stored)
- [When something goes wrong](#when-something-goes-wrong)

## A video, step by step

The whole workflow once, in order. Each step links to the section with the details.

**1. Make a project.** The **+** beside Projects names it and picks a folder; the project gets
its own folder inside. → [Projects are folders](#projects-are-folders)

**2. Add your sources.** Paste an article URL in the top bar and press Enter, or click **File**
or drop files on the window for PDFs, decks, notebooks and images. → [Sources](#sources)

**3. Read, and browse around.** In a docs site, sidebar and "next page" links open in the same
pane, with Back and Forward in the pane's toolbar, without adding sources. When a page is worth
keeping, press **Save as source**. Links to other sites become sources, and remember which
source they came from. → [Sources](#sources)

**4. Mark what matters.** Select text to highlight it and add a comment. Open a source's
**summary** with the notebook button in its toolbar and write the gist in your own words; the
first line appears under its name in the sources list.

**5. Connect the evidence.** On a highlight's card in the Highlights pane, press the link icon:
this passage *supports*, *contradicts*, *cites*, is *the same claim as*, or is *related to*
another source or passage. The other side gets a backlink. **Map**, beside Sources, shows it all
as a graph you can click through. → [Linking sources](#linking-sources), [The source map](#the-source-map)

**6. Bring in code.** Choose **Files** as a pane type — make, rename or delete files there as you
go — open a file, select lines, and highlight or link them like any passage. **Focus** (the crosshair) dims everything but those lines.
→ [Files and code](#files-and-code)

**7. Build the running order.** For each point you want to make, arrange the panes — which
source, scrolled where, which file and lines, which part of the canvas or map — and press
**+ Beat**. A message confirms what was captured, or tells you which pane to scroll and capture
again. Write the point on the beat's row, and what to say in its **script**.
→ [Beats](#beats), [What to say on a beat](#what-to-say-on-a-beat)

**8. Rehearse.** Open the **Presenter** window on your other monitor: it shows the current point,
what comes next, your script and a clock. **Present** (Alt+P) hides everything but the panes;
**→** and **←** move between beats. → [The presenter window](#the-presenter-window)

**9. Record.** Start your recorder on the studio window and the presenter's clock together. Talk,
press **→**, repeat; **f** marks a moment to redo. Afterwards **Copy log** gives you chapters and
an edit list.

Nothing drawn only for you reaches the recording in Present mode: summaries, capture messages,
file-editing tools and the folder tree are hidden, and scripts only ever appear in the presenter
window.

## Projects are folders

**You pick a folder to put a project in, and it makes its own folder inside it**, named
after the project. Choose `D:\Videos` for *How Git Actually Stores Your Code* and you get
`D:\Videos\how-git-actually-stores-your-code`. The New project dialog shows the exact path
before you commit to it, and a name already taken gets a number.

That matters for one reason: deleting a project deletes its folder, and this way that can
only ever be the project. Nothing else in the folder you picked is at risk. Delete also
refuses any folder with no `project.json` in it.

Each project is a self-contained folder:

```
<project folder>/
  project.json      sources, highlights, links, summaries, beats, notes, slides, canvas, layout
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

Because of that, **removing a file source removes its file too** — the X beside it asks first,
and the file goes to the Recycle Bin, where you can restore it. A source left in the list
while its file stayed in the folder would simply be adopted again the next time the project
opened. Web sources and code sources have no file in the project: removing one only takes it
off the list, and a code source's file, which lives outside the project, is never touched.

## Sources

A source is anything you want on screen. Paste a URL in the top bar, click **File**, drop files on the window, or copy them into the project's `sources/` folder.

| Source | How it is shown |
|---|---|
| Web page | The live page, exactly as the site builds it, or a clean Reader view |
| PowerPoint (`.pptx`, `.ppt`) | Real slides rendered by PowerPoint: a filmstrip, a slideshow, or the live animated show |
| PDF | A scrolling page view, or a Slides mode that fills the pane. See [PDFs](#pdfs) |
| Markdown | Document view, or Slides — split on a line containing only `---` |
| Jupyter notebook | Rendered cells with code, stdout, errors and image outputs |
| Images, video, audio | Inline player or viewer |
| CSV, TSV | Data table |
| Text, code, JSON, HTML | Text or rendered view |
| Word, Excel | Export to PDF and add that instead |

Select text in a web page, PDF, markdown or text source to highlight it and attach a comment.
The Highlights pane follows the nearest Source pane, including a pinned article; with no
Source pane visible it follows the sidebar selection. Opening it does not require clicking
a highlight first.

Selecting a source in the sidebar or following a link opens it in the visible Source pane,
even if that pane was pinned. If several Source panes are open, choose one in the destination
picker; its position and current article identify it. The other panes stay on their current
sources. Cancel (or `Esc`) leaves everything unchanged. With no Source pane, the first pane
becomes a Source pane. Links to passages also bring the destination passage into view.
Saved highlights appear in both Original and Reader views. Original view restores their
colours when page scripts refresh the article; hidden copies of text are ignored. Minor
whitespace changes are tolerated, but a passage rewritten or removed by the publisher may
no longer match even though its saved quote remains in Highlights.

**Highlighting.** Select text in an article; a small bar offers four colours and a comment box.
The box takes the typing straight away — start writing, then press `Enter` for a yellow
highlight or click the colour you want. Once you have typed something the card stays until you
finish or press `Esc`, even if the page carries on scrolling underneath. The highlight appears
as a card in the **Highlights** pane — click a card to scroll the article to it, or click the
highlight in the article to find its card. A comment can also be written or changed later in
the card's own box.

**Links in a web page.** A link to another page of the *same site* — a docs sidebar, a
"next page" link — opens in the same pane, like a browser, without creating a source. The
toolbar shows the page's address with **Back** and **Forward** for this pane. Beats remember
which page a pane was on, and where, so you can capture a beat on a page you only browsed to.
A link to a *different* site becomes a new source, as before, and **Ctrl+click** opens any
link in your normal browser. A link to a section of the same page (`#heading`) just scrolls.

A browsed page is not a source. It has no highlights or summary — highlights belong to the
page they were made on, and would otherwise land on matching text somewhere else — and it
opens in Original view only, because Reader shows a saved copy of the source's own page. To
highlight it, press **Save as source**: it becomes a source of its own in the sources list.

**A source remembers where it came from.** A source created from a link, or with Save as
source, shows **← *the page it came from*** in its toolbar; click it to go back. Sources
added before 0.12.0 have no such link.

**A summary for each source.** The notebook button in a Source pane's toolbar opens your
own Markdown summary of that source: the main claim, the number worth quoting, what it
contradicts. It saves as you type, a dot on the button shows that a source has one, and its
first line shows under the source's title in the sources list. Close it with its arrow and
it stays closed — for every source, after a restart — until you open it again. The button
and the summary are hidden entirely in Present mode, so they do not reach a recording.

**The ⋯ menu** at the right of a web source's toolbar holds what you need now and then:
turning the page's own scripts on or off, re-downloading the page, and opening it in your
browser. When scripts are off, a small **scripts off** marker stays on the toolbar — some
pages leave parts blank without their scripts — and clicking it turns them back on.

### Linking sources

Research is mostly *this says X, that says otherwise*. A **link** records that between two
sources, usually from one highlighted passage to another.

To link, step by step:

1. Put a **Highlights** pane beside the source, and highlight the passage you are making a
   point about.
2. On its card, press the **link icon**.
3. Choose how it relates, then the other **Source**, then the **Passage in it** if you have
   already highlighted it there. If you have not — or you are not sure where in that source the
   answer is — press **Pick it in the source…** instead: that source opens, and the next thing
   you highlight, draw or click in it becomes the other end. Add a note if the reason is not
   obvious, and press **Add link**.
4. The card now shows *→ contradicts Paper X — "…"*. Open Paper X and its passage shows
   *← contradicted by…*. Click either to jump to the other end.

In more detail:

* **Link a passage:** in the Highlights pane, press the link icon on a highlight's card.
  Choose how it relates — **supports**, **contradicts**, **cites**, **same claim as** or
  **related to** — then the other source and, optionally, the passage in it, and a note.
* **Link a whole source:** **Link source** at the top of the Highlights pane.
* **Pick the far end in the source itself.** **Pick it in the source…** opens the other source
  and waits: highlight the passage, draw on it, or click something already there, and the link
  completes with the relation and note you had already chosen. A bar at the top says what it is
  waiting for; `Esc` calls it off.
* **Link two passages of the same source.** Pick the source marked *(this source)* and then the
  passage — a claim on page 2 answering one on page 9, a drawing against the paragraph it is
  about. It shows on both cards like any other link; the map leaves it out, because an arrow
  from a source to itself says nothing there.
* **Drawings link too**, and are listed by what they are — *Rectangle · page 3*.
* **Backlinks are automatic.** The other source shows the link from its side — *contradicted
  by…*, *cited by…* — on the passage's card, or above the cards for a whole-source link. The
  counts at the top say how many links and backlinks a source has.
* **Click a link to go there:** it opens the other source, scrolled to its passage.
* A link stores references, like a beat. Deleting a linked highlight keeps the link, now to
  the whole source; removing a source removes its links.

### The source map

**Map**, beside Sources in the sidebar, shows every source as a circle and every link as a
line coloured by how they relate; a dashed line means one source was opened from another.
Bigger circles have more highlights and links.

* **Click a source** to open it. **Hover** one to fade everything not connected to it.
* **Links are drawn where they land.** A passage at one end of a link shows as a small
  coloured dot on the rim of its source, and the line runs between the dots — so a link between
  two sentences does not pretend to be a link between two whole documents. Hover a dot to read
  the passage, click it to open it. The **passages** button in the legend turns this off, which
  gives the older picture: one line per pair of sources.
* **Hover a line** to read the passages and the note behind it; **click** the end you want and
  it opens there.
* **Drag** a source to move it, drag the background to pan, **scroll** to zoom, and use the
  fit button in the legend to reset. Moved sources go back when the map is reopened.
* Code sources appear on the map like any other source.
* To show the map on camera, pick **Source map** as a pane's kind. It can be part of a beat
  like any pane, and it is drawn the same way every time for the same sources and links.

**Every Source pane picks its own source.** The dropdown at the left of a Source pane's toolbar either follows the sidebar selection or pins one source, so a slide deck can sit in one pane and the article it discusses in another.

### Drawing on a source

Some things are easier pointed at than quoted. The pencil in the Source toolbar draws a
**rectangle**, an **oval** or an **arrow** straight onto the source.

* Choose a shape and a colour from the pencil menu, then drag on the source. Let go and the
  usual note box appears, ready for typing, so the drawing can carry a comment like any
  highlight.
* **Draw around what you mean.** A drawing belongs to whatever it mostly covers — the paragraph,
  the picture, the page — and may reach a little outside it, so a box drawn around a paragraph
  starting in the gap above it is a box around that paragraph, and stays one when the pane
  changes width.
* The tool stays out until you put it down — press `Esc`, or click the pencil again. While it
  is out the source underneath cannot be clicked, which is why the button stays lit.
* Drawings belong to the source, not to the pane: they appear in **Highlights** as cards
  ("Rectangle · page 3"), can be linked to other sources, show up in the map, and a beat that
  shows the source shows them too.
* A drawing is anchored to what it was drawn over — a PDF page, a picture, or the paragraph
  underneath it — so it stays put when you zoom, resize the pane, or collapse the sidebar, and
  an article drawn on in Reader keeps its drawings in Original view as well.
  In Original view the drawing also follows centred page layouts and late-loading content;
  adding a pane to the left does not change which passage it belongs to.
  A drawing covering several text blocks follows their combined area when a site changes
  between stacked sections and columns. Older boxes saved against the whole page need one
  move/resize over the intended content (or a redraw) to acquire those anchors.
* **A marker shows where there is more to see.** Anything with a comment, and anything that is
  one end of a link, carries a small marker — at the corner of a drawing, at the end of a
  quote. Click it and the note opens on the source itself: the comment, and every link, each
  one clickable to jump to the other end. The pencil menu hides all the markers, and Present
  mode hides them for you while leaving the drawings on screen.
* **Move and resize it afterwards.** Click a drawing to pick it up: grips appear at its
  corners, or at both ends of an arrow. Drag the outline to move the whole thing, drag a grip
  to resize it. Dragged onto a different paragraph it belongs to that paragraph from then on;
  dragged into the white space of a page it belongs to the page itself.
* **`Delete` removes the drawing you are holding.** A quoted passage keeps to the bin on its
  card — it is too easy to have one selected by accident, and neither can be undone.
* To remove one, delete its card in Highlights.

Drawing works on articles (Original and Reader), PDFs and images. Markdown, notebooks, tables
and code do not take drawings — the pencil is not shown for them.

### PDFs

PDFs are drawn page by page inside the pane, so scrolling stays smooth however long the
document is and the pane always knows which page you are on.

* **Document** mode scrolls through the pages; **Slides** mode shows one whole page at a time.
* `→` `←` and `PageDown` `PageUp` turn the page in either mode, `Home` and `End` jump to the
  first and last. In Slides mode `Space` also moves on. These keys belong to the beats in
  Present mode, as they do for a Markdown deck, so a PDF never pages under you mid-take.
* The page counter beside **Document / Slides** shows where you are, and its arrows turn the
  page too.
* Zoom with the small `−` `+` control in the corner of the pane, or hold `Ctrl` and scroll.
  The percentage button puts the page back to the pane's width. The control is hidden in
  Present mode.
* **Select text to highlight it**, exactly as in an article: the popup takes a colour and a
  note, and the passage joins the Highlights panel with the page it is on. Clicking its card
  turns back to that page. PDF highlights link to other sources and appear in the map like
  any other. A selection cannot run across two pages — each page holds its own text — and
  a passage in a scanned PDF with no text layer cannot be selected at all.
* **A beat remembers the page**, in either mode, and puts it back when you show that beat.
  With two PDFs open at once, the keys go to the pane you last clicked in.

A deck that LibreOffice converted to PDF is shown by the same viewer.

### Slide decks

PowerPoint is the only thing that renders `.pptx` faithfully, so when it is installed Content Studio drives it to export each slide as an image. Fonts, charts and layout come out exactly as designed. Two ways to show a deck:

* **Slides** mode pages through the rendered slides inside the pane, and **Document** mode shows the whole deck as a filmstrip.
* **Play in PowerPoint** starts the real slideshow, so transitions and build animations play. Mirror that window with a **Window** pane to keep it on the same screen as everything else.

Without PowerPoint, LibreOffice is used to convert the deck to PDF. With neither, export to PDF yourself; PDFs get the same slideshow.

## Beats

A project is a pile of research; a video is a sequence. **Beats** are the sequence.

A beat is one step in your argument, and the **stage** that serves it: which panes, at what sizes, showing which source, scrolled where, with which highlight in view. You build one by arranging the screen the way you want it and pressing the camera in the **Beats** section — there is no form to fill in. Write the point in one line so you know what the beat is for.

In **Present** mode, **→** (or Space) applies the next beat and **←** the previous one. That is the whole interface while recording: the panes rearrange themselves and the right highlight scrolls into view, so the only job left is talking.

The **+ Beat** button saves the current arrangement immediately after the current beat
(or at the end if none is selected). A short message at the bottom of the window confirms
it and names the passage each article pane was captured at. If a pane had not yet reported
where it is, the message says so and names the pane: scroll that pane slightly and use the
camera on that beat to capture it again. The camera on an existing beat reports the same way. Each row gives the point its own line. Click its
number or **Show** to go there; **Restore** returns to its saved arrangement after you
have scrolled or experimented. Use **Duplicate beat** to reuse its arrangement and script
as a starting point. Moving a row keeps the same beat on screen, even if its number changes.

Deleting a beat or replacing its arrangement offers **Undo** above the list, without a
confirmation dialog. Undo restores the last such edit during this session; undoing an
arrangement change preserves any script or point you edited afterwards. It does not undo
changes to the underlying source or drawing.

Presentation keys also work while an **Original** article has focus. **Home** and **End**
jump to the first and last beats in the studio or presenter window. Text fields keep their
normal typing keys. Starting Present mode with no beat selected opens the first beat.

Things worth knowing:

* **Each Source pane remembers its own reading position.** Capture the beat after arranging
  and scrolling its panes. You can show the same blog twice at different passages, alongside
  a canvas, and return to both positions. Reader/Original mode is also remembered per pane.
  Beat changes jump directly, without an animated scroll through the article. Content anchors
  keep the passage in place when text reflows in a different pane width; late layout changes
  are corrected for a short settling period, until you interact with the page.
* **Collapsing the sidebar or entering Present mode keeps the passage on screen.** Both make
  the article pane wider, which reflows the text. The pane now puts the same passage back
  after any change of width, at any time, rather than keeping the old scroll distance.
* **Site headers and sticky contents lists are ignored when a position is captured.** They
  stay on screen however far you scroll, so they cannot say where you are. Beats captured
  before 0.11.4 in a wide pane may have saved one of them; those now return to their saved
  scroll distance, which is right at the pane width you captured them in. Press the camera
  on such a beat once to give it a proper anchor in the article.
* **Older beats need one re-capture to remember reading positions.** They still restore their
  saved highlights, immediately, but cannot recover scroll positions that were never saved.
  Arrange the old beat as you want it and use its camera button once.
* **Reading positions cover Original web pages, Reader, and scrollable in-app file views.**
  A PDF saves its page rather than a passage. Separate Browser/Embed panes do not expose their
  internal reading positions to beats. Highly dynamic pages or sites with their own nested scrolling areas
  may need Reader view for reliable passage restoration. A page that cannot confirm restoration
  shows a visible error instead of staying concealed.
* **Code and the map are part of a beat too.** A Files pane or code source restores its file,
  scroll position, selected lines and focus; a Source map pane is drawn the same way every
  time; a browsed page returns to that page. See [Files and code](#files-and-code).
* **Source slides keep their captured page when a pane mounts.** In Present mode, the arrow
  keys advance the beat rather than also advancing a slide inside it.
* **The canvas is one drawing per project, framed per beat.** A stage remembers the canvas
  pan and zoom, so beat 3 can sit on the left half of a diagram and beat 7 zoom into one
  corner of it. What it does not do is give each beat a separate drawing — improve the
  drawing and every beat showing it improves.
  Multiple Canvas panes can frame different parts of that same drawing independently.
  Drawing edits are shared immediately, so a fast beat switch does not leave the latest
  stroke waiting in an unmounted pane; changing one pane's view cannot overwrite another
  pane's newer drawing.
* **A stage stores references, not copies.** Improve a note or refine a drawing and every beat pointing at it shows the better version. Only the arrangement is frozen.
* **What you do inside a beat is not saved over it.** Scroll away, run a cell, make a mess — the beat still holds what you captured. Re-capture only when you ask for it, with the camera on that row.
* **A broken reference is loud.** If a beat's source or highlight has been deleted, it restores everything it still can and says what it could not, rather than quietly showing the wrong thing.
* **The beat strip is inside the window**, so screen-capture software records it. Press **h** to hide it; it stays hidden until you press **h** again. Better, use the presenter window below.

### What to say on a beat

The scroll icon on a beat opens its **script**: what this segment has to cover, the phrase
you want to use, the thing you always forget. It is **Markdown**, with a Preview tab, and
it saves as you type.

The script is shown in the **presenter window** and nowhere else. It is never drawn inside
the studio window, so it cannot appear in a recording no matter what is capturing the
screen. Use `-` and `+` there to set a text size you can read from where you sit; the
choice is remembered.

Bold renders in the accent colour, which makes it a good way to mark the words that must
come out right:

```markdown
Open with the number, not the concept.

- **seven labs**, not "several"
- say *illicit distillation* once, then just "this"
- do NOT call it a hack, it is a training method

> If the demo fails, cut to the diagram.
```

### The presenter window

**Presenter** in the toolbar opens a second, small, always-on-top window — put it on your other monitor. Since OBS (or anything else) captures the *studio* window, this one is never in shot, which is the whole point of it.

It shows the beat you are on, its point in large type, what comes next, and a clock. **→** and **←** work here as well as in the studio, so you can drive the running order from either.

**Start clock** does more than time you: every beat change while it runs is logged with its elapsed time, and **Redo** (or **f**) marks a moment to fix later. Stop, then **Copy log**, and you have this:

```
0:00 Hook: seven labs distilled Claude
0:38 What distillation legitimately is
2:10 — redo from here
2:24 Where it crosses the line
```

Chapters and an edit map, from the take you just did. Start the clock when you start recording; the two agree to within a second or so. Exact timecodes need OBS itself to be driven by the app, which is not built yet.

The log lives in the presenter window and is not saved — copy it before closing.

## Files and code

The **Files** pane shows a folder — the project's own, or any other you choose with the
folder button — as a tree on the left and the chosen file on the right, with syntax colours
for most languages. It covers the everyday file work around a video — making, editing,
renaming and deleting files — so you only need a full editor for heavy development.

* **Saving is only ever Ctrl+S** (or **Save**). A dot after the file name means unsaved
  changes. Nothing is saved by itself.
* **New file and new folder:** the two buttons above the tree, or right-click a folder. Type
  the name and press Enter; a name with slashes, such as `utils/helpers.py`, makes the folders
  on the way. A new file opens straight away. A name that already exists is refused, so
  nothing is ever overwritten.
* **Rename:** select an entry and press **F2**, or right-click → **Rename**. Only the name is
  selected, not the extension. Typing a path moves it, for example `lib/fit.py`. Unsaved edits
  to an open file keep going under its new name. Highlights, links and beats on a renamed file
  follow it.
* **Delete:** select an entry and press **Delete**, or right-click → **Delete**. It asks first,
  then moves the file or folder to the **Recycle Bin**, so it can be restored. If it has
  highlights, the question says so; they stay in the project, marked as missing, and return if
  you restore the file.
* Right-click also offers **Show in Explorer**, and the refresh button above the tree picks up
  files added outside the app.
* **Changes made elsewhere show up.** If another editor, git or the AI pane changes the open
  file, it reloads by itself when you have no unsaved changes. If you do, a bar says so and
  lets you load the other version or keep yours, which overwrites it on the next save.
* **The padlock opens the folder read-only**: nothing in it can be saved, created, renamed or
  deleted. Use it for a repository you only want to show. It is remembered per project.
* A file keeps its own line endings and byte-order mark when saved.
* **Files up to 50 MB open**, logs and data files included. Above 5 MB they are shown without
  syntax colours, which keeps typing quick; a note after the file name says so. Binary files —
  images, `.bin`, `.pkl` — are not opened, because saving one as text would corrupt it.

**Highlighting code.** Select lines and a small bar offers the highlight colours, and a link
button that highlights and opens the link dialog in one go. The first highlight turns the
file into a **code source** in the sources list, so its lines can be linked, shown on the
map, and opened in a Source pane (read-only, with its highlights). A coloured bar in the
gutter marks highlighted lines; click it to see the highlight's card and links in the
Highlights pane. Highlights follow their code when lines are added or removed above them;
if the code itself is rewritten, the bar turns faint to say the highlight may be stale.

To highlight and link code, step by step:

1. Choose **Files** as a pane type. It opens the project's folder; use the folder button at the
   top left of the pane to show another, such as a demo repository.
2. Click a file in the tree. Edit it if you need to and press **Ctrl+S** to save.
3. Select the lines you will talk about. The bar that appears offers four colours and a link
   button.
4. Pick a colour to highlight them, or press the link button to highlight them and open the link
   dialog straight away.
5. The file now appears in the sources list, and its highlights in the Highlights pane when you
   click the coloured bar beside the line numbers.

**Pointing at code on camera.** Select lines and press the crosshair to dim everything else.
A beat captured then remembers the file, where it was scrolled, the lines and the dimming,
and puts all of it back — so beat 4 can open `train.py` on the loss function and beat 5 on
the optimiser. In Present mode the folder tree and editing tools are hidden.

To put code in a beat:

1. Open the file in the Files pane and scroll to where the explanation starts.
2. Select the lines and press the **crosshair**; everything else dims. Press it again to undo.
3. Press **+ Beat**. The message says, for example, *train.py at lines 3–5, focused*.
4. In Present mode, **→** to that beat opens the file, scrolled and dimmed exactly as captured.
   The file itself is not copied into the beat: edit the code and the beat shows the new version.

The Files pane remembers which folder it shows and whether it is read-only, per project. A folder
you pick stays on your disk where it is; nothing is copied into the project.

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

Pane types: **Source**, **Highlights**, **Source map**, **Files**, **Notes**, **AI**, **Code** (runnable snippets), **Terminal**, **Jupyter**, **Slides** (a scratch markdown deck), **Canvas** (Excalidraw), **Browser**, **Window**, **Embed**.

Each Source pane's toolbar has, from left to right: which source it shows, Back and Forward for
pages browsed inside it, Original or Reader, the **←** link to the source it came from, its
address, **Save as source** when browsing, the summary button, and the **⋯** menu (page
scripts, re-download, open in your browser).

**Present mode** (Alt+P) hides the sidebar, top bar and pane headers so only your panes are on screen for recording.

## Embedding a running app

In the desktop app an Embed pane is a real browser view: paste the address — including a one-time token URL — and it behaves exactly as it does in Chrome. The rest of this section describes the fallback used when Content Studio runs in a browser tab instead.

Paste any address into an Embed pane — a model harness, Streamlit, Gradio, Ollama, a dev server, or a public site. It is routed through Content Studio's own proxy, which:

* strips the headers that normally stop an app being framed (`X-Frame-Options`, `Content-Security-Policy`),
* holds the app's cookies server-side, because an embedded app sits in a cross-site frame where a normal SameSite session cookie would never be sent back,
* passes every HTTP method through, not just GET,
* and pipes websockets to the real server, so apps that stream over a socket keep working.

That is why an app loads here even though pasting its URL into a plain iframe shows nothing.

Many local harnesses print a URL containing a one-time token and reject the bare address. Paste the whole URL the tool printed, query string included. If the app refuses, the pane shows its actual reply rather than an empty frame.

## Jupyter notebooks

Choose **Jupyter**, then **Start JupyterLab**. The launcher opens at the project folder;
notebooks you create are saved there. Studio uses the installed Python and can install
JupyterLab when it is missing.

**Another folder.** Notebooks often live somewhere else — a repository of experiments, a
shared drive, last month's project. The folder button in the pane toolbar (or **Another
folder** before it starts) points JupyterLab anywhere you like, and the choice is kept with
the project. Each folder keeps its own Lab tabs and layout, so going back to one reopens the
notebooks that were open in it.

One JupyterLab serves the whole app and it cannot change folders without restarting, so
moving it ends its kernels. Studio therefore moves the server by itself only when nothing is
running in it. With a kernel alive the pane says which folder it is in and offers the move as
a button, so a beat cannot throw away a running calculation in the middle of a take.

The embedded page uses the same loopback hostname as Studio, allowing its authenticated
kernel connection to work inside the pane. Authentication stays enabled. If port 8890 is
occupied, Studio chooses another free loopback port and displays it in the pane toolbar.
Startup failures show a diagnostic instead of claiming the server is ready.

Jupyter's saved tabs and layout live in that folder's `.jupyter/workspaces/` directory.
**A beat remembers the folder that was on screen**, so restoring it opens JupyterLab there
again — subject to the same rule about live kernels.
**Stop** stops the managed server and its kernels; starting again opens the same folder.
Save notebook edits before stopping or updating Studio. Existing notebooks do not need to
be moved into a `project-id/files` subfolder.

## Controlling a window

The **Window** pane is a live preview of a native desktop app or screen. **Embed** is for websites and localhost web apps you interact with directly inside a pane.

1. Click **Pick a window** and choose a thumbnail from Studio's window/screen picker.
2. Window captures automatically select the matching application. For a screen capture, choose the particular app to bring forward from **Choose app to interact with…**.
3. Click **Interact with app**. The real application comes forward; use its normal mouse, keyboard, menus and dialogs.
4. Click the floating **Back to Studio** button, press **Ctrl+Shift+F12**, or Alt+Tab back to Studio. Your current beat and layout stay in place.

Drag the toolbar by its grip or background to move it. **Hide toolbar** removes it for recording while the return shortcut remains active. If another program owns the shortcut, the toolbar explains this and cannot be hidden. The shortcut is released when you return. Closing Studio also removes the toolbar.

The toolbar names the app currently being used. Studio moves behind that app while continuing to render its preview. The app is not embedded inside the slot: selecting text, dragging and keyboard shortcuts happen in its real window. If only the toolbar appears, return to Studio and rescan; that is a failed switch, not another control mode.

Interaction requires the Windows desktop app. Elsewhere, Window remains a live preview. If a target closes, rescan and select its new window. Windows may refuse to bring an app forward; Studio reports that failure instead of pretending the switch succeeded. The preview does not forward input or move your physical cursor. Native apps still run in their own windows, and a minimised app may stop updating its capture. The floating toolbar may appear in a whole-display recording; hide it before a take if needed.

## Research with AI

Choose **AI** in a pane, select a model that supports tool calling, and ask a question or describe a deliverable. The agent can investigate sources, read files, search the web and create Markdown briefs, Mermaid diagrams, SVGs and scripts. It works through several tool calls and shows their results in the conversation. Generated diagrams are files; they are not automatically inserted into the Canvas.

Choose **Current source**, **All project sources** or **No source context** to control which saved article text and highlights are sent with the request. Project files can also be read through `project/` paths. These file tools keep the original project material read-only and put new work in the project's `research/` folder.

Every file write shows the proposed contents before **Allow once** or **Decline**. Every shell command shows the exact command and working folder. PowerShell works on Windows; Bash requires Git for Windows in its usual installation location. Commands run with your account and can access files outside the working folder: this is not an OS sandbox. Review the command before approving it. Commands stop after 30 seconds; output is capped.

**Stop** cancels a run. Closing its AI pane also cancels it, keeping completed tool results and any partial text already received. Runs are limited to 12 model steps and 15 minutes; send a follow-up to continue. Older complete turns leave the model's working context, but remain on disk and can be read by the history tool. A provider/model without tool support will report an error; protocol compatibility alone does not guarantee tool support.

### Conversations and files

**Project research** is the default when a project is open. Conversations are stored separately from project autosave in `<project>/.ai/conversations/`, and deliverables in `<project>/research/`. They travel with the project folder. **Global research** stores conversations in `~/.content-studio/conversations/` and deliverables in `~/.content-studio/research/`; it does not include the selected project's sources or file access. Global research also works before opening a project.

Use **New** to start a conversation and the conversation dropdown to resume one. **Files** opens its research folder. Existing project chat can be imported explicitly; the original chat is kept. Conversation files are local JSON, not encrypted like API keys, so keep private research in a folder you trust. Selected context and tool results are sent to the model provider you choose.

### Web search

Add a **Tavily API key** in **Settings → Web search**. This is separate from the model provider's key. The desktop encrypts it using your Windows account, stores it in `~/.content-studio/search.json`, and shows only its last four characters. Save replaces the key; Remove key disables search. Running the server outside Electron cannot encrypt new keys; Settings reports this.

Search sends the query to Tavily and returns source links and excerpts. Reading a public page by URL requires no search key. The reader accepts public HTTP(S) text pages on standard ports, with bounded size and time; it does not run page JavaScript, log in, read private-network URLs or bypass access restrictions. Add PDFs and other documents as project sources. Verify citations and conclusions before using them in a video.

## Models and keys

**Settings → Models and keys.** Nothing about the AI pane is configured by editing files.

Any **Anthropic-compatible** (`/v1/messages`) or **OpenAI-compatible** (`/chat/completions`) endpoint works, which in practice is everything: Anthropic, OpenAI, OpenRouter, DeepSeek, Groq, Together, Google Gemini and xAI are one click and a paste, Ollama and LM Studio need no key at all, and **Something else** takes a base URL for a gateway or a self-hosted model. Add several and switch between them from the dropdown in the AI pane itself.

After a provider is added, the refresh button asks it what it can run, so model names never have to be typed — and it is also the cheapest proof that a key works.

### Where keys are kept

`~/.content-studio/credentials.json`, written owner-only. That is:

* **outside the codebase**, so a key cannot be committed or pushed. It is not in `.env` and not in any project folder.
* **encrypted at rest.** On the desktop each key is sealed with the operating system's own facility — DPAPI on Windows, through Electron's `safeStorage` — so the ciphertext is bound to your Windows account. Copy the file to another machine, or read it from another account, and the keys are unusable. Settings says which state you are in: a padlock when they are encrypted, an open padlock when they are not.
* **write-only from the app's point of view.** A key is sent once. The server never sends it back — the UI sees `hasKey` and the last four characters, nothing more — so it cannot appear in a screenshot or a recording of the settings screen.
* **scrubbed out of errors.** If a provider echoes a key in a failure message, it is replaced before the message is shown.

Only the desktop app can encrypt, because `safeStorage` lives in the Electron main process; the server asks it over the channel it is already forked with, and holds no encryption key of its own. Run the server on its own with `npm run dev` and there is nothing to borrow: keys already sealed show as unreadable rather than being overwritten, and a key added there is written as text until the desktop app seals it.

A key that cannot be decrypted is **kept, not discarded** — the provider simply shows *paste it again* until you do. Delete the whole file and the app has no models again; nothing else is affected.

## Shortcuts

| Key | Action |
|---|---|
| `Alt+P` / `Esc` | Present mode |
| `Alt+B` | Show or hide the sidebar |
| Drag between panes | Resize columns and rows |
| `→` `←` `Space` | Next or previous beat, in Present mode |
| `Home` / `End` | First / last beat, in Present mode or the presenter window |
| `h` | Hide or show the beat strip |
| `→` `←` `Space` | Navigate slides and PDF pages, when not presenting |
| `Esc` | Put the drawing tool down |
| `Delete` | Remove the drawing you have picked up |
| `Home` / `End` | First / last page of a PDF, when not presenting |
| `Ctrl` + scroll | Zoom a PDF |
| `Ctrl+Enter` | Run the current code snippet |
| `Ctrl+S` | Save the open file, in the Files pane |
| `F2` / `Delete` | Rename / delete the selected file or folder, in the Files pane |
| `Ctrl+F` | Find in the open file, in the Files pane |
| `Ctrl+click` a link | Open it in your normal browser instead of the pane |


## Odds and ends

* Launching Studio again brings its existing window forward, including when that window was hidden. Development copies share the installed app's single-instance lock; close them after testing.

* Code snippets, the terminal and window control all act with your user's permissions; see [Security](../README.md#security).
* Pages are downloaded once and cached in `~/.content-studio/cache`. **Re-download this page**, in the Source toolbar's **⋯** menu, fetches it again.
* The proxy relies on every `*.localhost` name resolving to 127.0.0.1, which Chrome, Edge and Firefox do by default.
* Sites that need a login, or that block server-side fetching, will not render. Try the print version, or use Reader.
* The API server deliberately runs without `node --watch`: node-pty's console worker crashes under watch mode on Windows. Restart `npm run dev` after changing server files.

## Settings that live in `.env`

Optional, and nothing in it is needed to use the app.

| Variable | Default | Meaning |
|---|---|---|
| `API_PORT` | `4700` | API and proxy port |
| `HOST` | `127.0.0.1` | Bind address. Changing it exposes a shell and desktop control to your network. |
| `JUPYTER_PORT` | `8890` | Preferred JupyterLab port; another free loopback port is chosen if occupied |
| `RS_SHELL` | `powershell.exe` | Shell used by the Terminal pane |
| `ANTHROPIC_API_KEY` | | Only read once, to carry an older setup over into Settings |

`~/.content-studio/config.json` is the index of where each project folder is. Delete a project folder by hand and the index repairs itself on the next refresh.

## Where everything is stored

| What | Where | Safe to delete? |
|---|---|---|
| Your material | the project folder you chose | no — this is your work |
| Links, summaries, code highlights | inside `project.json` | no — part of your work |
| Code shown in the Files pane | wherever that folder is; never copied | — |
| Which projects exist | `~/.content-studio/config.json` | yes, but the app forgets where your projects are; the folders survive |
| Cached web pages | `~/.content-studio/cache/sites/` | yes — pages are fetched again as needed |
| API keys | `~/.content-studio/credentials.json` | yes — you would re-add your providers |
| The browser pane's sign-ins | `~/.content-studio/browser/` | yes — you would sign in again |
| Downloaded updates | `%LOCALAPPDATA%\content-studio-updater\` | yes |

Nothing of yours is ever written inside the codebase.

The page cache grows and is never pruned. One article with video in it can be 25 MB or so.
If it gets large, delete `~/.content-studio/cache` — the app rebuilds what it needs.

## When something goes wrong

**An update never arrives.** Open **Settings → Updates** and watch it. The installer is
around 115 MB and takes a few minutes; restarting the app during that throws the download
away and starts it again, so an app that is restarted often may never finish one. Leave it
open until it says *ready*, then click **Restart and install**. If you would rather not
wait, download the installer from
[Releases](https://github.com/gotherohit/content-studio/releases) and run it over the top.

**"The studio server did not start in time".** The app gave up waiting for its own server.
From 0.20.1 it waits a minute rather than twenty seconds, and on a check that does no work, so
this should not happen; the usual cause was the first launch straight after an update, while
Windows was still scanning the new files. Launching Content Studio again is the fix.

**The update downloads, you press Restart and install, and nothing happens.** Windows is
refusing to run the installer. Content Studio now says so in **Settings → Updates** and stays
open instead of quitting, and it writes what happened to `~/.content-studio/update.log`.

The usual cause on Windows 11 is **Smart App Control**, which only runs programs that are
either known to Microsoft or signed with a certificate from a trusted authority. Content
Studio's installer is not signed, so whether it is allowed is decided per file and can differ
from one release to the next — one update installs, the next is blocked with no message. You
can check at **Windows Security → App & browser control → Smart App Control**; when it says
*On*, that is what is blocking it. It can be switched off and back on again from there on
Windows 11 with the April 2026 update or later; on older builds turning it off was permanent
until a reset. Until the installer is signed, the alternative is to run the new version from
the source folder (`npm run desktop`).

**A project will not delete.** It now tells you why in the error bar. The usual cause is
another program holding a file in the folder open — Explorer sitting in it, PowerPoint with
a deck loaded, an editor. Close those and try again. The folder and everything in it is
removed, so there is no undo; if you only want it out of the sidebar, move the folder
somewhere else first and delete it afterwards.

**A beat restores the wrong thing, or says it could not.** Its source or highlight has been
deleted. Fix the arrangement and press the camera on that beat to re-capture it.

**A beat shows the article wherever the previous beat left it.** It was captured before
0.11.4 in a pane wide enough for the site's own header to be on screen, and anchored to the
header instead of the article. Scroll to the passage and press the camera on that beat.

**A beat drifts to a different passage when the sidebar is collapsed or Present mode
starts.** Fixed in 0.12.0: the pane keeps its passage when its width changes. If it still
happens, the beat was probably captured before 0.11.4 — press the camera on it once.

**Clicking a link in a docs site created a new source.** Before 0.12.0 every link did. Now
a link within the same site opens in the pane; only links to another site become sources.

**The presenter window is blank.** It reloads itself once if its page fails to load or
stops. If that also fails, the studio shows why in the error bar; close the presenter and
open it again.

**A highlight on code has a faint bar.** The lines it quoted were rewritten, so it could not be
found again and sits on its old line numbers. Delete it and highlight the new lines; its links
can be made again from the new highlight.

**The Files pane says the file changed on disk.** Something else — your editor, git, the AI pane
— saved it while you had unsaved changes here. **Load theirs, drop mine** discards your edits;
**Keep mine** makes the next save overwrite theirs.

**Ctrl+S does nothing in the Files pane.** The padlock is closed: the folder is read-only. Click
it to allow saving.

**A file will not open in the Files pane.** Files over 50 MB and binary files are refused; the
error bar says which. Open those in another program.

**A deleted file needs to come back.** It is in the Windows Recycle Bin: right-click it there
and choose **Restore**. Its highlights reappear in the Files pane once it is back.

**New file, Rename or Delete is greyed out.** The padlock in the Files toolbar is closed: the
folder is read-only. Click it to allow changes.

**A site refuses to load in the Embed pane.** In the desktop app, both Embed and Browser use real Chromium views. Check the address and that the app is running. Embed is suited to local
apps you are running yourself.

**Slides show as "cannot be rendered".** PowerPoint renders decks one slide at a time
through COM automation; if PowerPoint is not installed, LibreOffice is used to make a PDF
instead. With neither, a deck cannot be rendered.

**The terminal pane is empty on Windows.** `RS_SHELL` picks the shell; the default is
PowerShell.
