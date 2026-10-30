// Genera las tarjetas de misión (85 x 55 mm) para imprenta y para A4.
// Uso: npm i qrcode && node build.js  -> escribe tarjetas-imprenta.html, tarjetas-a4.html y check-NN.html
// Luego se imprimen a PDF con Chrome (ver README.md de esta carpeta).
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const REPO = path.resolve(__dirname, '../../..');
const codes = fs.readFileSync(path.join(REPO, 'qr/codigos.txt'), 'utf8').trim().split('\n')
  .map(l => { const [n, c, url] = l.split(' '); return { n, c, url }; });

const b64 = f => fs.readFileSync(path.join(__dirname, f)).toString('base64');
const IMG = {
  flor1: 'data:image/webp;base64,' + b64('deco-flor-1.webp'),
  flor2: 'data:image/webp;base64,' + b64('deco-flor-2.webp'),
  flor3: 'data:image/webp;base64,' + b64('deco-flor-3.webp'),
  gato1: 'data:image/png;base64,' + b64('gato-1.png'),
  gato2: 'data:image/png;base64,' + b64('gato-2.png'),
  gato3: 'data:image/png;base64,' + b64('gato-3.png'),
};

const INK = '#0D0D0D';
const BRAND_DEEP = '#9d6016';

// QR vectorial: módulos redondeados, ojos en marrón de marca, monograma en el centro.
function qrSvg(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const N = qr.modules.size;
  const dark = (r, c) => qr.modules.get(r, c) === 1;
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
  const mid = (N - 1) / 2;
  const LOGO_R = 3.6; // radio (en módulos) del hueco central
  const inLogo = (r, c) => Math.hypot(r - mid, c - mid) <= LOGO_R + 0.5;
  let body = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!dark(r, c) || inFinder(r, c) || inLogo(r, c)) continue;
    body += `<rect x="${c + 0.06}" y="${r + 0.06}" width="0.88" height="0.88" rx="0.32"/>`;
  }
  const eye = (x, y) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.7" fill="none" stroke="${BRAND_DEEP}" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" fill="${BRAND_DEEP}"/>`;
  const logo =
    `<circle cx="${mid + 0.5}" cy="${mid + 0.5}" r="${LOGO_R}" fill="#fff" stroke="${BRAND_DEEP}" stroke-width="0.18"/>` +
    `<text x="${mid + 0.5}" y="${mid + 1.75}" text-anchor="middle" font-family="Dancing Script" font-weight="700" font-size="3.6" fill="${BRAND_DEEP}">T&amp;J</text>`;
  return { N, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="geometricPrecision"><g fill="${INK}">${body}</g>${eye(0, 0)}${eye(N - 7, 0)}${eye(0, N - 7)}${logo}</svg>` };
}

// Reparto de gatos y flores entre las 13 tarjetas
const GATOS = ['gato2', 'gato3', 'gato1'];
const FLORES = ['flor1', 'flor2', 'flor3'];

function card({ n, url }, i) {
  const { svg } = qrSvg(url);
  const gato = GATOS[i % 3];
  const flor = FLORES[i % 3];
  return `
  <div class="card">
    <img class="flor ${flor}" src="${IMG[flor]}" alt="">
    <div class="left">
      <div class="eyebrow">Misión confidencial</div>
      <div class="title">Atención,<br>agente<span class="stamp">Top secret</span></div>
      <div class="sub">Escanea el código y descubre la misión que te ha sido encomendada.</div>
      <div class="agent"><span>Agente</span><i></i></div>
    </div>
    <div class="right">
      <div class="qrbox">${svg}</div>
      <div class="num"><b>Nº ${n}</b> · Toñi &amp; Juanjo · 07.11.26</div>
    </div>
    <img class="gato ${gato}" src="${IMG[gato]}" alt="">
  </div>`;
}

const fontsCss = fs.readFileSync(path.join(__dirname, 'fonts.css'), 'utf8');

// La tarjeta se dibuja a 91 x 61 mm (85 x 55 + 3 mm de sangrado por lado).
const CARD_CSS = `
${fontsCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.card {
  position: relative; width: 91mm; height: 61mm; overflow: hidden;
  background: #fff; font-family: 'Cormorant Garamond', Georgia, serif; color: ${INK};
}
/* marco fino dentro de la zona segura */
.card::before {
  content: ''; position: absolute; inset: 6.2mm; border: 0.25mm solid #F2B366; border-radius: 2.2mm; z-index: 1;
  pointer-events: none;
}
.flor { position: absolute; opacity: 0.55; z-index: 0; }
.flor1 { width: 30mm; left: -6mm; top: -8mm; transform: rotate(160deg); }
.flor2 { width: 22mm; left: -3mm; top: -10mm; transform: rotate(180deg); }
.flor3 { width: 22mm; left: -2mm; top: -9mm; transform: rotate(175deg); }
.left {
  position: absolute; z-index: 2; left: 10.5mm; top: 12.2mm; width: 35mm;
}
.eyebrow { font-weight: 700; font-size: 5.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: ${BRAND_DEEP}; }
.title { position: relative; font-family: 'Dancing Script', cursive; font-weight: 700; font-size: 21pt; line-height: 0.98; margin-top: 1.6mm; }
.sub { font-style: italic; font-size: 7.6pt; line-height: 1.22; color: #4a4a4a; margin-top: 2mm; width: 33mm; }
.agent { display: flex; align-items: flex-end; gap: 1.5mm; margin-top: 3mm; width: 33mm; }
.agent span { font-weight: 700; font-size: 5.4pt; letter-spacing: 0.2em; text-transform: uppercase; color: #8a8a8a; }
.agent i { flex: 1; border-bottom: 0.25mm dotted #9a9a9a; height: 3.4mm; }
.right { position: absolute; z-index: 2; right: 9.6mm; top: 11.4mm; width: 34mm; text-align: center; }
.qrbox { width: 34mm; height: 34mm; padding: 2.2mm; background: #fff; border-radius: 2.4mm;
  box-shadow: 0 0 0 0.25mm #F2B366; }
.qrbox svg { width: 100%; height: 100%; display: block; }
.num { font-size: 5.6pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8a8a8a; margin-top: 1.4mm; white-space: nowrap; }
.num b { color: ${BRAND_DEEP}; font-weight: 700; }
.stamp {
  position: absolute; z-index: 3; left: 18.6mm; top: 7.4mm; transform: rotate(-10deg); line-height: 1.2; white-space: nowrap; font-family: 'Cormorant Garamond', serif;
  font-weight: 700; font-size: 5pt; letter-spacing: 0.17em; text-transform: uppercase; color: #b03a2e;
  border: 0.35mm solid #b03a2e; border-radius: 0.8mm; padding: 0.5mm 1.4mm 0.4mm 1.6mm; background: rgba(255,255,255,0.9);
}
/* gatos asomando por el borde inferior (se cortan con la tarjeta) */
.gato { position: absolute; z-index: 2; }
.gato2 { width: 17mm; left: 11mm; bottom: -3.5mm; }
.gato3 { width: 18mm; left: 10mm; bottom: -3.4mm; }
.gato1 { width: 27mm; left: 10mm; bottom: -3mm; transform: rotate(-3deg); filter: drop-shadow(0 0 0.35mm rgba(0,0,0,0.28)); }
`;

// 1) Imprenta: una tarjeta por página, 91 x 61 mm con sangrado
const imprenta = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Tarjetas misión · imprenta</title>
<style>${CARD_CSS}
@page { size: 91mm 61mm; margin: 0; }
.page { width: 91mm; height: 61mm; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
</style></head><body>${codes.map((c, i) => `<div class="page">${card(c, i)}</div>`).join('')}</body></html>`;
fs.writeFileSync(path.join(__dirname, 'tarjetas-imprenta.html'), imprenta);

// 2) A4: 2 x 5 tarjetas a tamaño final (85 x 55) con marcas de corte
const perPage = 10, cols = 2, W = 85, H = 55;
const ox = (210 - cols * W) / 2, oy = (297 - 5 * H) / 2;
let a4 = '';
for (let p = 0; p < codes.length; p += perPage) {
  const slice = codes.slice(p, p + perPage);
  let cells = '', marks = '';
  slice.forEach((c, k) => {
    const col = k % cols, row = Math.floor(k / cols);
    cells += `<div class="cell" style="left:${ox + col * W}mm;top:${oy + row * H}mm">${card(c, p + k)}</div>`;
  });
  const rows = Math.ceil(slice.length / cols);
  const xs = [0, 1, 2].map(i => ox + i * W), ys = [...Array(rows + 1).keys()].map(i => oy + i * H);
  xs.forEach(x => { marks += `<i class="mv" style="left:${x}mm;top:${oy - 8}mm"></i><i class="mv" style="left:${x}mm;top:${oy + rows * H + 2}mm"></i>`; });
  ys.forEach(y => { marks += `<i class="mh" style="top:${y}mm;left:${ox - 8}mm"></i><i class="mh" style="top:${y}mm;left:${ox + cols * W + 2}mm"></i>`; });
  a4 += `<div class="sheet">${cells}${marks}</div>`;
}
const a4html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Tarjetas misión · A4</title>
<style>${CARD_CSS}
@page { size: A4; margin: 0; }
.sheet { position: relative; width: 210mm; height: 297mm; page-break-after: always; break-after: page; overflow: hidden; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.cell { position: absolute; width: ${W}mm; height: ${H}mm; overflow: hidden; outline: 0.1mm solid #e3e3e3; }
.cell .card { position: absolute; left: -3mm; top: -3mm; }
.mv { position: absolute; width: 0; height: 6mm; border-left: 0.15mm solid #000; }
.mh { position: absolute; height: 0; width: 6mm; border-top: 0.15mm solid #000; }
.foot { position: absolute; bottom: 4mm; left: 0; right: 0; text-align: center; font: italic 8pt 'Cormorant Garamond', serif; color: #999; }
</style></head><body>${a4}</body></html>`;
fs.writeFileSync(path.join(__dirname, 'tarjetas-a4.html'), a4html);

// 3) Una página por tarjeta a tamaño final, para capturas y para comprobar los QR
codes.forEach((c, i) => {
  fs.writeFileSync(path.join(__dirname, `check-${c.n}.html`),
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${CARD_CSS} body{background:#ddd;padding:0}
     .trim{position:relative;width:85mm;height:55mm;overflow:hidden}.trim .card{position:absolute;left:-3mm;top:-3mm}</style></head>
     <body><div class="trim">${card(c, i)}</div></body></html>`);
});
console.log('ok:', codes.length, 'tarjetas; versión QR', qrSvg(codes[0].url).N, 'módulos');
