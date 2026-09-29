(async () => {
  const { $, $$, esc, fmtDate, api, toast } = window.KGCApp, money = n => 'GHS ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!(await window.KGCPortal.me())) return;
  async function load() {
    try {
      const a = await api('/api/finance/my-records');
      $('#tTotal').textContent = money(a.filter(x => x.status === 'VERIFIED').reduce((s, x) => s + Number(x.amount), 0));
      $('#tPending').textContent = a.filter(x => x.status === 'PENDING').length; $('#tCount').textContent = a.length;
      $('#records').innerHTML = a.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${a.map(x => `<tr><td>${fmtDate(x.paid_at, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td>${esc(x.type[0] + x.type.slice(1).toLowerCase())}</td><td>${money(x.amount)}</td><td>${esc(x.payment_method)}${x.reference ? '<br><small>' + esc(x.reference) + '</small>' : ''}</td><td><span class="badge ${esc(x.status)}">${esc(x.status)}</span></td></tr>`).join('')}</tbody></table>` : '<p>No payments recorded yet. Your first record will appear here.</p>';
    } catch (e) { $('#records').textContent = e.message; }
  }
  $('#financeForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, m = $('#msg'), b = $('button[type=submit]', f); m.className = 'msg'; m.textContent = '';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    b.disabled = true; b.textContent = 'Submitting…';
    try { await api('/api/finance/records', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); f.reset(); toast('Payment recorded. It is pending verification.', 'ok'); load(); }
    catch (err) { m.className = 'msg bad'; m.textContent = err.message; }
    finally { b.disabled = false; b.textContent = 'Submit for verification'; }
  });
  // ---- online giving
  const prov = $('#pprov'), payMsg = $('#payMsg');
  api('/api/payments/config').then(c => {
    const opts = [c.paystack && ['PAYSTACK', 'Mobile Money / Card (Paystack)'], c.flutterwave && ['FLUTTERWAVE', 'Mobile Money / Card (Flutterwave)']].filter(Boolean);
    prov.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') || '<option value="">Not switched on yet</option>';
    if (!opts.length) { payMsg.className = 'msg'; payMsg.textContent = 'Online payments are being set up. For now, please record your payment below.'; $('#payBtn').disabled = true; }
  }).catch(() => {});
  $('#quick').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) { $('#pamount').value = b.dataset.a; $$('#quick .tab').forEach(t => t.setAttribute('aria-selected', t === b)); } });
  $('#payForm').addEventListener('submit', async e => {
    e.preventDefault(); payMsg.className = 'msg'; payMsg.textContent = ''; const f = e.target, b = $('#payBtn');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    b.disabled = true; b.textContent = 'Opening secure checkout…';
    try {
      const r = await api('/api/payments/create', { method: 'POST', body: { provider: prov.value, type: f.ptype.value, amount: $('#pamount').value, source: 'web' } });
      location.href = r.checkoutUrl;
    } catch (err) { payMsg.className = 'msg bad'; payMsg.textContent = err.message; b.disabled = false; b.textContent = 'Continue to secure payment'; }
  });
  load();
})();
