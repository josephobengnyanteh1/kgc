/* Shared by member / finance / admin: sign-out, guard, show Admin link for admins */
(() => {
  const { $, $$, api } = window.KGCApp;
  window.KGCPortal = {
    ADMIN_ROLES: ['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN', 'FINANCE_OFFICER'],
    async me() {
      try { const u = await api('/api/me'); if (window.KGCPortal.ADMIN_ROLES.includes(u.role)) $$('.admin-only').forEach(e => e.classList.remove('hidden')); return u; }
      catch (e) { if (e.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname)); return null; } throw e; }
    }
  };
  $('#logout')?.addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.href = '/login.html'; } });
})();
