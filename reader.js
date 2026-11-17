const $=id=>document.getElementById(id);
const list=$('list'),statusEl=$('status'),infoEl=$('info'),noticeEl=$('notice'),autoEl=$('auto'),langEl=$('lang'),transState=$('transState'),retryBtn=$('retryBtn');
let cues=[],active=-1,translations={},offset=0,lastP=null,srtKey='',transGen=0,autoTried='',aiCfg={base:'',model:'',key:''};
function render(){
 list.innerHTML='';
 cues.forEach((c,i)=>{const d=document.createElement('article');d.className='item'+(i===active?' active':'');d.id='cue-'+i;
 const btn=document.createElement('button');btn.className='anchor';btn.textContent='对齐到此句';btn.title='正在听到这句时点击，自动计算偏移';
 btn.addEventListener('click',e=>{e.stopPropagation();anchorTo(i);});
 const tm=document.createElement('div');tm.className='time';tm.textContent=`#${i+1}  ${fmt(c.start)} – ${fmt(c.end)}`;
 const en=document.createElement('div');en.className='en';en.textContent=c.en;
 const zh=document.createElement('div');zh.className='zh'+(translations[i]?'':' pending');zh.textContent=translations[i]||'（待翻译）';
 d.append(btn,tm,en,zh);d.addEventListener('click',()=>{d.scrollIntoView({behavior:'smooth',block:'center'});});list.append(d);});
}
function fmt(t){const sign=t<0?'-':'';t=Math.abs(t);const m=Math.floor(t/60),s=(t%60).toFixed(1).padStart(4,'0');return sign+String(m).padStart(2,'0')+':'+s;}
function setActive(t){
 if(!cues.length)return -1;
 let lo=0,hi=cues.length-1,found=-1;
 while(lo<=hi){const mid=(lo+hi)>>1,c=cues[mid];if(t<c.start)hi=mid-1;else if(t>c.end)lo=mid+1;else{found=mid;break;}}
 if(found<0)return -1;
 if(found!==active){active=found;document.querySelectorAll('.item.active').forEach(x=>x.classList.remove('active'));const el=$('cue-'+active);if(el){el.classList.add('active');if($('follow').checked)el.scrollIntoView({behavior:'smooth',block:'center'});}}
 return found;
}
function update(){
 if(!lastP)return;
 const t=lastP.currentTime-offset,found=setActive(t);
 infoEl.textContent=`Apple ${fmt(lastP.currentTime)} → 字幕 ${fmt(t)} · ${found>=0?'#'+(found+1):'—'} / ${cues.length}`;
}

// ---- 手动同步校准 ----
function setOffset(v,save=true){
 if(!Number.isFinite(v))return;
 offset=Math.round(v*10)/10;
 $('offRange').value=Math.max(-180,Math.min(180,offset));
 $('offNum').value=offset;
 if(save)chrome.storage.local.set({['offset:'+srtKey]:offset});
 update();
}
function anchorTo(i){
 if(!lastP){noticeEl.textContent='还没有收到 Apple 播放进度，无法对齐。请先在 Apple Podcasts 标签页播放节目。';return;}
 setOffset(lastP.currentTime-cues[i].start);
 noticeEl.textContent=`已对齐到第 ${i+1} 句，偏移 = ${offset} 秒。`;
}
$('offRange').addEventListener('input',e=>setOffset(+e.target.value));
$('offNum').addEventListener('change',e=>setOffset(+e.target.value));
$('offReset').addEventListener('click',()=>setOffset(0));
$('follow').addEventListener('change',e=>{
 if(e.target.checked&&active>=0)$('cue-'+active)?.scrollIntoView({behavior:'smooth',block:'center'});
});
document.querySelectorAll('.sync button[data-d]').forEach(b=>b.addEventListener('click',()=>setOffset(offset+(+b.dataset.d))));

// ---- AI 翻译 ----
const LANGS={'zh-CN':'Simplified Chinese (简体中文)','ja':'Japanese (日本語)'};
function transKey(){return `trans:${langEl.value}:${srtKey}`;}
function setZh(i){const el=document.querySelector(`#cue-${i} .zh`);if(el){el.textContent=translations[i];el.classList.remove('pending');}}
function fatal(msg){const e=new Error(msg);e.fatal=true;return e;}
async function aiTranslate(texts,context){
 const lang=LANGS[langEl.value];
 const system=`You are a professional podcast translator. Translate every item of "segments" into natural, fluent, idiomatic spoken ${lang}.
The segments are consecutive parts of one conversation. "context" holds the preceding segments (source and existing translation) for reference only; do not translate it.
Rules: keep the meaning faithful; make the flow coherent across segments; keep names and terms consistent; fix obvious speech-recognition errors only when context makes the intended word clear; never merge, split, drop or add segments.
Reply with JSON only: {"translations": [...]} containing exactly ${texts.length} strings in the same order.`;
 let r;
 try{
  r=await fetch(aiCfg.base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',
   headers:{'content-type':'application/json',authorization:'Bearer '+aiCfg.key},
   body:JSON.stringify({model:aiCfg.model,temperature:0.3,response_format:{type:'json_object'},
    messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({context,segments:texts})}]})});
 }catch(err){throw fatal('无法连接 AI 接口：'+err.message);}
 if(!r.ok)throw fatal(`AI 接口 HTTP ${r.status}：${(await r.text()).slice(0,200)}`);
 const j=await r.json();
 let out=null;
 try{out=JSON.parse((j.choices?.[0]?.message?.content||'').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,'')).translations;}catch{}
 if(!Array.isArray(out)||out.length!==texts.length)throw new Error('AI 返回的段数与原文不一致');
 return out.map(x=>String(x).trim());
}
async function translateBatch(idx){
 const first=idx[0],from=Math.max(0,first-3);
 const context=cues.slice(from,first).map((c,k)=>({source:c.en,translation:translations[from+k]||''}));
 try{return await aiTranslate(idx.map(i=>cues[i].en),context);}
 catch(err){
  if(err.fatal)throw err;
  try{return await aiTranslate(idx.map(i=>cues[i].en),context);}
  catch(err2){
   // 格式仍不对就拆半，避免译文错位
   if(err2.fatal||idx.length===1)throw err2;
   const h=idx.length>>1;
   return [...await translateBatch(idx.slice(0,h)),...await translateBatch(idx.slice(h))];
  }
 }
}
async function translateAll(){
 const gen=++transGen,key=transKey();
 retryBtn.hidden=true;
 // 从当前播放位置往后优先翻译，再回头补前面的
 const startAt=Math.max(active,0);
 const todo=cues.map((_,i)=>i).filter(i=>!translations[i]).sort((a,b)=>(a<startAt)-(b<startAt)||a-b);
 if(!todo.length){transState.textContent='';return;}
 const src=detectSrcLang(),tgt=langEl.value.split('-')[0];
 if(src===tgt){transState.textContent='原文已是所选语言，无需翻译';return;}
 let engine;
 try{engine=await makeEngine(src,tgt);}
 catch(err){
  if(gen!==transGen)return;
  if(err.name==='NotAllowedError'){transState.textContent='首次使用需要下载免费的本地翻译模型';retryBtn.textContent='下载并开始翻译';}
  else{transState.textContent='翻译不可用：'+err.message;retryBtn.textContent='重试翻译';}
  retryBtn.hidden=false;console.error(err);return;
 }
 let done=cues.length-todo.length;
 const show=()=>{transState.textContent=`翻译中（${engine.name}）${done}/${cues.length}`;};show();
 try{
  for(let k=0;k<todo.length;){
   const batch=[];let len=0;
   while(k<todo.length&&batch.length<engine.batch&&(!batch.length||len+cues[todo[k]].en.length<4000)){batch.push(todo[k]);len+=cues[todo[k]].en.length;k++;}
   const outs=await engine.run(batch);
   if(gen!==transGen)return;
   batch.forEach((i,n)=>{translations[i]=outs[n];setZh(i);});
   done+=batch.length;show();
   chrome.storage.local.set({[key]:translations});
  }
  transState.textContent='';
 }catch(err){
  if(gen===transGen){transState.textContent='翻译失败：'+err.message;retryBtn.textContent='重试翻译';retryBtn.hidden=false;}
  console.error(err);
 }finally{engine.destroy?.();}
}
function detectSrcLang(){
 const s=cues.slice(0,30).map(c=>c.en).join('');
 if(/[\u3040-\u30ff]/.test(s))return 'ja';
 return (s.match(/[\u4e00-\u9fff]/g)||[]).length>s.length*0.2?'zh':'en';
}
function dlMonitor(m){m.addEventListener('downloadprogress',e=>{transState.textContent=`正在下载本地翻译模型 ${Math.round(e.loaded*100)}%`;});}
// 优先级：自定义 AI 接口 > Chrome 内置 AI（Gemini Nano）> Chrome 内置翻译
async function makeEngine(src,tgt){
 if(aiCfg.base&&aiCfg.model&&aiCfg.key)return {name:'自定义 AI',batch:20,run:translateBatch};
 const io={expectedInputs:[{type:'text',languages:[src]}],expectedOutputs:[{type:'text',languages:[tgt]}]};
 if(self.LanguageModel&&await LanguageModel.availability(io)!=='unavailable'){
  let base=null;
  try{base=await LanguageModel.create({...io,monitor:dlMonitor,initialPrompts:[{role:'system',content:
   `You translate podcast transcript paragraphs into natural, fluent, idiomatic spoken ${LANGS[langEl.value]}. Keep the meaning faithful and keep names and terms consistent with the previous lines. Output only the translation, nothing else.`}]});}
  catch(err){if(err.name==='NotAllowedError')throw err;console.warn('内置 AI 不可用，改用内置翻译',err);}
  if(base)return {name:'Chrome 内置 AI',batch:1,destroy:()=>base.destroy(),run:async([i])=>{
   const prev=[i-2,i-1].filter(j=>j>=0&&translations[j]).map(j=>`${cues[j].en}\n=> ${translations[j]}`).join('\n\n');
   const s=await base.clone();
   try{return [(await s.prompt((prev?`Previous lines, for context only:\n${prev}\n\n`:'')+`Translate:\n${cues[i].en}`)).trim()];}
   finally{s.destroy();}
  }};
 }
 if(self.Translator&&await Translator.availability({sourceLanguage:src,targetLanguage:tgt})!=='unavailable'){
  const t=await Translator.create({sourceLanguage:src,targetLanguage:tgt,monitor:dlMonitor});
  return {name:'Chrome 内置翻译',batch:1,destroy:()=>t.destroy(),run:async([i])=>[await t.translate(cues[i].en)]};
 }
 throw new Error('当前浏览器没有可用的免费内置翻译（需 Chrome 138 及以上），可在「自定义 AI 接口」中配置');
}
retryBtn.addEventListener('click',()=>translateAll());
langEl.addEventListener('change',async()=>{
 chrome.storage.local.set({targetLang:langEl.value});
 translations=(await chrome.storage.local.get(transKey()))[transKey()]||{};
 render();update();translateAll();
});
$('aiSave').addEventListener('click',()=>{
 const cfg={base:$('aiBase').value.trim(),model:$('aiModel').value.trim(),key:$('aiKey').value.trim()};
 const apply=()=>{aiCfg=cfg;chrome.storage.local.set({aiConfig:cfg});$('aiBox').open=false;if(cues.length)translateAll();else transState.textContent='设置已保存';};
 if(!cfg.base&&!cfg.model&&!cfg.key){apply();return;}
 let origin;
 try{const u=new URL(cfg.base);if(u.protocol!=='https:')throw 0;origin=u.origin+'/*';}
 catch{transState.textContent='API 地址需为 https:// 开头的有效网址';return;}
 chrome.permissions.request({origins:[origin]},ok=>{
  if(!ok){transState.textContent='未授予访问该 API 地址的权限';return;}
  apply();
 });
});

// 偏移和翻译缓存都按单集分别保存
async function loadCues(key,newCues,msg){
 srtKey=key;cues=newCues;active=-1;
 const r=await chrome.storage.local.get([transKey(),'offset:'+key]);
 translations=r[transKey()]||{};
 setOffset(r['offset:'+key]??0,false);
 render();update();noticeEl.textContent=msg;translateAll();
}

// ---- 自动获取当前单集转录（pod-text.com） ----
function epKey(p){return p.title?p.title+'|'+(p.show||''):'';}
async function findEpisodeUrl(p){
 if(p.episodeLink)return p.episodeLink;
 const country=(p.page||'').match(/podcasts\.apple\.com\/([a-z]{2})\//)?.[1]||'us';
 const r=await fetch('https://itunes.apple.com/search?'+new URLSearchParams({term:p.title,media:'podcast',entity:'podcastEpisode',limit:'25',country}));
 if(!r.ok)throw new Error('iTunes 搜索失败 HTTP '+r.status);
 const {results=[]}=await r.json();
 const file=s=>(s||'').split('?')[0].split('/').pop();
 const hit=results.find(x=>x.trackName===p.title&&(!p.show||x.collectionName===p.show))
  ||results.find(x=>p.src&&file(x.episodeUrl)===file(p.src))
  ||results.find(x=>x.trackName===p.title);
 if(hit)return hit.trackViewUrl.replace(/&uo=\d+/,'');
 throw new Error('在 Apple 目录中找不到当前单集');
}
function showLoading(title,step,error=false){
 list.innerHTML='';
 const box=document.createElement('div');box.className='loading'+(error?' error':'');
 const h=document.createElement('div');h.className='loading-title';h.textContent=error?'获取转录失败':`正在获取《${title}》的转录文本`;
 const s=document.createElement('div');s.className='loading-step';s.textContent=step;
 box.append(Object.assign(document.createElement('div'),{className:'spinner'}),h,s);list.append(box);
}
async function loadTranscript(p){
 const ep=epKey(p);autoTried=ep;
 // 先清掉上一集的内容，避免新单集获取失败时仍显示旧转录
 transGen++;srtKey='';cues=[];active=-1;translations={};transState.textContent='';retryBtn.hidden=true;
 noticeEl.textContent='';
 showLoading(p.title,'正在 Apple 目录中查找当前单集……');
 try{
  const url=await findEpisodeUrl(p);
  const id=url.match(/[?&]i=(\d+)/)?.[1]||url;
  let saved=(await chrome.storage.local.get('pt:'+id))['pt:'+id];
  if(!saved){
   if(autoTried===ep)showLoading(p.title,'正在从 pod-text.com 下载转录文本……');
   const r=await fetch('https://pod-text.com/api/transcript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
   if(!r.ok)throw new Error('pod-text.com HTTP '+r.status);
   const j=await r.json();
   if(!j.success||!j.data?.segments?.length)throw new Error(j.error||j.message||'该单集没有 Apple 转录文本');
   saved={title:j.data.title,cues:j.data.segments.map(s=>({start:s.startSeconds,end:s.endSeconds,en:String(s.text||'').trim()})).filter(c=>c.en)};
   chrome.storage.local.set({['pt:'+id]:saved});
  }
  if(autoTried!==ep)return;
  await loadCues('ep:'+id,saved.cues,'');
 }catch(err){
  if(autoTried===ep)showLoading(p.title,err.message+'。可点上方「立即获取」重试。',true);
  console.error(err);
 }
}
$('fetchBtn').addEventListener('click',()=>{if(lastP?.title)loadTranscript(lastP);else noticeEl.textContent='还没有识别到正在播放的单集，请先在 Apple Podcasts 标签页播放。';});
autoEl.addEventListener('change',()=>{chrome.storage.local.set({autoTranscript:autoEl.checked});if(autoEl.checked&&lastP)onProgress(lastP);});

function onProgress(p){
 lastP=p;update();
 statusEl.textContent=`${p.title?'《'+p.title+'》 · ':''}Apple 播放进度：${fmt(p.currentTime)} / ${fmt(p.duration)} · ${p.paused?'已暂停':'正在播放'}`;
 if(autoEl.checked&&p.title&&epKey(p)!==autoTried)loadTranscript(p);
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.applePodcastSync?.newValue)onProgress(changes.applePodcastSync.newValue);});
// 重新注入页面脚本：插件重新加载后，已打开的 Apple 标签页不刷新也能继续同步
chrome.tabs.query({url:'https://podcasts.apple.com/*'},tabs=>{for(const t of tabs)chrome.scripting.executeScript({target:{tabId:t.id},files:['content.js']}).catch(()=>{});});
chrome.storage.local.get(['applePodcastSync','autoTranscript','offset:','targetLang','aiConfig'],r=>{
 autoEl.checked=r.autoTranscript??true;
 if(r.targetLang&&LANGS[r.targetLang])langEl.value=r.targetLang;
 if(r.aiConfig){aiCfg=r.aiConfig;$('aiBase').value=aiCfg.base;$('aiModel').value=aiCfg.model;$('aiKey').value=aiCfg.key;}
 setOffset(r['offset:']??0,false);
 if(r.applePodcastSync)onProgress(r.applePodcastSync);
});
