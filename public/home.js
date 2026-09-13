(async()=>{
  try{
    const [cat,me]=await Promise.all([api('/api/public/catalog'),loadMe()]);
    const s=cat.settings||{};
    document.title=`${s.siteName||'CodePro Host'} | Hospedagem e Painéis`;
    document.querySelector('#brandName').textContent=s.siteName||'CodePro Host';
    document.querySelector('#heroTitle').textContent=s.heroTitle||'CodePro Host';
    document.querySelector('#heroSubtitle').textContent=s.heroSubtitle||'';
    document.querySelector('#supportText').textContent=s.supportText||'';
    document.querySelector('#footerText').textContent=s.footerText||s.siteName||'CodePro Host';
    const db=document.querySelector('#discordBtn');db.href=s.discordInvite||'/auth/discord';if(!s.discordInvite)db.textContent='Entrar com Discord';
    if(me.loggedIn){
      document.querySelector('#navActions').innerHTML=`${userChip(me)}<a class="btn primary" href="/dashboard.html">Meu painel</a>`;
      document.querySelector('#heroLogin').href='/dashboard.html';document.querySelector('#heroLogin').textContent='Abrir meu painel';
    }
    const products=cat.products||[],cats=new Map((cat.categories||[]).map(c=>[c.id,c]));
    const root=document.querySelector('#pricing');
    root.innerHTML=products.length?products.map(p=>`<article class="price-card">${p.badge?`<span class="badge">${esc(p.badge)}</span>`:''}<div class="muted">${esc(cats.get(p.categoryId)?.name||'Produto')}</div><h3>${esc(p.name)}</h3><div class="price">${money(p.price,s.currency||'BRL')}</div><div class="billing">${esc(p.billing||'')}</div><p>${esc(p.description||'')}</p><ul class="features">${(p.features||[]).map(f=>`<li>${esc(f)}</li>`).join('')}</ul><a class="btn primary" href="${esc(p.buttonUrl||s.discordInvite||'#')}" ${/^https?:/i.test(p.buttonUrl||s.discordInvite||'')?'target="_blank" rel="noopener"':''}>${esc(p.buttonText||'Contratar')}</a></article>`).join(''):'<div class="empty" style="grid-column:1/-1">Nenhum produto publicado ainda.</div>';
  }catch(e){console.error(e);document.querySelector('#pricing').innerHTML='<div class="empty">Não foi possível carregar os produtos.</div>'}
})();
