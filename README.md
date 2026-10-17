<p align="center"><img src="docs/banner.png" alt="Inventario de Vinilos: tus discos en estanterías, con portadas y la misma colección en el móvil y en el ordenador" width="100%"></p>

<p align="center">
  <a href="https://ivanchux.github.io/inventario-vinilos/"><img alt="Abrir la app" src="https://img.shields.io/badge/abrir-la%20app-e8a54b?style=for-the-badge"></a>
  <a href="https://github.com/ivanchux/inventario-vinilos/actions/workflows/deploy.yml"><img alt="Pruebas y despliegue" src="https://github.com/ivanchux/inventario-vinilos/actions/workflows/deploy.yml/badge.svg"></a>
  <img alt="PWA instalable" src="https://img.shields.io/badge/PWA-instalable%20y%20sin%20conexión-63dfa0">
  <img alt="Sin dependencias" src="https://img.shields.io/badge/dependencias-0-c97a45">
  <a href="LICENSE"><img alt="Licencia PolyForm Noncommercial" src="https://img.shields.io/badge/licencia-PolyForm%20Noncommercial-lightgrey"></a>
</p>

<p align="center"><b>Tu colección de vinilos en estanterías, con portadas, estadísticas y la misma colección en el móvil y en el ordenador.<br>Funciona sin conexión, se instala como una app y no necesita cuentas.</b></p>

<p align="center"><img src="docs/estanterias.png" alt="Estanterías con los discos" width="860"></p>

> Nació para digitalizar la colección de vinilos de mi padre (varios cientos de discos apuntados a mano desde los años 80). La versión 2 se rehízo por dentro para que **no se pueda perder ni un disco**: lo que pasó con la versión anterior está explicado más abajo.

## Qué hace

**Organizar**
- Estanterías con los discos en carrusel. Se ordenan a mano (arrastrando, en el ordenador), por artista, año, título o los más recientes.
- Vista de **tabla** ordenable y exportable a Excel, y vista de **estadísticas** (géneros, décadas, artistas, formatos, valoraciones, valor estimado).
- Búsqueda por título, artista, género, año o etiqueta; filtros «Los tengo / Los quiero» y por género.

**Añadir discos sin esfuerzo**
- Escribe el título y el artista y pulsa **Buscar datos y portada**: la app consulta [MusicBrainz](https://musicbrainz.org) y [Cover Art Archive](https://coverartarchive.org) y rellena año, género y portada.
- O haz una foto a la portada con el móvil: se comprime sola.
- «Guardar y añadir otro» para meter muchos discos seguidos.

**Cada disco, con su ficha**
- Portada con el vinilo del color real, valoración con un toque, precio, estado, fecha de compra, canciones, etiquetas y notas.
- Escuchar un archivo de audio propio desde la ficha (el vinilo gira) y enlace a YouTube.
- **Resumen del año** tipo *Wrapped* y botón **Sorpréndeme**.

**Tus datos, a salvo**
- **Sincronización entre dispositivos** con tu propio servidor, **cifrada en el dispositivo** (el servidor no puede leer nada). Se fusiona disco a disco: lo que apuntas en el móvil aparece en el ordenador y al revés, portadas incluidas.
- **Buscador de discos repetidos** para unir los que se apuntaron dos veces.
- **Copias automáticas** en el propio dispositivo (una al día y antes de cada cambio grande), restaurables con un clic.
- **Copia de seguridad** en un archivo (con portadas) y recordatorio si hace tiempo que no se hace. Importar permite **añadir** o **sustituir**.
- Cinco temas de color, incluido uno claro.

<table>
  <tr>
    <td width="50%"><img src="docs/ficha.png" alt="Ficha de un disco"><br><sub><b>Ficha</b>: portada, vinilo, valoración y datos.</sub></td>
    <td width="50%"><img src="docs/editor.png" alt="Añadir un disco"><br><sub><b>Añadir</b>: busca los datos y la portada por ti.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/tabla.png" alt="Vista de tabla"><br><sub><b>Tabla</b>: ordenable y exportable a Excel.</sub></td>
    <td><img src="docs/estadisticas.png" alt="Estadísticas"><br><sub><b>Estadísticas</b> de toda la colección.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/movil.png" alt="La app en el móvil" width="300"><br><sub><b>Móvil</b>: navegación inferior y botón de añadir siempre a mano.</sub></td>
    <td><img src="docs/sincronizar.png" alt="Sincronizar dispositivos"><br><sub><b>Sincronizar</b> el móvil y el ordenador.</sub></td>
  </tr>
</table>

> Las portadas de las capturas son ilustraciones abstractas generadas para la demo, no portadas reales.

## Por qué no se pierden datos

La versión 1 guardaba toda la colección como un único bloque. Si el navegador fallaba un instante al leerlo (pasa en Safari para iPhone al volver a una web tras un rato), la app arrancaba vacía y **guardaba ese vacío encima de la colección buena**. Además, nada impedía que el navegador borrase los datos de una web poco usada. La versión 2:

| Riesgo | Cómo se evita |
|---|---|
| Un fallo al leer deja la app vacía y pisa los datos | Si no puede leer, reintenta y, si sigue fallando, **avisa y no escribe nada**. |
| Una ventana pisa los cambios de otra | Cada disco se guarda por separado; las demás ventanas se actualizan solas. |
| El navegador borra los datos por su cuenta | Pide almacenamiento persistente, sincroniza con el servidor y recuerda hacer copias. |
| Un error al importar o restaurar | Antes de cualquier cambio grande se guarda una **copia automática** restaurable. |
| Actualizar la app | La migración desde la versión 1 **no borra el original** y deja una copia de antes del cambio. |

Todo esto está cubierto por pruebas automáticas que se ejecutan en GitHub antes de cada publicación (`tests/e2e.py`, con un navegador real).

## Instalarla como app

- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*. Ábrela siempre desde ese icono: en iPhone, Safari y la app instalada guardan los datos por separado.
- **Android / ordenador (Chrome o Edge)**: menú del navegador → *Instalar aplicación*.

## Sincronización: montar el servidor

Hace falta un pequeño servidor que guarde la colección **cifrada** (no puede leer nada) y un número de versión para que dos dispositivos no se pisen. Hay dos versiones con la misma API; elige una.

### Opción A · Cloudflare Workers (gratis, recomendada)

Con una cuenta gratuita de Cloudflare basta: el plan gratuito de Workers y KV sobra para una colección familiar.

**Desde la terminal** (necesita Node ≥ 18):

```bash
cd server/cloudflare
npx wrangler login                          # abre el navegador para entrar en tu cuenta
npx wrangler kv namespace create VINILOS    # copia el "id" que imprime en wrangler.toml
npx wrangler secret put CREATE_PASSWORD     # escribe una contraseña tuya
npx wrangler deploy                         # te da la dirección: https://vinilos-sync.<tu-subdominio>.workers.dev
```

**O desde el panel de Cloudflare**, sin instalar nada:

1. *Storage & Databases → KV → Create*: crea un espacio llamado `VINILOS`.
2. *Workers & Pages → Create → Worker*: ponle de nombre `vinilos-sync`, pulsa *Deploy*, luego *Edit code*, sustituye todo por el contenido de [`server/cloudflare/worker.js`](server/cloudflare/worker.js) y vuelve a pulsar *Deploy*.
3. En el Worker, *Settings → Bindings → Add → KV namespace*: nombre de la variable `VINILOS`, espacio `VINILOS`.
4. *Settings → Variables and Secrets*: añade `ALLOWED_ORIGIN` (texto) con `https://ivanchux.github.io` y `CREATE_PASSWORD` (secreto) con una contraseña tuya.

Comprueba que funciona abriendo `https://vinilos-sync.<tu-subdominio>.workers.dev/api/health`: debe responder `{"ok":true,"app":"inventario-vinilos",…}`.

### Opción B · Servidor propio (Node o Docker / Coolify)

El servidor está en [`server/server.js`](server/server.js): Node ≥ 18, **sin dependencias**, un solo archivo. También sirve la app.

```bash
CREATE_PASSWORD=una-clave node server/server.js      # http://localhost:8787
docker build -f server/Dockerfile -t vinilos .
docker run -d -p 8787:8787 -v vinilos-data:/data -e CREATE_PASSWORD=una-clave vinilos
```

En Coolify: build pack **Dockerfile** con ruta `server/Dockerfile`, puerto **8787**, volumen persistente en **`/data`**, variables `CREATE_PASSWORD` y `ALLOWED_ORIGIN=https://ivanchux.github.io`, y un dominio con https.

| Variable | Para qué |
|---|---|
| `CREATE_PASSWORD` | Contraseña para crear colecciones nuevas (así nadie más usa tu servidor) |
| `ALLOWED_ORIGIN` | Orígenes permitidos, separados por comas |
| `PORT`, `DATA_DIR`, `STATIC_DIR` | Solo servidor propio: puerto, carpeta de datos y carpeta de la app |
| `MAX_VAULT_MB` / `MAX_BLOB_MB` | Solo servidor propio: límites de tamaño (8 y 4 MB) |

### Conectar los dispositivos

Si pones la dirección del servidor en [`js/config.js`](js/config.js), la app ya la trae rellenada.

En la app, botón de la nube:
- **Primer dispositivo**: «Es el primero» → dirección + contraseña. Te da un **código** y un **enlace**.
- **Los demás**: «Ya tengo un código» y pega el código. En iPhone, usa el código desde la app instalada: el enlace se abriría en Safari, que guarda los datos aparte.

Si los dos dispositivos ya tenían discos, se juntan y la app ofrece unir los repetidos.

## Stack y estructura

HTML, CSS y JavaScript con módulos nativos, sin frameworks ni paso de compilación. Datos en **IndexedDB**, cifrado con **Web Crypto** (AES-GCM + PBKDF2), PWA con service worker.

```
├── index.html            estructura de la página
├── css/app.css           estilos y temas
├── js/
│   ├── app.js            arranque, estado y vistas (estanterías, tabla, estadísticas)
│   ├── dialogos.js       ficha, editor, menú, sincronización, copias…
│   ├── store.js          capa de datos (IndexedDB, migración, copias)
│   ├── sync.js           sincronización cifrada y fusión
│   ├── portadas.js       compresión de fotos y búsqueda en MusicBrainz
│   └── ui.js, iconos.js, util.js, config.js
├── server/               servidor de sincronización (Node + Dockerfile, y Cloudflare en server/cloudflare/)
├── tests/e2e.py          pruebas con navegador real
└── service-worker.js     funcionamiento sin conexión
```

## Probarlo en local

```bash
git clone https://github.com/ivanchux/inventario-vinilos.git
cd inventario-vinilos
node server/server.js              # sirve la app y la sincronización en http://localhost:8787
# o solo la app: python3 -m http.server 8000

# pruebas
node --test server/server.test.js
pip install playwright && python -m playwright install chromium && python tests/e2e.py
```

## 📜 Licencia

El código y los diseños están bajo [PolyForm Noncommercial 1.0.0](https://github.com/Ivanchux/inventario-vinilos/blob/main/LICENSE).

**Puedes, sin pedir permiso:**

* Usar la app para tu colección y compartir el enlace.
* Estudiar el código y modificarlo para uso personal, educativo o sin ánimo de lucro.
* Subirla a tu propio hosting, siempre gratis y sin anuncios, conservando el aviso de copyright y la licencia.
* Hacer vídeos, capturas y reseñas de la app, aunque tu canal esté monetizado.
* Inspirarte en las ideas y el funcionamiento para crear tu propia app desde cero.

**Necesitas mi permiso por escrito para:**

* Vender la app, una copia o una versión modificada.
* Publicarla en tiendas de aplicaciones.
* Incluirla en una web con anuncios, suscripciones o compras.
* Usar el código o los diseños en un producto comercial.

La estética del resumen anual se inspira en los resúmenes tipo "Wrapped", pero este proyecto no está afiliado a Spotify ni a ninguna otra plataforma de música. Las portadas y los datos de los discos pertenecen a sus respectivos autores y sellos.
