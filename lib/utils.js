'use strict';
const crypto = require('node:crypto');

function id(prefix='id') { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }
function now() { return new Date().toISOString(); }
function clean(v, max=300) { return String(v ?? '').trim().slice(0, max); }
function bool(v, fallback=false) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase();
  if (['1','true','on','sim','yes'].includes(s)) return true;
  if (['0','false','off','nao','não','no'].includes(s)) return false;
  return fallback;
}
function safeUrl(v) {
  try {
    const u = new URL(String(v));
    if (!['http:','https:'].includes(u.protocol)) return '';
    return u.origin;
  } catch { return ''; }
}
function money(value, currency='BRL') {
  const n = Number(value) || 0;
  return new Intl.NumberFormat('pt-BR', { style:'currency', currency }).format(n);
}
function maskSecret(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0,4)}••••••••${s.slice(-4)}`;
}
module.exports = { id, now, clean, bool, safeUrl, money, maskSecret };
