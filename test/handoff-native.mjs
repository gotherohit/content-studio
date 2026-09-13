import { createInput } from '../server/input.js';
const input=createInput();
try {
  const {windows}=await input.send({type:'windows'});
  const source=windows.find(w=>w.title==='Content Studio');
  const target=windows.find(w=>w.title==='Handoff test target');
  if(!source || !target) throw Error('Open Studio and the disposable handoff target first.');
  console.log(await input.send({type:'focus',hwnd:target.id,fromHwnd:source.id}));
} catch(e) { console.error(e.message); process.exitCode=1; } finally { input.stop(); }
