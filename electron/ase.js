'use strict';

/**
 * ASE protocol (the query protocol GTA-era servers use, MTA included).
 *
 *   request : "s"
 *   reply   : "EYE1" <game4> <port6> <name*4> <gametype*4> <map*4>
 *             <version*4> <password> <numplayers> <maxplayers>
 *             [ <rule\0value\0>... ]
 *
 * MTA answers its ASE query on  <game port> + 123  (22003 -> 22126).
 */

const dgram = require('dgram');

/** Byte-level tokenizer for the "EYE1" format. */
class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  byte() { return this.buf[this.pos++]; }
  uint16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  str() {
    const start = this.pos;
    let len = 0;
    let kind = 'nul';
    // GTA/ASE strings are length-prefixed when they start with a small byte
    const first = this.buf[this.pos];
    if (first <= 0x20 && this.buf[this.pos + first] === 0x00) {
      this.pos += 1;
      len = first;
      kind = 'nul';
      this.pos += len + 1;
      return { value: this.buf.toString('utf8', start + 1, start + 1 + len), kind };
    }
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) this.pos++;
    const value = this.buf.toString('utf8', start, this.pos);
    this.pos++;
    return { value, kind };
  }
}

function parseAse(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'EYE1') return null;

  const out = {};
  let pos = 4;
  const readStr = () => {
    const len = buf[pos];
    if (len === undefined) return '';
    if (len === 0) { pos += 1; return ''; }
    pos += 1;
    const v = buf.toString('utf8', pos, pos + len);
    pos += len;
    return v;
  };

  try {
    out.game = readStr();            // "mta"
    out.gamePort = readStr();        // "22003"
    out.name = readStr();
    out.gametype = readStr();
    out.map = readStr();
    out.version = readStr();
    // trailing fields are either length-prefixed strings or raw bytes
    const tail = [];
    while (pos < buf.length) {
      const b = buf[pos];
      if (b < 0x20 && pos + 1 + b <= buf.length) {
        tail.push(readStr());
      } else {
        tail.push(b);
        pos += 1;
      }
    }
    out.passworded = Number(tail[0] === 1 || tail[0] === '1');
    out.players = Number(tail[1]) || 0;
    out.maxPlayers = Number(tail[2]) || 0;

    // rules: pairs after the header (Name=value style)
    const rules = {};
    const rest = tail.slice(3);
    for (let i = 0; i < rest.length - 1; i += 2) {
      const k = rest[i];
      const v = rest[i + 1];
      if (typeof k === 'string' && typeof v === 'string' && k.length) rules[k] = v;
    }
    out.rules = rules;
    if (rules.logo && /^https?:\/\//i.test(rules.logo)) out.logo = rules.logo;
    out.aselink = rules.aselink || rules.ase || '';
  } catch (_) {
    return null;
  }
  return out;
}

function pingOne(server, timeout = 1500) {
  return new Promise((resolve) => {
    if (!server || !server.ip) return resolve(null);
    const port = Number(server.asePort) || Number(server.port) + 123;
    const sock = dgram.createSocket('udp4');
    const started = Date.now();
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch (_) {}
      resolve(value);
    };

    sock.on('message', (msg) => {
      const info = parseAse(msg);
      finish(info ? { ...info, ping: Date.now() - started } : null);
    });
    sock.on('error', () => finish(null));

    const timer = setTimeout(() => finish(null), timeout);
    if (timer.unref) timer.unref();

    try {
      sock.send(Buffer.from('s'), port, server.ip, (err) => { if (err) finish(null); });
    } catch (_) {
      finish(null);
    }
  });
}

async function pingServers(servers, { timeout = 1500, concurrency = 16 } = {}) {
  const results = new Array(servers.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < servers.length) {
      const i = cursor++;
      results[i] = await pingOne(servers[i], timeout);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, servers.length) }, worker));
  return results;
}

module.exports = { parseAse, pingOne, pingServers };
