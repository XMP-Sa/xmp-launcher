'use strict';

/**
 * XMP Launcher — renderer
 * -------------------------------------------------------------------------
 * No frameworks, no runtime dependencies: a ~20 kB script that paints the UI,
 * talks to the main process through `window.xmp` and falls back to a bundled
 * demo snapshot whenever it is opened outside Electron (design preview).
 */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const isElectron = Boolean(window.xmp);

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  const state = {
    page: 'home',
    servers: [],
    filter: 'all',
    query: '',
    selected: null,
    prefs: {},
    info: {},
    loading: true,
    listLimit: 120,
    favorites: [],
    activeServerRow: null,
  };

  const TINTS = [
    ['#FF8A3D', 'rgba(255,138,61,.42)'],
    ['#FF5C6C', 'rgba(255,92,108,.42)'],
    ['#4FE0C8', 'rgba(79,224,200,.34)'],
    ['#7C9CFF', 'rgba(124,156,255,.38)'],
    ['#C792FF', 'rgba(199,146,255,.38)'],
    ['#B6F24A', 'rgba(182,242,74,.32)'],
    ['#FFC857', 'rgba(255,200,87,.38)'],
    ['#5FD0FF', 'rgba(95,208,255,.36)'],
  ];

  const PAGE_META = {
    home: ['خانه', 'XMP'],
    servers: ['سرورها', 'BROWSER'],
    favorites: ['علاقه‌مندی‌ها', 'SAVED'],
    settings: ['تنظیمات', 'PREFERENCES'],
  };

  // ---------------------------------------------------------------------
  // tiny helpers
  // ---------------------------------------------------------------------
  const el = (tag, props = {}, html) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (html != null) node.innerHTML = html;
    return node;
  };

  const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
  /** Compact Persian number: 12_480 -> "۱۲ هزار" (keeps stat cards tidy). */
  const faCompact = (n) => {
    const v = Number(n || 0);
    if (v >= 10000) return `${(v / 1000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} هزار`;
    return v.toLocaleString('fa-IR');
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const escapeHtml = (str) =>
    String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  function tintFor(name, ip) {
    let h = 0;
    const src = String(ip || name || '');
    for (let i = 0; i < src.length; i += 1) h = (h * 31 + src.charCodeAt(i)) % 9973;
    return TINTS[h % TINTS.length];
  }

  function initials(name) {
    const clean = String(name || 'XMP').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'XM';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function pingClass(ping) {
    if (ping == null || Number.isNaN(ping)) return 'off';
    if (ping < 80) return 'great';
    if (ping < 180) return 'good';
    return 'bad';
  }

  /** Perceived latency estimate before the live ASE reply arrives. */
  function estimatePing(server) {
    if (server.live && typeof server.live.ping === 'number') return server.live.ping;
    let h = 0;
    const src = server.ip || '';
    for (let i = 0; i < src.length; i += 1) h = (h * 17 + src.charCodeAt(i)) % 211;
    return 34 + (h % 150);
  }

  function relativeTime(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const m = Math.round(diff / 60000);
    if (m < 1) return 'همین حالا';
    if (m < 60) return `${fa(m)} دقیقه پیش`;
    const h = Math.round(m / 60);
    if (h < 24) return `${fa(h)} ساعت پیش`;
    return `${fa(Math.round(h / 24))} روز پیش`;
  }

  // ---------------------------------------------------------------------
  // toasts
  // ---------------------------------------------------------------------
  function toast(message, kind = 'info', ms = 3800) {
    const host = $('#toasts');
    const icons = {
      ok: '<path d="m4 12.5 5 5L20 6.5"/>',
      bad: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5.5M12 16.4v.2"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>',
    };
    const node = el('div', { className: `toast toast--${kind}` },
      `<svg class="toast__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">${icons[kind] || icons.info}</svg>
       <div>${escapeHtml(message)}</div>`);
    host.appendChild(node);
    setTimeout(() => {
      node.style.animation = 'toastOut 240ms ease forwards';
      setTimeout(() => node.remove(), 260);
    }, ms);
  }

  // ---------------------------------------------------------------------
  // prefs
  // ---------------------------------------------------------------------
  async function loadPrefs() {
    if (isElectron) {
      state.prefs = await window.xmp.prefs.get();
    } else {
      try {
        state.prefs = JSON.parse(localStorage.getItem('xmp:prefs') || '{}');
      } catch (_) { state.prefs = {}; }
    }
    state.favorites = Array.isArray(state.prefs.favorites) ? state.prefs.favorites : [];
    applyPrefs();
  }

  async function savePrefs(patch) {
    state.prefs = { ...state.prefs, ...patch };
    if ('favorites' in patch) state.favorites = patch.favorites;
    if (isElectron) {
      state.prefs = await window.xmp.prefs.set(patch);
    } else {
      localStorage.setItem('xmp:prefs', JSON.stringify(state.prefs));
    }
    applyPrefs();
  }

  function applyPrefs() {
    const p = state.prefs;
    document.documentElement.dataset.accent = p.accent || 'ember';
    document.documentElement.dataset.lowend = p.lowEndMode ? '1' : '0';
    document.documentElement.dataset.motion = p.reduceMotion ? 'off' : 'on';

    $$('.switch[data-pref]').forEach((sw) => {
      sw.setAttribute('aria-checked', String(Boolean(p[sw.dataset.pref])));
    });
    $$('.swatch').forEach((s) => {
      s.setAttribute('aria-pressed', String((p.accent || 'ember') === s.dataset.accent));
    });
    const nick = $('#setNickname');
    if (nick && document.activeElement !== nick) nick.value = p.nickname || '';

    const avatar = $('#navAvatar');
    const initial = (p.nickname || 'X')[0] || 'X';
    avatar.textContent = initial.toUpperCase();

    const pathLabel = $('#mtaPathLabel');
    if (pathLabel) pathLabel.textContent = p.mtaPath || 'پیدا نشد';
    updateGameStatus(p.mtaPath);
    const gtaLabel = $('#gtaPathLabel');
    if (gtaLabel) gtaLabel.textContent = p.gtaPath || 'پیدا نشد';
    updateGtaStatus(p.gtaPath);
  }

  // ---------------------------------------------------------------------
  // game path status
  // ---------------------------------------------------------------------
  function updateGameStatus(path) {
    const badge = $('#mtaStatusBadge');
    const hint = $('#mtaStatusHint');
    if (!badge) return;
    const ok = Boolean(path);
    badge.className = `badge ${ok ? 'badge--ok' : 'badge--warn'}`;
    badge.textContent = ok ? 'آماده اجرا' : 'نیاز به تنظیم';
    hint.textContent = ok
      ? 'موتور بازی پیدا شد؛ اتصال با یک کلیک انجام می‌شود.'
      : 'پوشه نصب موتور بازی را انتخاب کن یا «شناسایی خودکار» را بزن.';
  }

  async function detectGame(silent = true) {
    if (!isElectron) {
      if (!silent) toast('حالت پیش‌نمایش: شناسایی بازی فقط داخل نسخه نصب‌شده فعال است.', 'info');
      return;
    }
    const res = await window.xmp.game.detect();
    if (res && res.ok && res.installs.length) {
      const found = res.installs[0];
      if (found.path !== state.prefs.mtaPath) {
        await savePrefs({ mtaPath: found.path });
        if (!silent) toast('موتور بازی پیدا شد.', 'ok');
      }
      updateGameStatus(found.path);
      $('#mtaPathLabel').textContent = found.path;
    } else {
      updateGameStatus(state.prefs.mtaPath);
      if (!silent) toast('موتور بازی پیدا نشد. پوشه را دستی انتخاب کن.', 'bad');
    }
  }

  // ---------------------------------------------------------------------
  // XMP client + GTA status (phase 2)
  // ---------------------------------------------------------------------
  state.client = state.client || null;

  function updateGtaStatus(path) {
    const badge = $('#gtaStatusBadge');
    const hint = $('#gtaStatusHint');
    if (!badge) return;
    const ok = Boolean(path);
    badge.className = `badge ${ok ? 'badge--ok' : 'badge--warn'}`;
    badge.textContent = ok ? 'پیدا شد' : 'نیاز به تنظیم';
    hint.textContent = ok ? 'gta_sa.exe پیدا شد؛ آماده‌ای.' : 'پوشه نصب GTA San Andreas را انتخاب کن یا «شناسایی خودکار» را بزن.';
  }

  function renderClientStatus() {
    const badge = $('#clientStatusBadge');
    const hint = $('#clientStatusHint');
    const btn = $('#btnClientInstall');
    if (!badge) return;
    const c = state.client;
    if (!isElectron) {
      badge.className = 'badge'; badge.textContent = 'پیش‌نمایش';
      hint.textContent = 'مدیریت کلاینت فقط در نسخه نصب‌شده فعال است.';
      return;
    }
    if (c && c.installed) {
      badge.className = 'badge badge--ok';
      badge.textContent = `نصب‌شده ${c.version ? '· ' + c.version : ''}`;
      hint.textContent = 'XMP Client آماده اجراست؛ اتصال‌ها با کلاینت خود XMP انجام می‌شود.';
      if (btn) btn.textContent = 'به‌روزرسانی کلاینت';
    } else {
      badge.className = 'badge badge--warn';
      badge.textContent = 'نصب نیست';
      hint.textContent = 'کلاینت دانلود نشده؛ تا آن موقع اگر موتور بازی روی سیستم باشد از همان استفاده می‌شود.';
      if (btn) btn.textContent = 'دانلود و نصب کلاینت';
    }
  }

  async function refreshClientStatus() {
    if (!isElectron) { renderClientStatus(); return; }
    try { state.client = await window.xmp.client.status(); } catch (_) { state.client = null; }
    renderClientStatus();
  }

  async function detectGta(silent = true) {
    if (!isElectron) {
      if (!silent) toast('حالت پیش‌نمایش: شناسایی بازی فقط داخل نسخه نصب‌شده فعال است.', 'info');
      return;
    }
    const res = await window.xmp.game.detectGta();
    if (res && res.ok && res.installs.length) {
      const found = res.installs[0];
      if (found.path !== state.prefs.gtaPath) await savePrefs({ gtaPath: found.path });
      $('#gtaPathLabel').textContent = found.path;
      updateGtaStatus(found.path);
      if (!silent) toast('GTA San Andreas پیدا شد.', 'ok');
    } else {
      updateGtaStatus(state.prefs.gtaPath);
      if (!silent) toast('GTA San Andreas پیدا نشد. پوشه را دستی انتخاب کن.', 'bad');
    }
  }

  const STAGE_FA = {
    manifest: 'دریافت اطلاعات نسخه…',
    download: 'در حال دانلود کلاینت…',
    verify: 'بررسی امضای فایل (SHA-256)…',
    extract: 'در حال نصب…',
    done: 'نصب کامل شد.',
  };

  function wireClientProgress() {
    if (!isElectron || !window.xmp.client.onProgress) return;
    window.xmp.client.onProgress((p) => {
      const row = $('#clientProgressRow');
      const bar = $('#clientProgressBar');
      const label = $('#clientProgressLabel');
      if (!row || !bar) return;
      row.hidden = false;
      label.textContent = p.stage === 'download' && p.percent >= 0
        ? `${STAGE_FA.download} ${Number(p.percent).toLocaleString('fa-IR')}٪`
        : (STAGE_FA[p.stage] || 'در حال انجام…');
      bar.style.width = p.stage === 'download' ? `${p.percent}%`
        : p.stage === 'verify' ? '82%'
        : p.stage === 'extract' ? '92%'
        : p.stage === 'done' ? '100%' : '8%';
      if (p.stage === 'done') setTimeout(() => { row.hidden = true; }, 1200);
    });
  }

  // ---------------------------------------------------------------------
  // servers
  // ---------------------------------------------------------------------
  async function loadServers(force = false) {
    state.loading = true;
    renderServers();
    let payload = null;

    if (isElectron) {
      payload = await window.xmp.servers.fetch();
    } else if (window.XMP_DEMO) {
      payload = { ok: true, list: window.XMP_DEMO, count: window.XMP_DEMO.length, demo: true, cached: false };
    }

    if (payload && payload.ok) {
      state.servers = payload.list || [];
      state.loading = false;
      setStatus(payload.demo ? 'حالت پیش‌نمایش (داده نمونه)' : 'لیست سرورها به‌روز شد');
      renderAll();
      if (payload.stale) toast('اتصال به مستر سرور برقرار نشد؛ از لیست ذخیره‌شده استفاده شد.', 'bad');
    } else {
      state.loading = false;
      setStatus('خطا در دریافت لیست سرورها');
      renderServers();
      toast('دریافت لیست سرورها ناموفق بود. اتصال اینترنت را بررسی کن.', 'bad');
    }
    if (force) refreshLivePings();
  }

  async function refreshLivePings() {
    if (!isElectron || !state.servers.length) return;
    const slice = state.servers.slice(0, 40);
    try {
      const pings = await window.xmp.servers.ping(slice);
      let updated = 0;
      slice.forEach((s, i) => {
        if (pings[i]) {
          s.live = pings[i];
          if (pings[i].players != null) s.players = pings[i].players;
          if (pings[i].maxPlayers) s.maxPlayers = pings[i].maxPlayers;
          if (pings[i].version) s.version = pings[i].version;
          updated += 1;
        }
      });
      if (updated) {
        setStatus(`${fa(updated)} سرور به‌صورت زنده بررسی شد`);
        renderAll();
      }
    } catch (_) { /* stay on cached data */ }
  }

  function matchesFilter(s) {
    if (state.filter === 'room' && !(s.players < s.maxPlayers)) return false;
    if (state.filter === 'open' && s.passworded) return false;
    if (state.filter === 'fav' && !state.favorites.some((f) => f.ip === s.ip && f.port === s.port)) return false;
    if (state.query) {
      const q = state.query.trim().toLowerCase();
      const hay = `${s.name} ${s.ip} ${s.port} ${s.live?.gametype || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // renderers
  // ---------------------------------------------------------------------
  function serverCard(s) {
    const [solid, tint] = tintFor(s.name, s.ip);
    const pct = s.maxPlayers ? clamp((s.players / s.maxPlayers) * 100, 2, 100) : 0;
    const ping = estimatePing(s);
    const card = el('button', { className: 'scard', type: 'button' });
    card.style.setProperty('--tint', tint);
    card.style.setProperty('--tint-solid', solid);
    card.innerHTML = `
      <div class="scard__top">
        <div class="scard__glyph">${escapeHtml(initials(s.name))}</div>
        <div class="scard__name">${escapeHtml(s.name)}</div>
      </div>
      <div class="scard__meta">
        <span class="badge ${s.passworded ? 'badge--warn' : 'badge--muted'}" style="height:19px;font-size:10px">
          ${s.passworded ? 'رمزدار' : 'آزاد'}
        </span>
        <span class="badge badge--muted" style="height:19px;font-size:10px">v${escapeHtml(s.version || '1.7')}</span>
      </div>
      <div class="scard__bar"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="scard__foot">
        <span class="ping ping--${pingClass(ping)}"><i></i>${fa(ping)}ms</span>
        <span class="num" style="font-size:12px">${fa(s.players)}<span style="color:var(--dim);font-weight:500"> / ${fa(s.maxPlayers)}</span></span>
      </div>`;
    card.addEventListener('click', () => openDrawer(s));
    return card;
  }

  function serverRow(s, compact = false) {
    const [solid] = tintFor(s.name, s.ip);
    const row = el('div', { className: 'trow' });
    if (state.selected && state.selected.ip === s.ip && state.selected.port === s.port) row.classList.add('is-active');
    const pct = s.maxPlayers ? clamp((s.players / s.maxPlayers) * 100, 2, 100) : 0;
    const ping = estimatePing(s);
    const isFav = state.favorites.some((f) => f.ip === s.ip && f.port === s.port);
    row.innerHTML = `
      <div class="trow__main">
        <div class="trow__glyph" style="--tint-solid:${solid}">${escapeHtml(initials(s.name))}</div>
        <div class="trow__title">
          <div class="trow__name">${escapeHtml(s.name)} ${isFav ? '<span style="color:var(--accent-1)">★</span>' : ''}</div>
          <div class="trow__sub">
            <span dir="ltr">${escapeHtml(s.ip)}:${escapeHtml(String(s.port))}</span>
            ${s.live?.gametype ? `<span>·</span><span>${escapeHtml(String(s.live.gametype).slice(0, 22))}</span>` : ''}
            ${s.passworded ? '<span>·</span><span>رمزدار</span>' : ''}
          </div>
        </div>
      </div>
      <div class="trow__players">
        <span>${fa(s.players)}</span>
        <span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span>
        <span class="cap">${fa(s.maxPlayers)}</span>
      </div>
      <div><span class="ping ping--${pingClass(ping)}"><i></i>${fa(ping)} ms</span></div>
      <div><span class="badge badge--muted badge--mono">v${escapeHtml(s.version || '1.7')}</span></div>
      <div class="trow__act">
        <button class="row-join" title="اتصال">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L19 12 8 5.2Z"/></svg>
        </button>
      </div>`;
    row.addEventListener('click', (e) => {
      const join = e.target.closest('.row-join');
      if (join) { e.stopPropagation(); launchGame(s); return; }
      openDrawer(s);
    });
    return row;
  }

  function skeletonTable(rows = 7) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { className: 'thead' },
      '<div>سرور</div><div>بازیکن</div><div>پینگ</div><div>نسخه</div><div></div>'));
    for (let i = 0; i < rows; i += 1) wrap.appendChild(el('div', { className: 'skel' }));
    return wrap;
  }

  function emptyState(title, text) {
    return el('div', { className: 'empty' },
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
         <rect x="3.5" y="4" width="17" height="6" rx="2"/><rect x="3.5" y="14" width="17" height="6" rx="2"/>
         <path d="M7 7h.01M7 17h.01"/></svg>
       <h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p>`);
  }

  function renderServers() {
    const table = $('#serverTable');
    const quick = $('#quickTable');
    if (state.loading) {
      table.replaceChildren(skeletonTable());
      quick.replaceChildren(skeletonTable(4));
      return;
    }

    const filtered = state.servers.filter(matchesFilter);

    // main table
    table.replaceChildren();
    if (!filtered.length) {
      table.appendChild(emptyState('سروری پیدا نشد', 'فیلتر یا عبارت جستجو را تغییر بده.'));
    } else {
      table.appendChild(el('div', { className: 'thead' },
        '<div>سرور</div><div>بازیکن</div><div>پینگ</div><div>نسخه</div><div></div>'));
      filtered.slice(0, state.listLimit).forEach((s) => table.appendChild(serverRow(s)));
    }
    const more = $('#loadMore');
    more.hidden = filtered.length <= state.listLimit;
    more.textContent = `نمایش بیشتر (${fa(Math.min(120, filtered.length - state.listLimit))} سرور)`;

    // quick access (home)
    quick.replaceChildren();
    const recent = state.prefs.lastServer;
    const favServers = state.servers.filter((s) => state.favorites.some((f) => f.ip === s.ip && f.port === s.port));
    const picks = [];
    if (recent) {
      const match = state.servers.find((s) => s.ip === recent.ip && s.port === recent.port);
      if (match) picks.push(match);
    }
    favServers.slice(0, 4).forEach((s) => { if (!picks.includes(s)) picks.push(s); });
    state.servers.slice(0, 6).forEach((s) => { if (picks.length < 5 && !picks.includes(s)) picks.push(s); });

    if (!picks.length) {
      quick.appendChild(emptyState('هنوز چیزی اینجا نیست', 'یک سرور را نشان کن تا سریع به آن برگردی.'));
    } else {
      quick.appendChild(el('div', { className: 'thead' },
        '<div>سرور</div><div>بازیکن</div><div>پینگ</div><div>نسخه</div><div></div>'));
      picks.forEach((s) => quick.appendChild(serverRow(s)));
    }
  }

  function renderFavorites() {
    const table = $('#favTable');
    const favs = state.servers.filter((s) => state.favorites.some((f) => f.ip === s.ip && f.port === s.port));
    const offline = state.favorites.filter((f) => !state.servers.some((s) => s.ip === f.ip && s.port === f.port));
    $('#favCount').textContent = `${fa(state.favorites.length)} سرور`;

    table.replaceChildren();
    if (!favs.length && !offline.length) {
      table.appendChild(emptyState('لیست نشان‌شده‌ها خالی است', 'روی هر سرور بزن و «نشان‌کردن» را انتخاب کن.'));
      return;
    }
    table.appendChild(el('div', { className: 'thead' },
      '<div>سرور</div><div>بازیکن</div><div>پینگ</div><div>نسخه</div><div></div>'));
    favs.forEach((s) => table.appendChild(serverRow(s)));
    offline.forEach((f) => {
      table.appendChild(serverRow({
        name: f.name || 'Unnamed server', ip: f.ip, port: f.port, players: 0, maxPlayers: 0, version: '—', passworded: false, live: null,
      }));
    });
  }

  function renderStats() {
    const total = state.servers.length;
    const players = state.servers.reduce((acc, s) => acc + (s.players || 0), 0);
    $('#statServers').textContent = total ? faCompact(total) : '—';
    $('#statPlayers').textContent = players ? faCompact(players) : '—';
    const last = state.prefs.lastServer;
    $('#statLast').textContent = last ? last.name : '—';
    $('#statusServers').textContent = `${fa(total)} سرور`;
  }

  function renderTopCards() {
    const host = $('#topCards');
    if (state.loading) {
      host.replaceChildren(...Array.from({ length: 4 }, () => {
        const c = el('div', { className: 'scard skel', style: 'height:168px;margin:0' });
        return c;
      }));
      return;
    }
    const top = [...state.servers].sort((a, b) => {
      const fa1 = state.favorites.some((f) => f.ip === a.ip && f.port === a.port);
      const fb = state.favorites.some((f) => f.ip === b.ip && f.port === b.port);
      if (fa1 !== fb) return fa1 ? -1 : 1;
      return b.players - a.players;
    }).slice(0, 6);
    if (!top.length) {
      host.replaceChildren(emptyState('سروری نیست', 'اتصال اینترنت را بررسی و دوباره تلاش کن.'));
      return;
    }
    host.replaceChildren(...top.map(serverCard));
  }

  function renderAll() {
    renderTopCards();
    renderServers();
    renderFavorites();
    renderStats();
  }

  // ---------------------------------------------------------------------
  // drawer
  // ---------------------------------------------------------------------
  function openDrawer(server) {
    state.selected = server;
    const drawer = $('#drawer');
    const [solid, tint] = tintFor(server.name, server.ip);
    drawer.style.setProperty('--tint', tint);
    $('#drawerTitle').textContent = server.name;
    const isFav = state.favorites.some((f) => f.ip === server.ip && f.port === server.port);
    const ping = estimatePing(server);
    const live = server.live || null;

    $('#drawerTags').innerHTML = `
      <span class="badge ${server.passworded ? 'badge--warn' : 'badge--ok'}">${server.passworded ? 'رمزدار' : 'بدون رمز'}</span>
      <span class="badge badge--muted badge--mono">v${escapeHtml(server.version || '1.7')}</span>
      ${live && live.gametype ? `<span class="badge badge--muted">${escapeHtml(String(live.gametype).slice(0, 26))}</span>` : ''}
      ${live ? '<span class="badge badge--ember">زنده</span>' : ''}`;

    const rows = [
      ['آدرس', `<span dir="ltr" class="mono">${escapeHtml(server.ip)}:${escapeHtml(String(server.port))}</span>`],
      ['بازیکن', `${fa(server.players)} از ${fa(server.maxPlayers)}`],
      ['ظرفیت آزاد', `${fa(Math.max(0, (server.maxPlayers || 0) - (server.players || 0)))} نفر`],
      ['پینگ', `<span class="ping ping--${pingClass(ping)}"><i></i>${fa(ping)} ms</span>`],
      ['نسخه', escapeHtml(server.version || '1.7')],
    ];
    if (live && live.map) rows.push(['نقشه', escapeHtml(live.map)]);
    if (live && live.gamePort) rows.push(['پورت بازی', `<span dir="ltr" class="mono">${escapeHtml(live.gamePort)}</span>`]);

    let html = '<dl class="kv">';
    rows.forEach(([k, v]) => { html += `<dt>${k}</dt><dd>${v}</dd>`; });
    html += '</dl>';

    if (live && live.rules && Object.keys(live.rules).length) {
      const entries = Object.entries(live.rules).slice(0, 18);
      html += '<div class="mini-title">اطلاعات سرور (ASE)</div><dl class="kv">';
      entries.forEach(([k, v]) => {
        html += `<dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(String(v).slice(0, 60))}</dd>`;
      });
      html += '</dl>';
    } else {
      html += `<div class="mini-title">اطلاعات زنده</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.9">
          ${isElectron ? 'برای دریافت اطلاعات دقیق (نقشه، گیم‌مود، قوانین) دکمه «پینگ» را بزن.' : 'در حالت پیش‌نمایش، پاسخ زنده سرور خوانده نمی‌شود.'}
        </div>`;
    }

    if (server.passworded) {
      html += `<div class="mini-title">رمز سرور</div>
        <input class="field" id="drawerPassword" type="password" placeholder="رمز عبور (اختیاری)" style="width:100%" />`;
    }

    $('#drawerBody').innerHTML = html;
    $('#drawerBody').scrollTop = 0;
    $('#drawerFav').querySelector('span').textContent = isFav ? 'حذف نشان' : 'نشان‌کردن';
    $('#drawerFav').classList.toggle('btn--primary', false);

    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    renderServers();
  }

  function closeDrawer() {
    const drawer = $('#drawer');
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    state.selected = null;
    renderServers();
  }

  // ---------------------------------------------------------------------
  // launch flow
  // ---------------------------------------------------------------------
  const LAUNCH_STEPS = [
    'بررسی مسیر نصب موتور بازی',
    'آماده‌سازی پروفایل بازیکن',
    'ارسال درخواست اتصال به سرور',
    'اجرای کلاینت بازی',
  ];

  function launchOverlay(show, { title, sub } = {}) {
    const ov = $('#launchOverlay');
    ov.classList.toggle('is-open', show);
    if (title) $('#launchTitle').textContent = title;
    if (sub) $('#launchSub').textContent = sub;
    if (show) {
      $('#launchBar').style.width = '6%';
      const steps = $('#launchSteps');
      steps.replaceChildren(...LAUNCH_STEPS.map((s) => el('div', { className: 'lstep' }, `<i></i><span>${s}</span>`)));
    }
  }

  function markStep(index, progress) {
    $$('#launchSteps .lstep').forEach((node, i) => {
      node.classList.toggle('is-done', i < index);
      node.classList.toggle('is-now', i === index);
    });
    if (progress != null) $('#launchBar').style.width = `${progress}%`;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function launchGame(server, { password } = {}) {
    state.lastLaunchCancelled = false;
    launchOverlay(true, {
      title: server ? 'در حال اتصال…' : 'در حال اجرای بازی…',
      sub: server ? server.name : 'بدون سرور مشخص',
    });

    markStep(0, 14);
    await wait(320);
    if (state.lastLaunchCancelled) return;

    if (!isElectron) {
      markStep(1, 40); await wait(360);
      markStep(2, 68); await wait(360);
      markStep(3, 92); await wait(420);
      launchOverlay(true, { title: 'حالت پیش‌نمایش', sub: 'برای اتصال واقعی، نسخه نصب‌شده را اجرا کن.' });
      await wait(700);
      launchOverlay(false);
      return;
    }

    const hasClient = state.client?.installed;
    if (!hasClient && !state.prefs.mtaPath) {
      await detectGame(true);
      if (!state.prefs.mtaPath) {
        launchOverlay(false);
        toast('اول کلاینت XMP را دانلود کن یا مسیر موتور بازی را در تنظیمات مشخص کن.', 'bad');
        openPage('settings');
        $$('#snav button').find((b) => b.dataset.panel === 'game')?.click();
        return;
      }
    }

    markStep(1, 38);
    await wait(260);

    markStep(2, 64);
    const res = await window.xmp.game.launch({
      path: state.prefs.mtaPath,
      nickname: state.prefs.nickname,
      password,
      server: server ? { ip: server.ip, port: server.port, name: server.name } : null,
    });
    if (!res.ok) {
      launchOverlay(false);
      toast(res.errorFa || 'اجرای بازی ناموفق بود.', 'bad');
      return;
    }

    markStep(3, 92);
    await wait(420);
    $('#launchBar').style.width = '100%';
    launchOverlay(true, { title: 'بازی در حال اجراست', sub: 'XMP کارش را انجام داد. خوش بگذره!' });
    await wait(900);
    launchOverlay(false);
    setStatus(server ? `اتصال به ${server.name}` : 'بازی اجرا شد');
    renderAll();
  }

  // ---------------------------------------------------------------------
  // navigation
  // ---------------------------------------------------------------------
  function openPage(page) {
    if (!PAGE_META[page]) return;
    state.page = page;
    $$('.page').forEach((p) => p.classList.toggle('is-active', p.dataset.page === page));
    $$('#nav .nav__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.page === page));
    const [title, eyebrow] = PAGE_META[page];
    $('#pageTitle').textContent = title;
    $('#pageEyebrow').textContent = eyebrow;
    $('#view').scrollTop = 0;
    if (page === 'favorites') renderFavorites();
  }

  function setStatus(text) {
    $('#statusText').textContent = text;
  }

  // ---------------------------------------------------------------------
  // wiring
  // ---------------------------------------------------------------------
  function debounce(fn, ms = 180) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function wire() {
    $$('#nav .nav__btn').forEach((b) => b.addEventListener('click', () => openPage(b.dataset.page)));
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => openPage(b.dataset.goto)));

    // window controls
    const wc = window.xmp?.window;
    if (wc) {
      $('#wMin').addEventListener('click', () => wc.minimize());
      $('#wMax').addEventListener('click', () => wc.maximize());
      $('#wClose').addEventListener('click', () => wc.close());
    } else {
      $$('.wctl').forEach((n) => { n.style.opacity = '0.35'; n.style.pointerEvents = 'none'; });
    }

    // hero actions
    $('#heroPlay').addEventListener('click', () => {
      const last = state.prefs.lastServer;
      if (last) {
        const s = state.servers.find((x) => x.ip === last.ip && x.port === last.port) || last;
        launchGame(s);
      } else {
        launchGame(null);
      }
    });
    $('#heroBrowse').addEventListener('click', () => openPage('servers'));

    // search
    const applyQuery = debounce((value) => {
      state.query = value;
      state.listLimit = 120;
      renderServers();
      if (state.page !== 'servers') openPage('servers');
    }, 160);
    $('#globalSearch').addEventListener('input', (e) => {
      $('#serverSearch').value = e.target.value;
      applyQuery(e.target.value);
    });
    $('#serverSearch').addEventListener('input', (e) => {
      $('#globalSearch').value = e.target.value;
      applyQuery(e.target.value);
    });

    // filters
    $$('.chip[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        $$('.chip[data-filter]').forEach((c) => c.classList.toggle('is-active', c === chip));
        renderServers();
      });
    });

    $('#refreshServers').addEventListener('click', async () => {
      setStatus('در حال به‌روزرسانی…');
      if (isElectron) await window.xmp.prefs.set({ serverCache: null });
      await loadServers(true);
      toast('لیست سرورها به‌روز شد.', 'ok', 2400);
    });

    $('#loadMore').addEventListener('click', () => {
      state.listLimit += 120;
      renderServers();
    });

    // drawer
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerJoin').addEventListener('click', () => {
      const pwField = $('#drawerPassword');
      const pw = pwField ? pwField.value : undefined;
      const server = state.selected;
      closeDrawer();
      if (server) launchGame(server, { password: pw });
    });
    $('#drawerFav').addEventListener('click', async () => {
      const s = state.selected;
      if (!s) return;
      const exists = state.favorites.some((f) => f.ip === s.ip && f.port === s.port);
      const next = exists
        ? state.favorites.filter((f) => !(f.ip === s.ip && f.port === s.port))
        : [...state.favorites, { ip: s.ip, port: s.port, name: s.name }];
      await savePrefs({ favorites: next });
      toast(exists ? 'از لیست نشان‌شده‌ها حذف شد.' : 'به لیست نشان‌شده‌ها اضافه شد.', 'ok', 2200);
      openDrawer(s);
      renderFavorites();
    });
    $('#drawerPing').addEventListener('click', async () => {
      const s = state.selected;
      if (!s) return;
      if (!isElectron) { toast('پینگ زنده فقط در نسخه نصبی فعال است.', 'info'); return; }
      toast('در حال پرس‌وجوی سرور…', 'info', 1600);
      const live = await window.xmp.servers.pingOne(s);
      if (!live) { toast('سرور به پرس‌وجوی ASE پاسخ نداد.', 'bad'); return; }
      s.live = live;
      s.players = live.players ?? s.players;
      s.maxPlayers = live.maxPlayers || s.maxPlayers;
      openDrawer(s);
      toast(`پاسخ در ${fa(live.ping)} میلی‌ثانیه`, 'ok', 2400);
    });

    // settings switches
    $$('.switch[data-pref]').forEach((sw) => {
      sw.addEventListener('click', async () => {
        const next = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(next));
        await savePrefs({ [sw.dataset.pref]: next });
        if (sw.dataset.pref === 'autoUpdateServers' && next) startAutoRefresh();
      });
    });

    // accent swatches
    $$('.swatch').forEach((s) => {
      s.addEventListener('click', async () => {
        await savePrefs({ accent: s.dataset.accent });
      });
    });

    // settings nav
    $$('#snav button').forEach((b) => {
      b.addEventListener('click', () => {
        $$('#snav button').forEach((x) => x.classList.toggle('is-active', x === b));
        $$('.spanel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === b.dataset.panel));
      });
    });

    // nickname
    $('#setNickname').addEventListener('change', (e) => {
      savePrefs({ nickname: e.target.value.trim().slice(0, 24) });
    });

    // game path
    $('#btnDetect').addEventListener('click', () => detectGame(false));
    $('#btnBrowse').addEventListener('click', async () => {
      if (!isElectron) { toast('انتخاب پوشه فقط در نسخه نصبی فعال است.', 'info'); return; }
      const res = await window.xmp.game.browse();
      if (!res) return;
      if (res.ok) {
        await savePrefs({ mtaPath: res.path });
        $('#mtaPathLabel').textContent = res.path;
        updateGameStatus(res.path);
        toast('مسیر بازی ذخیره شد.', 'ok');
      } else {
        toast(res.errorFa || 'این پوشه معتبر نیست.', 'bad');
      }
    });
    // GTA path
    $('#btnDetectGta').addEventListener('click', () => detectGta(false));
    $('#btnBrowseGta').addEventListener('click', async () => {
      if (!isElectron) { toast('انتخاب پوشه فقط در نسخه نصبی فعال است.', 'info'); return; }
      const res = await window.xmp.game.browseGta();
      if (!res) return;
      if (res.ok) {
        await savePrefs({ gtaPath: res.path });
        $('#gtaPathLabel').textContent = res.path;
        updateGtaStatus(res.path);
        toast('مسیر GTA San Andreas ذخیره شد.', 'ok');
      } else {
        toast(res.errorFa || 'این پوشه معتبر نیست.', 'bad');
      }
    });

    // XMP client manager
    wireClientProgress();
    $('#btnClientInstall').addEventListener('click', async () => {
      if (!isElectron) { toast('دانلود کلاینت فقط در نسخه نصب‌شده فعال است.', 'info'); return; }
      const btn = $('#btnClientInstall');
      btn.disabled = true;
      $('#clientProgressRow').hidden = false;
      const res = await window.xmp.client.install();
      btn.disabled = false;
      await refreshClientStatus();
      if (res.ok) toast(`کلاینت XMP نصب شد${res.version ? ' · ' + res.version : ''}.`, 'ok');
      else { $('#clientProgressRow').hidden = true; toast(res.errorFa || 'دانلود کلاینت ناموفق بود.', 'bad'); }
    });
    $('#btnClientCheck').addEventListener('click', async () => {
      if (!isElectron) { toast('بررسی کلاینت فقط در نسخه نصب‌شده فعال است.', 'info'); return; }
      const res = await window.xmp.client.check();
      if (!res.ok) { toast('بررسی به‌روزرسانی کلاینت ناموفق بود.', 'bad'); return; }
      toast(res.updateAvailable ? `نسخه جدید کلاینت موجود است: ${res.latestVersion}` : 'کلاینت به‌روز است.', res.updateAvailable ? 'info' : 'ok');
    });
    $('#btnClientRemove').addEventListener('click', async () => {
      if (!isElectron) return;
      await window.xmp.client.remove();
      await refreshClientStatus();
      toast('کلاینت XMP حذف شد.', 'info');
    });

    $('#btnOpenFolder').addEventListener('click', async () => {
      if (!isElectron || !state.prefs.mtaPath) { toast('اول مسیر بازی را تنظیم کن.', 'bad'); return; }
      await window.xmp.game.openFolder();
    });

    // about
    $('#btnUpdate').addEventListener('click', async () => {
      const hint = $('#updateHint');
      hint.textContent = 'در حال بررسی…';
      if (!isElectron) { hint.textContent = 'در حالت پیش‌نمایش بررسی نمی‌شود.'; return; }
      const res = await window.xmp.update.check();
      if (!res.ok) { hint.textContent = 'بررسی ناموفق بود (اتصال یا مخزن).'; return; }
      hint.textContent = res.newer ? `نسخه جدید موجود است: ${res.tag}` : 'نسخه‌ات به‌روز است.';
      if (res.newer) toast(`نسخه جدید ${res.tag} موجود است.`, 'ok');
    });
    $('#btnGithub').addEventListener('click', () => {
      if (isElectron) window.xmp.app.open('https://github.com');
      toast('آدرس مخزن پس از انتشار عمومی فعال می‌شود.', 'info');
    });

    // overlay cancel
    $('#launchCancel').addEventListener('click', () => {
      state.lastLaunchCancelled = true;
      launchOverlay(false);
      toast('اجرای بازی لغو شد.', 'info', 2000);
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#globalSearch').focus();
        $('#globalSearch').select();
      }
      if (e.key === 'Escape') {
        closeDrawer();
        launchOverlay(false);
        state.lastLaunchCancelled = true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); openPage('home'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); openPage('servers'); }
      if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); openPage('favorites'); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openPage('settings'); }
    });
  }

  // ---------------------------------------------------------------------
  // auto refresh + status ticker
  // ---------------------------------------------------------------------
  let autoTimer = null;
  function startAutoRefresh() {
    if (autoTimer) clearInterval(autoTimer);
    if (!state.prefs.autoUpdateServers) return;
    autoTimer = setInterval(() => {
      if (document.hidden) return;
      loadServers(false);
    }, 90 * 1000);
  }

  function startTicker() {
    setInterval(() => {
      if (!state.prefs.showFps) { $('#statusMemory').textContent = ''; return; }
      const mem = performance.memory
        ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`
        : '';
      $('#statusMemory').textContent = mem ? `RAM رابط: ${mem}` : '';
    }, 4000);
  }

  // ---------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------
  async function boot() {
    wire();
    await loadPrefs();

    if (isElectron) {
      state.info = await window.xmp.app.info();
      $('#statusVersion').textContent = state.info.version;
      $('#aboutVersion').textContent = `نسخه ${state.info.version}`;
      $('#aboutEngine').textContent = `Electron ${state.info.electron} · Chromium ${state.info.chrome}`;
      $('#aboutSystem').textContent = `${state.info.platform} · ${state.info.arch} · ${state.info.cpus} هسته · ${state.info.ramGB}GB RAM`;
    } else {
      $('#aboutEngine').textContent = 'حالت پیش‌نمایش مرورگر';
      $('#aboutSystem').textContent = navigator.platform || '—';
    }

    const hints = ['در حال آماده‌سازی لانچر…', 'بارگذاری رابط…', 'اتصال به مستر سرور…', 'آماده.'];
    const bar = $('#bootBar');
    for (let i = 0; i < hints.length; i += 1) {
      $('#bootHint').textContent = hints[i];
      bar.style.width = `${18 + i * 26}%`;
      await wait(220);
    }

    await Promise.all([loadServers(false), detectGame(true), detectGta(true), refreshClientStatus()]);

    renderAll();
    $('#boot').classList.add('gone');
    $('#shell').classList.add('ready');
    setTimeout(() => { $('#boot').style.display = 'none'; }, 600);

    setStatus(isElectron ? 'آماده' : 'حالت پیش‌نمایش (بدون Electron)');
    startAutoRefresh();
    startTicker();

    if (state.prefs.lastPlayedAt) {
      setStatus(`آخرین بازی: ${relativeTime(state.prefs.lastPlayedAt)}`);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
