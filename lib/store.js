'use strict';
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

class JsonStore {
  constructor(root) {
    this.root = root;
    ensureDir(root);
  }
  file(name) { return path.join(this.root, name); }
  read(name, fallback) {
    const f = this.file(name);
    try {
      if (!fs.existsSync(f)) return clone(fallback);
      const raw = fs.readFileSync(f, 'utf8').trim();
      if (!raw) return clone(fallback);
      return JSON.parse(raw);
    } catch (err) {
      console.error('[STORE] read', name, err.message);
      return clone(fallback);
    }
  }
  write(name, value) {
    const f = this.file(name), tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, f);
    return value;
  }
  append(name, value) {
    fs.appendFileSync(this.file(name), `${JSON.stringify(value)}\n`);
  }
}

module.exports = { JsonStore, ensureDir };
