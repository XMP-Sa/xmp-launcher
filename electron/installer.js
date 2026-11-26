'use strict';

/**
 * Locating and launching the Multi Theft Auto client.
 *
 * XMP never bundles, patches or redistributes any part of GTA:SA or of the
 * MTA client — it detects an existing installation and hands it a connection
 * request, exactly like a shortcut would.
 */

const fs = require('fs');
const path = require('path');

const EXE_NAMES = ['Multi Theft Auto.exe', 'MultiTheftAuto.exe', 'mta.exe'];
const DEFAULT_DIRS = [
  'C:\\Program Files (x86)\\MTA San Andreas 1.7',
  'C:\\Program Files (x86)\\MTA San Andreas 1.6',
  'C:\\Program Files\\MTA San Andreas 1.7',
  'C:\\Program Files (x86)\\MTA San Andreas 1.5',
  'C:\\Program Files (x86)\\MTA San Andreas',
  'C:\\Program Files\\MTA San Andreas',
  'D:\\Program Files (x86)\\MTA San Andreas 1.7',
  'D:\\MTA San Andreas 1.7',
  'D:\\Games\\MTA San Andreas 1.7',
  'E:\\Games\\MTA San Andreas 1.7',
];

function normalizePath(dir) {
  if (!dir) return '';
  let p = String(dir).trim().replace(/^"|"$/g, '');
  p = p.replace(/\//g, '\\');
  if (/\.exe$/i.test(p)) p = path.win32.dirname(p);
  return p;
}

function looksLikeMtaDir(dir) {
  try {
    const entries = fs.readdirSync(dir);
    const hasExe = entries.some((f) => EXE_NAMES.some((n) => n.toLowerCase() === f.toLowerCase()));
    const hasCore = entries.some((f) => /mta.*\.(dll|exe)$/i.test(f)) || entries.includes('mods');
    return hasExe || hasCore;
  } catch (_) {
    return false;
  }
}

function validatePath(dir) {
  const target = normalizePath(dir);
  if (!target) return { ok: false, error: 'EMPTY_PATH', errorFa: 'مسیر نصب انتخاب نشده است.' };
  if (!fs.existsSync(target)) {
    return { ok: false, error: 'PATH_MISSING', errorFa: 'این مسیر روی سیستم پیدا نشد.' };
  }
  const resolved = resolveExecutable(target);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      errorFa: 'فایل اجرایی MTA در این پوشه پیدا نشد. پوشه‌ای که Multi Theft Auto.exe داخلش است را انتخاب کن.',
    };
  }
  return { ok: true, path: target, exe: resolved.exe };
}

function resolveExecutable(dirOrExe) {
  const target = normalizePath(dirOrExe);
  if (!target) return { ok: false, error: 'NO_PATH' };

  if (/\.exe$/i.test(String(dirOrExe).trim())) {
    if (fs.existsSync(dirOrExe)) return { ok: true, exe: dirOrExe, dir: path.win32.dirname(dirOrExe) };
  }

  if (!fs.existsSync(target)) return { ok: false, error: 'PATH_MISSING' };

  for (const name of EXE_NAMES) {
    const candidate = path.join(target, name);
    if (fs.existsSync(candidate)) return { ok: true, exe: candidate, dir: target };
  }

  // deep-ish scan (one level) so users can pick the parent folder
  try {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(target, entry.name);
      for (const name of EXE_NAMES) {
        const candidate = path.join(sub, name);
        if (fs.existsSync(candidate)) return { ok: true, exe: candidate, dir: sub };
      }
    }
  } catch (_) { /* ignore */ }

  return { ok: false, error: 'EXE_NOT_FOUND' };
}

/** Read the installed MTA version from the version file when available. */
function readVersion(dir) {
  try {
    const info = path.join(dir, 'version.txt');
    if (fs.existsSync(info)) return fs.readFileSync(info, 'utf8').trim().split('\n')[0];
  } catch (_) { /* ignore */ }
  return '';
}

function detect() {
  const found = [];
  for (const dir of DEFAULT_DIRS) {
    if (fs.existsSync(dir)) {
      const res = resolveExecutable(dir);
      if (res.ok) found.push({ path: res.dir, exe: res.exe, version: readVersion(res.dir), source: 'scan' });
    }
  }

  // registry hint (Windows only)
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('child_process');
      const reg = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Multi Theft Auto', '/s'], {
        encoding: 'utf8', windowsHide: true, timeout: 2500,
      });
      const m = /InstallLocation\s+REG_SZ\s+([^\r\n]+)/i.exec(reg) || /Path\s+REG_SZ\s+([^\r\n]+)/i.exec(reg);
      if (m) {
        const res = resolveExecutable(m[1]);
        if (res.ok && !found.some((f) => f.path.toLowerCase() === res.dir.toLowerCase())) {
          found.push({ path: res.dir, exe: res.exe, version: readVersion(res.dir), source: 'registry' });
        }
      }
    } catch (_) { /* not installed / no key */ }
  }

  return { ok: found.length > 0, installs: found };
}

// ---------------------------------------------------------------------------
// GTA San Andreas (user-provided game — XMP never distributes it)
// ---------------------------------------------------------------------------
const GTA_EXE = 'gta_sa.exe';
const GTA_DEFAULT_DIRS = [
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto San Andreas',
  'C:\\Program Files\\Steam\\steamapps\\common\\Grand Theft Auto San Andreas',
  'D:\\SteamLibrary\\steamapps\\common\\Grand Theft Auto San Andreas',
  'C:\\Program Files (x86)\\Rockstar Games\\GTA San Andreas',
  'C:\\Program Files\\Rockstar Games\\GTA San Andreas',
  'C:\\Games\\GTA San Andreas',
  'D:\\Games\\GTA San Andreas',
  'D:\\GTA San Andreas',
  'E:\\Games\\GTA San Andreas',
];

/** Soft validation: file must exist and look like the real game binary. */
function validateGtaDir(dir) {
  const target = normalizePath(dir);
  if (!target) return { ok: false, error: 'EMPTY_PATH', errorFa: 'مسیر GTA San Andreas انتخاب نشده است.' };
  const exe = path.join(target, GTA_EXE);
  if (!fs.existsSync(exe)) {
    return { ok: false, error: 'GTA_NOT_FOUND', errorFa: 'gta_sa.exe در این پوشه پیدا نشد. پوشه نصب GTA San Andreas را انتخاب کن.' };
  }
  let size = 0;
  try { size = fs.statSync(exe).size; } catch (_) { /* ignore */ }
  // The genuine US 1.0 exe is ~14 MB; anything far smaller is not the game.
  const plausible = size > 5 * 1024 * 1024;
  return {
    ok: plausible,
    path: target,
    exe,
    size,
    error: plausible ? '' : 'GTA_TOO_SMALL',
    errorFa: plausible ? '' : 'حجم gta_sa.exe غیرعادی است؛ احتمالاً نسخه درست بازی نیست (نسخه US 1.0 لازم است).',
  };
}

function detectGta() {
  const found = [];
  for (const dir of GTA_DEFAULT_DIRS) {
    const res = validateGtaDir(dir);
    if (res.ok) found.push({ path: res.path, exe: res.exe, size: res.size, source: 'scan' });
  }
  return { ok: found.length > 0, installs: found };
}

/**
 * Decide what actually gets launched (Phase 2):
 *   1. XMP Client installed by the client-manager  → prefer it
 *   2. else a classic MTA installation             → backward-compatible fallback
 *   3. else                                        → structured error
 */
function resolveLaunchTarget({ mtaPath } = {}, clientStatus = null) {
  if (clientStatus && clientStatus.installed && clientStatus.exe) {
    return { ok: true, engine: 'xmp', exe: clientStatus.exe, dir: path.dirname(clientStatus.exe) };
  }
  const mta = resolveExecutable(mtaPath || '');
  if (mta.ok) return { ok: true, engine: 'mta', exe: mta.exe, dir: mta.dir };
  return {
    ok: false,
    error: 'NO_CLIENT',
    errorFa: 'XMP Client نصب نیست و MTA هم پیدا نشد. از تنظیمات ← بازی، کلاینت XMP را دانلود کن.',
  };
}

/**
 * Build the MTA command line.
 *   --connect <ip> [--port <port>] [--password <pw>] [--nick <nick>]
 *   --serial / --nickname are honoured by recent MTA builds; --connect is the
 *   documented "join server" switch used by the installer's shortcuts.
 */
function buildArgs({ server, nickname, password, extra } = {}) {
  const args = [];
  if (server && server.ip) {
    args.push('--connect', String(server.ip));
    if (server.port) args.push('--port', String(server.port));
    if (password) args.push('--password', String(password));
  }
  if (nickname) args.push('--nick', String(nickname).replace(/\s+/g, '_'));
  if (Array.isArray(extra)) args.push(...extra.filter(Boolean).map(String));
  return args;
}

module.exports = {
  EXE_NAMES,
  GTA_EXE,
  GTA_DEFAULT_DIRS,
  DEFAULT_DIRS,
  validateGtaDir,
  detectGta,
  resolveLaunchTarget,
  normalizePath,
  validatePath,
  resolveExecutable,
  detect,
  buildArgs,
  looksLikeMtaDir,
};
