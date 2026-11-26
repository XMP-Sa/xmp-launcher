'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const MASTER_URL = 'https://mtasa.com/api/';

// XMP Client (xmp-blue fork) release manifest — published by the
// xmp-build workflow on every xmp-v* tag. See docs/client-manifest.example.json
const CLIENT_REPO = 'XMP-Sa/xmp-blue';
const CLIENT_MANIFEST_URL = `https://github.com/${CLIENT_REPO}/releases/latest/download/xmp-client-manifest.json`;
const GFW = { name: 'GTA:SA', id: 1 }; // legacy ASE game id used by MTA

/**
 * The public MTA list (used by mtasa.com and the in-game browser) is a plain
 * JSON array. It is refreshed by the MTA master every few minutes — perfect
 * for a launcher: one small request, no scraping.
 */
function httpJson(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'XMPLauncher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpJson(res.headers.location, timeout));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body.replace(/^\uFEFF/, ''))); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('timeout')); });
  });
}

function normalizeServer(raw) {
  const ip = String(raw.ip || '').trim();
  const port = Number(raw.port) || 22003;
  const name = String(raw.name || 'Unnamed server').replace(/\s+/g, ' ').trim();
  return {
    ip,
    port,
    name,
    players: Number(raw.players) || 0,
    maxPlayers: Number(raw.maxplayers ?? raw.maxPlayers) || 0,
    version: String(raw.version || ''),
    passworded: Number(raw.password) === 1,
    // ASE replies arrive on the game port + 123
    asePort: port + 123,
  };
}

async function fetchMasterList() {
  const data = await httpJson(MASTER_URL);
  if (!Array.isArray(data)) throw new Error('Unexpected master payload');
  return data
    .filter((s) => s && s.ip)
    .map(normalizeServer)
    .sort((a, b) => b.players - a.players);
}

function fetchReleaseInfo(currentVersion) {
  // Placeholder for the self-update check: flip REPO once published.
  const REPO = 'XMP-Sa/xmp-launcher';
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  return httpJson(url)
    .then((rel) => ({
      ok: true,
      tag: rel.tag_name,
      url: rel.html_url,
      notes: (rel.body || '').slice(0, 2000),
      asset: (rel.assets || []).find((a) => /setup.*\.exe$/i.test(a.name)) || null,
      newer: String(rel.tag_name || '').replace(/^v/, '') !== currentVersion,
    }))
    .catch((err) => ({ ok: false, error: String(err.message || err) }));
}

module.exports = {
  DEFAULT_PREFS: {
    nickname: '',
    mtaPath: '',
    gtaPath: '',
    clientVersion: '',
    theme: 'ember',
    accent: 'ember',
    autoUpdateServers: true,
    closeOnLaunch: false,
    minimizeToTray: false,
    showFps: true,
    reduceMotion: false,
    lowEndMode: false,
    language: 'fa',
    favorites: [],
    history: [],
    playCount: 0,
    lastServer: null,
    serverCache: null,
    window: null,
  },
  MASTER_URL,
  CLIENT_REPO,
  CLIENT_MANIFEST_URL,
  GFW,
  httpJson,
  fetchMasterList,
  fetchReleaseInfo,
  normalizeServer,
};
