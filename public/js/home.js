/* Home page: preloader, hero, embers, countdown, verses, ministries, tabs, live content, contact form */
(() => {
  const { $, $$, esc, fmtDate, api, toast, reduce } = window.KGCApp, C = window.KGC;

  // preloader → curtain opens → hero animates in
  const pre = $('.preloader'), start = performance.now();
  const open = () => {
    const wait = Math.max(0, 1700 - (performance.now() - start));
    setTimeout(() => { pre?.classList.add('done'); document.body.classList.add('loaded'); setTimeout(() => pre?.classList.add('gone'), 1400); }, wait);
  };
  document.readyState === 'complete' ? open() : addEventListener('load', open);
  setTimeout(open, 4500);

  // hero headline → per-letter
  $$('.hero h1 .ln').forEach((ln, li) => {
    const t = ln.textContent.trim(); ln.textContent = ''; ln.setAttribute('aria-label', t);
    [...t].forEach((c, i) => { const s = document.createElement('span'); s.className = c === ' ' ? 'sp' : 'ch'; s.style.setProperty('--i', i + li * 8); s.textContent = c === ' ' ? '' : c; s.setAttribute('aria-hidden', 'true'); ln.append(s); });
  });

  // golden embers that drift up and shy away from the pointer
  const cv = $('#embers');
  if (cv && !reduce) {
    const x = cv.getContext('2d'); let W, H, mx = -999, my = -999, ps = [];
    const size = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; ps = Array.from({ length: Math.min(70, W / 16) }, () => mk(true)); };
    const mk = init => ({ x: Math.random() * W, y: init ? Math.random() * H : H + 10, r: Math.random() * 1.8 + .4, v: Math.random() * .5 + .15, a: Math.random() * .6 + .2, p: Math.random() * 6 });
    addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
    let vis = true; new IntersectionObserver(([e]) => vis = e.isIntersecting).observe(cv);
    (function tick() {
      if (vis) {
        x.clearRect(0, 0, W, H);
        ps.forEach(p => {
          p.y -= p.v; p.p += .01; p.x += Math.sin(p.p) * .35;
          const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy); if (d < 110) { p.x += dx / d * 1.6; p.y += dy / d * 1.6; }
          if (p.y < -10) Object.assign(p, mk(false));
          x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = `rgba(248,${190 + p.r * 15 | 0},80,${p.a * (.6 + Math.sin(p.p * 3) * .4)})`; x.shadowColor = '#f0a81e'; x.shadowBlur = 10; x.fill();
        });
      }
      requestAnimationFrame(tick);
    })();
    size(); addEventListener('resize', size);
  }

  // countdown to next service (Ghana = GMT, no daylight saving)
  const ns = C.nextService, cd = $('#countdown');
  if (ns && cd) {
    $('#nextTitle').textContent = ns.title;
    const target = () => { const n = new Date(), t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), ns.hour, ns.minute)); t.setUTCDate(t.getUTCDate() + ((ns.day - n.getUTCDay() + 7) % 7)); if (t < n - 2 * 3600e3) t.setUTCDate(t.getUTCDate() + 7); return t; };
    const p2 = n => String(n).padStart(2, '0');
    const tick = () => { const ms = target() - Date.now(); if (ms <= 0) { cd.innerHTML = '<b style="grid-column:1/-1;font-size:1.6rem">Service is on now</b>'; return; } const s = ms / 1000 | 0; const v = [s / 86400 | 0, s % 86400 / 3600 | 0, s % 3600 / 60 | 0, s % 60]; $$('b', cd).forEach((b, i) => b.textContent = p2(v[i])); };
    tick(); setInterval(tick, 1000);
  }

  // verses carousel
  const vs = $$('.verse-item'), dots = $('.dots'); let vi = 0, vt;
  if (vs.length) {
    vs.forEach((_, i) => { const b = document.createElement('button'); b.ariaLabel = 'Show verse ' + (i + 1); b.innerHTML = '<i></i>'; b.onclick = () => show(i); dots.append(b); });
    const show = i => { vi = i; vs.forEach((v, k) => v.classList.toggle('on', k === i)); $$('button', dots).forEach((b, k) => { b.classList.remove('on'); void b.offsetWidth; b.classList.toggle('on', k === i); }); clearTimeout(vt); if (!reduce) vt = setTimeout(() => show((vi + 1) % vs.length), 7000); };
    show(0);
  }

  // ministries accordion
  const mins = $$('.min'), setMin = m => mins.forEach(x => { const on = x === m; x.classList.toggle('on', on); x.setAttribute('aria-expanded', on); });
  mins.forEach(m => { m.tabIndex = 0; m.setAttribute('role', 'button'); m.addEventListener('click', () => setMin(m)); m.addEventListener('mouseenter', () => matchMedia('(hover:hover)').matches && innerWidth > 980 && setMin(m)); m.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMin(m))); });
  mins[0] && setMin(mins[0]);

  // visit tabs from config
  const tabs = $('#tabs'), sched = $('#sched');
  if (tabs && C.schedule) {
    const draw = i => { sched.innerHTML = C.schedule[i].items.map(([a, b]) => `<li><b>${esc(a)}</b><time>${esc(b)}</time></li>`).join(''); $$('.tab', tabs).forEach((t, k) => t.setAttribute('aria-selected', k === i)); };
    tabs.innerHTML = C.schedule.map((s, i) => `<button class="tab" role="tab" data-i="${i}">${esc(s.tab)}</button>`).join('');
    tabs.onclick = e => { const b = e.target.closest('.tab'); if (b) draw(+b.dataset.i); };
    draw(0);
  }

  // config → page
  $$('[data-cfg]').forEach(el => { const v = C[el.dataset.cfg]; if (v) el.textContent = v; });
  $$('[data-cfg-href]').forEach(el => { const k = el.dataset.cfgHref, v = C[k]; if (v) el.href = (k === 'email' ? 'mailto:' : 'tel:') + v.replace(/\s/g, ''); });
  
  $$('.live-link').forEach(a => { if (C.liveUrl) { a.href = C.liveUrl; a.target = '_blank'; a.rel = 'noopener'; } else a.href = '#sermons'; });
  $('#year').textContent = new Date().getFullYear();

  // live content from Supabase via the API (each block fails softly)
  const emptyBox = (t, s) => `<div class="empty"><b>${t}</b><p>${s}</p></div>`;
  const embed = u => { try { const x = new URL(u); if (/youtu\.be$/.test(x.hostname)) return u; return x.href; } catch { return '#'; } };

  api('/api/events').then(ev => {
    $('#events-grid').innerHTML = ev.length ? ev.map((e, i) => { const d = new Date(e.starts_at); return `<article class="card" data-reveal style="--d:${i * .08}s"><div class="date-block"><b>${d.getDate()}</b><small>${d.toLocaleString(undefined, { month: 'short' }).toUpperCase()}</small></div><h3>${esc(e.title)}</h3><p>${esc(e.description || '')}</p><p class="meta">${d.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}${e.location ? ' · ' + esc(e.location) : ''}${e.branch_name ? '<br>' + esc(e.branch_name) : ''}</p></article>`; }).join('') : emptyBox('No events scheduled yet', 'Check back soon, or send us a message to ask what is coming up.');
    window.KGCApp.watch($('#events-grid'));
  }).catch(() => $('#events-grid').innerHTML = emptyBox('Events are on their way', 'We could not load events just now. Please refresh in a moment.'));

  api('/api/sermons').then(s => {
    const box = $('#sermon-box'); if (!s.length) return;
    const [f, ...rest] = s, link = u => u ? `href="${esc(embed(u))}" target="_blank" rel="noopener"` : 'href="#contact"';
    box.innerHTML = `<a class="feature" ${link(f.video_url)} data-reveal="zoom" ${f.thumbnail_url ? `style="background-image:linear-gradient(180deg,transparent 30%,rgba(6,5,4,.95)),url('${esc(f.thumbnail_url)}')"` : ''}><span class="play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><div><span class="label">LATEST MESSAGE</span><h3>${esc(f.title)}</h3><p>${esc(f.speaker || '')} ${f.speaker ? '·' : ''} ${fmtDate(f.preached_on)}</p></div></a>
      <div class="slist">${rest.map((x, i) => `<a class="srow" ${link(x.video_url)} data-reveal style="--d:${i * .08}s"><span class="pi"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span><div><h4>${esc(x.title)}</h4><small>${esc(x.speaker || '')} ${x.speaker ? '·' : ''} ${fmtDate(x.preached_on, { month: 'short', day: 'numeric', year: 'numeric' })}</small></div></a>`).join('')}</div>`;
    window.KGCApp.watch(box);
  }).catch(() => {});

  const ICON = { facebook_url: ['Facebook', 'M14 9h3V5h-3c-2.8 0-4 1.8-4 4v2H7v4h3v6h4v-6h3l1-4h-4V9.5c0-.3.2-.5.5-.5z'], tiktok_url: ['TikTok', 'M16 3c.3 2.4 1.8 4 4 4.2v3.2c-1.5 0-2.9-.5-4-1.3V15a6 6 0 1 1-6-6c.3 0 .7 0 1 .1v3.300a2.7 2.7 0 1 0 1.7 2.5V3z'], youtube_url: ['YouTube', 'M21.6 7.200a2.5 2.5 0 0 0-1.8-1.8C18.200 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.800 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.800 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.200 22 12 22 12s0-3.2-.4-4.8zM10 15V9l5.200 3z'], instagram_url: ['Instagram', 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm5.5-1.500a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'] };
  const socialLinks = b => Object.entries(ICON).filter(([k]) => b[k]).map(([k, [n, d]]) => `<a class="soc" href="${esc(b[k])}" target="_blank" rel="noopener" aria-label="${n}" title="${n}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg></a>`).join('');
  api('/api/branches').then(b => {
    if (!b.length) { $('#branch-grid').innerHTML = emptyBox('Branches coming soon', 'Branch locations will appear here.'); return; }
    $('#branch-grid').innerHTML = b.map((x, i) => `<article class="card branch" data-reveal style="--d:${i * .08}s"><span class="label">${esc((x.location || 'BRANCH').toUpperCase())}</span><h3>${esc(x.name.replace(/^Kingdom Glory Church\s*[-–]?\s*/i, '') || x.name)}</h3><p class="bname">${esc(x.name)}</p>
      <ul class="binfo"><li>${x.address ? esc(x.address) : '<em>Address coming soon</em>'}</li><li>${x.phone ? `<a href="tel:${esc(x.phone.replace(/[^\d+]/g, ''))}">${esc(x.phone)}</a>` : '<em>Phone coming soon</em>'}</li>${x.service_times ? `<li>${esc(x.service_times)}</li>` : ''}</ul>
      <div class="socs">${socialLinks(x)}</div></article>`).join('');
    window.KGCApp.watch($('#branch-grid'));
    // footer: follow links for whichever branch has them
    const withSocial = b.filter(x => Object.keys(ICON).some(k => x[k]));
    if (withSocial.length) $('#socials').innerHTML = withSocial.map(x => `<span class="foot-soc"><span>${esc(x.name.replace(/^Kingdom Glory Church\s*[-–]?\s*/i, ''))}</span>${socialLinks(x)}</span>`).join('');
  }).catch(() => $('#branch-grid').innerHTML = emptyBox('Branches', 'We could not load branches just now. Please refresh in a moment.'));

  api('/api/announcements').then(a => {
    const box = $('#ann-box'); if (!a.length) return;
    box.innerHTML = `<div class="ann" data-reveal><span class="label">LATEST ANNOUNCEMENT</span>${a.slice(0, 2).map(x => `<div class="ann-item"><h3>${esc(x.title)}</h3><p>${esc(x.body.length > 220 ? x.body.slice(0, 220) + '…' : x.body)}</p></div>`).join('')}</div>`;
    window.KGCApp.watch(box);
  }).catch(() => {});

  // contact form
  const f = $('#contactForm');
  f?.addEventListener('submit', async e => {
    e.preventDefault(); const m = $('#contactMsg'), btn = $('button[type=submit]', f); m.className = 'msg'; m.textContent = '';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try { const r = await api('/api/contact', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); f.reset(); toast(r.message, 'ok'); m.className = 'msg ok'; m.textContent = r.message; }
    catch (err) { m.className = 'msg bad'; m.textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Send message'; }
  });
})();
