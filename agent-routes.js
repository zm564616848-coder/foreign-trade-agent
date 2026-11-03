import { createKnowledgeService,KnowledgeError } from './knowledge.js';

async function bytes(req,max) {
  const parts=[];let size=0;
  for await(const part of req) {size+=part.length;if(size>max)throw new KnowledgeError(413,'请求过大，请缩小文件或问题内容');parts.push(part);}
  return Buffer.concat(parts);
}
async function json(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new KnowledgeError(415,'请求格式需要 JSON');
  try {const data=JSON.parse(await bytes(req,128*1024));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}
  catch(error){if(error instanceof KnowledgeError)throw error;throw new KnowledgeError(400,'请求格式无效');}
}
function cookie(req) {
  try{return decodeURIComponent((req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('kb_session='))?.slice(11)||'');}catch{return '';}
}
const sessionCookie=(value,seconds)=>`kb_session=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/api/agent; Max-Age=${seconds}`;

export function createAgentRouter({ service=createKnowledgeService() }={}) {
  const rates=new Map();
  return async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/agent/'))return false;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
    try {
      if(!['GET','POST','DELETE'].includes(req.method))throw new KnowledgeError(405,'不支持的请求方式');
      if(req.method!=='GET') {
        const origin=req.headers.origin;
        if((origin&&new URL(origin).host!==req.headers.host)||req.headers['sec-fetch-site']==='cross-site')throw new KnowledgeError(403,'不允许跨站提交');
      }
      if(req.method==='GET'&&url.pathname==='/api/agent/config') {send(200,service.status());return true;}
      const ip=req.socket.remoteAddress;const now=Date.now();
      for(const [key,value]of rates)if(now-value.at>60000)rates.delete(key);
      if(!rates.has(ip)&&rates.size>=1000)throw new KnowledgeError(429,'访问过于频繁，请稍后再试');
      const rate=rates.get(ip)||{at:now,count:0};rates.set(ip,rate);
      if(++rate.count>40)throw new KnowledgeError(429,'访问过于频繁，请一分钟后重试');
      if(url.pathname==='/api/agent/login'&&req.method==='POST') {
        const data=await json(req);const result=await service.login(data.email,data.password);
        res.setHeader('Set-Cookie',sessionCookie(result.token,result.expires));send(200,{user:result.user});return true;
      }
      if(url.pathname==='/api/agent/logout'&&req.method==='POST') {res.setHeader('Set-Cookie',sessionCookie('',0));send(200,{ok:true});return true;}
      const token=cookie(req);const user=await service.authenticate(token);
      if(url.pathname==='/api/agent/session'&&req.method==='GET') {send(200,{user});return true;}
      if(url.pathname==='/api/agent/documents'&&req.method==='GET') {send(200,{documents:await service.list(token,user)});return true;}
      if(url.pathname==='/api/agent/documents'&&req.method==='POST') {
        if(!req.headers['content-type']?.startsWith('multipart/form-data;'))throw new KnowledgeError(415,'请使用文件上传表单');
        const data=await bytes(req,24*1024*1024);let form;
        try {form=await new Response(data,{headers:{'Content-Type':req.headers['content-type']}}).formData();}catch{throw new KnowledgeError(400,'上传表单无效');}
        const document=await service.upload(token,user,form);
        send(201,{document});return true;
      }
      if(url.pathname==='/api/agent/chat'&&req.method==='POST') {send(200,await service.ask(token,user,await json(req)));return true;}
      const match=url.pathname.match(/^\/api\/agent\/documents\/([0-9a-f-]+)(?:\/(index|media))?$/i);
      if(match) {
        const [,id,action]=match;
        if(action==='media'&&req.method==='GET') {send(200,await service.media(token,user,id));return true;}
        if(action==='index'&&req.method==='POST') {const data=await json(req);send(200,{document:await service.reindex(token,user,id,data.notes)});return true;}
        if(!action&&req.method==='DELETE') {send(200,await service.remove(token,user,id));return true;}
      }
      send(404,{error:'接口不存在'});
    } catch(error) {send(error instanceof KnowledgeError?error.status:500,{error:error instanceof KnowledgeError?error.message:'知识库操作暂时失败，请稍后重试'});}
    return true;
  };
}
