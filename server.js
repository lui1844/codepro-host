'use strict';
require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { JsonStore, ensureDir } = require('./lib/store');
const { id, now, clean, bool, safeUrl, maskSecret } = require('./lib/utils');
const { haxRequest } = require('./lib/haxApi');
const { exchangeCode, getUser, getGuildMember, ensureWebhook } = require('./lib/discord');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = String(process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const SITE_DATA_DIR = path.resolve(process.env.SITE_DATA_DIR || path.join(ROOT, 'data'));
const SHARED_DATA_DIR = process.env.CODEPRO_SHARED_DATA_DIR ? path.resolve(process.env.CODEPRO_SHARED_DATA_DIR) : SITE_DATA_DIR;
const siteStore = new JsonStore(SITE_DATA_DIR);
const sharedStore = new JsonStore(SHARED_DATA_DIR);
ensureDir(path.join(ROOT, 'uploads'));

const FILES = {
  settings:'site_settings.json', products:'site_products.json', categories:'site_categories.json',
  clients:'site_clients.json', admins:'site_admins.json', audit:'site_audit.jsonl',
  rooms:'hax_panel_rooms.json',
};

const DEFAULT_SETTINGS = {
  siteName:'CodePro Host',
  heroTitle:'Hospedagem, bots e painéis para sua comunidade',
  heroSubtitle:'Gerencie seus serviços e salas HaxBall em um painel moderno, rápido e integrado ao Discord.',
  discordInvite:'', supportText:'Fale com nossa equipe pelo Discord.', currency:'BRL',
  maintenance:false, accent:'#5865F2', logoUrl:'', footerText:'CodePro Host',
};

function readSettings(){ return { ...DEFAULT_SETTINGS, ...siteStore.read(FILES.settings, {}) }; }
function writeSettings(v){ return siteStore.write(FILES.settings, { ...readSettings(), ...v }); }
function readProducts(){ const v=siteStore.read(FILES.products,[]); return Array.isArray(v)?v:[]; }
function readCategories(){ const v=siteStore.read(FILES.categories,[]); return Array.isArray(v)?v:[]; }
function readClients(){ const v=siteStore.read(FILES.clients,{}); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }
function readAdmins(){ const v=siteStore.read(FILES.admins,[]); return Array.isArray(v)?v.map(String):[]; }
function readRooms(){ const v=sharedStore.read(FILES.rooms,[]); return Array.isArray(v)?v:[]; }
function writeRooms(v){ return sharedStore.write(FILES.rooms,v); }
function ownerIds(){ return String(process.env.ADMIN_DISCORD_IDS||'').split(',').map(x=>x.trim()).filter(Boolean); }
function isAdminId(uid){ return !!uid && (ownerIds().includes(String(uid)) || readAdmins().includes(String(uid))); }
function roomPublic(r){ return { id:r.id, name:r.name, login:r.login||r.name, url:r.url, enabled:r.enabled!==false, createdAt:r.createdAt||null, apiKeyMasked:maskSecret(r.apiKey) }; }
function audit(req, action, details={}){
  try { siteStore.append(FILES.audit,{ at:now(), action, userId:req.session?.user?.id||null, user:req.session?.user?.username||null, ip:req.ip, details }); } catch {}
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy:{ directives:{ defaultSrc:["'self'"], imgSrc:["'self'",'data:','https://cdn.discordapp.com','https://media.discordapp.net','https:'], styleSrc:["'self'","'unsafe-inline'"], scriptSrc:["'self'"], connectSrc:["'self'"] } } }));
app.use(express.json({ limit:'1mb' }));
app.use(express.urlencoded({ extended:false }));
app.use(cookieSession({
  name:'codepro_session',
  keys:[process.env.SESSION_SECRET || 'CHANGE_ME_CODEPRO_SESSION_SECRET'],
  maxAge: 7*24*60*60*1000,
  sameSite:'lax',
  httpOnly:true,
  secure:BASE_URL.startsWith('https://'),
}));
app.use('/auth', rateLimit({ windowMs:60_000, limit:30, standardHeaders:true, legacyHeaders:false }));
app.use('/api', rateLimit({ windowMs:60_000, limit:180, standardHeaders:true, legacyHeaders:false }));
app.use(express.static(path.join(ROOT,'public'), { extensions:['html'] }));

function requireLogin(req,res,next){ if(!req.session?.user) return res.status(401).json({ok:false,error:'login_required'}); next(); }
function requireAdmin(req,res,next){ if(!req.session?.user || !isAdminId(req.session.user.id)) return res.status(403).json({ok:false,error:'admin_required'}); next(); }
function csrfToken(req){ if(!req.session.csrf) req.session.csrf=crypto.randomBytes(24).toString('hex'); return req.session.csrf; }
function requireCsrf(req,res,next){ if(['GET','HEAD','OPTIONS'].includes(req.method)) return next(); if(req.get('x-csrf-token')!==req.session?.csrf) return res.status(403).json({ok:false,error:'csrf'}); next(); }
app.use('/api', (req,res,next)=>{ if(req.path==='/me' || req.path.startsWith('/public/')) return next(); return requireCsrf(req,res,next); });

function clientRecord(uid){ return readClients()[String(uid)] || null; }
function accessibleRoomIds(uid){
  if(isAdminId(uid)) return readRooms().filter(r=>r.enabled!==false).map(r=>r.id);
  const rec=clientRecord(uid); if(!rec || rec.active===false) return [];
  return Array.isArray(rec.roomIds)?rec.roomIds.map(String):[];
}
function getRoomForUser(req, roomId){
  const room=readRooms().find(r=>String(r.id)===String(roomId) && r.enabled!==false);
  if(!room) return null;
  return accessibleRoomIds(req.session.user.id).includes(String(room.id)) ? room : null;
}

async function refreshClientRole(userId){
  const roleId=process.env.CLIENT_ROLE_ID, guildId=process.env.DISCORD_GUILD_ID, botToken=process.env.DISCORD_BOT_TOKEN;
  if(!roleId || !guildId || !botToken) return false;
  try { const member=await getGuildMember({botToken,guildId,userId}); return !!member?.roles?.includes(roleId); } catch { return false; }
}

app.get('/auth/discord',(req,res)=>{
  if(!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(500).send('Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no .env');
  const state=crypto.randomBytes(20).toString('hex'); req.session.oauthState=state;
  const q=new URLSearchParams({ client_id:process.env.DISCORD_CLIENT_ID, redirect_uri:REDIRECT_URI, response_type:'code', scope:'identify', state, prompt:'none' });
  res.redirect(`https://discord.com/oauth2/authorize?${q}`);
});
app.get('/auth/discord/callback', async(req,res)=>{
  try {
    if(!req.query.code || !req.query.state || req.query.state!==req.session?.oauthState) throw new Error('oauth_state_invalid');
    const tok=await exchangeCode({clientId:process.env.DISCORD_CLIENT_ID,clientSecret:process.env.DISCORD_CLIENT_SECRET,code:String(req.query.code),redirectUri:REDIRECT_URI});
    const u=await getUser(tok.access_token);
    req.session.user={ id:String(u.id), username:u.global_name||u.username, tag:u.discriminator&&u.discriminator!=='0'?`${u.username}#${u.discriminator}`:u.username, avatar:u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`:'' };
    req.session.oauthState=null; csrfToken(req); audit(req,'login',{discordId:u.id}); res.redirect('/dashboard.html');
  } catch(e){ console.error('[OAUTH]',e); res.redirect('/index.html?login=erro'); }
});
app.post('/auth/logout',requireLogin,requireCsrf,(req,res)=>{ audit(req,'logout'); req.session=null; res.json({ok:true}); });

app.get('/api/me', async(req,res)=>{
  if(!req.session?.user) return res.json({ok:true,loggedIn:false,csrf:null});
  const uid=req.session.user.id, rec=clientRecord(uid), roleClient=await refreshClientRole(uid);
  res.json({ok:true,loggedIn:true,user:req.session.user,isAdmin:isAdminId(uid),isClient:isAdminId(uid)||!!rec||roleClient,roomCount:accessibleRoomIds(uid).length,csrf:csrfToken(req)});
});
app.get('/api/public/catalog',(req,res)=>{
  const settings=readSettings();
  const categories=readCategories().filter(c=>c.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  const products=readProducts().filter(p=>p.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
  res.json({ok:true,settings,categories,products});
});

app.get('/api/panels',requireLogin,async(req,res)=>{
  const ids=accessibleRoomIds(req.session.user.id), rooms=readRooms().filter(r=>ids.includes(String(r.id))&&r.enabled!==false);
  const rows=await Promise.all(rooms.map(async r=>{ try{const h=await fetch(`${String(r.url).replace(/\/$/,'')}/health`,{signal:AbortSignal.timeout(2500)}).then(x=>x.json());return {...roomPublic(r),online:!!h?.ok,roomName:h?.room||r.name};}catch{return {...roomPublic(r),online:false,roomName:r.name};} }));
  res.json({ok:true,panels:rows});
});
app.get('/api/panels/:id/state',requireLogin,async(req,res)=>{ const room=getRoomForUser(req,req.params.id); if(!room)return res.status(404).json({ok:false,error:'panel_not_found'}); try{res.json(await haxRequest(room,'/state'));}catch(e){res.status(e.status||502).json({ok:false,error:e.message,payload:e.payload});} });

function proxyGet(endpoint){ return async(req,res)=>{const room=getRoomForUser(req,req.params.id);if(!room)return res.status(404).json({ok:false,error:'panel_not_found'});try{res.json(await haxRequest(room,endpoint(req)));}catch(e){res.status(e.status||502).json({ok:false,error:e.message,payload:e.payload});}}; }
function proxyPost(endpoint, bodyFn=(req)=>req.body){ return async(req,res)=>{const room=getRoomForUser(req,req.params.id);if(!room)return res.status(404).json({ok:false,error:'panel_not_found'});try{const data=await haxRequest(room,endpoint(req),{method:'POST',body:bodyFn(req)});audit(req,'panel_action',{roomId:room.id,endpoint:endpoint(req)});res.json(data);}catch(e){res.status(e.status||502).json({ok:false,error:e.message,payload:e.payload});}}; }

app.get('/api/panels/:id/bans',requireLogin,proxyGet(()=>'/bans'));
app.post('/api/panels/:id/bans',requireLogin,proxyPost(()=>'/bans'));
app.get('/api/panels/:id/roles',requireLogin,proxyGet(()=>'/roles'));
app.post('/api/panels/:id/roles',requireLogin,proxyPost(()=>'/roles'));
app.get('/api/panels/:id/admins',requireLogin,proxyGet(()=>'/admins'));
app.post('/api/panels/:id/admins',requireLogin,proxyPost(()=>'/admins'));
app.get('/api/panels/:id/known-players',requireLogin,proxyGet(req=>`/known-players?limit=${Math.min(50,Number(req.query.limit)||50)}`));
app.get('/api/panels/:id/maps',requireLogin,proxyGet(()=>'/maps'));
app.post('/api/panels/:id/maps',requireLogin,proxyPost(()=>'/maps'));
app.get('/api/panels/:id/uniforms',requireLogin,proxyGet(()=>'/uniforms'));
app.post('/api/panels/:id/uniforms',requireLogin,proxyPost(()=>'/uniforms'));
app.get('/api/panels/:id/stats',requireLogin,proxyGet(req=>`/stats?limit=${Math.min(50,Number(req.query.limit)||20)}`));
app.get('/api/panels/:id/replays',requireLogin,proxyGet(()=>'/replays'));
app.get('/api/panels/:id/replays/download',requireLogin,async(req,res)=>{
  const room=getRoomForUser(req,req.params.id); if(!room)return res.status(404).json({ok:false,error:'panel_not_found'});
  const name=path.basename(clean(req.query.name,180)); if(!name.toLowerCase().endsWith('.hbr2'))return res.status(400).json({ok:false,error:'invalid_replay_name'});
  try{
    const base=String(room.url||'').replace(/\/$/,'');
    const r=await fetch(`${base}/replay-file?name=${encodeURIComponent(name)}`,{headers:{'x-api-key':room.apiKey||''},signal:AbortSignal.timeout(12000)});
    if(!r.ok){const t=await r.text();let d={};try{d=JSON.parse(t)}catch{};return res.status(r.status).json({ok:false,error:d.error||'replay_download_failed'});}
    res.setHeader('content-type','application/octet-stream');res.setHeader('content-disposition',`attachment; filename="${name.replace(/"/g,'')}"`);res.setHeader('cache-control','private, no-store');
    if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
  }catch(e){res.status(502).json({ok:false,error:e.message});}
});
app.post('/api/panels/:id/passwords',requireLogin,proxyPost(()=>'/passwords'));
app.post('/api/panels/:id/room-name',requireLogin,proxyPost(()=>'/room-name'));
app.post('/api/panels/:id/restart',requireLogin,proxyPost(()=>'/host/restart',req=>({by:`Site • ${req.session.user.username}`,reason:clean(req.body.reason||'Reinício pelo painel web',180)})));
app.post('/api/panels/:id/chat',requireLogin,proxyPost(()=>'/chat'));
app.post('/api/panels/:id/room-password',requireLogin,proxyPost(()=>'/room-password',req=>({...req.body,by:`Site • ${req.session.user.username}`})));
app.post('/api/panels/:id/settings',requireLogin,proxyPost(()=>'/settings'));
app.post('/api/panels/:id/announce',requireLogin,proxyPost(()=>'/announce'));
app.post('/api/panels/:id/webhooks',requireLogin,proxyPost(()=>'/webhooks'));

const mapUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:700_000}});
app.post('/api/panels/:id/maps/upload',requireLogin,mapUpload.single('map'),async(req,res)=>{
  const room=getRoomForUser(req,req.params.id); if(!room)return res.status(404).json({ok:false,error:'panel_not_found'});
  if(!req.file)return res.status(400).json({ok:false,error:'map_file_required'});
  const content=req.file.buffer.toString('utf8');
  try{const data=await haxRequest(room,'/maps',{method:'POST',body:{action:'add',command:clean(req.body.command,30),name:clean(req.body.name||req.file.originalname.replace(/\.hbs$/i,''),60),content}});audit(req,'map_upload',{roomId:room.id,command:req.body.command});res.json(data);}catch(e){res.status(e.status||502).json({ok:false,error:e.message,payload:e.payload});}
});

app.post('/api/panels/:id/webhooks/channel',requireLogin,async(req,res)=>{
  const room=getRoomForUser(req,req.params.id); if(!room)return res.status(404).json({ok:false,error:'panel_not_found'});
  const kind=clean(req.body.kind,20), channelId=clean(req.body.channelId,30);
  if(!['replay','chat','password','login','playerinfo'].includes(kind))return res.status(400).json({ok:false,error:'invalid_webhook_kind'});
  if(!/^\d{15,25}$/.test(channelId))return res.status(400).json({ok:false,error:'invalid_channel_id'});
  try{
    const url=await ensureWebhook({botToken:process.env.DISCORD_BOT_TOKEN,channelId,name:`CodePro • ${room.name} • ${kind}`});
    const data=await haxRequest(room,'/webhooks',{method:'POST',body:{[kind]:url}}); audit(req,'webhook_channel',{roomId:room.id,kind,channelId}); res.json(data);
  }catch(e){res.status(502).json({ok:false,error:e.message});}
});

// ---------------- ADMIN ----------------
app.get('/api/admin/overview',requireLogin,requireAdmin,(req,res)=>{
  const clients=readClients(), products=readProducts(), cats=readCategories(), rooms=readRooms();
  res.json({ok:true,counts:{clients:Object.keys(clients).length,products:products.length,categories:cats.length,panels:rooms.length,admins:readAdmins().length+ownerIds().length},settings:readSettings()});
});
app.get('/api/admin/categories',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,categories:readCategories()}));
app.post('/api/admin/categories',requireLogin,requireAdmin,(req,res)=>{const db=readCategories();const row={id:id('cat'),name:clean(req.body.name,60),slug:clean(req.body.slug||req.body.name,60).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),description:clean(req.body.description,300),active:req.body.active!==false,order:Number(req.body.order)||0,createdAt:now()};if(!row.name)return res.status(400).json({ok:false,error:'name_required'});db.push(row);siteStore.write(FILES.categories,db);audit(req,'category_create',{id:row.id});res.json({ok:true,category:row});});
app.put('/api/admin/categories/:id',requireLogin,requireAdmin,(req,res)=>{const db=readCategories(),i=db.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:'not_found'});db[i]={...db[i],name:clean(req.body.name??db[i].name,60),description:clean(req.body.description??db[i].description,300),active:req.body.active===undefined?db[i].active:!!req.body.active,order:req.body.order===undefined?db[i].order:Number(req.body.order)||0,updatedAt:now()};siteStore.write(FILES.categories,db);res.json({ok:true,category:db[i]});});
app.delete('/api/admin/categories/:id',requireLogin,requireAdmin,(req,res)=>{const db=readCategories(),before=db.length;siteStore.write(FILES.categories,db.filter(x=>x.id!==req.params.id));const products=readProducts().map(p=>p.categoryId===req.params.id?{...p,categoryId:null}:p);siteStore.write(FILES.products,products);res.json({ok:true,removed:before-db.length});});

app.get('/api/admin/products',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,products:readProducts()}));
app.post('/api/admin/products',requireLogin,requireAdmin,(req,res)=>{const db=readProducts();const row={id:id('prd'),name:clean(req.body.name,80),categoryId:clean(req.body.categoryId,60)||null,price:Number(req.body.price)||0,billing:clean(req.body.billing||'único',30),description:clean(req.body.description,500),features:Array.isArray(req.body.features)?req.body.features.map(x=>clean(x,100)).filter(Boolean).slice(0,12):String(req.body.features||'').split('\n').map(x=>clean(x,100)).filter(Boolean).slice(0,12),badge:clean(req.body.badge,30),active:req.body.active!==false,order:Number(req.body.order)||0,buttonText:clean(req.body.buttonText||'Contratar',30),buttonUrl:clean(req.body.buttonUrl||readSettings().discordInvite,500),createdAt:now()};if(!row.name)return res.status(400).json({ok:false,error:'name_required'});db.push(row);siteStore.write(FILES.products,db);audit(req,'product_create',{id:row.id});res.json({ok:true,product:row});});
app.put('/api/admin/products/:id',requireLogin,requireAdmin,(req,res)=>{const db=readProducts(),i=db.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:'not_found'});const p=db[i];db[i]={...p,name:clean(req.body.name??p.name,80),categoryId:req.body.categoryId===undefined?p.categoryId:(clean(req.body.categoryId,60)||null),price:req.body.price===undefined?p.price:Number(req.body.price)||0,billing:clean(req.body.billing??p.billing,30),description:clean(req.body.description??p.description,500),features:req.body.features===undefined?p.features:(Array.isArray(req.body.features)?req.body.features:String(req.body.features).split('\n')).map(x=>clean(x,100)).filter(Boolean).slice(0,12),badge:clean(req.body.badge??p.badge,30),active:req.body.active===undefined?p.active:!!req.body.active,order:req.body.order===undefined?p.order:Number(req.body.order)||0,buttonText:clean(req.body.buttonText??p.buttonText,30),buttonUrl:clean(req.body.buttonUrl??p.buttonUrl,500),updatedAt:now()};siteStore.write(FILES.products,db);res.json({ok:true,product:db[i]});});
app.delete('/api/admin/products/:id',requireLogin,requireAdmin,(req,res)=>{const db=readProducts(),before=db.length;siteStore.write(FILES.products,db.filter(x=>x.id!==req.params.id));res.json({ok:true,removed:before-db.length});});

app.get('/api/admin/panels',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,panels:readRooms().map(roomPublic)}));
app.post('/api/admin/panels',requireLogin,requireAdmin,(req,res)=>{const db=readRooms();let rid=clean(req.body.id||req.body.name,40).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'')||id('room');if(db.some(x=>x.id===rid))rid=`${rid}-${Date.now().toString().slice(-5)}`;const url=safeUrl(req.body.url);if(!url)return res.status(400).json({ok:false,error:'invalid_url'});const row={id:rid,name:clean(req.body.name,80)||rid,login:clean(req.body.login||req.body.name,80)||rid,url,apiKey:clean(req.body.apiKey,250),enabled:req.body.enabled!==false,createdAt:now()};db.push(row);writeRooms(db);audit(req,'panel_create',{id:row.id});res.json({ok:true,panel:roomPublic(row)});});
app.put('/api/admin/panels/:id',requireLogin,requireAdmin,(req,res)=>{const db=readRooms(),i=db.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:'not_found'});const r=db[i],url=req.body.url===undefined?r.url:safeUrl(req.body.url);if(!url)return res.status(400).json({ok:false,error:'invalid_url'});db[i]={...r,name:clean(req.body.name??r.name,80),login:clean(req.body.login??r.login,80),url,apiKey:req.body.apiKey?clean(req.body.apiKey,250):r.apiKey,enabled:req.body.enabled===undefined?r.enabled:!!req.body.enabled,updatedAt:now()};writeRooms(db);res.json({ok:true,panel:roomPublic(db[i])});});
app.delete('/api/admin/panels/:id',requireLogin,requireAdmin,(req,res)=>{const db=readRooms();writeRooms(db.filter(x=>x.id!==req.params.id));const clients=readClients();for(const rec of Object.values(clients)) if(Array.isArray(rec.roomIds)) rec.roomIds=rec.roomIds.filter(x=>x!==req.params.id);siteStore.write(FILES.clients,clients);res.json({ok:true});});

app.get('/api/admin/clients',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,clients:readClients()}));
app.put('/api/admin/clients/:discordId',requireLogin,requireAdmin,(req,res)=>{const did=clean(req.params.discordId,30);if(!/^\d{15,25}$/.test(did))return res.status(400).json({ok:false,error:'invalid_discord_id'});const db=readClients(),validRoomIds=new Set(readRooms().map(r=>r.id));const roomIds=(Array.isArray(req.body.roomIds)?req.body.roomIds:[]).map(String).filter(x=>validRoomIds.has(x));db[did]={discordId:did,name:clean(req.body.name,80),active:req.body.active!==false,roomIds,notes:clean(req.body.notes,300),updatedAt:now(),createdAt:db[did]?.createdAt||now()};siteStore.write(FILES.clients,db);audit(req,'client_update',{discordId:did,roomIds});res.json({ok:true,client:db[did]});});
app.delete('/api/admin/clients/:discordId',requireLogin,requireAdmin,(req,res)=>{const db=readClients();delete db[req.params.discordId];siteStore.write(FILES.clients,db);res.json({ok:true});});

app.get('/api/admin/admins',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,owners:ownerIds(),admins:readAdmins()}));
app.post('/api/admin/admins',requireLogin,requireAdmin,(req,res)=>{const did=clean(req.body.discordId,30);if(!/^\d{15,25}$/.test(did))return res.status(400).json({ok:false,error:'invalid_discord_id'});const db=readAdmins();if(!db.includes(did))db.push(did);siteStore.write(FILES.admins,db);res.json({ok:true,admins:db});});
app.delete('/api/admin/admins/:id',requireLogin,requireAdmin,(req,res)=>{if(ownerIds().includes(req.params.id))return res.status(409).json({ok:false,error:'owner_cannot_be_removed'});siteStore.write(FILES.admins,readAdmins().filter(x=>x!==req.params.id));res.json({ok:true});});

app.get('/api/admin/settings',requireLogin,requireAdmin,(req,res)=>res.json({ok:true,settings:readSettings()}));
app.put('/api/admin/settings',requireLogin,requireAdmin,(req,res)=>{const allowed=['siteName','heroTitle','heroSubtitle','discordInvite','supportText','currency','maintenance','accent','logoUrl','footerText'];const patch={};for(const k of allowed)if(Object.prototype.hasOwnProperty.call(req.body,k))patch[k]=k==='maintenance'?!!req.body[k]:clean(req.body[k],k==='heroSubtitle'?500:300);writeSettings(patch);audit(req,'settings_update',{keys:Object.keys(patch)});res.json({ok:true,settings:readSettings()});});
app.get('/api/admin/audit',requireLogin,requireAdmin,(req,res)=>{try{const f=siteStore.file(FILES.audit);if(!fs.existsSync(f))return res.json({ok:true,events:[]});const events=fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).slice(-150).reverse().map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);res.json({ok:true,events});}catch(e){res.json({ok:true,events:[]});}});

app.get('/health',(req,res)=>res.json({ok:true,site:readSettings().siteName,uptime:Math.floor(process.uptime())}));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

app.listen(PORT,()=>{
  console.log(`[SITE] ${readSettings().siteName} ouvindo na porta ${PORT}`);
  console.log(`[SITE] Base URL: ${BASE_URL}`);
  console.log(`[SITE] Discord callback: ${REDIRECT_URI}`);
  console.log(`[SITE] Data: ${SITE_DATA_DIR}`);
  if(SHARED_DATA_DIR!==SITE_DATA_DIR) console.log(`[SITE] Dados compartilhados CodePro: ${SHARED_DATA_DIR}`);
});
