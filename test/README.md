# Jupyter verification

`npm test` checks loopback-only startup arguments, project-local Lab workspaces, and
occupied-port handling. For a real kernel test, start the development server on port
4710, create a fresh project in the dedicated test folder, and run Electron with
`test/jupyter-desktop.cjs`, `--remote-debugging-port=9223`, and a quoted
`--test-profile=<fresh folder beneath the test folder>` argument. This fixture displays
the real renderer with a separate browser profile. The server still shares the real app
index: only register, open and delete the new scratch project.

Select Jupyter in that project, start it, create a Python notebook and run `6 * 7`.
Save it, reload Studio and execute another cell. Check that the kernel returns to Idle,
then Stop/start and verify the saved notebook opens and executes again. Remove the
scratch project, close the fixture, stop its development server, and remove only the
test browser profile. Do not stop the user's installed app or its Jupyter server.

# Research verification

`npm test` includes isolated research-agent tests for tool-call streaming in both provider
formats, signed-content replay, file boundaries, write approval, concurrent file edits,
encrypted search keys, durable transcripts, history trimming and cancellation. Windows
scratch folders live under the dedicated test folder in AGENTS.md and are removed afterwards.

For a real UI check, run `node test/research-provider-fixture.mjs` and add a temporary
OpenAI-compatible, keyless provider at `http://127.0.0.1:4891/v1`, model `fixture-agent`.
Open a new disposable project in the test folder, choose AI, and explicitly select the
fixture model. Send a request, approve its file write and PowerShell command, and check the
saved file, tool results and conversation after reload. A request containing `slow` tests
Stop. No paid model or real web search is used. Remove the temporary provider and scratch
project, and stop the fixture when done. A real Tavily request needs a separately supplied key.

# Highlight verification

Highlight regressions run in `npm test`: hidden duplicate text, element selection boundaries,
whitespace changes, overlapping marks, website colour overrides and DOM replacement recovery.
For UI verification, use a disposable project and serve `highlight-article.html` through a
browser route override for a synthetic source URL. Its injection URLs expect the test server
on port 4710. Select both passages with the real colour picker, click **Simulate article
update**, and check both coloured passages and Highlights cards. Check Reader, Original and
reopening the project, then remove the disposable project and close the test app.

# Window handoff verification

`npm test` includes the handoff lifecycle tests: return, hidden toolbar, shortcut
conflict, focus failure, stale targets, sender isolation and cleanup. They also assert
that the toolbar is shown before native focus is transferred.

For a real Windows check, launch Studio with `--remote-debugging-port=9222` and open
only a disposable project in the test folder required by AGENTS.md. Then launch:

```sh
node_modules/.bin/electron test/handoff-target.cjs --remote-debugging-port=9223
```

This opens a disposable editor with no file access. Pick it in a Window pane and check
the live capture and automatic application selection. Interact, type/select text in
the real editor, return by the floating button, then repeat with the toolbar hidden
and Ctrl+Shift+F12. The Studio layout should remain unchanged. Check a closed target,
cancelled picker and stopping capture too. Close the fixture and remove the scratch
project when finished.

`node test/handoff-native.mjs` separately exercises the Windows focus helper against
the two named windows. It requires both to be visible and never creates project data.
It is deliberately excluded from CI and the regular unit suite.
