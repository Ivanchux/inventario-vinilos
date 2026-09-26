# 📀 Inventario de Vinilos

Una app de catálogo para colecciones de vinilos: estanterías organizables por artista, arrastrar y soltar para reordenar, ficha detallada por disco, estadísticas, resumen anual estilo *Wrapped*, y funcionamiento 100% offline como PWA instalable.

**[▶ Ver demo en vivo](https://ivanchux.github.io/inventario-vinilos/)** — pulsa el botón 🧪 al entrar para cargar una colección de ejemplo sin tener que rellenar nada a mano.

> Nació para digitalizar la colección de vinilos de mi padre (varios cientos de discos apuntados a mano desde los años 80) y ha acabado siendo un pequeño estudio de diseño de interfaz, PWA y modelado de datos sin backend.

<!-- Sustituye esto por una captura o GIF navegando la app -->
<!-- ![captura de la app](docs/screenshot.png) -->

## Funcionalidades

- **Estanterías arrastrables**: organiza los discos por artista (o como quieras) en carruseles horizontales, con orden manual o automático por año/título.
- **Ficha independiente del formulario**: al abrir un disco ves una vista de detalle (con el vinilo animándose mientras suena audio), separada de la pantalla de edición.
- **Reproducción de audio local**: si tienes el archivo descargado, se reproduce ahí mismo con el vinilo girando al ritmo de la reproducción.
- **Estadísticas y sección de detalle**: gráficos por género, década, top artistas, valoraciones y valor estimado de la colección.
- **Resumen anual estilo Wrapped**: un repaso animado de tu año en discos, con aviso automático cada 365 días.
- **Exportar / importar**: backup completo en JSON, para migrar entre dispositivos o hacer copias de seguridad.
- **PWA instalable y offline**: se puede añadir a la pantalla de inicio en iOS/Android y funciona sin conexión (service worker + caché), con icono y splash propios.
- **Sin backend, sin cuentas, sin tracking**: todos los datos viven en `localStorage`, en el propio dispositivo.

## Stack

Vanilla JS + HTML + CSS, un único archivo autocontenido (sin frameworks, sin build step). PWA con `manifest.json` y Service Worker. Despliegue automático a GitHub Pages vía GitHub Actions en cada push a `main`.

Elegido a propósito: cero dependencias, cero backend que mantener, y cualquiera puede abrir `index.html` y entender el código de arriba a abajo.

## Cómo probarlo en local

```bash
git clone https://github.com/TU-USUARIO/TU-REPO.git
cd TU-REPO
python3 -m http.server 8000
# abre http://localhost:8000
```

(Puedes abrir `index.html` directamente con doble clic, pero serví­rlo por http:// evita alguna limitación del navegador con `file://` en el Service Worker.)

## Estructura

```
├── index.html              # toda la app: HTML + CSS + JS
├── manifest.json            # metadatos de la PWA (nombre, iconos, colores)
├── service-worker.js        # caché offline
├── icons/                   # iconos para escritorio, iOS y Android
└── .github/workflows/       # despliegue automático a GitHub Pages
```

## Roadmap

- [ ] Selección múltiple para mover/borrar varios discos a la vez
- [ ] Filtros combinados (década + formato + condición)
- [ ] Reordenar con teclado (accesibilidad)
- [ ] Generalizar el modelo de datos para otras colecciones (libros, cómics, cartas...)

## Licencia

MIT — usa, copia y modifica libremente.
