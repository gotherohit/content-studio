import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

test('Vajra sidebar selects and searches conversations, scopes workspaces, and adapts without interrupting a run', async () => {
  const require = createRequire(new URL('../client/package.json', import.meta.url));
  const ts = require('typescript'), React = require('react');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const saved = new Map(); let resize;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { constructor(cb) { resize = cb; } observe() { resize([{ contentRect: { width: 1000 } }]); } disconnect() {} } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let root, settings = 0, stopped = 0, created = 0;
  const session = (id, title, status = 'complete') => ({ id, title, status, updatedAt: 'today', workspace: 'scratch/research', model: null, messages: [{ role: 'assistant', content: `${title} answer` }], activity: [] });
  const sessions = { alpha: session('alpha', 'Alpha evidence'), beta: session('beta', 'Beta diagram'), global: session('global', 'Global research'), active: session('active', 'Running task', 'running') };
  const calls = [];
  const research = {
    list: async project => { calls.push(project); return { sessions: project ? [sessions.alpha, sessions.beta, sessions.active] : [sessions.global] }; },
    load: async (_project, id) => sessions[id],
    create: async project => { assert.equal(project, 'scratch'); created++; return session('new', 'New research', 'idle'); },
    stop: async () => { stopped++; },
  };
  const load = (name, imports = {}) => {
    const source = fs.readFileSync(new URL(`../client/src/components/${name}.tsx`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {}; new Function('require', 'exports', code)(id => imports[id] || require(id), exports); return exports;
  };
  try {
    const { AiPanel } = load('AiPanel', { './VajraSidebar': load('VajraSidebar'), '../api': { api: { aiStatus: async () => ({ models: [] }), reveal: async () => {} } }, '../research': { research }, marked: { marked: { parse: text => text } }, dompurify: { sanitize: text => text } });
    root = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(AiPanel, { projectId: 'scratch', projectTitle: 'Scratch project', source: null, onOpenSettings: () => settings++ })));
    const click = async selector => { const el = document.querySelector(selector); assert.ok(el, selector); await React.act(async () => el.click()); };
    const search = async text => { await React.act(async () => { const el = document.querySelector('[aria-label="Search conversations"]'); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, text); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
    assert.ok(document.querySelector('.vajra-shell.wide .vajra-sidebar'));
    assert.equal(document.querySelector('[aria-current="page"]').title, 'Alpha evidence');
    await click('.vajra-conversation[title="Beta diagram"]'); assert.match(document.querySelector('.chat').textContent, /Beta diagram answer/);
    await search(' ALPHA '); assert.equal(document.querySelectorAll('.vajra-conversation').length, 1);
    await search('missing'); assert.match(document.querySelector('.vajra-conversation-list').textContent, /No matching/);
    await click('.vajra-sidebar > button'); assert.equal(created, 1); assert.equal(document.querySelector('[aria-label="Search conversations"]').value, '');
    await React.act(async () => { const select = document.querySelector('[aria-label="Conversation location"]'); select.value = 'global'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.match(document.querySelector('.chat').textContent, /Global research answer/); assert.equal(calls.at(-1), null);
    await React.act(async () => resize([{ contentRect: { width: 400 } }])); assert.equal(document.querySelector('.vajra-sidebar'), null);
    await click('[title="Toggle Vajra sidebar"]'); assert.equal(document.activeElement.getAttribute('aria-label'), 'Search conversations');
    assert.equal(document.querySelector('.vajra-sidebar').getAttribute('aria-modal'), 'true');
    await React.act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('.vajra-sidebar'), null); assert.equal(document.activeElement.title, 'Toggle Vajra sidebar');
    await click('[title="Toggle Vajra sidebar"]');
    await React.act(async () => { const select = document.querySelector('[aria-label="Conversation location"]'); select.value = 'project'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await click('.vajra-conversation[title="Running task"]'); assert.equal(document.querySelector('.vajra-sidebar'), null);
    await click('[title="Toggle Vajra sidebar"]'); assert.equal(document.querySelector('[aria-label="Conversation location"]').disabled, true);
    assert.ok([...document.querySelectorAll('.vajra-conversation')].every(el => el.disabled)); assert.equal(stopped, 0, 'opening navigation never stops a run');
    await click('.vajra-sidebar-footer button:last-child'); assert.equal(settings, 1); assert.equal(document.querySelector('.vajra-sidebar'), null);
  } finally {
    if (root) await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
