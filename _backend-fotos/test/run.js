// Banco de pruebas: ejecuta Code.gs en un entorno Apps Script simulado con un Drive falso.
// Uso: node _backend-fotos/test/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE = 'https://www.googleapis.com/drive/v3';

function makeEnv() {
  const props = new Map();
  const cache = new Map();
  let clock = Date.parse('2026-11-07T12:00:00Z');
  const drive = { files: new Map(), sessions: new Map(), seq: 0, calls: [] };
  const newId = p => p + (++drive.seq);

  function resp(code, body, headers = {}) {
    return {
      getResponseCode: () => code,
      getContentText: () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
      getAllHeaders: () => headers,
    };
  }
  function parseQuery(url) { return Object.fromEntries(new URL(url).searchParams.entries()); }

  function fetch(url, opt = {}) {
    const method = (opt.method || 'get').toLowerCase();
    const h = opt.headers || {};
    drive.calls.push({ method, url, headers: h });
    if (!url.includes('upload_id=') && h.Authorization !== 'Bearer TOKEN') return resp(401, { error: 'auth' });

    // Abrir sesión reanudable
    if (method === 'post' && url.startsWith(UPLOAD + '?uploadType=resumable')) {
      const meta = JSON.parse(opt.payload);
      const id = newId('up');
      drive.sessions.set(id, { meta, total: Number(h['X-Upload-Content-Length']), data: Buffer.alloc(0), origin: h.Origin, mime: h['X-Upload-Content-Type'] });
      if (drive.noLocation) return resp(200, '', {});
      return resp(200, '', { Location: `${UPLOAD}?uploadType=resumable&upload_id=${id}` });
    }
    // Subir trozo / consultar estado
    if (method === 'put' && url.startsWith(UPLOAD + '?')) {
      const id = parseQuery(url).upload_id;
      const s = drive.sessions.get(id);
      if (!s) return resp(404, 'not found');
      const cr = h['Content-Range'];
      const q = cr.match(/^bytes \*\/(\d+)$/);
      const finish = () => {
        const fid = newId('f');
        drive.files.set(fid, { id: fid, name: s.meta.name, mimeType: s.mime, parents: s.meta.parents, appProperties: { ...s.meta.appProperties }, createdTime: new Date(clock).toISOString(), trashed: false, size: s.data.length, data: s.data, perms: [] });
        drive.sessions.delete(id);
        return resp(200, { id: fid, name: s.meta.name });
      };
      if (q) {
        if (s.data.length === s.total) return finish();
        return resp(308, '', s.data.length ? { Range: `bytes=0-${s.data.length - 1}` } : {});
      }
      const m = cr.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      const a = Number(m[1]), b = Number(m[2]);
      const buf = Buffer.from(opt.payload);
      assert.strictEqual(b - a + 1, buf.length, 'Content-Range no coincide con el tamaño del trozo');
      if (a !== s.data.length) return resp(400, 'bad offset');
      s.data = Buffer.concat([s.data, buf]);
      if (s.data.length === s.total) return finish();
      return resp(308, '', { Range: `bytes=0-${s.data.length - 1}` });
    }
    // API de Drive
    if (url.startsWith(DRIVE)) {
      const u = new URL(url);
      const p = u.pathname.replace('/drive/v3', '');
      const body = opt.payload ? JSON.parse(opt.payload) : null;
      if (p === '/about') return resp(200, { storageQuota: { usage: '3000000000', limit: '16106127360' }, user: { emailAddress: 'boda@example.com' } });
      if (method === 'post' && p === '/files') {
        const id = newId('dir');
        drive.files.set(id, { id, name: body.name, mimeType: body.mimeType, parents: body.parents || ['root'], appProperties: {}, createdTime: new Date(clock).toISOString(), trashed: false, perms: [] });
        return resp(200, { id });
      }
      let m;
      if ((m = p.match(/^\/files\/([^/]+)$/))) {
        const f = drive.files.get(m[1]);
        if (!f) return resp(404, { error: 'nf' });
        if (method === 'get') return resp(200, { id: f.id, trashed: f.trashed });
        if (method === 'patch') { Object.assign(f.appProperties, body.appProperties || {}); return resp(200, { id: f.id }); }
      }
      if ((m = p.match(/^\/files\/([^/]+)\/permissions$/)) && method === 'post') {
        const f = drive.files.get(m[1]);
        assert.deepStrictEqual(body, { type: 'anyone', role: 'reader', allowFileDiscovery: false });
        if (!f.perms.includes('anyoneWithLink')) f.perms.push('anyoneWithLink');
        return resp(200, { id: 'anyoneWithLink' });
      }
      if ((m = p.match(/^\/files\/([^/]+)\/permissions\/anyoneWithLink$/)) && method === 'delete') {
        const f = drive.files.get(m[1]);
        if (!f.perms.includes('anyoneWithLink')) return resp(404, { error: 'nf' });
        f.perms = f.perms.filter(x => x !== 'anyoneWithLink');
        return resp(204, '');
      }
      if (p === '/files' && method === 'get') {
        const q = u.searchParams.get('q');
        const parent = q.match(/'([^']+)' in parents/)[1];
        const pubFilter = /appProperties has \{ key='pub' and value='1' \}/.test(q);
        let list = [...drive.files.values()].filter(f => f.parents.includes(parent) && !f.trashed && f.mimeType !== 'application/vnd.google-apps.folder');
        if (pubFilter) list = list.filter(f => f.appProperties.pub === '1');
        list.sort((x, y) => y.createdTime.localeCompare(x.createdTime));
        return resp(200, { files: list.map(f => ({ id: f.id, mimeType: f.mimeType, createdTime: f.createdTime, appProperties: { ...f.appProperties }, imageMediaMetadata: f.mimeType.startsWith('image/') ? { width: 4032, height: 3024, rotation: 1 } : undefined, videoMediaMetadata: f.mimeType.startsWith('video/') ? { width: 1920, height: 1080, durationMillis: '12400' } : undefined })) });
      }
    }
    return resp(500, 'mock: ruta no simulada ' + method + ' ' + url);
  }

  const ctx = {
    console: { log() {}, error() {} },
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock); }
      static now() { return clock; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: { getScriptCache: () => ({
      get: k => { const e = cache.get(k); return e && e.exp > clock ? e.v : null; },
      put: (k, v, sec) => cache.set(k, { v, exp: clock + sec * 1000 }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    Utilities: {
      formatDate: d => new Date(d).toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '.'),
      base64Decode: s => [...Buffer.from(s, 'base64')].map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => 'abcd1234-0000',
    },
    ScriptApp: { getOAuthToken: () => 'TOKEN' },
    UrlFetchApp: { fetch },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.env.CODE_PATH || path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  const call = (action, p = {}, how = 'post') => {
    const out = how === 'get'
      ? ctx.doGet({ parameter: { action, ...p } })
      : ctx.doPost({ postData: { contents: JSON.stringify({ action, ...p }) } });
    return JSON.parse(out.text);
  };
  return { ctx, call, drive, props, cache, tick: ms => { clock += ms; } };
}

// Sube un buffer usando el plan B (trozos por el script), como haría la web si no puede ir directa
function uploadViaProxy(env, data, uploadUrl, chunk) {
  let r;
  for (let start = 0; start < data.length; start += chunk) {
    const part = data.subarray(start, Math.min(start + chunk, data.length));
    r = env.call('chunk', { key: 'laboda2026', uploadUrl, start, total: data.length, data: part.toString('base64') });
    assert.ok(r.ok, 'trozo falló: ' + JSON.stringify(r));
  }
  return r;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const KEY = 'laboda2026';
const MB = 1024 * 1024;

test('ping responde sin clave', () => {
  const env = makeEnv();
  assert.deepStrictEqual(env.call('ping', {}, 'get'), { ok: true, pong: true });
});

test('sin la clave de la web no deja hacer nada', () => {
  const env = makeEnv();
  assert.strictEqual(env.call('start', { key: 'mala', name: 'a.jpg', size: 10 }).error, 'key');
  assert.strictEqual(env.call('gallery', {}, 'get').error, 'key');
  assert.strictEqual(env.drive.calls.length, 0, 'no debe tocar Drive');
});

test('rechaza tipos que no son foto ni vídeo y tamaños excesivos', () => {
  const env = makeEnv();
  assert.strictEqual(env.call('start', { key: KEY, name: 'virus.exe', mimeType: 'application/x-msdownload', size: 100 }).error, 'type');
  assert.strictEqual(env.call('start', { key: KEY, name: 'doc.pdf', mimeType: 'application/pdf', size: 100 }).error, 'type');
  assert.strictEqual(env.call('start', { key: KEY, name: 'f.jpg', mimeType: 'image/jpeg', size: 0 }).error, 'size');
  const big = env.call('start', { key: KEY, name: 'f.jpg', mimeType: 'image/jpeg', size: 61 * MB });
  assert.strictEqual(big.error, 'too_big'); assert.strictEqual(big.maxMb, 60);
  assert.strictEqual(env.call('start', { key: KEY, name: 'v.mov', mimeType: 'video/quicktime', size: 1025 * MB }).error, 'too_big');
});

test('acepta HEIC de iPhone aunque el navegador no diga el tipo', () => {
  const env = makeEnv();
  const r = env.call('start', { key: KEY, name: 'IMG_0001.HEIC', mimeType: '', size: 3 * MB, origin: 'https://laboda.es' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.kind, 'photo');
});

test('abre sesión con el origen permitido y crea las carpetas una sola vez', () => {
  const env = makeEnv();
  const r1 = env.call('start', { key: KEY, name: 'IMG_1.jpg', mimeType: 'image/jpeg', size: 5 * MB, origin: 'https://laboda.es', guest: 'Pepe' });
  const r2 = env.call('start', { key: KEY, name: 'VID_1.mp4', mimeType: 'video/mp4', size: 300 * MB, origin: 'https://evil.example', guest: '' });
  assert.ok(r1.ok && r2.ok);
  assert.ok(r1.uploadUrl.includes('upload_id='));
  assert.strictEqual(r1.chunkSize, 8 * MB);
  const sessions = [...env.drive.sessions.values()];
  assert.strictEqual(sessions[0].origin, 'https://laboda.es');
  assert.strictEqual(sessions[1].origin, 'https://laboda.es', 'un origen no permitido se sustituye por laboda.es');
  const dirs = [...env.drive.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  assert.strictEqual(dirs.length, 2, 'carpeta principal + "No publicar"');
  assert.ok(dirs.find(d => d.name === 'No publicar').parents.includes(dirs.find(d => d.name !== 'No publicar').id));
  assert.deepStrictEqual(sessions[0].meta.parents, [env.props.get('FOLDER_ID')]);
  assert.match(sessions[0].meta.name, / · Pepe · IMG_1\.jpg$/);
  assert.match(sessions[1].meta.name, / · Invitado · VID_1\.mp4$/);
  assert.strictEqual(sessions[0].meta.appProperties.guest, 'Pepe');
});

test('limpia nombres de invitado raros', () => {
  const env = makeEnv();
  env.call('start', { key: KEY, name: '../../x.jpg', mimeType: 'image/jpeg', size: 10, guest: '  ../Mari\nCarmen\\  ' + 'x'.repeat(60) });
  const s = [...env.drive.sessions.values()][0];
  assert.ok(!/[\/\\\n]/.test(s.meta.appProperties.guest));
  assert.ok(s.meta.appProperties.guest.length <= 40);
  assert.ok(s.meta.appProperties.guest.startsWith('.. Mari Carmen'));
  assert.ok(!s.meta.name.includes('/'));
});

test('plan B: sube un vídeo de 20 MB por trozos a través del script, íntegro', () => {
  const env = makeEnv();
  const data = Buffer.alloc(20 * MB + 12345); for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 255;
  const s = env.call('start', { key: KEY, name: 'boda.mp4', mimeType: 'video/mp4', size: data.length, origin: 'https://laboda.es' });
  const half = env.call('chunk', { key: KEY, uploadUrl: s.uploadUrl, start: 0, total: data.length, data: data.subarray(0, s.chunkSize).toString('base64') });
  assert.deepStrictEqual(half, { ok: true, done: false, received: s.chunkSize });
  const q = env.call('query', { key: KEY, uploadUrl: s.uploadUrl, total: data.length });
  assert.strictEqual(q.received, s.chunkSize, 'tras un corte, sabe por dónde seguir');
  let r;
  for (let start = s.chunkSize; start < data.length; start += s.chunkSize) {
    r = env.call('chunk', { key: KEY, uploadUrl: s.uploadUrl, start, total: data.length, data: data.subarray(start, start + s.chunkSize).toString('base64') });
  }
  assert.ok(r.done && r.fileId);
  assert.ok(env.drive.files.get(r.fileId).data.equals(data), 'el archivo en Drive es idéntico al original');
});

test('plan B: no se puede usar el script para llamar a otras webs', () => {
  const env = makeEnv();
  assert.strictEqual(env.call('chunk', { key: KEY, uploadUrl: 'https://evil.example/x?upload_id=1', start: 0, total: 3, data: 'YWJj' }).error, 'url');
  assert.strictEqual(env.call('query', { key: KEY, uploadUrl: 'https://www.googleapis.com/drive/v3/files/abc', total: 3 }).error, 'url');
  assert.strictEqual(env.drive.calls.length, 0);
});

test('plan B: rechaza trozos fuera de rango y sesiones caducadas', () => {
  const env = makeEnv();
  const s = env.call('start', { key: KEY, name: 'a.jpg', mimeType: 'image/jpeg', size: 3, origin: 'https://laboda.es' });
  assert.strictEqual(env.call('chunk', { key: KEY, uploadUrl: s.uploadUrl, start: 2, total: 3, data: 'YWJj' }).error, 'range');
  assert.strictEqual(env.call('chunk', { key: KEY, uploadUrl: s.uploadUrl.replace(/upload_id=\w+/, 'upload_id=nope'), start: 0, total: 3, data: 'YWJj' }).error, 'expired');
});

test('si Drive no devuelve la sesión, lo dice claramente', () => {
  const env = makeEnv(); env.drive.noLocation = true;
  assert.strictEqual(env.call('start', { key: KEY, name: 'a.jpg', mimeType: 'image/jpeg', size: 3 }).error, 'drive');
});

function uploadN(env, n, opts = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const data = Buffer.from('foto' + i);
    const s = env.call('start', { key: KEY, name: (opts.video ? 'v' : 'f') + i + (opts.video ? '.mp4' : '.jpg'), mimeType: opts.video ? 'video/mp4' : 'image/jpeg', size: data.length, guest: opts.guest || 'Ana', origin: 'https://laboda.es' });
    ids.push(uploadViaProxy(env, data, s.uploadUrl, s.chunkSize).fileId);
  }
  return ids;
}

test('galería: diferido de 5 minutos y publicación solo con enlace', () => {
  const env = makeEnv();
  const [old] = uploadN(env, 1);
  env.tick(6 * 60 * 1000);
  const [fresh] = uploadN(env, 1, { video: true });
  const g = env.call('gallery', { key: KEY }, 'get');
  assert.ok(g.ok && g.enabled);
  assert.deepStrictEqual(g.items.map(i => i.id), [old], 'la recién subida espera su diferido');
  assert.strictEqual(g.pending, 1);
  assert.deepStrictEqual(env.drive.files.get(old).perms, ['anyoneWithLink']);
  assert.deepStrictEqual(env.drive.files.get(fresh).perms, [], 'nada se publica antes de tiempo');
  assert.strictEqual(g.items[0].guest, 'Ana');
  assert.strictEqual(g.items[0].w, 3024, 'respeta la rotación del móvil');
  env.tick(6 * 60 * 1000); env.cache.clear();
  const g2 = env.call('gallery', { key: KEY }, 'get');
  assert.deepStrictEqual(g2.items.map(i => i.id), [fresh, old], 'más recientes primero');
  assert.strictEqual(g2.items[0].type, 'video'); assert.strictEqual(g2.items[0].dur, 12);
});

test('galería: la caché evita repetir consultas a Drive', () => {
  const env = makeEnv();
  uploadN(env, 2); env.tick(10 * 60 * 1000);
  env.call('gallery', { key: KEY }, 'get');
  const before = env.drive.calls.length;
  env.call('gallery', { key: KEY }, 'get');
  assert.strictEqual(env.drive.calls.length, before, 'segunda llamada en 30 s sale de la caché');
  env.tick(31 * 1000);
  env.call('gallery', { key: KEY }, 'get');
  assert.ok(env.drive.calls.length > before, 'pasados 30 s se refresca');
});

test('galería: borrar o mover a "No publicar" la retira y la despublica', () => {
  const env = makeEnv();
  const [a, b] = uploadN(env, 2); env.tick(10 * 60 * 1000);
  env.call('gallery', { key: KEY }, 'get');
  env.drive.files.get(a).trashed = true;
  env.drive.files.get(b).parents = [env.props.get('HIDDEN_FOLDER_ID')];
  env.cache.clear();
  const g = env.call('gallery', { key: KEY }, 'get');
  assert.strictEqual(g.items.length, 0);
  assert.deepStrictEqual(env.drive.files.get(b).perms, [], 'la movida a "No publicar" deja de ser accesible por enlace');
  assert.strictEqual(env.drive.files.get(b).appProperties.pub, '0');
});

test('galería: publica como mucho 40 nuevas por refresco y sigue en el siguiente', () => {
  const env = makeEnv();
  uploadN(env, 50); env.tick(10 * 60 * 1000);
  assert.strictEqual(env.call('gallery', { key: KEY }, 'get').items.length, 40);
  env.cache.clear();
  assert.strictEqual(env.call('gallery', { key: KEY }, 'get').items.length, 50);
});

test('galería: se puede apagar sin tocar el código', () => {
  const env = makeEnv();
  env.props.set('GALLERY_ENABLED', 'false');
  assert.deepStrictEqual(env.call('gallery', { key: KEY }, 'get'), { ok: true, enabled: false, items: [] });
  env.props.set('GALLERY_ENABLED', 'true'); env.props.set('GALLERY_DELAY_MIN', '0');
  uploadN(env, 1);
  assert.strictEqual(env.call('gallery', { key: KEY }, 'get').items.length, 1, 'diferido configurable a 0');
});

test('si los novios borran la carpeta, se crea otra nueva', () => {
  const env = makeEnv();
  uploadN(env, 1);
  const first = env.props.get('FOLDER_ID');
  env.drive.files.get(first).trashed = true; env.cache.clear();
  uploadN(env, 1);
  assert.notStrictEqual(env.props.get('FOLDER_ID'), first);
});

test('resumen para los novios solo con su clave', () => {
  const env = makeEnv();
  assert.strictEqual(env.call('status', { admin: 'x' }, 'get').error, 'admin');
  env.ctx.setup();
  const admin = env.props.get('ADMIN_KEY');
  uploadN(env, 3); uploadN(env, 1, { video: true });
  const st = env.call('status', { admin }, 'get');
  assert.deepStrictEqual([st.total, st.photos, st.videos, st.hidden], [4, 3, 1, 0]);
  assert.strictEqual(st.storageLimitGB, 16.1);
});

let ok = 0;
for (const t of tests) {
  try { t.fn(); ok++; console.log('  ✓ ' + t.name); }
  catch (e) { console.log('  ✗ ' + t.name + '\n    ' + (e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
}
console.log(`\n${ok}/${tests.length} pruebas superadas`);
process.exit(ok === tests.length ? 0 : 1);
