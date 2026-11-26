'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON store with debounced atomic writes. No dependencies: keeps the
 * installed footprint and the memory profile minimal.
 */
class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults };
    this._timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.data = { ...this.defaults, ...parsed };
    } catch (_) {
      /* first run */
    }
  }

  all() {
    return { ...this.data };
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._scheduleFlush();
    return value;
  }

  merge(patch) {
    if (!patch || typeof patch !== 'object') return this.all();
    this.data = { ...this.data, ...patch };
    this._scheduleFlush();
    return this.all();
  }

  _scheduleFlush() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    this._timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('store: failed to persist', err.message);
    }
  }
}

/** Pull over settings from the stock MTA client registry dump if present. */
function migrateLegacy(prefs) {
  if (prefs.get('legacyScanned')) return;
  const candidates = [
    path.join(process.env.APPDATA || '', 'MTA San Andreas 1.7', 'coreconfig.xml'),
    path.join(process.env.LOCALAPPDATA || '', 'MTA San Andreas 1.7', 'coreconfig.xml'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const xml = fs.readFileSync(file, 'utf8');
      const nick = /<nick>([^<]+)<\/nick>/i.exec(xml);
      if (nick && nick[1]) prefs.set('nickname', nick[1].trim());
      prefs.set('legacyFound', true);
      break;
    } catch (_) { /* ignore */ }
  }
  prefs.set('legacyScanned', true);
}

module.exports = Store;
module.exports.migrateLegacy = migrateLegacy;
