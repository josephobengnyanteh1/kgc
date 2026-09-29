(async () => {
  const { $, api } = window.KGCApp, u = new URLSearchParams(location.search), ref = u.get('reference') || u.get('tx_ref') || u.get('trxref');
  const app = u.get('from') === 'app'; $('#back').href = app ? '/app/#give' : '/finance.html'; if (app) $('#back').textContent = 'Back to the app';
  const show = id => ['working', 'ok', 'wait', 'bad'].forEach(k => $('#' + k).classList.toggle('hidden', k !== id));
  if (!ref) { show('bad'); return; }
  const tid = u.get('transaction_id'), qs = tid ? '?transaction_id=' + encodeURIComponent(tid) : '';
  for (let i = 0; i < 8; i++) {
    try {
      const t = await api('/api/payments/status/' + encodeURIComponent(ref) + qs);
      if (t.status === 'VERIFIED') { $('#okText').textContent = `Your ${t.type.toLowerCase()} of ${t.currency} ${Number(t.amount).toFixed(2)} was received. God bless you.`; show('ok'); return; }
      if (t.status === 'FAILED' || u.get('status') === 'cancelled') { show('bad'); return; }
    } catch { /* keep trying */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  show('wait');
})();
