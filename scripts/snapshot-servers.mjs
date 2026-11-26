#!/usr/bin/env node
/**
 * Regenerates src/data/demo.js — the offline snapshot the launcher ships as a
 * first-run fallback (and that powers the browser preview).
 *
 *   node scripts/snapshot-servers.mjs
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MASTER = 'https://mtasa.com/api/';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'data', 'demo.js');

const res = await fetch(MASTER, { headers: { 'user-agent': 'XMPLauncher/snapshot' } });
if (!res.ok) throw new Error(`master responded ${res.status}`);
const raw = await res.json();

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);

const servers = raw
  .filter((s) => s && s.ip)
  .sort((a, b) => (b.players || 0) - (a.players || 0))
  .slice(0, 120)
  .map((s) => {
    const port = Number(s.port) || 22003;
    return {
      ip: s.ip,
      port,
      name: clean(s.name) || 'Unnamed server',
      players: Number(s.players) || 0,
      maxPlayers: Number(s.maxplayers) || 0,
      version: String(s.version || '1.7'),
      passworded: Number(s.password) === 1,
      asePort: port + 123,
      live: null,
    };
  });

const banner = `/* Offline snapshot used by the browser preview and as a first-run fallback.
   Source: the public MTA master list (${MASTER})
   Regenerate with: node scripts/snapshot-servers.mjs */
`;

await writeFile(out, `${banner}window.XMP_DEMO = ${JSON.stringify(servers, null, 1)};\n`);
console.log(`wrote ${servers.length} servers -> ${path.relative(process.cwd(), out)}`);
