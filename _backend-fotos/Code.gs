/**
 * Fotos de los invitados · Boda Toñi & Juanjo (07.11.2026)
 * Backend en Google Apps Script, desplegado en la cuenta de Google de la boda.
 *
 * Qué hace:
 *  - start   : valida la subida y abre una "sesión de subida reanudable" de Google Drive. El móvil
 *              sube el archivo directamente a Drive por trozos (calidad original, vídeos incluidos).
 *  - chunk   : plan B. Si el navegador no puede subir directo a Drive, manda los trozos aquí y el
 *              script los reenvía a la misma sesión.
 *  - query   : pregunta cuántos bytes ha recibido ya Drive (para reanudar tras un corte).
 *  - gallery : lista para la galería de la web. Solo salen fotos con más de GALLERY_DELAY_MIN
 *              minutos, para dar tiempo a quitar las que no queráis mostrar.
 *  - status  : resumen para los novios (requiere ADMIN_KEY).
 *
 * Permisos: solo "drive.file". El script SOLO ve los archivos y carpetas que él mismo crea;
 * no puede ver ni tocar nada más del Drive de la cuenta.
 *
 * Para retirar una foto de la galería: borradla (papelera) o movedla a la carpeta
 * "No publicar" que hay dentro de la carpeta de fotos.
 */

// ───────────────────────── Configuración ─────────────────────────
var CONFIG = {
  FOLDER_NAME: 'Boda Toñi & Juanjo · Fotos de los invitados',
  HIDDEN_FOLDER_NAME: 'No publicar',
  // Orígenes desde los que se permite subir directamente a Drive
  ALLOWED_ORIGINS: ['https://laboda.es', 'https://www.laboda.es', 'http://localhost:8931'],
  // Misma contraseña que la web. No es un secreto (está en la web): solo frena a bots.
  SITE_KEY: 'laboda2026',
  MAX_PHOTO_MB: 60,
  MAX_VIDEO_MB: 1024,
  CHUNK_MB: 8,                 // tamaño de trozo recomendado (múltiplo de 256 KB)
  GALLERY_ENABLED: true,
  GALLERY_DELAY_MIN: 5,        // minutos de "diferido" antes de que una foto salga en la galería
  GALLERY_CACHE_SEC: 30,       // la lista se recalcula como mucho cada 30 s
  SHARE_PER_REFRESH: 40,       // máximo de fotos nuevas que se publican en cada refresco
  TIMEZONE: 'Europe/Madrid'
};

var DRIVE = 'https://www.googleapis.com/drive/v3';
var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
var PHOTO_EXT = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'];
var VIDEO_EXT = ['mp4', 'mov', 'm4v', '3gp', 'webm'];

// Algunos ajustes se pueden cambiar sin tocar el código, en Configuración del proyecto › Propiedades del script
function setting_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (v === null || v === '') return CONFIG[name];
  if (typeof CONFIG[name] === 'number') return Number(v);
  if (typeof CONFIG[name] === 'boolean') return v === 'true';
  return v;
}

// ───────────────────────── Entradas web ─────────────────────────
function doGet(e) {
  var p = (e && e.parameter) || {};
  return handle_(p.action || 'ping', p);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'json' }); }
  return handle_(body.action, body);
}

function handle_(action, p) {
  try {
    if (action === 'ping') return json_({ ok: true, pong: true });
    if (action === 'status') return json_(status_(p));
    if (p.key !== CONFIG.SITE_KEY) return json_({ ok: false, error: 'key' });
    if (action === 'start') return json_(start_(p));
    if (action === 'chunk') return json_(chunk_(p));
    if (action === 'query') return json_(query_(p));
    if (action === 'gallery') return json_(gallery_());
    return json_({ ok: false, error: 'action' });
  } catch (err) {
    console.error(action, err && err.stack || err);
    return json_({ ok: false, error: 'server', detail: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────── Subida ─────────────────────────
function classify_(name, mime) {
  var ext = String(name || '').toLowerCase().split('.').pop();
  mime = String(mime || '').toLowerCase();
  if (/^image\//.test(mime) || PHOTO_EXT.indexOf(ext) >= 0) return 'photo';
  if (/^video\//.test(mime) || VIDEO_EXT.indexOf(ext) >= 0) return 'video';
  return null;
}

function cleanGuest_(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f\/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanFileName_(s) {
  var n = String(s || '').replace(/[\u0000-\u001f\u007f\/\\]+/g, '_').trim();
  return (n || 'archivo').slice(-80);
}

function start_(p) {
  var size = Number(p.size);
  var kind = classify_(p.name, p.mimeType);
  if (!kind) return { ok: false, error: 'type' };
  if (!(size > 0)) return { ok: false, error: 'size' };
  var maxMb = kind === 'video' ? setting_('MAX_VIDEO_MB') : setting_('MAX_PHOTO_MB');
  if (size > maxMb * 1024 * 1024) return { ok: false, error: 'too_big', maxMb: maxMb };
  var origin = CONFIG.ALLOWED_ORIGINS.indexOf(p.origin) >= 0 ? p.origin : CONFIG.ALLOWED_ORIGINS[0];

  var guest = cleanGuest_(p.guest);
  var stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH.mm.ss');
  var mime = p.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
  var meta = {
    name: stamp + ' · ' + (guest || 'Invitado') + ' · ' + cleanFileName_(p.name),
    parents: [folders_().main],
    mimeType: mime,
    description: 'Subida desde laboda.es por ' + (guest || 'un invitado sin nombre'),
    appProperties: { guest: guest, kind: kind, src: 'laboda' }
  };
  var res = UrlFetchApp.fetch(UPLOAD + '?uploadType=resumable&fields=id,name,mimeType,size', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
      Origin: origin   // permite que el navegador suba directamente desde ese origen
    },
    payload: JSON.stringify(meta),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var headers = res.getAllHeaders();
  var location = headers.Location || headers.location;
  if (code !== 200 || !location) return { ok: false, error: 'drive', code: code };
  return { ok: true, uploadUrl: location, chunkSize: setting_('CHUNK_MB') * 1024 * 1024, kind: kind };
}

// Solo aceptamos URLs de sesión de subida de Drive (evita usar el script como proxy de cualquier cosa)
function checkUploadUrl_(u) {
  return typeof u === 'string' && u.indexOf(UPLOAD + '?') === 0 && /[?&]upload_id=/.test(u);
}

function parseRange_(h) {
  var r = h && (h.Range || h.range);
  var m = r && String(r).match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;   // bytes ya recibidos
}

function chunk_(p) {
  if (!checkUploadUrl_(p.uploadUrl)) return { ok: false, error: 'url' };
  var bytes = Utilities.base64Decode(p.data || '');
  var start = Number(p.start), total = Number(p.total);
  if (!(total > 0) || !(start >= 0) || !bytes.length || start + bytes.length > total) return { ok: false, error: 'range' };
  if (bytes.length > (setting_('CHUNK_MB') + 1) * 1024 * 1024) return { ok: false, error: 'chunk_too_big' };
  var res = UrlFetchApp.fetch(p.uploadUrl, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total },
    payload: bytes,
    followRedirects: false,
    muteHttpExceptions: true
  });
  return uploadResult_(res);
}

function query_(p) {
  if (!checkUploadUrl_(p.uploadUrl)) return { ok: false, error: 'url' };
  var res = UrlFetchApp.fetch(p.uploadUrl, {
    method: 'put',
    headers: { 'Content-Range': 'bytes */' + Number(p.total) },
    followRedirects: false,
    muteHttpExceptions: true
  });
  return uploadResult_(res);
}

function uploadResult_(res) {
  var code = res.getResponseCode();
  if (code === 200 || code === 201) {
    var f = JSON.parse(res.getContentText() || '{}');
    return { ok: true, done: true, fileId: f.id };
  }
  if (code === 308) return { ok: true, done: false, received: parseRange_(res.getAllHeaders()) };
  if (code === 404 || code === 410) return { ok: false, error: 'expired' };
  return { ok: false, error: 'drive', code: code };
}

// ───────────────────────── Carpetas ─────────────────────────
function drive_(method, path, body, query) {
  var url = DRIVE + path + (query ? '?' + query : '');
  var opt = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body) { opt.contentType = 'application/json; charset=UTF-8'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(url, opt);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) throw new Error('Drive ' + method + ' ' + path + ' → ' + code + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : {};
}

function folderAlive_(id) {
  if (!id) return false;
  try { return !drive_('get', '/files/' + id, null, 'fields=id,trashed').trashed; }
  catch (err) { return false; }
}

function folders_() {
  var props = PropertiesService.getScriptProperties();
  var main = props.getProperty('FOLDER_ID');
  var hidden = props.getProperty('HIDDEN_FOLDER_ID');
  var cache = CacheService.getScriptCache();
  if (main && hidden && cache.get('folders_ok') === main) return { main: main, hidden: hidden };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    main = props.getProperty('FOLDER_ID');
    hidden = props.getProperty('HIDDEN_FOLDER_ID');
    if (!folderAlive_(main)) {
      main = drive_('post', '/files', { name: CONFIG.FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, 'fields=id').id;
      props.setProperty('FOLDER_ID', main);
      hidden = null;
    }
    if (!folderAlive_(hidden)) {
      hidden = drive_('post', '/files', { name: CONFIG.HIDDEN_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [main] }, 'fields=id').id;
      props.setProperty('HIDDEN_FOLDER_ID', hidden);
    }
    cache.put('folders_ok', main, 600);
    return { main: main, hidden: hidden };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────── Galería ─────────────────────────
function listFolder_(folderId, extraQ) {
  var out = [], token = '';
  var fields = 'nextPageToken,files(id,mimeType,createdTime,appProperties,imageMediaMetadata(width,height,rotation),videoMediaMetadata(width,height,durationMillis))';
  for (var page = 0; page < 10; page++) {
    var q = "'" + folderId + "' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'" + (extraQ || '');
    var r = drive_('get', '/files', null,
      'q=' + encodeURIComponent(q) + '&orderBy=createdTime%20desc&pageSize=1000&fields=' + encodeURIComponent(fields) +
      (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    out = out.concat(r.files || []);
    token = r.nextPageToken;
    if (!token) break;
  }
  return out;
}

function setPublic_(id, on) {
  if (on) {
    drive_('post', '/files/' + id + '/permissions', { type: 'anyone', role: 'reader', allowFileDiscovery: false }, 'fields=id');
  } else {
    try { drive_('delete', '/files/' + id + '/permissions/anyoneWithLink'); } catch (err) { /* ya no era pública */ }
  }
  drive_('patch', '/files/' + id, { appProperties: { pub: on ? '1' : '0' } }, 'fields=id');
}

function gallery_() {
  if (!setting_('GALLERY_ENABLED')) return { ok: true, enabled: false, items: [] };
  var cache = CacheService.getScriptCache();
  var hit = cache.get('gallery');
  if (hit) return JSON.parse(hit);

  var f = folders_();
  var delayMs = setting_('GALLERY_DELAY_MIN') * 60 * 1000;
  var now = Date.now();
  var files = listFolder_(f.main);
  var ready = files.filter(function (x) { return now - new Date(x.createdTime).getTime() >= delayMs; });
  var pending = files.length - ready.length;

  // Publicar (solo con enlace) las que ya han pasado el diferido; despublicar las movidas a "No publicar"
  var lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) {
    try {
      var toShare = ready.filter(function (x) { return !(x.appProperties && x.appProperties.pub === '1'); })
        .slice(0, setting_('SHARE_PER_REFRESH'));
      toShare.forEach(function (x) {
        try { setPublic_(x.id, true); x.appProperties = x.appProperties || {}; x.appProperties.pub = '1'; }
        catch (err) { console.error('share', x.id, err); }
      });
      listFolder_(f.hidden, " and appProperties has { key='pub' and value='1' }").forEach(function (x) {
        try { setPublic_(x.id, false); } catch (err) { console.error('unshare', x.id, err); }
      });
    } finally { lock.releaseLock(); }
  }

  var items = ready.filter(function (x) { return x.appProperties && x.appProperties.pub === '1'; }).map(function (x) {
    var video = /^video\//.test(x.mimeType) || (x.appProperties && x.appProperties.kind === 'video');
    var m = (video ? x.videoMediaMetadata : x.imageMediaMetadata) || {};
    var rotated = m.rotation === 1 || m.rotation === 3;
    return {
      id: x.id,
      type: video ? 'video' : 'photo',
      guest: (x.appProperties && x.appProperties.guest) || '',
      t: x.createdTime,
      w: (rotated ? m.height : m.width) || null,
      h: (rotated ? m.width : m.height) || null,
      dur: video && m.durationMillis ? Math.round(Number(m.durationMillis) / 1000) : null
    };
  });
  var out = { ok: true, enabled: true, items: items, pending: pending, updated: new Date(now).toISOString() };
  try { cache.put('gallery', JSON.stringify(out), setting_('GALLERY_CACHE_SEC')); } catch (err) { /* lista demasiado grande para caché */ }
  return out;
}

// ───────────────────────── Para los novios ─────────────────────────
function status_(p) {
  var admin = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!admin || p.admin !== admin) return { ok: false, error: 'admin' };
  var f = folders_();
  var files = listFolder_(f.main);
  var hidden = listFolder_(f.hidden);
  var photos = files.filter(function (x) { return !/^video\//.test(x.mimeType); }).length;
  var about = drive_('get', '/about', null, 'fields=storageQuota');
  var q = about.storageQuota || {};
  var gb = function (b) { return b ? Math.round(Number(b) / 1e8) / 10 : null; };
  return {
    ok: true,
    total: files.length, photos: photos, videos: files.length - photos, hidden: hidden.length,
    storageUsedGB: gb(q.usage), storageLimitGB: gb(q.limit)
  };
}

/**
 * Ejecutar UNA vez desde el editor (botón ▶ con "setup" seleccionado) para dar permisos,
 * crear las carpetas y generar la clave de administración. El resultado sale en el registro.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().slice(0, 8));
  var f = folders_();
  var about = drive_('get', '/about', null, 'fields=storageQuota,user(emailAddress)');
  console.log('Cuenta: ' + about.user.emailAddress);
  console.log('Carpeta de fotos: https://drive.google.com/drive/folders/' + f.main);
  console.log('Carpeta "No publicar": https://drive.google.com/drive/folders/' + f.hidden);
  console.log('Clave de administración (para ver el resumen): ' + props.getProperty('ADMIN_KEY'));
  console.log('Espacio usado: ' + Math.round(about.storageQuota.usage / 1e8) / 10 + ' GB de ' +
    (about.storageQuota.limit ? Math.round(about.storageQuota.limit / 1e8) / 10 + ' GB' : 'ilimitado'));
}
