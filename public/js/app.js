/* Shared behaviour for every page: header, progress bar, reveal, cursor glow, tilt cards, toasts, API helper */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (v, o = { year: 'numeric', month: 'long', day: 'numeric' }) => v ? new Date(v).toLocaleDateString(undefined, o) : '—';

  async function api(url, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.body && !isForm && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || 'Something went wrong. Please try again.'); e.status = res.status; throw e; }
    return data;
  }

  let stack;
  function toast(text, type = '') {
    stack ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts', role: 'status' }));
    const t = Object.assign(document.createElement('div'), { className: 'toast ' + type, textContent: text });
    stack.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 4800);
  }
  window.KGCApp = { $, $$, esc, fmtDate, api, toast, reduce };

  // header: glass on scroll, hide on scroll-down
  const header = $('.header');
  const progress = Object.assign(document.createElement('div'), { className: 'progress' });
  document.body.prepend(progress);
  const top = Object.assign(document.createElement('button'), { className: 'totop', ariaLabel: 'Back to top', innerHTML: '↑' });
  document.body.append(top);
  top.onclick = () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  let lastY = 0, ticking = false;
  function onScroll() {
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    top.classList.toggle('show', y > 900);
    if (header) {
      header.classList.toggle('scrolled', y > 40);
      const menuOpen = $('.links.open');
      header.classList.toggle('hide', y > 500 && y > lastY + 4 && !menuOpen);
      if (y < lastY - 4) header.classList.remove('hide');
    }
    lastY = y; ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // mobile menu
  const burger = $('.burger'), links = $('.links');
  if (burger && links) {
    const set = open => { links.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); document.body.classList.toggle('no-scroll', open); };
    burger.onclick = () => set(!links.classList.contains('open'));
    $$('a', links).forEach(a => a.addEventListener('click', () => set(false)));
    addEventListener('keydown', e => e.key === 'Escape' && set(false));
  }

  // active nav link by section
  const secs = $$('main section[id]');
  if (secs.length && links) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) $$('a', links).forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }), { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(s => io.observe(s));
  }

  // reveal on scroll
  const rev = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rev.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  const watch = root => $$('[data-reveal]:not(.in)', root).forEach(el => rev.observe(el));
  watch(document); window.KGCApp.watch = watch;

  // cursor glow (desktop only)
  if (!reduce && matchMedia('(hover:hover)').matches) {
    const g = Object.assign(document.createElement('div'), { className: 'glow' });
    document.body.append(g);
    addEventListener('pointermove', e => { g.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; g.classList.add('on'); }, { passive: true });
    document.addEventListener('pointerleave', () => g.classList.remove('on'));
  }

  // card spotlight + gentle tilt, magnetic buttons (event delegation so dynamic cards work)
  if (!reduce && matchMedia('(hover:hover)').matches) {
    document.addEventListener('pointermove', e => {
      const c = e.target.closest?.('.card');
      if (c) {
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        c.style.setProperty('--mx', x + 'px'); c.style.setProperty('--my', y + 'px');
        if (c.dataset.tilt !== 'off') c.style.transform = `perspective(900px) rotateX(${((y / r.height) - .5) * -6}deg) rotateY(${((x / r.width) - .5) * 6}deg) translateY(-4px)`;
      }
      const b = e.target.closest?.('[data-magnet]');
      if (b) { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .22}px,${(e.clientY - r.top - r.height / 2) * .3}px)`; }
    }, { passive: true });
    document.addEventListener('pointerout', e => {
      const c = e.target.closest?.('.card'); if (c && !c.contains(e.relatedTarget)) c.style.transform = '';
      const b = e.target.closest?.('[data-magnet]'); if (b && !b.contains(e.relatedTarget)) b.style.transform = '';
    });
  }

  // parallax
  const par = $$('[data-parallax]');
  if (par.length && !reduce) {
    const run = () => par.forEach(el => { const r = el.parentElement.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return; el.style.transform = `translateY(${((r.top + r.height / 2 - innerHeight / 2) * -0.09).toFixed(1)}px)`; });
    addEventListener('scroll', () => requestAnimationFrame(run), { passive: true }); run();
  }

  // password strength meter
  const pw = $('#password'), bar = $('.strength i');
  if (pw && bar) pw.addEventListener('input', () => {
    const v = pw.value; let s = 0;
    if (v.length >= 12) s++; if (v.length >= 16) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
    bar.style.width = (s * 20) + '%'; bar.style.background = s < 3 ? 'var(--bad)' : s < 5 ? 'var(--gold)' : 'var(--ok)';
  });

  // soft fade when leaving to another page
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]'); if (!a || reduce || e.metaKey || e.ctrlKey || a.target || a.origin !== location.origin || a.getAttribute('href').startsWith('#') || a.pathname === location.pathname) return;
    e.preventDefault(); document.body.style.transition = 'opacity .35s'; document.body.style.opacity = 0; setTimeout(() => location.href = a.href, 300);
  });
  addEventListener('pageshow', e => { if (e.persisted) document.body.style.opacity = 1; });
})();
