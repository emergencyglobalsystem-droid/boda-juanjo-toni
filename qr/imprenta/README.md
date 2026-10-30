# Tarjetas de misión para imprimir

Tarjeta de 85 × 55 mm (tamaño tarjeta de visita), una por misión, con el QR de su misión.

| Archivo | Para qué |
|---|---|
| `tarjetas-imprenta-85x55-sangrado3mm.pdf` | Para la imprenta. 13 páginas de 91 × 61 mm: tarjeta de 85 × 55 mm con 3 mm de sangrado por lado. Fuentes incrustadas. |
| `tarjetas-A4-para-recortar.pdf` | Para imprimir en casa o en copistería. A4 con 10 tarjetas por hoja (2 hojas) y marcas de corte. Imprimir al 100 %, sin "ajustar a página". |
| `png/tarjeta-NN-codigo.png` | Cada tarjeta suelta a tamaño final (unos 500 ppp), para enviar o revisar. |

Recomendación de papel: cartulina blanca mate de 300 a 350 g. El brillo dificulta un poco leer el QR con luz directa.

El número de la tarjeta (Nº 01 a Nº 13) coincide con el de la misión en `q/misiones.js`. El hueco "Agente" es para escribir a mano el nombre de la persona.

Todos los QR se han comprobado leyendo la imagen renderizada, también a baja resolución.

## Regenerar

En `fuente/`: `npm i qrcode && node build.js`, y después imprimir a PDF con Chrome:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --allow-file-access-from-files --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf=../tarjetas-imprenta-85x55-sangrado3mm.pdf "file://$PWD/tarjetas-imprenta.html"
```
