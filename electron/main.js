'use strict';

/**
 * XMP Launcher — main process
 * ------------------------------------------------------------------
 * Keeps the renderer completely offline and sandboxed: every privileged
 * action (process spawn, UDP queries, filesystem, HTTP) happens here and is
 * exposed through a tiny, explicit IPC surface.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const dgram = require('dgram');

const pkg = require('../package.json');
const store = require('./store');
const { pingServers, pingOne } = require('./ase');
const installer = require('./installer');
const config = require('./config');
const clientManager = require('./client');


// ---------------------------------------------------------------------------
// Single instance + memory friendly switches
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const isDev = process.argv.includes('--dev');
let win = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const userData = app.getPath('userData');
const prefs = new store(path.join(userData, 'prefs.json'), config.DEFAULT_PREFS);
const clientDir = path.join(userData, 'client');

store.migrateLegacy(prefs);

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const state = prefs.get('window') || {};
  const bounds = {
    width: Math.max(state.width || 1180, 940),
    height: Math.max(state.height || 700, 600),
    x: state.x,
    y: state.y,
  };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#080A0F',
    frame: false,
    title: 'XMP Launcher',
    icon: path.join(__dirname, '..', 'src', 'assets', 'logo-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true,
      devTools: isDev,
      experimentalFeatures: false,
    },
  });

  if (state.maximized) win.maximize();

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    if (!maximized && !win.isMinimized()) {
      const b = win.getBounds();
      prefs.set('window', { ...b, maximized: false });
    } else {
      prefs.set('window', { ...(prefs.get('window') || {}), maximized });
    }
  };
  win.on('resized', persistBounds);
  win.on('moved', persistBounds);
  win.on('maximize', persistBounds);
  win.on('unmaximize', persistBounds);

  win.on('close', (e) => {
    const minimize = prefs.get('minimizeToTray');
    if (!isQuitting && minimize) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });

  // never let the app navigate away or open random windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  nativeTheme.themeSource = 'dark';
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win && !win.isVisible()) win.show();
  });
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------------------------------------------------------------------
// IPC: window controls
// ---------------------------------------------------------------------------
ipcMain.handle('win:action', (e, action) => {
  if (!win) return null;
  switch (action) {
    case 'minimize': win.minimize(); break;
    case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'close': win.close(); break;
    case 'quit': isQuitting = true; app.quit(); break;
    default: break;
  }
  return { maximized: win ? win.isMaximized() : false };
});

// ---------------------------------------------------------------------------
// IPC: app info / preferences
// ---------------------------------------------------------------------------
ipcMain.handle('app:info', () => ({
  version: pkg.version,
  name: pkg.productName,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  cpus: os.cpus().length,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  isDev,
}));

ipcMain.handle('prefs:get', () => prefs.all());
ipcMain.handle('prefs:set', (e, patch) => {
  prefs.merge(patch);
  if (typeof patch.minimizeToTray === 'boolean' && patch.minimizeToTray === false && app.dock) {
    app.dock.show();
  }
  return prefs.all();
});

// ---------------------------------------------------------------------------
// IPC: servers
// ---------------------------------------------------------------------------
let lastMasterFetch = 0;

ipcMain.handle('servers:fetch', async () => {
  const cached = prefs.get('serverCache');
  const now = Date.now();
  const ttl = 90 * 1000;

  if (cached && now - (cached.at || 0) < ttl) {
    return { ok: true, ...cached, cached: true };
  }

  try {
    const list = await config.fetchMasterList();
    // enrich the most populated ones with a live ASE ping (runs in parallel)
    const sample = list.slice(0, 48);
    const pings = await pingServers(sample, { timeout: 1200, concurrency: 12 });
    const merged = list.map((s, i) => ({ ...s, live: pings[i] || null }));

    // Phase 3: merge the official XMP server list (best effort).
    try {
      const xmpList = await config.fetchXmpServers();
      const key = (x) => `${x.ip}:${x.port}`;
      const known = new Map(merged.map((x) => [key(x), x]));
      for (const entry of xmpList) {
        const hit = known.get(key(entry));
        if (hit) {
          hit.official = true;
          if (entry.name) hit.name = entry.name;
        } else {
          merged.unshift({
            ...entry,
            name: entry.name || 'XMP Server',
            players: 0,
            maxPlayers: 0,
            version: '1.7',
            passworded: false,
            asePort: entry.port + 123,
            official: true,
            source: 'xmp',
            live: null,
          });
        }
      }
      // live-check injected XMP entries right away
      const injected = merged.filter((x) => x.source === 'xmp');
      if (injected.length) {
        const live = await pingServers(injected, { timeout: 1500, concurrency: 8 });
        injected.forEach((x, i) => {
          if (live[i]) {
            x.live = live[i];
            x.players = live[i].players ?? x.players;
            x.maxPlayers = live[i].maxPlayers || x.maxPlayers;
            if (live[i].name) x.name = live[i].name;
            x.passworded = Boolean(live[i].passworded);
          }
        });
      }
    } catch (_) { /* XMP list is optional */ }
    const payload = { at: now, list: merged, count: merged.length, source: 'master' };
    prefs.set('serverCache', payload);
    lastMasterFetch = now;
    return { ok: true, ...payload, cached: false };
  } catch (err) {
    if (cached) return { ok: true, ...cached, cached: true, stale: true, error: String(err.message || err) };
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('servers:ping', async (e, servers) => {
  if (!Array.isArray(servers)) return [];
  return pingServers(servers.slice(0, 120), { timeout: 1500, concurrency: 24 });
});

ipcMain.handle('servers:pingOne', async (e, s) => pingOne(s, 2000));

// ---------------------------------------------------------------------------
// IPC: game / MTA integration
// ---------------------------------------------------------------------------
ipcMain.handle('game:detect', async () => {
  const found = installer.detect();
  return found;
});

ipcMain.handle('game:browse', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select your Multi Theft Auto: San Andreas folder',
    properties: ['openDirectory'],
    defaultPath: 'C:\\Program Files (x86)\\MTA San Andreas 1.7',
  });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = res.filePaths[0];
  const normalized = installer.normalizePath(dir);
  const valid = installer.validatePath(normalized);
  if (valid.ok) prefs.set('mtaPath', normalized);
  return { path: normalized, ...valid };
});

ipcMain.handle('game:detectGta', async () => installer.detectGta());

ipcMain.handle('game:browseGta', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select your GTA San Andreas folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = installer.normalizePath(res.filePaths[0]);
  const valid = installer.validateGtaDir(dir);
  if (valid.ok) prefs.set('gtaPath', dir);
  return { path: dir, ...valid };
});

// ---------------------------------------------------------------------------
// IPC: XMP Client manager (Phase 2)
// ---------------------------------------------------------------------------
ipcMain.handle('client:status', () => clientManager.status(clientDir));

ipcMain.handle('client:check', async () => {
  const res = await clientManager.checkUpdate(clientDir, config.CLIENT_MANIFEST_URL);
  if (res.ok && res.currentVersion) prefs.set('clientVersion', res.currentVersion);
  return res;
});

let clientBusy = false;
ipcMain.handle('client:install', async () => {
  if (clientBusy) return { ok: false, error: 'BUSY', errorFa: 'نصب کلاینت در حال انجام است.' };
  clientBusy = true;
  try {
    const st = await clientManager.install(clientDir, config.CLIENT_MANIFEST_URL, (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('client:progress', p);
    });
    prefs.set('clientVersion', st.version || '');
    return { ok: true, ...st };
  } catch (err) {
    return { ok: false, error: String(err.message || err), errorFa: String(err.message || err) };
  } finally {
    clientBusy = false;
  }
});

ipcMain.handle('client:remove', () => clientManager.remove(clientDir));

ipcMain.handle('game:launch', async (e, payload = {}) => {
  const cs = clientManager.status(clientDir);
  const check = installer.resolveLaunchTarget({ mtaPath: payload.path || prefs.get('mtaPath') || '' }, cs);
  if (!check.ok) {
    return { ok: false, error: check.error, errorFa: check.errorFa };
  }
  const args = installer.buildArgs(payload);
  try {
    const child = spawn(check.exe, args, {
      cwd: check.dir,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: false,
    });
    child.unref();

    prefs.merge({
      lastPlayedAt: Date.now(),
      playCount: (prefs.get('playCount') || 0) + 1,
      lastServer: payload.server
        ? { name: payload.server.name, ip: payload.server.ip, port: payload.server.port }
        : prefs.get('lastServer') || null,
    });

    if (prefs.get('closeOnLaunch') && win) {
      setTimeout(() => { isQuitting = true; app.quit(); }, 1600);
    }
    return { ok: true, exe: check.exe, args, engine: check.engine };
  } catch (err) {
    return { ok: false, error: String(err.message || err), errorFa: 'اجرای MTA با خطا مواجه شد.' };
  }
});

ipcMain.handle('game:openFolder', () => {
  const target = prefs.get('mtaPath');
  if (!target) return false;
  shell.openPath(target);
  return true;
});

// ---------------------------------------------------------------------------
// IPC: misc
// ---------------------------------------------------------------------------
ipcMain.handle('shell:open', (e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('update:check', async () => {
  try {
    const info = await config.fetchReleaseInfo(pkg.version);
    return info;
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// IPC: launcher self-update (Discord-style: download in boot, silent install)
// ---------------------------------------------------------------------------
let updateBusy = false;
ipcMain.handle('update:download', async () => {
  if (updateBusy) return { ok: false, error: 'BUSY' };
  updateBusy = true;
  try {
    const info = await config.fetchReleaseInfo(pkg.version);
    if (!info.ok || !info.newer || !info.asset?.browser_download_url) {
      return { ok: false, error: 'NO_UPDATE', info };
    }
    const dest = path.join(app.getPath('temp'), `XMP-Launcher-Setup-${String(info.tag).replace(/^v/, '')}.exe`);
    await clientManager.downloadToFile(info.asset.browser_download_url, dest, (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', p);
    });
    const stat = fs.statSync(dest);
    if (info.asset.size && stat.size !== info.asset.size) {
      fs.rmSync(dest, { force: true });
      return { ok: false, error: 'SIZE_MISMATCH' };
    }
    const digest = String(info.asset.digest || '');
    if (digest.startsWith('sha256:')) {
      const actual = await clientManager.sha256File(dest);
      if (actual.toLowerCase() !== digest.slice('sha256:'.length).toLowerCase()) {
        fs.rmSync(dest, { force: true });
        return { ok: false, error: 'CHECKSUM_MISMATCH' };
      }
    }
    return { ok: true, file: dest, version: info.tag, size: stat.size };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    updateBusy = false;
  }
});

ipcMain.handle('update:apply', (e, file) => {
  const temp = path.resolve(app.getPath('temp'));
  const resolved = typeof file === 'string' ? path.resolve(file) : '';
  if (!resolved.startsWith(`${temp}${path.sep}`) || !/\.exe$/i.test(resolved) || !fs.existsSync(resolved)) {
    return { ok: false, error: 'BAD_FILE' };
  }
  const fileToRun = resolved;
  try {
    const child = spawn(fileToRun, ['/S'], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => { isQuitting = true; app.quit(); }, 800);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('log:event', (e, name, data) => {
  if (isDev) console.log(`[renderer:${name}]`, data || '');
  return true;
});
