import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';

function setup({ conflict = false, failFocus = false } = {}) {
  const handlers = new Map(); const shortcuts = new Map(); const windows = [];
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.visible = false; this.dead = false; windows.push(this); }
    isDestroyed() { return this.dead; }
    isVisible() { return this.visible; }
    getNativeWindowHandle() { const b=Buffer.alloc(8); b.writeBigUInt64LE(42n); return b; }
    async loadFile() {}
    setAlwaysOnTop() {}
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    isMinimized() { return false; }
    focus() { this.emit('focus'); }
    destroy() { this.dead = true; this.emit('closed'); }
    static getAllWindows() { return windows.filter(w=>!w.dead); }
  }
  const studio = new Window();
  const code=readFileSync(new URL('../electron/handoff.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function wireHandoff','function wireHandoff');
  const context={ BrowserWindow:Window, path, ipcMain:{handle:(n,fn)=>handlers.set(n,fn)}, screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920}})}, globalShortcut:{register:(s,fn)=>{if(conflict)return false;shortcuts.set(s,fn);return true},unregister:s=>shortcuts.delete(s)} };
  vm.createContext(context); vm.runInContext(code,context);
  context.wireHandoff(studio,'.',async (route)=> {
    if(route.endsWith('targets'))return {available:true,windows:[{id:99,title:'Scratch app'}]};
    assert.equal(windows.at(-1).isVisible(), true, 'Show the toolbar before transferring native focus');
    if(failFocus)throw Error('Focus refused');
    return {ok:true};
  });
  const call=(name,arg,sender=studio.webContents)=>handlers.get('handoff:'+name)({sender},arg);
  return {studio,call,shortcuts,windows};
}

test('handoff returns without replacing Studio and releases its shortcut', async()=>{
  const s=setup(); assert.equal((await s.call('start',99)).active,true);
  const bar=s.windows[1]; assert.equal(bar.isVisible(),true);
  await s.call('return',undefined,bar.webContents);
  assert.equal(s.call('state').active,false); assert.equal(s.shortcuts.size,0); assert.equal(bar.dead,true); assert.equal(s.studio.dead,false);
});
test('hidden toolbar still has a working return shortcut',async()=>{
  const s=setup(); await s.call('start',99); await s.call('hide');
  assert.equal(s.call('state').hidden,true); [...s.shortcuts.values()][0]();
  assert.equal(s.call('state').active,false);
});
test('shortcut conflict keeps a visible way back',async()=>{
  const s=setup({conflict:true}); assert.equal((await s.call('start',99)).shortcut,false);
  assert.throws(()=>s.call('hide'),/unavailable/); assert.equal(s.windows[1].isVisible(),true);
});
test('failed focus cleans up the toolbar and shortcut',async()=>{
  const s=setup({failFocus:true}); await assert.rejects(s.call('start',99),/Focus refused/);
  assert.equal(s.shortcuts.size,0); assert.equal(s.windows[1].dead,true); assert.equal(s.call('state').active,false);
});
test('stale targets and foreign senders cannot start an interaction',async()=>{
  const s=setup(); await assert.rejects(s.call('start',123),/no longer available/);
  await assert.rejects(s.call('start',99,{}),/outside Studio/); assert.equal(s.windows.length,1);
});
test('Alt-Tab back and Studio closing clean up the handoff',async()=>{
  const s=setup(); await s.call('start',99); s.studio.emit('focus'); assert.equal(s.call('state').active,false);
  await s.call('start',99); s.studio.destroy(); assert.equal(s.shortcuts.size,0); assert.equal(s.windows[2].dead,true);
});
