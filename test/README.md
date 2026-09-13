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
