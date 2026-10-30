// Prueba en vivo contra el backend ya desplegado en la cuenta de la boda.
// Uso: node _backend-fotos/test/live.js "https://script.google.com/macros/s/XXXX/exec" [CLAVE_ADMIN]
// Sube una imagen de prueba pequeña (directa a Drive) y otra por el plan B, y comprueba la galería.
const [url, admin] = process.argv.slice(2);
if (!url) { console.log('Falta la URL /exec'); process.exit(1); }
const KEY = 'laboda2026';

const get = async q => (await fetch(url + '?' + new URLSearchParams(q))).json();
const post = async b => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) })).json();

// PNG de 1x1 px
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const step = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) process.exitCode = 1; };

  const ping = await get({ action: 'ping' });
  step(ping.ok, 'el backend responde');

  const bad = await get({ action: 'gallery', key: 'mala' });
  step(bad.error === 'key', 'rechaza peticiones sin la clave');

  // 1) Subida directa a Drive (como hará el móvil)
  const s1 = await post({ action: 'start', key: KEY, name: 'PRUEBA-directa.png', mimeType: 'image/png', size: png.length, guest: 'Prueba técnica', origin: 'https://laboda.es' });
  step(s1.ok, 'abre sesión de subida ' + (s1.ok ? '' : JSON.stringify(s1)));
  if (s1.ok) {
    const r = await fetch(s1.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${png.length - 1}/${png.length}` }, body: png });
    const f = await r.json().catch(() => ({}));
    step(r.status === 200 && f.id, 'sube directa a Drive (' + r.status + ')');
  }

  // 2) Plan B: a través del script
  const s2 = await post({ action: 'start', key: KEY, name: 'PRUEBA-planB.png', mimeType: 'image/png', size: png.length, guest: 'Prueba técnica', origin: 'https://laboda.es' });
  if (s2.ok) {
    const c = await post({ action: 'chunk', key: KEY, uploadUrl: s2.uploadUrl, start: 0, total: png.length, data: png.toString('base64') });
    step(c.ok && c.done && c.fileId, 'sube por el plan B ' + (c.ok ? '' : JSON.stringify(c)));
  }

  const g = await get({ action: 'gallery', key: KEY });
  step(g.ok, `galería responde (${g.items ? g.items.length : '?'} publicadas, ${g.pending} esperando el diferido)`);

  if (admin) {
    const st = await get({ action: 'status', admin });
    step(st.ok, 'resumen: ' + JSON.stringify(st));
  }
  console.log('\nLas dos fotos de prueba se llaman "PRUEBA-…" en la carpeta de Drive: se pueden borrar.');
})();
