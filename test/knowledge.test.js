import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeService,chunkText,validateUpload } from '../knowledge.js';
import { createServer } from '../server.js';
import { readFile } from 'node:fs/promises';

const user={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.test'};
const other='22222222-2222-4222-8222-222222222222';
const config={url:'https://project.supabase.co',anon:'public-test-key',key:'private-model-test-key',model:'test-model'};
function fixture({answer={answer:'资料中的流程要求先审核再出货。[S1]',citations:['S1']},matches,quota=true}={}) {
  const docs=[];const chunks=[];const calls=[];const objects=new Map();
  async function fetchImpl(url,init={}) {
    calls.push({url,init});const u=new URL(url);const body=typeof init.body==='string'?JSON.parse(init.body):init.body;
    const reply=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    if(u.pathname==='/auth/v1/token')return reply({access_token:'private-session-test',expires_in:3600,user});
    if(u.pathname==='/auth/v1/user')return init.headers.Authorization==='Bearer private-session-test'?reply(user):new Response('',{status:401});
    if(u.hostname==='api.openai.com') {
      assert.equal(init.headers.Authorization,'Bearer private-model-test-key');
      if(u.pathname.endsWith('/embeddings'))return reply({data:body.input.map((_,index)=>({index,embedding:Array(1536).fill(0.05)}))});
      const visual=Array.isArray(body.messages.at(-1).content);
      return reply({choices:[{message:{content:JSON.stringify(visual?{descriptions:[{index:0,text:'第一帧展示装箱流程'},{index:1,text:'第二帧展示检验步骤'}]}:answer)}}]});
    }
    assert.equal(init.headers.apikey,'public-test-key');
    assert.equal(init.headers.Authorization,'Bearer private-session-test');
    if(u.pathname.endsWith('/rpc/reserve_kb_operation'))return reply(quota);
    if(u.pathname.endsWith('/rpc/match_kb_chunks'))return reply(matches||chunks.map(c=>({...c,similarity:0.9,title:'业务说明',mime_type:'text/plain'})));
    if(u.pathname==='/rest/v1/kb_documents') {
      if(init.method==='POST'){docs.push({...body});return reply(null);}
      let selected=docs.filter(d=>!u.searchParams.has('id')||'eq.'+d.id===u.searchParams.get('id'));
      if(u.searchParams.has('user_id'))selected=selected.filter(d=>'eq.'+d.user_id===u.searchParams.get('user_id'));
      if(init.method==='PATCH'){selected.forEach(d=>Object.assign(d,body));return new Response(null,{status:204});}
      if(init.method==='DELETE'){selected.forEach(d=>docs.splice(docs.indexOf(d),1));return new Response(null,{status:204});}
      return reply(selected);
    }
    if(u.pathname==='/rest/v1/kb_chunks') {
      if(init.method==='DELETE'){chunks.splice(0);return new Response(null,{status:204});}
      if(init.method==='POST'){chunks.push(...body);return new Response(null,{status:201});}
    }
    if(u.pathname.includes('/object/sign/'))return reply({signedURL:'/object/sign/logihub-knowledge/private-file?token=temporary-test'});
    if(u.pathname.includes('/storage/v1/object/')){
      if(init.method==='DELETE'){return reply({ok:true});}
      if(init.method==='POST'){objects.set(u.pathname,init.body);return reply({Key:u.pathname});}
      return new Response('test file');
    }
    throw new Error('Unexpected fixture request '+u.pathname);
  }
  return {service:createKnowledgeService({config,fetchImpl}),docs,chunks,calls,fetchImpl};
}
function form(name,text,type='text/plain',extra={}) {
  const f=new FormData();f.append('file',new File([text],name,{type}));for(const [key,value]of Object.entries(extra))f.append(key,value);return f;
}
test('unconfigured agent remains explicit and makes no external requests',async()=>{
  const service=createKnowledgeService({config:{},fetchImpl:()=>{throw new Error('no request expected');}});
  assert.deepEqual(service.status(),{databaseReady:false,modelReady:false,configured:false});
  await assert.rejects(service.login('owner@example.test','test'),e=>e.status===503);
  await assert.rejects(service.authenticate('test'),e=>e.status===503);
});
test('text chunk overlap and upload allowlist preserve usable retrieval content',()=>{
  const chunks=chunkText('ABCDEFGHIJKL',6,2);
  assert.deepEqual(chunks.map(c=>c.content),['ABCDEF','EFGHIJ','IJKL']);
  assert.equal(validateUpload(new File(['text'],'brief.md')).mime,'text/markdown');
  assert.throws(()=>validateUpload(new File(['<script>'],'page.html')),e=>e.status===415);
  assert.throws(()=>validateUpload({name:'large.pdf',size:21*1024*1024}),e=>e.status===400);
});
test('upload stores private object and owner-scoped chunks; answer cites only current evidence',async()=>{
  const f=fixture();const result=await f.service.upload('private-session-test',user,form('流程.txt','出货流程：先审核合同，然后安排装箱检验。'));
  assert.equal(result.status,'ready');assert.equal(f.docs[0].user_id,user.id);assert.ok(f.docs[0].storage_path.startsWith(user.id+'/'));
  assert.equal(f.chunks.length,1);assert.equal(f.chunks[0].embedding.length,1536);assert.equal(f.chunks[0].user_id,user.id);
  const response=await f.service.ask('private-session-test',user,{question:'出货之前做什么？'});
  assert.match(response.answer,/\[S1\]/);assert.equal(response.sources[0].documentId,result.id);
  assert.ok(!JSON.stringify(response).includes('private-model-test-key'));
  assert.ok(f.calls.filter(c=>c.url.includes('supabase.co')).every(c=>c.init.headers.Authorization==='Bearer private-session-test'));
});
test('retrieval drops another account evidence and declines to invent an answer',async()=>{
  const f=fixture({matches:[{user_id:other,similarity:0.99,content:'other account secret'}]});
  const result=await f.service.ask('private-session-test',user,{question:'问题'});
  assert.equal(result.sources.length,0);assert.match(result.answer,/未找到/);
  assert.equal(f.calls.filter(c=>c.url.endsWith('chat/completions')).length,0);
});
test('fabricated model citations are rejected rather than shown as real sources',async()=>{
  const f=fixture({answer:{answer:'错误证据 [S99]',citations:['S99']}});
  await f.service.upload('private-session-test',user,form('规则.txt','真实规则'));
  await assert.rejects(f.service.ask('private-session-test',user,{question:'规则'}),e=>e.status===502&&e.message.includes('引用'));
});
test('durable quota denial prevents model invocation',async()=>{
  const f=fixture({quota:false});
  await assert.rejects(f.service.ask('private-session-test',user,{question:'问题'}),e=>e.status===429);
  assert.equal(f.calls.filter(c=>c.url.includes('openai.com')).length,0);
});
test('video frames are separately indexed at their own timestamps and marked as excluding audio',async()=>{
  const f=fixture();const frames=[{at:0,data:'data:image/jpeg;base64,/9j/'},{at:12.5,data:'data:image/jpeg;base64,/9j/'}];
  const doc=await f.service.upload('private-session-test',user,form('演示.mp4','video fixture','video/mp4',{frames:JSON.stringify(frames)}));
  assert.equal(doc.status,'ready');assert.equal(doc.analysis_kind,'video_frames');
  assert.deepEqual(f.chunks.map(c=>c.at_seconds),[0,12.5]);assert.ok(f.chunks.every(c=>c.content.includes('不含音频')));
});
test('actual PDF and DOCX extractors produce retrievable text and PDF page references',async()=>{
  for(const [name,phrase]of [['procedure.pdf','review contract'],['procedure.docx','inspect goods']]) {
    const f=fixture();const file=await readFile(new URL('./fixtures/'+name,import.meta.url));
    const item=await f.service.upload('private-session-test',user,form(name,file));
    assert.equal(item.status,'ready',item.error);
    assert.ok(f.chunks.some(c=>c.content.includes(phrase)));
    if(name.endsWith('.pdf'))assert.equal(f.chunks[0].page,1);
  }
});
test('files persist as awaiting index when model configuration is missing',async()=>{
  const f=fixture();const service=createKnowledgeService({config:{...config,key:''},fetchImpl:f.fetchImpl});
  const item=await service.upload('private-session-test',user,form('saved.txt','Persistent private source'));
  assert.equal(item.status,'needs_index');assert.equal(f.docs.length,1);
  assert.equal(f.calls.filter(c=>c.url.includes('openai.com')).length,0);
});
test('reindexing cached analysis does not duplicate user-provided notes',async()=>{
  const f=fixture();const item=await f.service.upload('private-session-test',user,form('notes.txt','Original source','text/plain',{notes:'Additional notes'}));
  assert.equal(f.chunks.length,2);
  await f.service.reindex('private-session-test',user,item.id);
  assert.equal(f.chunks.length,2);
});
test('media links require document ownership and have a short expiry',async()=>{
  const f=fixture();const item=await f.service.upload('private-session-test',user,form('资料.txt','内容'));
  const media=await f.service.media('private-session-test',user,item.id);
  assert.equal(new URL(media.url).origin,'https://project.supabase.co');assert.equal(media.expiresIn,300);
  await assert.rejects(f.service.media('private-session-test',{id:other},item.id),e=>e.status===404);
});
test('agent HTTP login keeps session out of JSON and protects private endpoints and cross-site posts',async t=>{
  const f=fixture();const server=createServer({agentService:f.service});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
  const unauth=await fetch(base+'/api/agent/documents');assert.equal(unauth.status,401);
  const login=await fetch(base+'/api/agent/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email:'owner@example.test',password:'test-password'})});
  assert.equal(login.status,200);const body=await login.text();assert.ok(!body.includes('private-session-test'));assert.ok(!body.includes('test-password'));
  const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  assert.equal((await fetch(base+'/api/agent/documents',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
  const attack=await fetch(base+'/api/agent/chat',{method:'POST',headers:{Cookie:cookie.split(';')[0],Origin:'https://unrelated.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(attack.status,403);
  for(const asset of ['agent.html','agent.js','agent.css'])assert.equal((await fetch(base+'/'+asset)).status,200);
});
