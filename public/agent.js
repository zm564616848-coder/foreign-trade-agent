const $=s=>document.querySelector(s);
let config={},user=null,history=[],busy=false,readyDocuments=0;
const pending=new Set();
function node(tag,className,text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
async function api(path,options={}) {
  const controller=new AbortController();pending.add(controller);
  const timer=setTimeout(()=>controller.abort(),180000);
  try {
    const headers={...options.headers};
    if(options.body&&!(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
    const response=await fetch(`./api/agent/${path}`,{...options,headers,credentials:'same-origin',signal:controller.signal});
    if(response.status===404||response.status===405)throw new Error('当前地址没有连接知识库后端，请使用工作台提供的智能问答入口。');
    let data;try{data=await response.json();}catch{throw new Error('服务响应异常，请稍后重试');}
    if(!response.ok){if(response.status===401&&user)clearSession();throw new Error(data.error||'操作暂时失败');}
    return data;
  } catch(error){if(error.name==='AbortError')throw new Error('操作超时或已取消，请稍后重试');throw error;}
  finally{clearTimeout(timer);pending.delete(controller);}
}
function clearSession() {
  pending.forEach(c=>c.abort());pending.clear();user=null;history=[];busy=false;readyDocuments=0;
  $('#agent-workspace').hidden=true;$('#login-panel').hidden=false;$('#logout').hidden=true;
  $('#account-label').textContent='尚未登录';$('#document-list').replaceChildren();
  $('#chat-messages').replaceChildren();$('#question').value='';$('#media-dialog').close();$('#media-body').replaceChildren();
  $('#upload-form').reset();$('#selected-file').textContent='每份最多 20 MB，图片最多 8 MB';$('#upload-status').textContent='';$('#chat-error').textContent='';
  $('#login-password').value='';
}
async function setSession(value) {
  user=value;$('#login-panel').hidden=true;$('#agent-workspace').hidden=false;$('#logout').hidden=false;
  $('#account-label').textContent=user.email;$('#login-password').value='';
  $('#ask-button').disabled=!config.modelReady;
  try{await loadDocuments();}catch(error){$('#document-list').replaceChildren(node('p','agent-error library-empty',error.message));}
}
const states={pending:'处理中',ready:'可检索',needs_index:'待建立索引',needs_notes:'需要文字说明',failed:'分析未完成'};
async function loadDocuments() {
  const data=await api('documents');$('#document-count').textContent=`${data.documents.length} 份`;
  readyDocuments=data.documents.filter(d=>d.status==='ready').length;$('#ask-button').disabled=!config.modelReady||!readyDocuments||busy;
  const list=$('#document-list');list.replaceChildren();
  if(!data.documents.length){list.append(node('div','library-empty','还没有资料。上传文档、图片或视频，建立你的私人知识库。'));return;}
  data.documents.forEach(doc=>{
    const item=node('article','document-item');item.append(node('h3','',doc.title),node('div','document-meta',`${doc.mime_type.split('/')[0]} · ${(doc.size_bytes/1024/1024).toFixed(1)} MB · ${states[doc.status]||doc.status}`));
    if(doc.analysis_kind==='video_frames')item.append(node('div','document-meta','视频抽帧分析，不含音频'));
    if(doc.analysis_kind==='video_notes')item.append(node('div','document-meta','仅索引视频说明/字幕，未分析画面或音频'));
    if(doc.truncated)item.append(node('p','document-error','资料较长，部分内容尚未索引，请拆分为较小文件后继续上传。'));
    if(doc.error)item.append(node('p','document-error',doc.error));
    const actions=node('div','document-actions');
    const preview=node('button','text-button','预览原资料');preview.onclick=()=>previewMedia(doc.id,0);actions.append(preview);
    if(doc.status!=='ready'){
      const retry=node('button','text-button','补充说明 / 重建索引');
      retry.onclick=async()=>{
        const notes=prompt('补充资料说明或粘贴视频字幕；留空则保留现有说明。');if(notes===null)return;
        retry.disabled=true;
        try{await api(`documents/${doc.id}/index`,{method:'POST',body:notes?{notes}:{}});await loadDocuments();}catch(error){$('#upload-status').textContent=error.message;}finally{retry.disabled=false;}
      };actions.append(retry);
    }
    const remove=node('button','text-button danger','删除');remove.onclick=async()=>{
      if(!confirm(`删除“${doc.title}”及其检索索引？`))return;
      remove.disabled=true;try{await api(`documents/${doc.id}`,{method:'DELETE'});await loadDocuments();}catch(error){$('#upload-status').textContent=error.message;}finally{remove.disabled=false;}
    };actions.append(remove);item.append(actions);list.append(item);
  });
}
async function previewMedia(id,at=0) {
  $('#media-body').replaceChildren(node('p','file-hint','正在读取私有资料…'));$('#media-dialog').showModal();
  try{
    const data=await api(`documents/${id}/media`);const url=new URL(data.url);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))throw new Error('资料链接来源异常');
    $('#media-title').textContent=data.title;const body=$('#media-body');body.replaceChildren();
    if(data.type.startsWith('image/')){const image=node('img','preview-image');image.src=url.href;image.alt=data.title;body.append(image);}
    else if(data.type.startsWith('video/')){const video=node('video','preview-video');video.controls=true;video.preload='auto';video.addEventListener('loadeddata',()=>{if(at>0)video.currentTime=Math.min(at,video.duration||at);},{once:true});video.src=url.href;body.append(video);}
    else {body.append(node('p','file-hint','点击下方链接，在新窗口打开或下载原文。'));}
    const link=node('a','official-link','打开原始资料 ↗');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';body.append(link);
  }catch(error){$('#media-body').replaceChildren(node('p','agent-error',error.message));}
}
function mediaEvent(video,name,action) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('浏览器无法读取这个视频'));},12000);
    const success=()=>{cleanup();resolve();};const failure=()=>{cleanup();reject(new Error('浏览器不支持此视频格式'));};
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener(name,success);video.removeEventListener('error',failure);};
    video.addEventListener(name,success);video.addEventListener('error',failure);action();
  });
}
async function sampleVideo(file) {
  const video=document.createElement('video');video.muted=true;video.preload='auto';const url=URL.createObjectURL(file);
  try{
    await mediaEvent(video,'loadeddata',()=>{video.src=url;video.load();});
    if(!Number.isFinite(video.duration)||!video.videoWidth)throw new Error('无法读取视频时长');
    const times=[...new Set([0,Math.round(video.duration/2*10)/10,Math.max(0,Math.round((video.duration-0.3)*10)/10)])];
    const canvas=document.createElement('canvas');const scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);const ctx=canvas.getContext('2d');const frames=[];
    for(const at of times){if(Math.abs(video.currentTime-at)>0.05)await mediaEvent(video,'seeked',()=>{video.currentTime=at;});ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push({at,data:canvas.toDataURL('image/jpeg',0.65)});}
    return frames;
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
$('#knowledge-file').onchange=()=>{const file=$('#knowledge-file').files[0];$('#selected-file').textContent=file?`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`:'每份最多 20 MB，图片最多 8 MB';if(file&&!$('#document-title').value)$('#document-title').value=file.name;};
$('#upload-form').onsubmit=async event=>{
  event.preventDefault();const file=$('#knowledge-file').files[0];if(!file)return;
  $('#upload-button').disabled=true;$('#upload-status').textContent='正在准备资料…';
  try{
    if(file.size>20*1024*1024)throw new Error('文件超过 20 MB，请压缩或拆分后上传');
    const form=new FormData();form.append('file',file);form.append('title',$('#document-title').value||file.name);form.append('notes',$('#document-notes').value);
    if(file.type.startsWith('video/')){
      $('#upload-status').textContent='正在抽取视频画面…';
      try{form.append('frames',JSON.stringify(await sampleVideo(file)));}
      catch{if(!$('#document-notes').value.trim())throw new Error('视频无法抽帧，请补充文字说明或字幕后重试');}
    }
    $('#upload-status').textContent='正在上传并分析，较长资料可能需要一两分钟…';
    const data=await api('documents',{method:'POST',body:form});
    $('#upload-status').textContent=data.document.status==='ready'?'资料已入库，可开始提问。':(data.document.error||'资料已保存，索引尚未完成。');
    $('#upload-form').reset();$('#selected-file').textContent='每份最多 20 MB，图片最多 8 MB';await loadDocuments();
  }catch(error){$('#upload-status').textContent=error.message;}
  finally{$('#upload-button').disabled=false;}
};
function message(role,text,sources=[]) {
  $('#chat-welcome')?.remove();const item=node('article',`message ${role}`);item.append(node('div','message-role',role==='user'?'你':'知识问答 Agent'),node('div','message-text',text));
  if(sources.length){const list=node('div','source-list');sources.forEach(source=>{
    const box=node('div','source-item');const suffix=source.page?` · 第 ${source.page} 页`:Number.isFinite(source.atSeconds)?` · ${source.atSeconds} 秒画面`:'';
    const button=node('button','text-button',`[${source.reference}] ${source.title}${suffix} ↗`);button.onclick=()=>previewMedia(source.documentId,source.atSeconds||0);box.append(button,node('p','',source.snippet));list.append(box);
  });item.append(list);}
  $('#chat-messages').append(item);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
}
$('#chat-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;const question=$('#question').value.trim();if(!question)return;
  if(!readyDocuments){$('#chat-error').textContent='请先上传资料并等待索引完成。';return;}
  busy=true;$('#ask-button').disabled=true;$('#chat-error').textContent='';message('user',question);$('#question').value='';
  try{const data=await api('chat',{method:'POST',body:{question,history}});if(!user)return;message('assistant',data.answer,data.sources||[]);history.push({role:'user',content:question},{role:'assistant',content:data.answer});history=history.slice(-6);}
  catch(error){if(user){$('#chat-error').textContent=error.message;$('#question').value=question;}}
  finally{busy=false;$('#ask-button').disabled=!config.modelReady||!readyDocuments;}
};
document.querySelectorAll('[data-question]').forEach(button=>button.onclick=()=>{$('#question').value=button.dataset.question;$('#question').focus();});
$('#clear-chat').onclick=()=>{if(busy)return;history=[];$('#chat-messages').replaceChildren(node('p','file-hint','新对话已开始，请输入问题。'));$('#chat-error').textContent='';};
$('#login-form').onsubmit=async event=>{
  event.preventDefault();$('#login-button').disabled=true;$('#login-error').textContent='';
  try{const data=await api('login',{method:'POST',body:{email:$('#login-email').value,password:$('#login-password').value}});await setSession(data.user);}
  catch(error){$('#login-error').textContent=error.message;}
  finally{$('#login-button').disabled=!config.databaseReady;}
};
$('#logout').onclick=async()=>{clearSession();try{await api('logout',{method:'POST',body:{}});}catch{};};
$('#close-media').onclick=()=>{$('#media-dialog').close();$('#media-body').replaceChildren();};
async function start() {
  try{
    config=await api('config');$('#login-button').disabled=!config.databaseReady;
    $('#setup-banner').textContent=!config.databaseReady?'私人知识库尚未连接。管理员完成数据库与文件存储配置后，即可登录和上传资料。':!config.modelReady?'资料库配置已保存，AI 模型尚未开通。登录并验证资料库后可保存文件，连接模型后再建立索引。':'服务配置已保存。登录并上传资料，验证连接后即可进行有来源的问答。';
    if(config.databaseReady){try{const data=await api('session');await setSession(data.user);}catch(error){if(!error.message.includes('登录'))$('#login-error').textContent=error.message;}}
  }catch(error){$('#setup-banner').textContent=error.message;$('#login-button').disabled=true;}
}
start();
