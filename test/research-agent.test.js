import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import express from 'express';
import { resolveWorkspacePath, executeTool, publicAddress, runShell } from '../server/agent-tools.js';
import { createResearchAgent, workingHistory, repairInterrupted } from '../server/research-agent.js';
import { createResearchSearch } from '../server/research-search.js';
import { agentStep, sse, anthropicMessages, openaiMessages } from '../server/agent-model.js';

async function scratch(t) {
  const root = path.resolve(process.platform === 'win32' ? 'D:/test content studio' : path.join(os.tmpdir(), 'content-studio-tests'));
  await fs.mkdir(root,{recursive:true}); const dir=await fs.mkdtemp(path.join(root,'agent-tests-'));
  t.after(async()=> { if(!dir.startsWith(root+path.sep))throw Error('Invalid cleanup path'); await fs.rm(dir,{recursive:true,force:true}); });
  return dir;
}
async function listening(t, app) {
  const server=http.createServer(app); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)})); return `http://127.0.0.1:${server.address().port}`;
}
const signal=()=>new AbortController().signal;

test('file tools reject traversal, protected app data and escaping junctions',async t=>{
  const root=await scratch(t);const workspace=path.join(root,'workspace');const outside=path.join(root,'outside');await fs.mkdir(workspace);await fs.mkdir(outside);
  await assert.rejects(resolveWorkspacePath(workspace,'../outside/a'),/inside/);
  await assert.rejects(resolveWorkspacePath(workspace,'.env'),/protected/);
  await assert.rejects(resolveWorkspacePath(workspace,'a:stream'),/protected/);
  await fs.symlink(outside,path.join(workspace,'escape'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(resolveWorkspacePath(workspace,'escape/new.md'),/outside/);
});

test('writes are reviewed, denied writes do nothing, and concurrent edits survive',async t=>{
  const workspace=await scratch(t),file=path.join(workspace,'brief.md');const args={path:'brief.md',content:'New research'};
  await assert.rejects(executeTool('write_file',args,{workspace,signal:signal(),approve:async()=>false}),/declined/);
  await assert.rejects(fs.access(file));
  await fs.writeFile(file,'Original');
  await assert.rejects(executeTool('write_file',args,{workspace,signal:signal(),approve:async p=>{assert.equal(p.before,'Original');await fs.writeFile(file,'User edit');return true}}),/changed during review/);
  assert.equal(await fs.readFile(file,'utf8'),'User edit');
  await executeTool('write_file',args,{workspace,signal:signal(),approve:async()=>true});
  assert.equal(await fs.readFile(file,'utf8'),'New research');
});

test('file search returns bounded literal matches and skips protected, binary and linked files', async t => {
  const workspace = await scratch(t), projectDir = path.join(workspace, 'project'), outside = await scratch(t);
  await fs.mkdir(projectDir); await fs.mkdir(path.join(workspace, 'notes'));
  await fs.writeFile(path.join(workspace, 'notes', 'brief.md'), 'Distillation is useful.\nA literal [term] here.\nDISTILLATION again.');
  await fs.writeFile(path.join(workspace, '.env'), 'Distillation secret');
  await fs.writeFile(path.join(workspace, 'config.json'), 'Distillation config');
  await fs.writeFile(path.join(workspace, 'binary.bin'), Buffer.from('Distillation\0binary'));
  await fs.writeFile(path.join(outside, 'private.md'), 'Distillation outside');
  await fs.symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const ctx = { workspace, projectDir, signal: signal() };
  const result = await executeTool('search_files', { query: 'distillation' }, ctx);
  assert.deepEqual(result.matches.map(m => [m.path, m.line]), [['notes/brief.md', 1], ['notes/brief.md', 3]]);
  assert.ok(result.skippedFiles >= 4);
  assert.equal((await executeTool('search_files', { query: '[term]' }, ctx)).matches.length, 1);
  assert.equal((await executeTool('search_files', { query: 'Distillation', case_sensitive: true }, ctx)).matches.length, 1);
  const bounded = await executeTool('search_files', { query: 'distillation', max_results: 1 }, ctx); assert.equal(bounded.matches.length, 1); assert.equal(bounded.truncated, true);
  await fs.writeFile(path.join(projectDir, 'source.md'), 'Project evidence');
  assert.equal((await executeTool('search_files', { query: 'evidence', path: 'project/' }, ctx)).matches[0].path, 'project/source.md');
  await fs.writeFile(path.join(projectDir, 'long.md'), 'Context '.repeat(100) + 'needle near the end');
  assert.match((await executeTool('search_files', { query: 'needle', path: 'project/' }, ctx)).matches[0].text, /needle near the end/);
  await assert.rejects(executeTool('search_files', { query: 'secret', path: '../' }, ctx), /inside/);
  await assert.rejects(executeTool('search_files', { query: 'outside', path: 'escape' }, ctx), /outside/);
  await assert.rejects(executeTool('search_files', { query: 'x', max_results: 101 }, ctx), /max_results/);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(executeTool('search_files', { query: 'x' }, { ...ctx, signal: aborted.signal }));
});

test('targeted edits review the exact change, preserve unrelated text and refuse ambiguity or concurrent edits', async t => {
  const workspace = await scratch(t), file = path.join(workspace, 'brief.md');
  const before = '\uFEFFHeading\r\nOriginal passage\r\nKeep this footer\r\n'; await fs.writeFile(file, before);
  const args = { path: 'brief.md', old_text: 'Original passage', new_text: 'Verified passage' };
  let reviews = 0;
  const ctx = { workspace, projectDir: workspace, signal: signal(), approve: async proposal => { reviews++; assert.deepEqual(proposal.edit, { before: args.old_text, after: args.new_text }); assert.equal(proposal.before, before); assert.equal(proposal.after, before.replace(args.old_text, args.new_text)); return true; } };
  await executeTool('edit_file', args, ctx); assert.equal(reviews, 1); assert.equal(await fs.readFile(file, 'utf8'), before.replace(args.old_text, args.new_text));
  await assert.rejects(executeTool('edit_file', args, ctx), /not found/);
  await assert.rejects(executeTool('edit_file', { ...args, path: 'project/brief.md' }, ctx), /read-only/);
  await fs.writeFile(file, 'Repeated Repeated');
  await assert.rejects(executeTool('edit_file', { ...args, old_text: 'Repeated' }, ctx), /more than once/);
  await fs.writeFile(file, before);
  await assert.rejects(executeTool('edit_file', args, { ...ctx, approve: async () => false }), /declined/); assert.equal(await fs.readFile(file, 'utf8'), before);
  await assert.rejects(executeTool('edit_file', args, { ...ctx, approve: async () => { await fs.writeFile(file, 'User changed this'); return true; } }), /changed during review/);
  assert.equal(await fs.readFile(file, 'utf8'), 'User changed this');
  await executeTool('edit_file', { path: 'brief.md', old_text: ' changed', new_text: '' }, { ...ctx, approve: async () => true }); assert.equal(await fs.readFile(file, 'utf8'), 'User this');
  assert.equal((await executeTool('edit_file', { path: 'brief.md', old_text: 'User', new_text: 'User' }, ctx)).unchanged, true);
});

test('public URL guard rejects local addresses and mapped IPv6 loopback',()=>{
  for(const address of ['127.0.0.1','10.1.1.1','172.20.0.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});

test('history trimming keeps tool calls and results together; interrupted calls are repaired',()=>{
  const messages=[{role:'user',content:'Old'.repeat(1000)},{role:'assistant',content:'',toolCalls:[{id:'x',name:'read_file',arguments:'{}'}]},{role:'tool',toolCallId:'x',content:'Read'},{role:'user',content:'New'}];
  assert.deepEqual(workingHistory(messages,100).messages,[messages[3]]);
  const fixed=repairInterrupted({messages:messages.slice(0,2),activity:[{status:'approval',approval:{id:'old'}}],status:'running'});
  assert.equal(fixed.messages[2].toolCallId,'x');assert.equal(fixed.activity[0].status,'interrupted');
  assert.equal(fixed.activity[0].approval,undefined);
});

test('shell cancellation stops a running command',async t=>{
  const workspace=await scratch(t),abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),800);t.after(()=>clearTimeout(timer));
  const result=await runShell(process.platform==='win32'?'Start-Sleep -Seconds 20':'sleep 20',process.platform==='win32'?'powershell':'bash',workspace,abort.signal);
  assert.equal(result.cancelled,true);
});

test('search keys are encrypted, masked and never echoed in provider errors',async t=>{
  const appDir=await scratch(t),secret='tvly-test-secret-123456';
  const vault={available:async()=>true,encrypt:async k=>Buffer.from(k).toString('base64'),decrypt:async k=>Buffer.from(k,'base64').toString()};
  const search=createResearchSearch({appDir,vault,fetchImpl:async()=>new Response(secret,{status:401})});await search.load();await search.save(secret);
  const stored=await fs.readFile(path.join(appDir,'search.json'),'utf8');assert.ok(!stored.includes(secret));assert.equal(search.status().keyHint,'…3456');
  await assert.rejects(search.search('test',signal()),e=>!e.message.includes(secret)&&e.message.includes('401'));
  const reloaded=createResearchSearch({appDir,vault});await reloaded.load();assert.equal(reloaded.status().hasKey,true);
});

test('OpenAI tool argument fragments survive chunked SSE and tool results replay',async t=>{
  const url=await listening(t,async(req,res)=>{
    let body='';for await(const part of req)body+=part; const payload=JSON.parse(body);assert.ok(payload.tools.length);
    res.setHeader('Content-Type','text/event-stream');
    for(const ev of [{choices:[{delta:{content:'Checking files. '}}]},{choices:[{delta:{tool_calls:[{index:0,id:'call1',function:{name:'read_file',arguments:'{"pa'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'th":"brief.md"}'}}]},finish_reason:'tool_calls'}]}])res.write('data: '+JSON.stringify(ev)+'\r\n\r\n');res.end('data: [DONE]');
  });
  let text='';const reply=await agentStep({provider:{kind:'openai',baseUrl:url,label:'Fixture'},model:'test',system:'test',messages:[{role:'user',content:'read'}],tools:[{name:'read_file',description:'read',parameters:{type:'object'}}],signal:signal(),onText:d=>text+=d});
  assert.equal(text,'Checking files. ');assert.deepEqual(JSON.parse(reply.toolCalls[0].arguments),{path:'brief.md'});
  const converted=openaiMessages([reply,{role:'tool',toolCallId:'call1',content:'Result'}]);assert.equal(converted[1].tool_call_id,'call1');
});

test('Anthropic streams tool requests and preserves native signed content for replay',async t=>{
  const url=await listening(t,async(req,res)=>{
    for await(const _ of req){}res.setHeader('Content-Type','text/event-stream');
    const events=[{type:'message_start',message:{id:'msg_1',type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:5,output_tokens:1}}},
      {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool1',name:'read_file',input:{}}},
      {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"path":"brief.md"}'}},
      {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:20}},{type:'message_stop'}];
    for(const ev of events)res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);res.end();
  });
  const reply=await agentStep({provider:{kind:'anthropic',baseUrl:url,apiKey:'fixture'},model:'test',system:'test',messages:[{role:'user',content:'read'}],tools:[{name:'read_file',description:'read',parameters:{type:'object'}}],signal:signal(),onText:()=>{}});
  assert.equal(reply.toolCalls[0].name,'read_file');
  const opaque={type:'redacted_thinking',data:'opaque-signature'};reply.anthropicContent.unshift(opaque);
  assert.deepEqual(anthropicMessages([reply])[0].content[0],opaque);
});

test('durable agent loop pauses for approval, saves output and isolates global sessions',async t=>{
  const root=await scratch(t),projectDir=path.join(root,'project'),home=path.join(root,'home');await fs.mkdir(projectDir);await fs.mkdir(home);await fs.writeFile(path.join(projectDir,'project.json'),'{}');
  const credentials={list:()=>({providers:[]}),find:()=>null,resolve:()=>({provider:{kind:'openai'},model:'fixture',ref:'fixture/model'})};
  const config={appDir:()=>home,dirOf:id=>id==='scratch'?projectDir:null};
  let count=0;
  const agent=createResearchAgent({config,credentials,search:{status:()=>({hasKey:false})},readProject:async()=>({sources:[],chat:[]}),step:async()=>++count===1?{role:'assistant',content:'Saving a brief.',toolCalls:[{id:'write1',name:'write_file',arguments:JSON.stringify({path:'brief.md',content:'# Research\nVerified fixture'})}]}:{role:'assistant',content:'Saved brief.md.',toolCalls:[]}});
  const app=express();app.use(express.json());app.use('/api/research',agent.router);const url=await listening(t,app);
  const post=async(route,body)=>{const r=await fetch(url+'/api/research'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json()};
  const session=await post('/sessions',{projectId:'scratch'});
  const response=await fetch(url+`/api/research/sessions/${session.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'scratch',message:'Save a brief',model:'fixture/model',context:'none'})});
  let approved=false,done=false;
  for await(const data of sse(response.body)){
    if(!data)continue;const event=JSON.parse(data);
    if(event.activity?.approval){assert.equal(agent.isProjectActive('scratch'),true);const result=await post(`/sessions/${session.id}/approval`,{projectId:'scratch',approvalId:event.activity.approval.id,allow:true});assert.equal(result.ok,true);approved=true;}
    if(event.done){done=true;assert.equal(event.session.status,'complete');}
  }
  assert.ok(approved&&done);assert.equal(await fs.readFile(path.join(projectDir,'research','brief.md'),'utf8'),'# Research\nVerified fixture');
  const stored=JSON.parse(await fs.readFile(path.join(projectDir,'.ai','conversations',session.id+'.json'),'utf8'));assert.equal(stored.messages[2].role,'tool');
  const globals=await fetch(url+'/api/research/sessions').then(r=>r.json());assert.equal(globals.sessions.length,0);
  const reopened=await fetch(url+`/api/research/sessions/${session.id}?projectId=scratch`).then(r=>r.json());assert.equal(reopened.messages.at(-1).content,'Saved brief.md.');
});

test('stopping during approval persists an interrupted tool result and releases the session lock',async t=>{
  const root=await scratch(t),home=path.join(root,'home');await fs.mkdir(home);
  const credentials={list:()=>({providers:[]}),find:()=>null,resolve:()=>({provider:{kind:'openai'},model:'fixture',ref:'fixture/model'})};
  const agent=createResearchAgent({config:{appDir:()=>home,dirOf:()=>null},credentials,search:{status:()=>({hasKey:false})},readProject:async()=>({}),step:async()=>({role:'assistant',content:'Requesting a write.',toolCalls:[{id:'pending1',name:'write_file',arguments:JSON.stringify({path:'blocked.md',content:'Never written'})}]})});
  const app=express();app.use(express.json());app.use('/api/research',agent.router);const url=await listening(t,app);
  const post=(route,body)=>fetch(url+'/api/research'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const session=await post('/sessions',{}).then(r=>r.json());
  const response=await post(`/sessions/${session.id}/run`,{message:'Propose a write'});let stopped=false;
  for await(const data of sse(response.body)){
    if(!data)continue;const event=JSON.parse(data);
    if(event.activity?.approval){
      const duplicate=await post(`/sessions/${session.id}/run`,{message:'Duplicate'});assert.equal(duplicate.status,400);
      await post(`/sessions/${session.id}/stop`,{});stopped=true;
    }
    if(event.done)assert.equal(event.session.status,'stopped');
  }
  assert.ok(stopped);await assert.rejects(fs.access(path.join(home,'research','blocked.md')));
  const stored=JSON.parse(await fs.readFile(path.join(home,'conversations',session.id+'.json'),'utf8'));
  assert.equal(stored.status,'stopped');assert.equal(stored.messages.at(-1).role,'tool');
});

test('project source tools page article text, expose highlights, and deny global access', async t => {
  const workspace = await scratch(t);
  const sources = [{ id: 'article', title: 'Research article', url: 'https://example.org/article', textContent: 'A'.repeat(30000), summary: 'A short summary', highlights: [{ text: 'Evidence', comment: 'Important' }] }];
  const ctx = { workspace, projectDir: workspace, projectSources: async () => sources, signal: signal() };
  assert.deepEqual((await executeTool('list_sources', {}, ctx)).sources[0].highlights, 1);
  assert.deepEqual((await executeTool('search_sources', { query: 'important' }, ctx)).matches.map((m) => m.id), ['article']);
  const paged = { ...ctx, projectSources: async () => [...Array.from({ length: 200 }, (_, index) => ({ id: `filler-${index}`, title: 'Other', textContent: '' })), ...sources] };
  assert.equal((await executeTool('list_sources', { offset: 200, limit: 1 }, paged)).sources[0].id, 'article');
  assert.equal((await executeTool('search_sources', { query: 'important', source_offset: 200 }, paged)).matches[0].id, 'article');
  const page = await executeTool('read_source', { source_id: 'article', offset: 20000, limit: 10000 }, ctx);
  assert.equal(page.text.length, 10000); assert.equal(page.totalChars, 30000); assert.equal(page.highlights[0].comment, 'Important');
  assert.equal((await executeTool('list_highlights', { source_id: 'article', offset: 0, limit: 1 }, ctx)).highlights[0].text, 'Evidence');
  await assert.rejects(executeTool('read_source', { source_id: 'missing' }, ctx), /no longer/);
  await assert.rejects(executeTool('read_source', { source_id: 'article', limit: 100000 }, ctx), /limit/);
  await assert.rejects(executeTool('list_sources', {}, { ...ctx, projectDir: null }), /project conversation/);
});

test('attached text reaches the model and persists, while visible transcript hides contents and rejects oversized input', async t => {
  const root = await scratch(t), projectDir = path.join(root, 'project'), home = path.join(root, 'home');
  await fs.mkdir(projectDir); await fs.mkdir(home); await fs.writeFile(path.join(projectDir, 'project.json'), '{}');
  const credentials = { list: () => ({ providers: [] }), find: () => null, resolve: () => ({ provider: { kind: 'openai' }, model: 'fixture', ref: 'fixture/model' }) };
  const sources = [{ id: 'source-b', title: 'Second', url: 'https://example.org/b', textContent: 'SECOND SOURCE TEXT', highlights: [] }, { id: 'source-a', title: 'First', url: 'https://example.org/a', textContent: 'FIRST SOURCE TEXT', highlights: [] }];
  let modelCalls = 0;
  const agent = createResearchAgent({ config: { appDir: () => home, dirOf: (id) => id === 'scratch' ? projectDir : null }, credentials, search: {}, readProject: async () => ({ sources }), step: async ({ messages, system }) => {
    modelCalls++;
    assert.match(messages.at(-1).content, /PRIVATE ATTACHMENT TEXT/);
    assert.match(system, /FIRST SOURCE TEXT/); assert.doesNotMatch(system, /SECOND SOURCE TEXT/);
    return { role: 'assistant', content: 'Used the attachment.', toolCalls: [] };
  } });
  const app = express(); app.use(express.json()); app.use('/api/research', agent.router); const url = await listening(t, app);
  const post = (route, body) => fetch(url + '/api/research' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const session = await post('/sessions', { projectId: 'scratch' }).then((r) => r.json());
  const endpoint = `/sessions/${session.id}/run`;
  const base = { projectId: 'scratch', message: 'Summarize this', model: 'fixture/model', context: 'source', sourceId: 'source-a' };
  const bad = await post(endpoint, { ...base, attachments: [{ name: 'huge.txt', kind: 'text', content: 'X'.repeat(60001), truncated: false }] });
  assert.equal(bad.status, 400); assert.equal(modelCalls, 0);
  const before = await fetch(url + `/api/research/sessions/${session.id}?projectId=scratch`).then((r) => r.json());
  assert.equal(before.messages.length, 0);
  const response = await post(endpoint, { ...base, attachments: [{ name: 'notes.txt', kind: 'text', content: 'PRIVATE ATTACHMENT TEXT', truncated: false }] });
  let completed;
  for await (const data of sse(response.body)) if (data) { const event = JSON.parse(data); if (event.session) { assert.ok(!JSON.stringify(event.session).includes('PRIVATE ATTACHMENT TEXT')); completed = event.session; } }
  assert.equal(completed.status, 'complete'); assert.equal(modelCalls, 1);
  assert.equal(completed.messages[0].attachments[0].name, 'notes.txt');
  const stored = JSON.parse(await fs.readFile(path.join(projectDir, '.ai', 'conversations', session.id + '.json'), 'utf8'));
  assert.equal(stored.messages[0].attachments[0].content, 'PRIVATE ATTACHMENT TEXT');
});

test('Vajra persists plans and step progress, resumes limited runs, and serializes renames', async t => {
  const home = await scratch(t);
  const credentials = { list: () => ({ providers: [] }), find: () => null, resolve: () => ({ provider: { kind: 'openai' }, model: 'fixture', ref: 'fixture/model' }) };
  let calls = 0, finish = false;
  const agent = createResearchAgent({ config: { appDir: () => home, dirOf: () => null }, credentials, search: {}, readProject: async () => ({}), step: async ({ system }) => {
    calls++;
    if (calls > 1) assert.match(system, /Investigate sources/);
    return finish ? { role: 'assistant', content: 'Resumed from saved progress.', toolCalls: [] } : { role: 'assistant', content: '', toolCalls: [{ id: `plan${calls}`, name: 'update_plan', arguments: JSON.stringify({ steps: [{ text: 'Investigate sources', status: 'in_progress' }] }) }] };
  } });
  const app = express(); app.use(express.json()); app.use('/api/research', agent.router); const url = await listening(t, app);
  const request = (route, body, method = 'POST') => fetch(url + '/api/research' + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const session = await request('/sessions', {}).then(r => r.json());
  const endpoint = `/sessions/${session.id}`;
  assert.equal((await request(endpoint, { title: ' ' }, 'PUT')).status, 400);
  assert.equal((await request(endpoint, { title: 'My Vajra research' }, 'PUT').then(r => r.json())).title, 'My Vajra research');
  const response = await request(endpoint + '/run', { message: 'Investigate' });
  let completed;
  for await (const data of sse(response.body)) {
    if (!data) continue; const event = JSON.parse(data);
    if (event.session?.status === 'running' && event.session.progress.step === 0) assert.equal((await request(endpoint, { title: 'Race' }, 'PUT')).status, 400);
    if (event.done) completed = event.session;
  }
  assert.equal(completed.status, 'limited'); assert.equal(completed.progress.step, 12); assert.ok(completed.progress.finishedAt);
  const stored = JSON.parse(await fs.readFile(path.join(home, 'conversations', session.id + '.json'), 'utf8'));
  assert.deepEqual(stored.plan, [{ text: 'Investigate sources', status: 'in_progress' }]); assert.equal(stored.title, 'My Vajra research');
  finish = true;
  const resume = await request(endpoint + '/run', { message: 'Continue from saved progress' });
  for await (const data of sse(resume.body)) { if (data) { const event = JSON.parse(data); if (event.done) completed = event.session; } }
  assert.equal(completed.status, 'complete'); assert.equal(completed.progress.step, 1); assert.equal(completed.plan[0].status, 'in_progress', 'the harness never fabricates plan completion');
});
