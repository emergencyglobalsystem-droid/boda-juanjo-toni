# Fotos de los invitados · backend

Script de Google Apps Script que guarda las fotos y vídeos de los invitados en el Drive de la cuenta de la boda y alimenta la galería de la web. Esta carpeta empieza por `_` para que GitHub Pages no la publique.

- `Code.gs` y `appsscript.json`: el script (se pega en la cuenta de Google).
- `test/run.js`: pruebas con un Drive simulado → `node _backend-fotos/test/run.js`
- `test/live.js`: prueba real una vez desplegado → `node _backend-fotos/test/live.js URL_EXEC [CLAVE_ADMIN]`

## Activarlo en la cuenta de la boda (10 minutos)

1. Entrar en **script.google.com** con la cuenta de Google de la boda y pulsar **Nuevo proyecto**. Ponerle de nombre **Fotos boda** (arriba a la izquierda).
2. En **Configuración del proyecto** (la rueda ⚙ de la izquierda) marcar **Mostrar el archivo de manifiesto "appsscript.json" en el editor**.
3. Volver al **Editor** (`< >`):
   - En `Código.gs`, borrar todo y pegar el contenido de `Code.gs`.
   - En `appsscript.json`, borrar todo y pegar el contenido de `appsscript.json`.
   - Guardar (icono del disquete).
4. Arriba, en el desplegable de funciones, elegir **setup** y pulsar **▶ Ejecutar**.
   - Pedirá permisos: **Revisar permisos** → elegir la cuenta de la boda.
   - Saldrá "Google no ha verificado esta aplicación". Es normal: el script es vuestro. Pulsar **Configuración avanzada** → **Ir a Fotos boda (no seguro)** → **Permitir**.
   - Los permisos son solo dos: archivos de Drive *que cree esta aplicación* (no ve nada más del Drive) y conectarse a servicios externos (para hablar con Drive).
5. Abajo saldrá el **Registro de ejecución** con el enlace de la carpeta de fotos, el espacio libre y la **clave de administración**. Guardar esa clave.
6. Arriba a la derecha: **Implementar → Nueva implementación** → en el engranaje elegir **Aplicación web**:
   - Descripción: `v1`
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** y copiar la **URL de la aplicación web** (termina en `/exec`).
7. Pasar esa URL (y, si se quiere, la clave de administración) para conectarla con la web.

Si más adelante cambia el código: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL no cambia.

## Durante la boda

- Las fotos llegan a la carpeta **Boda Toñi & Juanjo · Fotos de los invitados** del Drive.
- La galería de la web muestra cada foto **5 minutos después** de subirse.
- Para quitar una foto de la galería: **borrarla** o **moverla a la carpeta "No publicar"** (está dentro de la carpeta de fotos). En menos de un minuto desaparece de la web y deja de ser accesible por enlace.

## Ajustes sin tocar el código

En **Configuración del proyecto → Propiedades del script** se pueden añadir:

| Propiedad | Ejemplo | Qué hace |
|---|---|---|
| `GALLERY_DELAY_MIN` | `10` | Minutos de diferido de la galería |
| `GALLERY_ENABLED` | `false` | Apaga la galería (las subidas siguen funcionando) |
| `MAX_VIDEO_MB` | `500` | Tamaño máximo de vídeo |
| `MAX_PHOTO_MB` | `60` | Tamaño máximo de foto |
