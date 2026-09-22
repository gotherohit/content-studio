import http from 'node:http';
const port=4891;
const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture-agent'}]}));return;}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);const messages=body.messages||[];
  const lastUser=messages.findLastIndex(m=>m.role==='user');const prompt=messages[lastUser]?.content||'';
  const results=messages.slice(lastUser+1).filter(m=>m.role==='tool');
  res.setHeader('Content-Type','text/event-stream');
  const send=ev=>res.write('data: '+JSON.stringify(ev)+'\n\n');
  if(prompt.includes('slow')){
    send({choices:[{delta:{content:'Starting the cancellable fixture response…'}}]});const timer=setTimeout(()=>res.end(),60000);res.on('close',()=>clearTimeout(timer));return;
  }
  const plan = status => ({ steps: [{ text: 'Inspect workspace and create a verified brief', status }] });
  const steps=[['update_plan',plan('in_progress')],['list_files',{}],['write_file',{path:'fixture-brief.md',content:'# Fixture research brief\n\nThis file verifies the agent write approval and persistence.\n'}],['read_file',{path:'fixture-brief.md'}],['bash',{shell:'powershell',command:"Write-Output 'fixture-shell-ok'"}],['update_plan',plan('complete')]];
  const selected=steps[results.length];
  if(selected){
    const [name,args]=selected;
    send({choices:[{delta:{content:`Step ${results.length+1}: ${name.replaceAll('_',' ')}.\n`}}]});
    send({choices:[{delta:{tool_calls:[{index:0,id:`call_${lastUser}_${results.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]});
  }else send({choices:[{delta:{content:'Completed the fixture workflow. Saved **fixture-brief.md**, read it back, and ran the approved shell command. This is a local verification response.'},finish_reason:'stop'}]});
  res.end('data: [DONE]\n\n');
});
server.listen(port,'127.0.0.1',()=>console.log(`Research fixture on ${port}`));
