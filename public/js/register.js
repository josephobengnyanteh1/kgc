(() => {
  const { $, esc, api, toast } = window.KGCApp, f = $('#regForm'), m = $('#msg'), photo = $('#photo'), prev = $('#preview');
  let photoBlob = null;

  api('/api/branches').then(b => { $('#branchId').innerHTML = '<option value="">Select branch</option>' + b.map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.location ? ' — ' + esc(x.location) : ''}</option>`).join(''); })
    .catch(() => { $('#branchId').innerHTML = '<option value="">Branches unavailable — you can still register</option>'; });

  // shrink the photo in the browser so uploads stay small and fast
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 900, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res(b) : rej(new Error('Could not read that image.')), 'image/jpeg', .86); URL.revokeObjectURL(url);
      };
      img.onerror = () => rej(new Error('That file is not a readable image.')); img.src = url;
    });
  }
  photo.addEventListener('change', async () => {
    const file = photo.files[0]; if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { photo.value = ''; toast('Please choose a JPG, PNG or WebP image.', 'bad'); return; }
    try { photoBlob = await shrink(file); prev.src = URL.createObjectURL(photoBlob); } catch (e) { photo.value = ''; toast(e.message, 'bad'); }
  });
  $('label[for=photo]').addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), photo.click()));

  f.addEventListener('submit', async e => {
    e.preventDefault(); m.className = 'msg'; m.textContent = '';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    if ($('#password').value !== $('#confirm').value) { m.className = 'msg bad'; m.textContent = 'The two passwords do not match.'; $('#confirm').focus(); return; }
    const fd = new FormData(f); fd.set('terms', $('#terms').checked ? 'true' : ''); if (photoBlob) fd.set('profilePhoto', photoBlob, 'photo.jpg');
    const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Submitting…';
    try {
      const r = await api('/api/auth/register', { method: 'POST', body: fd });
      if (photoBlob && r.photoSaved === false) toast('Registered! Your photo could not be saved — you can send it to the church office.', '');
      $('#formView').classList.add('hidden'); $('#doneView').classList.remove('hidden'); scrollTo({ top: 0 });
    } catch (err) { m.className = 'msg bad'; m.textContent = err.message; b.disabled = false; b.textContent = 'Submit registration'; }
  });
})();
