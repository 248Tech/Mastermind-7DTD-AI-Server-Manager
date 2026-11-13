/* Mastermind interactive demo — static, in-memory, no network. */
(function () {
  'use strict';
  const D = JSON.parse(JSON.stringify(window.MM_DATA));
  const DEMO_EMAIL = 'demo.admin@mastermind.demo';
  const DEMO_PASS = 'DemoAdmin!2026';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const state = { server: 'srv-1', q: '', tab: {}, timers: [] };
  const srv = () => D.servers.find((s) => s.id === state.server) || D.servers[0];
  const srvName = (id) => (D.servers.find((s) => s.id === id) || {}).name || id;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pill = (t, k) => `<span class="pill ${k}">${esc(t)}</span>`;
  const statusPill = (s) => pill(s, { online: 'ok', active: 'ok', succeeded: 'ok', offline: 'bad', failed: 'bad', quarantined: 'warn', pending: 'warn', running: 'info', queued: 'info' }[s] || 'mute');

  function toast(msg) {
    let box = $('.toast');
    if (!box) { box = document.createElement('div'); box.className = 'toast'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const d = document.createElement('div'); d.textContent = msg; box.appendChild(d);
    setTimeout(() => d.remove(), 3800);
  }
  function modal(html, onMount) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', k); } });
    document.body.appendChild(bg);
    $$('[data-close]', bg).forEach((b) => b.addEventListener('click', () => bg.remove()));
    if (onMount) onMount(bg);
    return bg;
  }
  function confirmBox(title, body, okLabel, fn, danger) {
    modal(`<h2>${esc(title)}</h2><p style="color:var(--soft);line-height:1.5">${body}</p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${esc(okLabel)}</button></div>`, (bg) => {
      $('#ok', bg).addEventListener('click', () => { bg.remove(); fn(); });
    });
  }

  /* ---- jobs: simulated queue with live progress ---- */
  let jobSeq = 1043;
  function queueJob(type, serverId, out, opts) {
    const job = { id: 'j-' + jobSeq++, type, server: serverId, by: DEMO_EMAIL.split('@')[0], status: 'queued', at: Date.now(), out: 'Waiting for agent…' };
    D.jobs.unshift(job);
    toast(`Job ${job.id} queued: ${type}`);
    setTimeout(() => { job.status = 'running'; job.out = 'Agent picked up job…'; refreshIf('jobs'); }, 700);
    setTimeout(() => {
      job.status = 'succeeded'; job.out = out;
      if (opts && opts.done) opts.done();
      toast(`Job ${job.id} succeeded`);
      refreshIf('jobs'); refreshIf('dashboard'); refreshIf('players'); refreshIf('mods'); refreshIf('saves');
    }, 2200);
    return job;
  }
  function refreshIf(name) { if (current() === name) render(); }

  /* ---- layout ---- */
  const NAV = [
    ['Overview', [['dashboard', 'Dashboard', '◈'], ['health', 'Health', '♥']]],
    ['Server', [['players', 'Players', '♟'], ['mods', 'Mods', '◇'], ['poi-search', 'POI Search', '⌕'], ['saves', 'Saves', '▣'], ['logs', 'Logs & Console', '≡'], ['chat', 'Chat', '✉'], ['live-map', 'Live Map', '⌖'], ['donator-shop', 'Donator Shop', '♡']]],
    ['Automation', [['jobs', 'Jobs', '⚡'], ['schedules', 'Schedules', '◷'], ['alerts', 'Alerts', '◎'], ['triggers', 'Triggers', '✦']]],
    ['System', [['hosts', 'Hosts', '⬡'], ['accounts', 'Accounts', '♙'], ['security', 'Security', '◆'], ['settings', 'Settings', '⚙']]],
  ];
  const current = () => (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];

  function shell(inner, page) {
    return `<div class="shell">
    <button class="menu" aria-label="Toggle navigation" id="menu">☰</button>
    <nav class="nav" id="nav" aria-label="Primary">
      <div class="brand"><img src="../assets/favicon.png" alt=""><div><b>Mastermind</b><span>7DTD Control Plane · demo</span></div></div>
      <div class="srvsel"><select id="srvsel" aria-label="Active server">${D.servers.map((s) => `<option value="${s.id}" ${s.id === state.server ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="navscroll">${NAV.map(([g, items]) => `<div class="sect">${g}</div>` + items.map(([id, label, ic]) => `<a class="item ${id === page ? 'on' : ''}" href="#/${id}"><i>${ic}</i>${label}</a>`).join('')).join('')}</div>
      <div class="navfoot">
        <a class="portal" href="#/player-portal">⌖ View Player Portal</a>
        <div class="user"><span class="avatar">D</span><div><div style="color:var(--text);font-weight:600">demo.admin</div><div>Administrator</div></div></div>
        <button class="btn sm" id="logout">↪ Sign out</button>
      </div>
    </nav>
    <div class="main">
      <div class="banner"><b>Interactive demo</b><span>Mock data only — nothing here touches a real server. Actions work in-browser and reset on reload.</span><span class="sp"></span><a href="https://github.com/248Tech/Mastermind-7DTD-AI-Server-Manager" target="_blank" rel="noopener">View source ↗</a><a href="../">← Overview</a></div>
      <main class="content" id="page">${inner}</main>
    </div></div>`;
  }
  const head = (t, d) => `<h1 class="title">${esc(t)}</h1><p class="lede">${d}</p>`;

  /* ---- pages ---- */
  const pages = {};

  pages.dashboard = () => {
    const online = D.players.filter((p) => p.online).length;
    const s = srv();
    return head('Dashboard', 'Fleet overview across every registered server and host.') + `
    <div class="grid g4" style="margin-bottom:12px">
      <div class="card stat"><div class="l">Servers online</div><div class="v">${D.servers.filter((x) => x.status === 'online').length}/${D.servers.length}</div><div class="d">1 offline (test)</div></div>
      <div class="card stat"><div class="l">Players online</div><div class="v">${online}</div><div class="d">peak 21 today</div></div>
      <div class="card stat"><div class="l">Jobs (24h)</div><div class="v">${D.jobs.length + 36}</div><div class="d">100% success</div></div>
      <div class="card stat"><div class="l">Agent latency</div><div class="v">18<small style="font-size:.9rem"> ms</small></div><div class="d">all hosts reachable</div></div>
    </div>
    <h3 style="margin:18px 0 8px;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--soft)">Servers</h3>
    <div class="grid g3">${D.servers.map((x) => `
      <div class="card"><div class="row" style="justify-content:space-between"><b>${esc(x.name)}</b>${statusPill(x.status)}</div>
      <div style="color:var(--muted);font-size:.78rem;margin:4px 0 10px">${esc(x.world)} · ${esc(x.host)} · ${esc(x.version)}</div>
      <div class="row" style="gap:18px;font-size:.8rem;color:var(--soft)"><span>👥 ${x.players}/${x.max}</span><span>Day ${x.day}</span><span>${x.fps ? x.fps + ' FPS' : '—'}</span></div>
      <div class="bar" style="margin:10px 0"><i style="width:${(x.players / x.max) * 100}%"></i></div>
      <div class="row"><button class="btn sm" data-manage="${x.id}">Manage</button>${x.status === 'online' ? `<button class="btn sm" data-act="safe-restart" data-id="${x.id}">Safe restart</button>` : `<button class="btn sm primary" data-act="start" data-id="${x.id}">Start</button>`}</div></div>`).join('')}
    </div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>Recent activity — ${esc(s.name)}</h3><ul class="steps">${D.jobs.slice(0, 5).map((j) => `<li class="${j.status === 'succeeded' ? 'done' : 'run'}">${j.status === 'succeeded' ? '✔' : '…'} <span class="mono">${j.id}</span> ${esc(j.type)} <span style="color:var(--muted)">by ${esc(j.by)}</span></li>`).join('')}</ul></div>
      <div class="card"><h3>Quick actions</h3><div class="row"><button class="btn" data-act="backup" data-id="${s.id}">Run backup</button><button class="btn" data-act="safe-restart" data-id="${s.id}">Safe restart</button><button class="btn" data-act="skip-reboot" data-id="${s.id}">Skip next auto reboot</button><a class="btn" href="#/live-map">Open live map</a></div>
      <p style="color:var(--muted);font-size:.78rem;margin:12px 0 0;line-height:1.5">Safe restart runs a countdown, saves the world, takes a backup, kicks players and verifies the restart — all queued through the job pipeline and attributed to the initiating account.</p></div>
    </div>`;
  };
  pages.dashboard.bind = () => {
    $$('[data-manage]').forEach((b) => b.addEventListener('click', () => { state.server = b.dataset.manage; location.hash = '#/logs'; }));
    bindActions();
  };

  function bindActions() {
    $$('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act, id = b.dataset.id || state.server, s = D.servers.find((x) => x.id === id);
      if (a === 'safe-restart') return confirmBox('Safe restart ' + s.name, 'Players receive a 5-minute countdown, the world is saved and backed up, remaining players are kicked, and the server restarts with verification.', 'Queue safe restart', () => safeRestart(s));
      if (a === 'start') return queueJob('start', id, 'Server process started, telnet reachable in 41s', { done() { s.status = 'online'; s.players = 0; s.fps = 60; } });
      if (a === 'backup') return queueJob('backup', id, 'Full backup 1.8 GB written, retention pruned 1', { done() { D.saves.unshift({ id: 'b' + Date.now(), server: id, kind: 'Full backup', day: s.day, size: '1.8 GB', at: new Date().toISOString().slice(0, 16).replace('T', ' '), by: 'demo.admin' }); } });
      if (a === 'skip-reboot') return toast('Next scheduled reboot for ' + s.name + ' will be skipped once.');
    }));
  }
  function safeRestart(s) {
    const job = queueJob('safe-restart', s.id, 'Countdown 5m → save → backup → kick verified → restart OK');
    const steps = ['Announcing countdown', 'Saving world', 'Writing backup', 'Kicking players', 'Restarting & verifying'];
    steps.forEach((t, i) => setTimeout(() => { job.out = t + '…'; refreshIf('jobs'); }, 800 + i * 280));
  }

  pages.health = () => {
    const spark = (id, label, val, unit) => `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${label}</h3><b>${val}${unit}</b></div><canvas class="spark" id="${id}" width="400" height="80"></canvas></div>`;
    return head('Health', 'Host-scoped CPU, RAM, disk, agent latency and real 7DTD reachability samples.') + `
    <div class="grid g2">${spark('sp-cpu', 'CPU', 38, '%')}${spark('sp-ram', 'RAM', 11.2, ' GiB')}${spark('sp-disk', 'Disk', 62, '%')}${spark('sp-lat', 'Agent latency', 18, ' ms')}</div>
    <div class="card" style="margin-top:12px"><h3>Stability Safe Restart policy</h3><div class="row" style="gap:24px;font-size:.85rem;color:var(--soft)"><span>Memory limit: <b style="color:var(--text)">16 GiB</b></span><span>Cooldown: <b style="color:var(--text)">6 h</b></span><span>Last trigger: <b style="color:var(--text)">never</b></span></div><p style="color:var(--muted);font-size:.78rem;margin:10px 0 0">When the host memory watcher exceeds the limit, Mastermind queues the normal safe-restart flow and automatically skips the next scheduled reboot.</p></div>`;
  };
  pages.health.bind = () => {
    const draw = (id, base, amp, max) => {
      const c = $('#' + id); if (!c) return; const g = c.getContext('2d'); const w = c.width, h = c.height;
      const pts = Array.from({ length: 48 }, (_, i) => base + Math.sin(i / 5) * amp + rnd(-amp / 2, amp / 2));
      g.clearRect(0, 0, w, h); g.beginPath(); pts.forEach((v, i) => { const x = (i / 47) * w, y = h - (v / max) * h * 0.9 - 4; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = '#818cf8'; g.lineWidth = 2; g.stroke(); g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(99,102,241,.35)'); gr.addColorStop(1, 'rgba(99,102,241,0)'); g.fillStyle = gr; g.fill();
    };
    draw('sp-cpu', 38, 14, 100); draw('sp-ram', 11, 1.2, 16); draw('sp-disk', 62, 1.5, 100); draw('sp-lat', 18, 6, 60);
  };

  pages.players = () => {
    const q = state.q.toLowerCase();
    const rows = D.players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.steam.includes(q));
    return head('Players', 'Identities, playtime, kick and ban controls. Roster polled via Allocs with telnet fallback.') + `
    <div class="toolbar"><input class="in" id="q" placeholder="Search name or SteamID…" value="${esc(state.q)}" aria-label="Search players"><span class="pill info">${D.players.filter((p) => p.online).length} online</span></div>
    <div class="tablewrap"><table><thead><tr><th>Player</th><th>Status</th><th>Lvl</th><th>Kills</th><th>Deaths</th><th>Ping</th><th>Playtime</th><th>Country</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><b>${esc(p.name)}</b> ${p.admin ? pill('admin', 'info') : ''}<div class="mono" style="color:var(--muted);font-size:.68rem">${p.steam}</div></td><td>${p.online ? '<span class="dot ok"></span>online' : '<span class="dot bad"></span>' + esc(p.last)}</td><td>${p.level}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.online ? p.ping + ' ms' : '—'}</td><td>${p.playtime} h</td><td>${p.country}</td>
    <td><div class="row"><button class="btn sm" data-inv="${p.id}">Inventory</button>${p.online ? `<button class="btn sm" data-kick="${p.id}">Kick</button>` : ''}<button class="btn sm danger" data-ban="${p.id}">Ban</button><button class="btn sm" data-adm="${p.id}">${p.admin ? 'Demote' : 'Promote'}</button></div></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No players match.</td></tr>'}
    </tbody></table></div>`;
  };
  pages.players.bind = () => {
    const q = $('#q'); q.addEventListener('input', () => { state.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
    const find = (id) => D.players.find((p) => p.id === id);
    $$('[data-kick]').forEach((b) => b.addEventListener('click', () => { const p = find(b.dataset.kick); confirmBox('Kick ' + p.name, 'Kick this player from the server? The job verifies the player left.', 'Kick player', () => queueJob('kick', state.server, `Kicked ${p.name}; verified absent from roster`, { done() { p.online = false; p.last = 'just now'; } }), true); }));
    $$('[data-ban]').forEach((b) => b.addEventListener('click', () => { const p = find(b.dataset.ban); confirmBox('Ban ' + p.name, 'Adds the SteamID to serveradmin.xml and kicks the player.', 'Ban player', () => queueJob('ban', state.server, `Banned ${p.name}`, { done() { p.online = false; D.players.splice(D.players.indexOf(p), 1); } }), true); }));
    $$('[data-adm]').forEach((b) => b.addEventListener('click', () => { const p = find(b.dataset.adm); queueJob(p.admin ? 'demote' : 'promote', state.server, `${p.name} ${p.admin ? 'demoted' : 'promoted'} via serveradmin.xml`, { done() { p.admin = !p.admin; } }); }));
    $$('[data-inv]').forEach((b) => b.addEventListener('click', () => { const p = find(b.dataset.inv); modal(`<h2>${esc(p.name)} — inventory</h2><p style="color:var(--muted);font-size:.78rem">Allocs <span class="mono">getplayerinventories</span> snapshot (mock)</p><div class="tablewrap"><table><tbody>${[['Steel Pickaxe', 1, 'Q4'], ['9mm Pistol', 1, 'Q3'], ['9mm Ammo', 128, '—'], ['Canned Stew', 6, '—'], ['Medical Bandage', 9, '—'], ['Wood', 480, '—']].map((r) => `<tr><td>${r[0]}</td><td>×${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Close</button></div>`); }));
  };

  pages.mods = () => {
    const tab = state.tab.mods || 'all';
    const list = D.mods.filter((m) => tab === 'all' || m.status === tab);
    const n = (s) => D.mods.filter((m) => m.status === s).length;
    return head('Mods', 'Active, quarantined and pending inventories with safe quarantine/restore and mandatory diff review.') + `
    <div class="tabs">${[['all', 'All (' + D.mods.length + ')'], ['active', 'Active (' + n('active') + ')'], ['quarantined', 'Quarantined (' + n('quarantined') + ')'], ['pending', 'Pending (' + n('pending') + ')']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="tablewrap"><table><thead><tr><th>Mod</th><th>Version</th><th>Author</th><th>Status</th><th>Size</th><th>Notes</th><th></th></tr></thead><tbody>${list.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td class="mono">${m.version}</td><td>${esc(m.author)}</td><td>${statusPill(m.status)}</td><td>${m.size}</td><td class="wrap">${esc(m.note)}</td>
    <td><div class="row">${m.status === 'active' ? `<button class="btn sm" data-cfg="${m.id}">Edit config</button><button class="btn sm danger" data-mq="${m.id}">Quarantine</button>` : ''}${m.status === 'quarantined' ? `<button class="btn sm" data-diff="${m.id}">Compare config</button><button class="btn sm primary" data-mr="${m.id}">Restore</button>` : ''}${m.status === 'pending' ? `<button class="btn sm primary" data-mapprove="${m.id}">Approve</button><button class="btn sm danger" data-mdeny="${m.id}">Reject</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  };
  pages.mods.bind = () => {
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab.mods = b.dataset.tab; render(); }));
    const m = (id) => D.mods.find((x) => x.id === id);
    const mv = (b, key, to, label) => b && b.addEventListener('click', () => { const mod = m(b.dataset[key]); queueJob(label, state.server, `${mod.name} → ${to}`, { done() { mod.status = to; mod.note = to === 'active' ? 'Restored and activated; restart required' : 'Moved to quarantine'; } }); });
    $$('[data-mq]').forEach((b) => mv(b, 'mq', 'quarantined', 'mod-quarantine'));
    $$('[data-mr]').forEach((b) => mv(b, 'mr', 'active', 'mod-restore'));
    $$('[data-mapprove]').forEach((b) => mv(b, 'mapprove', 'quarantined', 'mod-approve'));
    $$('[data-mdeny]').forEach((b) => b.addEventListener('click', () => { const mod = m(b.dataset.mdeny); D.mods.splice(D.mods.indexOf(mod), 1); toast(mod.name + ' request rejected'); render(); }));
    $$('[data-cfg]').forEach((b) => b.addEventListener('click', () => { const mod = m(b.dataset.cfg); modal(`<h2>${esc(mod.name)} — Config editor</h2><p style="color:var(--muted);font-size:.78rem">IDE-style editor with diff review before atomic save.</p><textarea class="in mono" id="cfg" rows="9" style="font-size:.76rem">&lt;config&gt;\n  &lt;rewards enabled="true" /&gt;\n  &lt;maxHomes value="3" /&gt;\n  &lt;chatColor value="FFAA33" /&gt;\n&lt;/config&gt;</textarea><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Review & save</button></div>`, (bg) => $('#sv', bg).addEventListener('click', () => { bg.remove(); toast('Diff reviewed — config saved atomically (demo).'); })); }));
    $$('[data-diff]').forEach((b) => b.addEventListener('click', () => { const mod = m(b.dataset.diff); modal(`<h2>${esc(mod.name)} — config merge preview</h2><div class="diff mono"><span class="r">- &lt;range value="48" /&gt;</span><span class="a">+ &lt;range value="64" /&gt;</span><span>  &lt;mode value="auto" /&gt;</span><span class="a">+ &lt;battery drain="0.4" /&gt;</span></div><p style="color:var(--soft);font-size:.8rem">Compatible settings carry forward; new keys are highlighted for review.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>`); }));
  };

  pages['poi-search'] = () => {
    const q = state.q.toLowerCase(); const list = D.pois.filter((p) => !q || p.name.toLowerCase().includes(q));
    return head('POI Search', 'Native prefab index from <span class="mono">Data/Prefabs/POIs</span> with on-demand in-game previews.') + `
    <div class="toolbar"><input class="in" id="q" placeholder="Search ${D.pois.length} indexed prefabs…" value="${esc(state.q)}" aria-label="Search POIs"></div>
    <div class="grid g4">${list.map((p) => `<div class="card"><div style="height:90px;border-radius:8px;background:linear-gradient(135deg,#1b1530,#2a1a10);display:grid;place-items:center;font-size:2rem;margin-bottom:8px">🏚️</div><b style="font-size:.85rem">${esc(p.name)}</b><div style="color:var(--muted);font-size:.74rem;margin:2px 0 8px">Tier ${p.tier} · ${p.size}</div><button class="btn sm" data-prev="${esc(p.name)}">Request preview</button></div>`).join('') || '<div class="empty">No prefab matches.</div>'}</div>`;
  };
  pages['poi-search'].bind = () => {
    const q = $('#q'); q.addEventListener('input', () => { state.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('[data-prev]').forEach((b) => b.addEventListener('click', () => { b.textContent = 'Requested…'; b.disabled = true; setTimeout(() => { b.textContent = 'Preview ready ✔'; toast('Preview JPEG fetched from game host (mock).'); }, 1200); }));
  };

  pages.saves = () => head('Saves', 'Full-world and RegionHealer snapshots with retention, confirmed restore and scheduled backups.') + `
    <div class="toolbar"><button class="btn primary" data-act="backup" data-id="${state.server}">+ Manual full backup</button></div>
    <div class="tablewrap"><table><thead><tr><th>Server</th><th>Type</th><th>Game day</th><th>Size</th><th>Created</th><th>By</th><th></th></tr></thead><tbody>${D.saves.filter((b) => b.server === state.server).map((b) => `<tr><td>${esc(srvName(b.server))}</td><td>${esc(b.kind)}</td><td>${b.day}</td><td>${b.size}</td><td>${b.at}</td><td>${esc(b.by)}</td><td><div class="row"><button class="btn sm" data-restore="${b.id}">Restore</button><button class="btn sm danger" data-del="${b.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No saves for this server.</td></tr>'}</tbody></table></div>`;
  pages.saves.bind = () => {
    bindActions();
    $$('[data-restore]').forEach((b) => b.addEventListener('click', () => confirmBox('Restore backup', srv().status === 'online' ? 'Restore requires the server to be <b>offline</b>. Stop the server first — Mastermind refuses to restore over a running world.' : 'Replace the current world with this backup?', srv().status === 'online' ? 'Understood' : 'Restore', () => { if (srv().status !== 'online') queueJob('restore', state.server, 'World restored from backup'); }, true)));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => confirmBox('Delete backup', 'Permanently delete this backup? (demo only)', 'Delete', () => { D.saves.splice(D.saves.findIndex((x) => x.id === b.dataset.del), 1); render(); }, true)));
  };

  pages.logs = () => head('Logs & Console', 'Persistent log following with rotation recovery, keyword alerts and an audited telnet command box.') + `
    <div class="row" style="margin-bottom:10px"><span class="pill ok">● live</span><span style="color:var(--muted);font-size:.78rem">${esc(srv().name)}</span></div>
    <div class="terminal mono" id="term" role="log" aria-live="off"></div>
    <div class="cmdrow"><input class="in mono" id="cmd" placeholder='Try: lp · gettime · say "hello" · help' aria-label="Console command" autocomplete="off"><button class="btn primary" id="send">Send</button></div>
    <p style="color:var(--muted);font-size:.76rem">Every command is audited with the initiating account. Responses here are simulated.</p>`;
  pages.logs.bind = () => {
    const term = $('#term');
    const add = (l, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = l; term.appendChild(d); term.scrollTop = term.scrollHeight; };
    D.logs.forEach((l) => add(l, /WRN/.test(l) ? 'w' : /ERR/.test(l) ? 'e' : ''));
    const lines = ['INF Spawned zombie: zombieFeral at (%x, 70, %z)', 'INF GMSG: Player \'%p\' left the game', 'INF Region r.%a.%b saved (0.%c s)', 'WRN Entity collision budget at 9%d%', 'INF AIDirector: Wandering horde spawned near (%x, 64, %z)'];
    const iv = setInterval(() => { if (!document.body.contains(term)) return clearInterval(iv); const l = lines[Math.floor(rnd(0, lines.length))].replace(/%x|%z/g, () => Math.round(rnd(-3000, 3000))).replace('%p', D.players[Math.floor(rnd(0, 11))].name).replace(/%a|%b/g, () => Math.round(rnd(-6, 6))).replace('%c', Math.round(rnd(1, 9))).replace('%d', Math.round(rnd(0, 9))); add(new Date().toISOString().slice(0, 19) + ' ' + l, /WRN/.test(l) ? 'w' : ''); }, 1800);
    state.timers.push(iv);
    const run = () => {
      const i = $('#cmd'); const c = i.value.trim(); if (!c) return; i.value = ''; add('> ' + c, 'cmd');
      const [h, ...rest] = c.split(/\s+/);
      const out = { lp: () => ['Total of ' + D.players.filter((p) => p.online).length + ' in the game'].concat(D.players.filter((p) => p.online).slice(0, 6).map((p, n) => `${n + 1}. id=${171 + n}, ${p.name}, level=${p.level}, ping=${p.ping}`)), gettime: () => ['Day ' + srv().day + ', ' + srv().time], version: () => ['Game version: ' + srv().version], say: () => ['Message sent to all players: ' + rest.join(' ')], help: () => ['Commands: lp, gettime, version, say <msg>, listplayers, saveworld'], saveworld: () => ['World saved.'], listplayers: () => ['(alias of lp)'] }[h.toLowerCase()];
      setTimeout(() => (out ? out() : ['*** ERROR: unknown command "' + h + '" (demo supports: lp, gettime, version, say, saveworld, help)']).forEach((l) => add(l, out ? 'ok' : 'e')), 250);
    };
    $('#send').addEventListener('click', run); $('#cmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  };

  pages.chat = () => head('Chat', 'Player and server chat history with moderation and an optional Discord relay.') + `
    <div class="grid g2"><div class="card"><h3>Live chat</h3><div id="chatlog">${D.chat.map((c) => `<div style="padding:.3rem 0;border-bottom:1px solid var(--line2)"><span class="mono" style="color:var(--muted)">${c.t}</span> <b style="color:${c.src === 'server' ? 'var(--orange)' : '#c7d2fe'}">${esc(c.who)}</b> ${esc(c.msg)}</div>`).join('')}</div>
    <div class="cmdrow"><input class="in" id="say" placeholder="Reply as server (sent as say)…" aria-label="Server reply"><button class="btn primary" id="sendsay">Send</button></div></div>
    <div class="card"><h3>Moderation</h3><div class="row" style="justify-content:space-between;margin-bottom:10px"><span>Bad-word filter</span><button class="sw on" aria-label="toggle"></button></div><div class="row" style="justify-content:space-between;margin-bottom:10px"><span>Flood protection</span><button class="sw on" aria-label="toggle"></button></div><div class="row" style="justify-content:space-between;margin-bottom:10px"><span>Discord relay (#in-game-chat)</span><button class="sw on" aria-label="toggle"></button></div><p style="color:var(--muted);font-size:.78rem">Actions: log → warn → kick. Mentions are suppressed on relay.</p></div></div>`;
  pages.chat.bind = () => {
    bindSwitches();
    const send = () => { const i = $('#say'); if (!i.value.trim()) return; D.chat.push({ t: new Date().toTimeString().slice(0, 5), who: 'Server', msg: i.value, src: 'server' }); render(); toast('Sent to server via say'); };
    $('#sendsay').addEventListener('click', send); $('#say').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  };
  function bindSwitches() { $$('.sw').forEach((s) => s.addEventListener('click', () => s.classList.toggle('on'))); }

  pages['live-map'] = () => head('Live Map', 'Terrain, players, zombies, animals, claims and region grid — here drawn procedurally for the demo.') + `
    <div class="toolbar"><label><input type="checkbox" id="l-pl" checked> Players</label><label><input type="checkbox" id="l-z" checked> Zombies</label><label><input type="checkbox" id="l-a" checked> Animals</label><label><input type="checkbox" id="l-c" checked> Claims</label><label><input type="checkbox" id="l-g"> Region grid</label></div>
    <div class="mapbox"><canvas id="map" width="1000" height="560" aria-label="Live map"></canvas></div>
    <div class="legend"><span><i style="background:#60a5fa"></i>Players</span><span><i style="background:#ef4444"></i>Zombies</span><span><i style="background:#fbbf24"></i>Animals</span><span><i style="background:#a78bfa"></i>Claims</span><span id="coords" class="mono">hover the map for coordinates</span></div>`;
  pages['live-map'].bind = () => {
    const c = $('#map'), g = c.getContext('2d'), W = c.width, H = c.height;
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return hash(xi, yi) * (1 - u) * (1 - v) + hash(xi + 1, yi) * u * (1 - v) + hash(xi, yi + 1) * (1 - u) * v + hash(xi + 1, yi + 1) * u * v; };
    const terrain = document.createElement('canvas'); terrain.width = W; terrain.height = H; const tg = terrain.getContext('2d'), img = tg.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const n = 0.55 * noise(x / 90, y / 90) + 0.3 * noise(x / 30, y / 30) + 0.15 * noise(x / 10, y / 10); const i = (y * W + x) * 4; let r, gg, b; if (n < 0.38) { r = 20; gg = 50; b = 80; } else if (n < 0.42) { r = 120; gg = 110; b = 70; } else if (n < 0.62) { r = 30 + n * 40; gg = 70 + n * 70; b = 35; } else if (n < 0.75) { r = 40; gg = 80; b = 40; } else { r = 100 + n * 40; gg = 95 + n * 40; b = 85 + n * 30; } img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255; }
    tg.putImageData(img, 0, 0);
    const ents = (n, col) => Array.from({ length: n }, (_, i) => ({ x: hash(i, col) * W, y: hash(col, i) * H, vx: rnd(-.6, .6), vy: rnd(-.6, .6) }));
    const Z = ents(70, 3), A = ents(18, 5), P = D.players.filter((p) => p.online).map((p) => ({ n: p.name, x: W / 2 + (p.x / 3600) * W * .9, y: H / 2 + (p.z / 3600) * H * .9, vx: rnd(-.3, .3), vy: rnd(-.3, .3) }));
    const claims = Array.from({ length: 9 }, (_, i) => ({ x: hash(i, 9) * (W - 60), y: hash(9, i) * (H - 60), r: 18 + hash(i, 2) * 18 }));
    const on = (id) => $('#' + id).checked;
    const step = (arr, s) => arr.forEach((e) => { e.x += e.vx * s; e.y += e.vy * s; if (e.x < 0 || e.x > W) e.vx *= -1; if (e.y < 0 || e.y > H) e.vy *= -1; });
    let raf; const draw = () => {
      if (!document.body.contains(c)) return cancelAnimationFrame(raf);
      g.drawImage(terrain, 0, 0);
      if (on('l-g')) { g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; for (let x = 0; x < W; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
      if (on('l-c')) claims.forEach((k) => { g.fillStyle = 'rgba(167,139,250,.22)'; g.strokeStyle = '#a78bfa'; g.fillRect(k.x, k.y, k.r * 2, k.r * 2); g.strokeRect(k.x, k.y, k.r * 2, k.r * 2); });
      step(Z, 1); step(A, .6); step(P, .5);
      if (on('l-a')) { g.fillStyle = '#fbbf24'; A.forEach((e) => { g.beginPath(); g.arc(e.x, e.y, 3, 0, 7); g.fill(); }); }
      if (on('l-z')) { g.fillStyle = '#ef4444'; Z.forEach((e) => { g.beginPath(); g.arc(e.x, e.y, 2.5, 0, 7); g.fill(); }); }
      if (on('l-pl')) P.forEach((e) => { g.fillStyle = '#60a5fa'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(e.x, e.y, 5, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(e.n, e.x + 8, e.y + 4); });
      raf = requestAnimationFrame(draw);
    };
    if (!matchMedia('(prefers-reduced-motion:reduce)').matches) draw(); else { draw(); cancelAnimationFrame(raf); }
    c.addEventListener('mousemove', (e) => { const r = c.getBoundingClientRect(); const x = Math.round(((e.clientX - r.left) / r.width - .5) * 6000), z = Math.round(((e.clientY - r.top) / r.height - .5) * 6000); $('#coords').textContent = `x ${x}  z ${z}`; });
    state.timers.push({ stop: () => cancelAnimationFrame(raf) });
  };

  pages.jobs = () => head('Jobs', 'Queue-backed actions with output tracking and initiating-account attribution.') + `
    <div class="toolbar"><button class="btn primary" id="newjob">+ New job</button></div>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>Type</th><th>Server</th><th>By</th><th>Status</th><th>When</th><th>Output</th></tr></thead><tbody>${D.jobs.map((j) => `<tr><td class="mono">${j.id}</td><td>${esc(j.type)}</td><td>${esc(srvName(j.server))}</td><td>${esc(j.by)}</td><td>${statusPill(j.status)}</td><td>${Math.max(0, Math.round((Date.now() - j.at) / 60000))} min ago</td><td class="wrap">${esc(j.out)}</td></tr>`).join('')}</tbody></table></div>`;
  pages.jobs.bind = () => $('#newjob').addEventListener('click', () => modal(`<h2>New job</h2><label class="f">Type<select id="jt"><option value="backup">Backup</option><option value="rcon">Console command</option><option value="safe-restart">Safe restart</option><option value="restart">Restart</option><option value="stop">Stop</option></select></label><label class="f">Server<select id="js">${D.servers.filter((s) => s.status === 'online').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Queue job</button></div>`, (bg) => $('#go', bg).addEventListener('click', () => { const t = $('#jt', bg).value, s = $('#js', bg).value; bg.remove(); queueJob(t, s, t + ' completed on agent'); })));

  pages.schedules = () => head('Schedules', 'Safe scheduled restarts and backups with overlap prevention. Simple builder or five-field cron.') + `
    <div class="tablewrap"><table><thead><tr><th>Name</th><th>Server</th><th>Action</th><th>Cron</th><th>Next run</th><th>Enabled</th></tr></thead><tbody>${D.schedules.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(srvName(s.server))}</td><td>${esc(s.kind)}</td><td class="mono">${s.cron}</td><td>${s.enabled ? s.next : '—'}</td><td><button class="sw ${s.enabled ? 'on' : ''}" data-sch="${s.id}" aria-label="Toggle ${esc(s.name)}"></button></td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="margin-top:12px"><h3>Blood Moon safety</h3><div class="row" style="justify-content:space-between"><span style="color:var(--soft);font-size:.84rem">Defer restarts on in-game days divisible by 7 until the next day begins.</span><button class="sw on" aria-label="Blood moon safety"></button></div></div>`;
  pages.schedules.bind = () => { bindSwitches(); $$('[data-sch]').forEach((b) => b.addEventListener('click', () => { const s = D.schedules.find((x) => x.id === b.dataset.sch); s.enabled = !s.enabled; setTimeout(render, 160); })); };

  pages.alerts = () => head('Alerts', 'Discord and email alerts: server events, log keywords, player connections and stability.') + `
    <div class="tablewrap"><table><thead><tr><th>Rule</th><th>Type</th><th>Channel</th><th>Last fired</th><th>Enabled</th><th></th></tr></thead><tbody>${D.alerts.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${pill(a.kind, 'mute')}</td><td>${esc(a.channel)}</td><td>${esc(a.last)}</td><td><button class="sw ${a.enabled ? 'on' : ''}" aria-label="Toggle ${esc(a.name)}"></button></td><td><button class="btn sm" data-test="${a.id}">Test pipeline</button></td></tr>`).join('')}</tbody></table></div>`;
  pages.alerts.bind = () => { bindSwitches(); $$('[data-test]').forEach((b) => b.addEventListener('click', () => { b.textContent = 'Sending…'; setTimeout(() => { b.textContent = 'Test pipeline'; toast('Test alert delivered to channel (mock).'); }, 900); })); };

  pages.triggers = () => head('Triggers', 'Run actions when in-game events happen — level rewards, claims, vehicle recovery.') + `
    <div class="tablewrap"><table><thead><tr><th>Name</th><th>When</th><th>Action</th><th>Fired</th></tr></thead><tbody>${D.triggers.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="mono">${esc(t.on)}</td><td>${esc(t.action)}</td><td>${t.fired}×</td></tr>`).join('')}</tbody></table></div>`;

  pages.hosts = () => head('Hosts', 'Machines running the Go agent. Pair with a one-time token; unregister never deletes game files.') + `
    <div class="toolbar"><button class="btn primary" id="pair">Pair new host</button></div>
    <div class="tablewrap"><table><thead><tr><th>Host</th><th>OS</th><th>Agent</th><th>Address</th><th>Servers</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${D.hosts.map((h) => `<tr><td><b>${esc(h.name)}</b></td><td>${esc(h.os)}</td><td class="mono">${h.agent}</td><td class="mono">${h.ip}</td><td>${h.servers}</td><td>${statusPill(h.status)}</td><td>${h.lastSeen}</td></tr>`).join('')}</tbody></table></div>`;
  pages.hosts.bind = () => $('#pair').addEventListener('click', () => modal(`<h2>Pair new host</h2><p style="color:var(--soft);font-size:.84rem">One-time token (expires in 15 min). Run on the game host:</p><pre class="diff mono" style="white-space:pre-wrap">curl -sSL "https://mm.example.com/install.sh?token=DEMO-ONLY-0000&amp;name=new-host" | sudo bash</pre><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>`));

  pages.accounts = () => head('Accounts', 'Role-based access. Admins approve registrations; passwords use salted scrypt.') + `
    <div class="tablewrap"><table><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Steam</th><th>Last login</th><th></th></tr></thead><tbody>${D.accounts.map((u) => `<tr><td><b>${esc(u.email)}</b></td><td>${pill(u.role, u.role === 'admin' ? 'info' : 'mute')}</td><td>${statusPill(u.status)}</td><td>${u.steam}</td><td>${u.last}</td><td>${u.status === 'pending' ? `<button class="btn sm primary" data-appr="${u.id}">Approve</button>` : u.role === 'admin' ? '<span style="color:var(--muted);font-size:.74rem">protected</span>' : `<button class="btn sm" data-reset="${u.id}">Reset password</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  pages.accounts.bind = () => {
    $$('[data-appr]').forEach((b) => b.addEventListener('click', () => { D.accounts.find((u) => u.id === b.dataset.appr).status = 'active'; toast('Account approved; sessions refreshed.'); render(); }));
    $$('[data-reset]').forEach((b) => b.addEventListener('click', () => toast('Password reset; existing sessions revoked (mock).')));
  };

  pages.security = () => head('Security', 'Login lockouts, math challenge, reCAPTCHA and registration quotas.') + `
    <div class="grid g2"><div class="card"><h3>Login protection</h3>${[['Escalating lockouts', 1], ['Math challenge on login', 1], ['Optional reCAPTCHA', 0], ['Require email confirmation', 1], ['Admin approval for new accounts', 1]].map(([l, o]) => `<div class="row" style="justify-content:space-between;margin-bottom:10px"><span>${l}</span><button class="sw ${o ? 'on' : ''}" aria-label="${l}"></button></div>`).join('')}</div>
    <div class="card"><h3>Recent security events</h3><ul class="steps"><li>✔ Admin login — demo.admin (US)</li><li class="run">! 3 failed logins from 198.51.100.4 — locked 15 min</li><li>✔ Password changed — ops.sam</li><li>✔ Agent key rotated — do-nyc-01</li></ul></div></div>`;
  pages.security.bind = bindSwitches;

  pages.settings = () => head('Settings', 'Organization, integrations and secrets (encrypted at rest).') + `
    <div class="grid g2"><div class="card"><h3>Organization</h3><label class="f">Name<input value="Demo Survival Co." aria-label="Organization name"></label><label class="f">Timezone<select><option>UTC</option><option>America/New_York</option></select></label></div>
    <div class="card"><h3>Integrations</h3>${[['Discord alerts', 'connected'], ['Mailgun email', 'connected'], ['Stripe donations', 'test mode'], ['Cloudflare API', 'connected'], ['AI config assistant (Codex/Kimi)', 'enabled']].map(([n, s]) => `<div class="row" style="justify-content:space-between;margin-bottom:10px"><span>${n}</span>${pill(s, 'ok')}</div>`).join('')}<p style="color:var(--muted);font-size:.76rem;margin:0">Secrets are never shown after saving.</p></div></div>`;

  pages['donator-shop'] = () => head('Donator Shop', 'Supporter packages with optional In-Game Gifts, fulfilled from a signed Stripe webhook.') + `
    <div class="grid g3">${D.shop.map((s) => `<div class="card"><b>${esc(s.name)}</b><div style="font-size:1.6rem;font-weight:700;margin:6px 0">$${s.price}</div><div style="color:var(--soft);font-size:.82rem;margin-bottom:8px">${esc(s.gifts)}</div><div style="color:var(--muted);font-size:.74rem">${s.sold} supporters</div></div>`).join('')}</div>`;

  pages['player-portal'] = () => head('Player Portal', 'What players see at <span class="mono">/player</span>: public map and shop, Steam-verified profile.') + `
    <div class="grid g2"><div class="card"><h3>Steam-verified profile</h3><div class="row"><span class="avatar" style="width:44px;height:44px">K</span><div><b>Kestrel</b><div style="color:var(--muted);font-size:.78rem">Level 54 · Supporter</div></div></div><div class="grid g3" style="margin-top:12px"><div class="stat"><div class="v">1,284</div><div class="l">Zombie kills</div></div><div class="stat"><div class="v">12</div><div class="l">Deaths</div></div><div class="stat"><div class="v">96h</div><div class="l">Playtime</div></div></div></div>
    <div class="card"><h3>Privacy boundary</h3><ul class="steps"><li class="done">✔ Terrain, zombies &amp; animals public</li><li class="done">✔ Player positions only after Steam OpenID</li><li class="done">✔ No staff controls, claims or telnet</li><li class="done">✔ No IPs or webtokens exposed</li></ul></div></div><p><a class="btn" href="#/dashboard">← Back to admin</a></p>`;

  /* ---- render / auth / router ---- */
  function stopTimers() { state.timers.forEach((t) => (t.stop ? t.stop() : clearInterval(t))); state.timers = []; }
  function render() {
    stopTimers();
    if (!store.get('mm_demo_auth')) return renderLogin();
    const page = pages[current()] ? current() : 'dashboard';
    app.innerHTML = shell(pages[page](), page);
    document.title = (page === 'dashboard' ? 'Dashboard' : page.replace('-', ' ').replace(/^./, (c) => c.toUpperCase())) + ' · Mastermind Demo';
    $('#menu').addEventListener('click', () => $('#nav').classList.toggle('open'));
    $$('#nav a.item,#nav a.portal').forEach((a) => a.addEventListener('click', () => $('#nav').classList.remove('open')));
    $('#srvsel').addEventListener('change', (e) => { state.server = e.target.value; render(); });
    $('#logout').addEventListener('click', () => { store.del('mm_demo_auth'); location.hash = ''; render(); });
    if (pages[page].bind) pages[page].bind();
    if (!['live-map', 'logs'].includes(page)) bindActions();
  }
  function renderLogin() {
    document.title = 'Sign in · Mastermind Demo';
    app.innerHTML = `<div class="login"><form class="login-card" id="lf" novalidate><img src="../assets/icon-192.png" alt="Mastermind logo"><h1>Mastermind</h1><p class="sub">Sign in to the control plane</p>
      <label class="f">Email<input id="em" type="email" autocomplete="username" value="${DEMO_EMAIL}"></label>
      <label class="f">Password<input id="pw" type="password" autocomplete="current-password" value="${DEMO_PASS}"></label>
      <div id="err" role="alert" style="color:#fca5a5;font-size:.8rem;min-height:1.1em;margin-bottom:8px"></div>
      <button class="btn primary block" type="submit">Sign in</button>
      <div class="divider">or</div>
      <button class="btn block" type="button" id="quick">Enter as demo administrator</button>
      <div class="hint"><b>Demo credentials are pre-filled.</b><br>Email <span class="mono">${DEMO_EMAIL}</span><br>Password <span class="mono">${DEMO_PASS}</span><br>This is a static, fictional environment — no backend, no real accounts.</div>
      <a class="back" href="../">← Back to project overview</a></form></div>`;
    const go = () => { store.set('mm_demo_auth', '1'); location.hash = '#/dashboard'; render(); };
    $('#lf').addEventListener('submit', (e) => { e.preventDefault(); if ($('#em').value.trim().toLowerCase() === DEMO_EMAIL && $('#pw').value === DEMO_PASS) go(); else $('#err').textContent = 'Invalid credentials. Use the pre-filled demo account.'; });
    $('#quick').addEventListener('click', go);
  }
  window.addEventListener('hashchange', render);
  render();
})();
