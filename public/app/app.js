/* KGC members' app — a small single-page app (no framework). Talks to the same secure API as the website. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = window.KGC || {}, money = n => 'GHS ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (v, o) => v ? new Date(v).toLocaleString(undefined, o) : '—';
  const root = $('#root');
  let me = null, branches = [], unread = 0, installEvt = null, ticker = null;

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || 'Something went wrong. Please try again.'); e.status = res.status; throw e; }
    return data;
  }
  const toast = (t, type = '') => { const el = Object.assign(document.createElement('div'), { className: 'toast ' + type, textContent: t }); $('#toasts').append(el); setTimeout(() => el.remove(), 4500); };

  const I = {
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    give: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7"/>',
    fb: '<path fill="currentColor" stroke="none" d="M14 9h3V5h-3c-2.8 0-4 1.8-4 4v2H7v4h3v6h4v-6h3l1-4h-4V9.5c0-.3.2-.5.5-.5z"/>',
    tt: '<path fill="currentColor" stroke="none" d="M16 3c.3 2.4 1.8 4 4 4.2v3.2c-1.5 0-2.9-.5-4-1.3V15a6 6 0 1 1-6-6c.3 0 .7 0 1 .1v3.300a2.7 2.7 0 1 0 1.7 2.5V3z"/>',
    yt: '<path fill="currentColor" stroke="none" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.200 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.800 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.800 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8zM10 15V9l5.200 3z"/>',
    ig: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/>'
  };
  const svg = (k, w = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
  const VERSES = [['Enter into his gates with thanksgiving, and into his courts with praise.', 'Psalm 100:4'], ['Thy word is a lamp unto my feet, and a light unto my path.', 'Psalm 119:105'], ['Arise, shine; for thy light is come, and the glory of the Lord is risen upon thee.', 'Isaiah 60:1'], ['Where two or three are gathered together in my name, there am I in the midst of them.', 'Matthew 18:20'], ['The Lord is my shepherd; I shall not want.', 'Psalm 23:1'], ['I can do all things through Christ which strengtheneth me.', 'Philippians 4:13']];
  const dayVerse = () => VERSES[Math.floor(Date.now() / 864e5) % VERSES.length];
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const empty = (t, s) => `<div class="empty"><b>${t}</b><p>${s}</p></div>`;
  const skel = n => Array.from({ length: n }, () => '<div class="card"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:70%"></div></div>').join('');
  const shortName = n => (n || '').replace(/^Kingdom Glory Church\s*[-–]?\s*/i, '') || n;

  /* ---------- sign in ---------- */
  function showLogin(note) {
    clearInterval(ticker);
    root.innerHTML = `<div class="login"><img class="logo" src="/app/icons/icon-192.png" alt="Kingdom Glory Church"><h1>Welcome home</h1><p class="sub">Sign in to your KGC members' app.</p>
      ${note ? `<div class="note">${esc(note)}</div>` : ''}
      <form id="lf" novalidate><div class="field"><label for="e">EMAIL</label><input id="e" type="email" required autocomplete="email" inputmode="email"></div>
      <div class="field"><label for="p">PASSWORD</label><input id="p" type="password" required autocomplete="current-password"></div>
      <button class="btn solid block" type="submit">SIGN IN</button><p class="msg" id="lm" role="alert"></p></form>
      <p class="alt">New here? <a href="/register.html">Create your member account</a></p><p class="alt"><a href="/">Visit the website</a></p></div>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault(); const b = $('button', e.target), m = $('#lm'); m.textContent = ''; m.className = 'msg';
      if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
      b.disabled = true; b.textContent = 'SIGNING IN…';
      try { await api('/api/auth/login', { method: 'POST', body: { email: $('#e').value, password: $('#p').value } }); await boot(); }
      catch (err) { m.className = 'msg bad'; m.textContent = err.message; b.disabled = false; b.textContent = 'SIGN IN'; }
    };
  }

  /* ---------- shell ---------- */
  const TABS = [['home', 'Home', 'home'], ['events', 'Events', 'cal'], ['give', 'Give', 'give'], ['inbox', 'Inbox', 'bell'], ['me', 'Profile', 'user']];
  function shell() {
    root.innerHTML = `<div class="app"><header class="top"><img src="/app/icons/icon-192.png" alt=""><h1>KINGDOM GLORY</h1><a class="bell" href="#inbox" aria-label="Notifications">${svg('bell')}<span class="dot hidden" id="topDot">0</span></a></header>
      <main id="view" tabindex="-1"></main>
      <nav class="tabs" aria-label="App">${TABS.map(([id, l, ic]) => `<a href="#${id}" data-t="${id}">${svg(ic)}<span>${l}</span>${id === 'inbox' ? '<span class="dot hidden" id="tabDot">0</span>' : ''}</a>`).join('')}</nav></div>`;
  }
  function setUnread(n) { unread = n; ['topDot', 'tabDot'].forEach(id => { const d = $('#' + id); if (d) { d.textContent = n > 9 ? '9+' : n; d.classList.toggle('hidden', !n); } }); }

  /* ---------- views ---------- */
  const VIEWS = {
    async home(v) {
      const first = me.full_name.split(' ')[0], bq = me.branch_id ? '?branch=' + me.branch_id : '';
      v.innerHTML = `<div class="hello"><span class="script">${greet()},</span><h2>${esc(first)}</h2></div>
        <div class="card hero-card"><span class="label">NEXT SERVICE</span><h3>${esc(C.nextService?.title || 'Sunday Worship Service')}</h3><div class="count" id="cd"><div><b>--</b><small>DAYS</small></div><div><b>--</b><small>HRS</small></div><div><b>--</b><small>MIN</small></div><div><b>--</b><small>SEC</small></div></div></div>
        <div class="quick"><button data-go="give">${svg('give')}Give</button><button data-go="events">${svg('cal')}Events</button><button data-go="inbox">${svg('bell')}Inbox</button><button data-go="me">${svg('user')}Profile</button></div>
        <div class="verse"><blockquote>${esc(dayVerse()[0])}</blockquote><cite>${esc(dayVerse()[1])}</cite></div>
        <div class="sec"><h2>Announcements</h2></div><div id="an">${skel(1)}</div>
        <div class="sec"><h2>Coming up</h2><button data-go="events">See all</button></div><div id="ev">${skel(1)}</div>`;
      countdown();
      api('/api/announcements' + bq).then(a => { $('#an').innerHTML = a.length ? a.slice(0, 3).map(x => `<div class="card ann"><span class="label">${esc((x.branch_name ? shortName(x.branch_name) : 'ALL BRANCHES').toUpperCase())}</span><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></div>`).join('') : empty('All quiet for now', 'New announcements will appear here.'); }).catch(() => $('#an').innerHTML = empty('Could not load', 'Pull down or try again shortly.'));
      api('/api/events' + bq).then(e => { $('#ev').innerHTML = e.length ? e.slice(0, 3).map(evCard).join('') : empty('No events yet', 'Check back soon.'); }).catch(() => $('#ev').innerHTML = empty('Could not load', 'Try again shortly.'));
    },
    async events(v) {
      v.innerHTML = `<div class="hello"><span class="script">What's happening</span><h2>Events</h2></div><div id="ev">${skel(3)}</div>`;
      try { const e = await api('/api/events' + (me.branch_id ? '?branch=' + me.branch_id : '')); $('#ev').innerHTML = e.length ? e.map(evCard).join('') : empty('No events yet', 'When your church publishes events they will show here.'); }
      catch { $('#ev').innerHTML = empty('Could not load events', 'Check your connection and try again.'); }
    },
    async give(v) {
      let cfg = { paystack: false, flutterwave: false }; try { cfg = await api('/api/payments/config'); } catch { /* offline */ }
      const provs = [cfg.paystack && ['PAYSTACK', 'Paystack'], cfg.flutterwave && ['FLUTTERWAVE', 'Flutterwave']].filter(Boolean);
      v.innerHTML = `<div class="hello"><span class="script">Sow into the Kingdom</span><h2>Give</h2></div>
        <form class="card" id="gf" novalidate>
          <div class="field"><span class="lab">TYPE</span><div class="chips" id="gt">${['TITHE', 'OFFERING', 'DUES'].map((t, i) => `<button type="button" data-v="${t}" class="${i ? '' : 'on'}">${t[0] + t.slice(1).toLowerCase()}</button>`).join('')}</div></div>
          <div class="field"><span class="lab">AMOUNT (GHS)</span><input class="amount" id="ga" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0.00" aria-label="Amount in Ghana cedis"></div>
          <div class="chips" id="gq" style="justify-content:center;margin-bottom:16px">${[50, 100, 200, 500].map(n => `<button type="button" data-v="${n}">${n}</button>`).join('')}</div>
          ${provs.length ? `<div class="field"><label for="gp">PAY WITH</label><select id="gp">${provs.map(([k, l]) => `<option value="${k}">Mobile Money / Card · ${l}</option>`).join('')}</select></div><button class="btn solid block" type="submit" id="gb">GIVE SECURELY</button>` : '<div class="note">Online payments are being switched on. For now you can record a payment you made on the website.</div><a class="btn block" href="/finance.html">RECORD A PAYMENT</a>'}
          <p class="msg" id="gm" role="alert"></p></form>
        <div class="sec"><h2>My giving</h2></div><div class="card" id="gh">${skel(1)}</div>`;
      $('#gt').onclick = e => { const b = e.target.closest('[data-v]'); if (b) $$('#gt button').forEach(x => x.classList.toggle('on', x === b)); };
      $('#gq').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { $('#ga').value = b.dataset.v; $$('#gq button').forEach(x => x.classList.toggle('on', x === b)); } };
      $('#gf').onsubmit = async e => {
        e.preventDefault(); const b = $('#gb'), m = $('#gm'); m.className = 'msg'; m.textContent = ''; if (!b) return;
        const amount = parseFloat($('#ga').value); if (!(amount >= 1)) { m.className = 'msg bad'; m.textContent = 'Enter an amount of at least GHS 1.'; return; }
        b.disabled = true; b.textContent = 'OPENING SECURE CHECKOUT…';
        try { const r = await api('/api/payments/create', { method: 'POST', body: { provider: $('#gp').value, type: $('#gt .on').dataset.v, amount, source: 'app' } }); location.href = r.checkoutUrl; }
        catch (err) { m.className = 'msg bad'; m.textContent = err.message; b.disabled = false; b.textContent = 'GIVE SECURELY'; }
      };
      try {
        const r = await api('/api/finance/my-records'), total = r.filter(x => x.status === 'VERIFIED').reduce((s, x) => s + Number(x.amount), 0);
        $('#gh').innerHTML = r.length ? `<div class="row"><span class="label">CONFIRMED TOTAL</span><b style="font-family:var(--display);font-size:1.8rem;color:var(--gold2)">${money(total)}</b></div>` + r.slice(0, 15).map(x => `<div class="row"><div><b>${esc(x.type[0] + x.type.slice(1).toLowerCase())}</b><br><small>${fmt(x.paid_at, { dateStyle: 'medium' })}</small></div><div style="text-align:right">${money(x.amount)}<br><span class="badge ${esc(x.status)}">${esc(x.status)}</span></div></div>`).join('') : empty('Nothing yet', 'Your giving history will appear here.');
      } catch { $('#gh').innerHTML = empty('Could not load', 'Try again shortly.'); }
    },
    async inbox(v) {
      v.innerHTML = `<div class="hello"><span class="script">Stay in the loop</span><h2>Inbox</h2></div><div id="nl">${skel(3)}</div>`;
      try {
        const n = await api('/api/member/notifications'); setUnread(n.filter(x => !x.read_at).length);
        const head = n.some(x => !x.read_at) ? '<div style="text-align:right;margin-bottom:10px"><button class="btn sm" id="ra">MARK ALL READ</button></div>' : '';
        $('#nl').innerHTML = head + (n.length ? n.map(x => `<button class="nt ${x.read_at ? '' : 'new'}" data-id="${esc(x.id)}"><i></i><div><b>${esc(x.title)}</b><p>${esc(x.body)}</p><small>${fmt(x.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div></button>`).join('') : empty('No messages yet', 'Announcements and giving receipts will show up here.'));
        $('#ra')?.addEventListener('click', async () => { await api('/api/member/notifications/read-all', { method: 'PATCH' }); go('inbox'); });
        $('#nl').onclick = async e => { const b = e.target.closest('.nt.new'); if (!b) return; b.classList.remove('new'); setUnread(Math.max(0, unread - 1)); api('/api/member/notifications/' + b.dataset.id + '/read', { method: 'PATCH' }).catch(() => {}); };
      } catch { $('#nl').innerHTML = empty('Could not load', 'Check your connection and try again.'); }
    },
    async me(v) {
      const b = branches.find(x => x.id === me.branch_id), rows = [['Email', me.email], ['Phone', me.phone], ['Date of birth', me.date_of_birth ? fmt(me.date_of_birth, { dateStyle: 'long' }) : ''], ['Ministry', me.ministry], ['Address', me.address]];
      const socs = b ? [['facebook_url', 'fb', 'Facebook'], ['tiktok_url', 'tt', 'TikTok'], ['youtube_url', 'yt', 'YouTube'], ['instagram_url', 'ig', 'Instagram']].filter(([k]) => b[k]).map(([k, ic, n]) => `<a class="soc" href="${esc(b[k])}" target="_blank" rel="noopener" aria-label="${n}">${svg(ic)}</a>`).join('') : '';
      v.innerHTML = `<div class="me">${me.profile_photo_key ? `<img class="avatar" src="/api/member/photo" alt="Your photo" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar',textContent:'${esc(me.full_name[0])}'}))">` : `<div class="avatar">${esc(me.full_name[0])}</div>`}<h2>${esc(me.full_name)}</h2><span class="badge ${esc(me.status)}">${esc(me.status)}</span></div>
        <div class="card">${rows.map(([k, val]) => `<div class="row"><small class="label">${k.toUpperCase()}</small><span style="text-align:right;overflow-wrap:anywhere">${esc(val || '—')}</span></div>`).join('')}</div>
        ${b ? `<div class="card"><span class="label">MY BRANCH</span><h3>${esc(shortName(b.name))}</h3><p>${b.address ? esc(b.address) : 'Address coming soon'}</p>${b.phone ? `<p style="margin-top:6px"><a class="tel" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></p>` : ''}${b.service_times ? `<p style="margin-top:6px">${esc(b.service_times)}</p>` : ''}<div class="socs">${socs}</div></div>` : ''}
        <div id="ins"></div>
        <a class="btn block" href="/member.html" style="margin-bottom:12px">FULL MEMBER PORTAL</a><button class="btn bad block" id="so">SIGN OUT</button>`;
      const showInstall = () => {
        const ins = $('#ins'); if (!ins || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
        if (installEvt) ins.innerHTML = '<button class="btn solid block" id="inst" style="margin-bottom:12px">INSTALL THE APP</button>';
        else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) ins.innerHTML = '<div class="note">To install: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.</div>';
        $('#inst')?.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#ins').innerHTML = ''; });
      };
      showInstall();
      $('#so').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { me = null; showLogin('You have been signed out.'); } };
    }
  };
  const evCard = e => { const d = new Date(e.starts_at); return `<div class="card ev"><div class="date"><b>${d.getDate()}</b><small>${d.toLocaleString(undefined, { month: 'short' }).toUpperCase()}</small></div><div><h3>${esc(e.title)}</h3><p>${d.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}${e.location ? ' · ' + esc(e.location) : ''}${e.branch_name ? '<br>' + esc(shortName(e.branch_name)) : ''}</p>${e.description ? `<p style="margin-top:6px">${esc(e.description)}</p>` : ''}</div></div>`; };

  function countdown() {
    clearInterval(ticker); const ns = C.nextService || { day: 0, hour: 9, minute: 0 }, cd = $('#cd'); if (!cd) return;
    const target = () => { const n = new Date(), t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), ns.hour, ns.minute)); t.setUTCDate(t.getUTCDate() + ((ns.day - n.getUTCDay() + 7) % 7)); if (t < n - 2 * 36e5) t.setUTCDate(t.getUTCDate() + 7); return t; };
    const tick = () => { const s = Math.max(0, (target() - Date.now()) / 1000 | 0), v = [s / 86400 | 0, s % 86400 / 3600 | 0, s % 3600 / 60 | 0, s % 60]; $$('b', cd).forEach((b, i) => b.textContent = String(v[i]).padStart(2, '0')); };
    tick(); ticker = setInterval(tick, 1000);
  }

  /* ---------- router ---------- */
  function go(id) { if (location.hash === '#' + id) route(); else location.hash = id; }
  async function route() {
    if (!me) return; const id = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'home', v = $('#view'); if (!v) return;
    $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.t === id));
    v.innerHTML = ''; const w = document.createElement('div'); w.className = 'view'; v.append(w); scrollTo({ top: 0 });
    try { await VIEWS[id](w); } catch (e) { if (e.status === 401) { me = null; showLogin('Your session ended. Please sign in again.'); } else w.innerHTML = empty('Something went wrong', esc(e.message)); }
  }
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
  addEventListener('hashchange', route);
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash === '#me') route(); });

  async function boot() {
    try {
      me = await api('/api/me');
      shell();
      api('/api/branches').then(b => { branches = b; if (location.hash === '#me') route(); }).catch(() => {});
      api('/api/member/notifications').then(n => setUnread(n.filter(x => !x.read_at).length)).catch(() => {});
      route();
    } catch (e) { me = null; showLogin(e.status && e.status !== 401 ? e.message : ''); }
    $('#splash').classList.add('off');
  }
  addEventListener('online', () => toast('Back online', 'ok')); addEventListener('offline', () => toast('You are offline. Some things may not load.', 'bad'));
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {}));
  boot();
})();
