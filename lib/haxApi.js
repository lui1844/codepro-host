'use strict';

async function haxRequest(room, endpoint, options = {}) {
  const base = String(room.url || '').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 9000));
  try {
    const headers = { 'x-api-key': room.apiKey || '', ...(options.headers || {}) };
    let body;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const res = await fetch(`${base}${endpoint}`, {
      method: options.method || 'GET', headers, body, signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok:false, error:text || `HTTP ${res.status}` }; }
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status; err.payload = data;
      throw err;
    }
    return data;
  } finally { clearTimeout(timeout); }
}

module.exports = { haxRequest };
