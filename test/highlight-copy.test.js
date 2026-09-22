import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

test('focused highlight note copies the captured quote, preserves note copy, and exposes a copy button', async () => {
  const require = createRequire(new URL('../client/package.json', import.meta.url));
  const ts = require('typescript'), React = require('react');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let copied = '', root;
  dom.window.navigator.clipboard = { writeText: async text => { copied = text; } };
  try {
    const source = await fs.readFile(new URL('../client/src/components/HighlightPopup.tsx', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {}; new Function('require', 'exports', compiled)(require, exports);
    root = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(exports.HighlightPopup, { x: 100, y: 100, flip: false, selectionText: 'Selected article passage', onCommit() {}, onCancel() {} })));
    const input = document.querySelector('input'); assert.equal(document.activeElement, input);
    const key = () => new dom.window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    let event = key(); await React.act(async () => input.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true); assert.equal(copied, 'Selected article passage');
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'My note'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    event = key(); await React.act(async () => input.dispatchEvent(event)); assert.equal(event.defaultPrevented, false, 'typed notes retain native copy');
    copied = ''; await React.act(async () => document.querySelector('[title="Copy selected text"]').click()); assert.equal(copied, 'Selected article passage');
    for (const file of ['OriginalView', 'Reader', 'PdfView', 'FileView']) assert.match(await fs.readFile(new URL(`../client/src/components/${file}.tsx`, import.meta.url), 'utf8'), /selectionText=\{popup.shape \? undefined : popup.anchor\?\.text\}/);
  } finally {
    if (root) await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
