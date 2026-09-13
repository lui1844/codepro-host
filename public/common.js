let ME = null;
async function api(url, options={}){
  const headers={...(options.headers||{})};
  if(ME?.csrf && !['GET','HEAD'].includes((options.method||'GET').toUpperCase())) headers['x-csrf-token']=ME.csrf;
  if(options.json!==undefined){headers['content-type']='application/json';options.body=JSON.stringify(options.json);delete options.json;}
  const r=await fetch(url,{...options,headers});
  const text=await r.text(); let data={};
  try{data=text?JSON.parse(text):{};}catch{data={ok:false,error:text||`HTTP ${r.status}`};}
  if(!r.ok||data.ok===false){const e=new Error(data.error||`HTTP ${r.status}`);e.data=data;e.status=r.status;throw e;}
  return data;
}
async function loadMe(){ME=await api('/api/me');return ME;}
function toast(msg,type='ok'){let box=document.querySelector('.toastbox');if(!box){box=document.createElement('div');box.className='toastbox';document.body.appendChild(box)}const t=document.createElement('div');t.className=`toast ${type==='err'?'err':'ok'}`;t.textContent=msg;box.appendChild(t);setTimeout(()=>t.remove(),3500)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function money(v,c='BRL'){try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency:c}).format(Number(v)||0)}catch{return `R$ ${Number(v||0).toFixed(2)}`}}
function fmtDate(v){if(!v)return '-';try{return new Date(v).toLocaleString('pt-BR')}catch{return String(v)}}
async function logout(){try{await api('/auth/logout',{method:'POST',json:{}})}finally{location.href='/';}}
function userChip(me){const u=me?.user||{};return `<div class="userchip">${u.avatar?`<img class="avatar" src="${esc(u.avatar)}">`:`<div class="avatar"></div>`}<span>${esc(u.username||'Discord')}</span></div>`}
function modal(title,html){const b=document.createElement('div');b.className='modal-backdrop';b.innerHTML=`<div class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="close">×</button></div>${html}</div>`;b.querySelector('.close').onclick=()=>b.remove();b.addEventListener('click',e=>{if(e.target===b)b.remove()});document.body.appendChild(b);return b;}
