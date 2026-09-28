(() => {
  const { $, api } = window.KGCApp, f = $('#loginForm'), m = $('#msg');
  // already signed in? go straight to the portal
  api('/api/me').then(u => location.replace(['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN', 'FINANCE_OFFICER'].includes(u.role) ? '/admin.html' : '/member.html')).catch(() => {});
  f.addEventListener('submit', async e => {
    e.preventDefault(); m.className = 'msg'; m.textContent = '';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const b = $('button', f); b.disabled = true; b.textContent = 'Signing in…';
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      m.className = 'msg ok'; m.textContent = 'Signed in. Taking you to your portal…';
      const next = new URLSearchParams(location.search).get('next');
      const safe = next && /^\/[a-z]+\.html$/.test(next) ? next : null;
      setTimeout(() => location.href = safe || (['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN', 'FINANCE_OFFICER'].includes(r.role) ? '/admin.html' : '/member.html'), 500);
    } catch (err) { m.className = 'msg bad'; m.textContent = err.message; b.disabled = false; b.textContent = 'Sign in'; }
  });
})();
