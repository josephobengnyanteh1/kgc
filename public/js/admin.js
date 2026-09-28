(async () => {
  const { $, $$, esc, fmtDate, api, toast } = window.KGCApp, money = n => 'GHS ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const me = await window.KGCPortal.me(); if (!me) return;
  if (!window.KGCPortal.ADMIN_ROLES.includes(me.role)) { location.replace('/member.html'); return; }
  const empty = (cols, t) => `<tr><td colspan="${cols}" style="text-align:center;padding:2.2rem;color:var(--mist)">${t}</td></tr>`;
  const cur = { m: 'PENDING', f: 'PENDING' };

  // which tabs this role may use
  const views = [['members', 'Members', ['SUPER_ADMIN', 'CHURCH_ADMIN', 'BRANCH_ADMIN']], ['finance', 'Finance', null], ['messages', 'Messages', ['SUPER_ADMIN', 'CHURCH_ADMIN']]].filter(v => !v[2] || v[2].includes(me.role));
  const tabs = $('#mainTabs');
  tabs.innerHTML = views.map(([id, l]) => `<button class="tab" role="tab" data-v="${id}" aria-selected="false">${l}</button>`).join('');
  const show = id => { views.forEach(([v]) => $('#v-' + v).classList.toggle('hidden', v !== id)); $$('.tab', tabs).forEach(t => t.setAttribute('aria-selected', t.dataset.v === id)); ({ members: loadM, finance: loadF, messages: loadG })[id](); };
  tabs.onclick = e => { const b = e.target.closest('.tab'); if (b) show(b.dataset.v); };

  // ---- members
  async function loadM() {
    const body = $('#mRows'); body.innerHTML = empty(5, 'Loading…');
    try {
      const d = await api('/api/admin/registrations?status=' + cur.m);
      body.innerHTML = d.length ? d.map(x => `<tr><td><b>${esc(x.full_name)}</b><br><small>${esc(x.email)}</small></td><td>${esc(x.branch_name || 'Not assigned')}</td><td>${fmtDate(x.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><span class="badge ${esc(x.status)}">${esc(x.status)}</span></td><td><div class="acts"><button class="btn btn-sm" data-act="view" data-id="${esc(x.id)}">View</button>${x.status === 'PENDING' ? `<button class="btn btn-sm btn-solid" data-act="member" data-to="ACTIVE" data-id="${esc(x.id)}">Approve</button><button class="btn btn-sm btn-danger" data-act="member" data-to="REJECTED" data-id="${esc(x.id)}">Reject</button>` : ''}${x.status === 'ACTIVE' ? `<button class="btn btn-sm btn-danger" data-act="member" data-to="SUSPENDED" data-id="${esc(x.id)}">Suspend</button>` : ''}${x.status === 'SUSPENDED' ? `<button class="btn btn-sm" data-act="member" data-to="ACTIVE" data-id="${esc(x.id)}">Reactivate</button>` : ''}</div></td></tr>`).join('') : empty(5, 'No ' + cur.m.toLowerCase() + ' members.');
    } catch (e) { body.innerHTML = empty(5, esc(e.message)); }
  }
  $('#mFilters').onclick = e => { const b = e.target.closest('.tab'); if (!b) return; cur.m = b.dataset.s; $$('#mFilters .tab').forEach(t => t.setAttribute('aria-selected', t === b)); loadM(); };

  // ---- finance
  async function loadF() {
    const body = $('#fRows'); body.innerHTML = empty(7, 'Loading…');
    api('/api/admin/finance/summary').then(s => { const by = Object.fromEntries(s.map(x => [x.type, x])); $('#fSummary').innerHTML = ['TITHE', 'OFFERING', 'DUES'].map(t => `<div class="stat"><small>${t} · VERIFIED</small><strong>${money(by[t]?.total || 0)}</strong></div>`).join(''); }).catch(() => {});
    try {
      const d = await api('/api/admin/finance?status=' + cur.f);
      body.innerHTML = d.length ? d.map(x => `<tr><td>${fmtDate(x.paid_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><b>${esc(x.full_name || '—')}</b><br><small>${esc(x.branch_name || '')}</small></td><td>${esc(x.type)}</td><td>${money(x.amount)}</td><td>${esc(x.payment_method)}${x.reference ? '<br><small>' + esc(x.reference) + '</small>' : ''}</td><td><span class="badge ${esc(x.status)}">${esc(x.status)}</span></td><td><div class="acts">${x.status === 'PENDING' ? `<button class="btn btn-sm btn-solid" data-act="fin" data-to="VERIFIED" data-id="${esc(x.id)}">Verify</button><button class="btn btn-sm btn-danger" data-act="fin" data-to="FAILED" data-id="${esc(x.id)}">Fail</button>` : ''}${x.status === 'VERIFIED' ? `<button class="btn btn-sm btn-danger" data-act="fin" data-to="REVERSED" data-id="${esc(x.id)}">Reverse</button>` : ''}</div></td></tr>`).join('') : empty(7, 'No records here.');
    } catch (e) { body.innerHTML = empty(7, esc(e.message)); }
  }
  $('#fFilters').onclick = e => { const b = e.target.closest('.tab'); if (!b) return; cur.f = b.dataset.s; $$('#fFilters .tab').forEach(t => t.setAttribute('aria-selected', t === b)); loadF(); };

  // ---- messages
  async function loadG() {
    const body = $('#gRows'); body.innerHTML = empty(5, 'Loading…');
    try {
      const d = await api('/api/admin/messages');
      body.innerHTML = d.length ? d.map(x => `<tr style="${x.handled ? 'opacity:.5' : ''}"><td><b>${esc(x.name)}</b><br><small>${esc(x.email || '')} ${esc(x.phone || '')}</small></td><td>${esc(x.topic)}</td><td style="max-width:360px;white-space:pre-wrap">${esc(x.body)}</td><td>${fmtDate(x.created_at, { month: 'short', day: 'numeric' })}</td><td><button class="btn btn-sm" data-act="msg" data-id="${esc(x.id)}">${x.handled ? 'Reopen' : 'Mark done'}</button></td></tr>`).join('') : empty(5, 'No messages yet.');
    } catch (e) { body.innerHTML = empty(5, esc(e.message)); }
  }

  // ---- one click handler for every button (no inline onclick, so the security policy stays strict)
  const modal = $('#modal'), detail = $('#detail'), closeM = () => modal.classList.remove('show');
  $('#close').onclick = closeM; modal.onclick = e => e.target === modal && closeM(); addEventListener('keydown', e => e.key === 'Escape' && closeM());
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const { act, id, to } = b.dataset;
    try {
      if (act === 'view') {
        const x = await api('/api/admin/registrations/' + id);
        const row = (k, v) => `<div class="detail"><small>${k}</small><b>${esc(v || '—')}</b></div>`;
        detail.innerHTML = `${x.profile_photo_key ? `<img class="avatar" src="/api/admin/photo/${encodeURIComponent(x.id)}" alt="Profile photo">` : ''}<h2 style="font-size:2.2rem;margin-bottom:1rem">${esc(x.full_name)}</h2><div class="details">${row('EMAIL', x.email)}${row('PHONE', x.phone)}${row('DATE OF BIRTH', x.date_of_birth ? fmtDate(x.date_of_birth) : '')}${row('GENDER', x.gender)}${row('BRANCH', x.branch_name)}${row('MINISTRY', x.ministry)}${row('ADDRESS', x.address)}${row('STATUS', x.status)}</div>`;
        modal.classList.add('show');
      } else if (act === 'member' || act === 'fin') {
        if (!confirm(`Change this ${act === 'member' ? 'member' : 'record'} to ${to}?`)) return;
        b.disabled = true;
        const r = await api(`/api/admin/${act === 'member' ? 'registrations' : 'finance'}/${id}/status`, { method: 'PATCH', body: { status: to } });
        toast(r.message, 'ok'); act === 'member' ? loadM() : loadF();
      } else if (act === 'msg') { await api('/api/admin/messages/' + id, { method: 'PATCH' }); loadG(); }
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  });

  show(views[0][0]);
})();
