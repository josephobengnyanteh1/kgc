(async () => {
  const { $, esc, fmtDate, api } = window.KGCApp;
  const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v || '—'; };
  try {
    const m = await window.KGCPortal.me(); if (!m) return;
    set('name', m.full_name.split(' ')[0]); set('sideName', m.full_name); set('sideBranch', m.branch_name || 'KGC member');
    set('since', fmtDate(m.created_at, { month: 'short', year: 'numeric' })); set('statBranch', m.branch_name); set('statMinistry', m.ministry);
    const st = $('#status'); st.textContent = m.status; st.className = 'badge ' + m.status;
    $('#avatarBox').textContent = m.full_name.trim()[0].toUpperCase();
    if (m.profile_photo_key) { const img = new Image(); img.className = 'avatar'; img.alt = 'Your profile photo'; img.onload = () => $('#avatarBox').replaceWith(img); img.src = '/api/member/photo'; }
    const rows = [['Full name', m.full_name], ['Email', m.email], ['Phone', m.phone], ['Date of birth', m.date_of_birth ? fmtDate(m.date_of_birth) : ''], ['Gender', m.gender], ['Branch', m.branch_name], ['Ministry', m.ministry], ['Address', m.address]];
    $('#details').innerHTML = rows.map(([k, v]) => `<div class="detail"><small>${k.toUpperCase()}</small><b>${esc(v || '—')}</b></div>`).join('');
    const a = await api('/api/member/activity');
    $('#activityList').innerHTML = a.length ? a.map(x => `<li><b>${esc(x.action.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()))}</b><br><small>${new Date(x.created_at).toLocaleString()}</small></li>`).join('') : '<li>No activity yet.</li>';
  } catch (e) { const b = $('#error'); b.textContent = e.message; b.classList.remove('hidden'); }
})();
