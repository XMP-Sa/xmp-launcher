'use strict';

/**
 * XMP Client manager (Phase 2)
 * ------------------------------------------------------------------
 * Downloads, verifies, installs and updates the XMP Client (the
 * mtasa-blue fork built by the xmp-blue repo) into <userData>/client.
 * The launcher never touches GTA:SA files — the user provides the game,
 * this module only manages our own client binaries.
 *
 * Manifest contract (served next to the client zip, see
 * docs/client-manifest.example.json):
 *   { "version": "1.7.0-xmp.1",
 *     "url": "https://…/XMP-Client-win32.zip",
 *     "sha256": "…", "size": 12345678 }
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// New name first (patch 0002), legacy name second so early CI builds of the
// fork (still called "Multi Theft Auto.exe") are accepted too.
const CLIENT_EXE_NAMES = ['XMP Client.exe', 'Multi Theft Auto.exe'];
const MARKER = 'xmp-client.json';

function findExe(dir, depth = 2) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const name of CLIENT_EXE_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  if (depth <= 0) return null;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const hit = findExe(path.join(dir, e.name), depth - 1);
        if (hit) return hit;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
  } catch (_) {
    return null;
  }
}

function status(clientDir) {
  const exe = findExe(clientDir);
  const marker = readMarker(clientDir);
  return {
    installed: Boolean(exe),
    exe,
    dir: clientDir,
    version: marker?.version || '',
    installedAt: marker?.installedAt || 0,
  };
}

function httpJson(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'user-agent': 'XMPLauncher/1.1 (client-manager)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpJson(res.headers.location, timeout));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  });
}

async function fetchManifest(manifestUrl) {
  const m = await httpJson(manifestUrl);
  if (!m || !m.url || !m.version) throw new Error('مانیفست کلاینت معتبر نیست.');
  return m;
}

function downloadToFile(url, dest, onProgress, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'user-agent': 'XMPLauncher/1.1 (client-manager)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(downloadToFile(res.headers.location, dest, onProgress, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0;
      let done = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (onProgress) onProgress({ received: done, total, percent: total ? Math.round((done / total) * 100) : -1 });
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ bytes: done })));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

/**
 * Full install/update flow. Stages reported through onProgress:
 * manifest → download → verify → extract → done
 */
async function install(clientDir, manifestUrl, onProgress = () => {}) {
  const manifest = await fetchManifest(manifestUrl);
  onProgress({ stage: 'manifest', version: manifest.version });

  fs.mkdirSync(clientDir, { recursive: true });
  const tmpZip = path.join(clientDir, '.download.zip');
  const staging = path.join(clientDir, '.staging');

  try {
    await downloadToFile(manifest.url, tmpZip, (p) => onProgress({ stage: 'download', ...p }));

    if (manifest.sha256) {
      onProgress({ stage: 'verify' });
      const sum = await sha256File(tmpZip);
      if (sum.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
        throw new Error('چک‌سام فایل کلاینت درست نیست؛ دانلود لغو شد.');
      }
    }

    onProgress({ stage: 'extract' });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    // adm-zip is a tiny pure-JS unzip — no native deps, keeps the app light.
    const AdmZip = require('adm-zip');
    new AdmZip(tmpZip).extractAllTo(staging, true);

    const exe = findExe(staging);
    if (!exe) throw new Error('داخل بسته کلاینت، فایل اجرایی پیدا نشد.');

    // swap staging into place (keep the marker next to the exe's folder)
    const exeDir = path.dirname(exe);
    const keep = new Set(['.download.zip']);
    for (const e of fs.readdirSync(clientDir)) {
      if (!keep.has(e) && e !== '.staging') fs.rmSync(path.join(clientDir, e), { recursive: true, force: true });
    }
    const srcRoot = exeDir === staging ? staging : exeDir;
    for (const e of fs.readdirSync(srcRoot)) {
      fs.renameSync(path.join(srcRoot, e), path.join(clientDir, e));
    }
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(tmpZip, { force: true });

    const marker = { version: manifest.version, installedAt: Date.now(), sha256: manifest.sha256 || '' };
    fs.writeFileSync(path.join(clientDir, MARKER), JSON.stringify(marker, null, 2));

    onProgress({ stage: 'done', version: manifest.version });
    return status(clientDir);
  } catch (err) {
    fs.rmSync(tmpZip, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

async function checkUpdate(clientDir, manifestUrl) {
  const cur = status(clientDir);
  try {
    const manifest = await fetchManifest(manifestUrl);
    return {
      ok: true,
      installed: cur.installed,
      currentVersion: cur.version,
      latestVersion: manifest.version,
      updateAvailable: !cur.installed || cur.version !== manifest.version,
      size: manifest.size || 0,
    };
  } catch (err) {
    return { ok: false, installed: cur.installed, currentVersion: cur.version, error: String(err.message || err) };
  }
}

function remove(clientDir) {
  fs.rmSync(clientDir, { recursive: true, force: true });
  return status(clientDir);
}

module.exports = {
  CLIENT_EXE_NAMES,
  status,
  install,
  checkUpdate,
  remove,
  fetchManifest,
};
