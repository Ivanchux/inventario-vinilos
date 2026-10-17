/* ==========================================================
   Inventario de Vinilos · arranque, estado y vistas
   ========================================================== */

import * as store from './store.js';
import * as sync from './sync.js';
import { $, $$, esc, normalizar, decadaDe, euros, debounce, ls, uuid } from './util.js';
import { pintarIconos, icono } from './iconos.js';
import { tostada, hayDialogoAbierto } from './ui.js';
import * as D from './dialogos.js';

/* ---------------- Estado ---------------- */

export const estado = {
  discos: [],
  estanterias: [],
  filtro: 'todos',
  genero: '',
  q: '',
  vista: ls.get('vinilos_vista', 'estanterias'),
  orden: { col: 'artista', dir: 1 },
  listo: false,
  persistente: null,
};

export const GENEROS = ['Rock', 'Pop', 'Jazz', 'Blues', 'Soul', 'Funk', 'Disco', 'Reggae', 'Hip Hop', 'Electrónica', 'Clásica', 'Ópera', 'Country', 'Folk', 'Metal', 'Punk', 'Latin / Salsa', 'R&B', 'Gospel', 'Flamenco', 'Canción española', 'Bandas Sonoras', 'Experimental'];

export const disco = (id) => estado.discos.find((d) => d.id === id);
export const estanteria = (id) => estado.estanterias.find((e) => e.id === id);
/** Estantería en la que se muestra un disco (si la suya ya no existe, la primera). */
export const estanteriaDe = (d) => (estanteria(d.estanteria_id) ? d.estanteria_id : estado.estanterias[0]?.id);

/* ---------------- Carga ---------------- */

async function cargar() {
  const r = await store.cargar();
  estado.discos = r.discos;
  estado.estanterias = r.estanterias;
  return r;
}

export async function recargar() {
  try {
    await cargar();
    render();
  } catch {
    /* se reintentará con el siguiente cambio */
  }
}
const recargarEnUnRato = debounce(recargar, 150);

/* ---------------- Filtros ---------------- */

function coincide(d) {
  if (estado.filtro !== 'todos' && d.estado_posesion !== estado.filtro) return false;
  if (estado.genero && (d.genero || '') !== estado.genero) return false;
  if (!estado.q) return true;
  const q = normalizar(estado.q);
  return [d.titulo, d.artista, d.genero, d.anio, ...(d.tags || [])].some((x) => normalizar(x).includes(q));
}
const hayFiltro = () => estado.filtro !== 'todos' || !!estado.genero || !!estado.q;

const ORDENES = {
  manual: (a, b) => (a.posicion || 0) - (b.posicion || 0),
  artista: (a, b) => (a.artista || '').localeCompare(b.artista || '', 'es') || (a.anio || 0) - (b.anio || 0),
  anio: (a, b) => (a.anio || 9999) - (b.anio || 9999),
  titulo: (a, b) => (a.titulo || '').localeCompare(b.titulo || '', 'es'),
  reciente: (a, b) => String(b.fecha_alta).localeCompare(String(a.fecha_alta)),
};

/* ---------------- Portadas (carga perezosa) ---------------- */

const observador =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entradas) =>
          entradas.forEach((e) => {
            if (!e.isIntersecting) return;
            observador.unobserve(e.target);
            ponerPortada(e.target);
          }),
        { rootMargin: '300px' }
      )
    : null;

async function ponerPortada(el) {
  const src = await store.urlPortada(el.dataset.portada);
  if (!src) return;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => el.replaceChildren(img);
  img.src = src;
}
export function hidratarPortadas(raiz) {
  raiz.querySelectorAll('[data-portada]').forEach((el) => (observador ? observador.observe(el) : ponerPortada(el)));
}
export const inicial = (d) => esc((d.titulo || '?').replace(/^(the|los|las|el|la)\s+/i, '').trim().charAt(0).toUpperCase() || '?');

/* ---------------- Vista: estanterías ---------------- */

function tarjeta(d, arrastrable) {
  return `<button class="tarjeta" data-id="${d.id}" ${arrastrable ? 'draggable="true"' : ''} style="--vc:${esc(d.color_vinilo || '#1c1c1c')}" aria-label="${esc(d.titulo)}${d.artista ? ', de ' + esc(d.artista) : ''}">
    <span class="arte" style="display:block"><span class="vinilo" aria-hidden="true"></span>
      <span class="funda" ${d.portada ? `data-portada="${d.portada}"` : ''}><span class="inicial">${inicial(d)}</span></span>
      ${d.estado_posesion === 'quiero' ? '<span class="insignia quiero">Lo quiero</span>' : ''}
      ${d.escuchando ? '<span class="insignia sonando">Sonando</span>' : ''}</span>
    <span class="t" style="display:-webkit-box">${esc(d.titulo)}</span><span class="a" style="display:block">${esc(d.artista || 'Artista desconocido')}</span></button>`;
}

function renderEstanterias() {
  const cont = $('#vistaEstanterias');
  if (!estado.discos.length) {
    cont.innerHTML = `<div class="vacio">
      <svg class="ilustracion" viewBox="0 0 120 120" aria-hidden="true"><rect x="10" y="20" width="62" height="62" rx="4" fill="var(--surface-3)"/><circle cx="74" cy="51" r="32" fill="#0d0d0d"/><circle cx="74" cy="51" r="25" fill="none" stroke="#222"/><circle cx="74" cy="51" r="18" fill="none" stroke="#222"/><circle cx="74" cy="51" r="9" fill="var(--accent)"/><rect x="10" y="20" width="44" height="62" rx="4" fill="var(--surface-2)"/><rect x="6" y="92" width="108" height="8" rx="3" fill="var(--wood-1)"/></svg>
      <h2 class="serif">Empieza tu colección</h2>
      <p>Apunta tus discos y ordénalos en estanterías. Se guardan en este dispositivo y funcionan sin conexión.</p>
      <div class="acciones">
        <button class="btn btn-primario" data-accion="anadir">${icono('mas')}Añadir el primer disco</button>
        <button class="btn" data-accion="sincronizar">${icono('nube')}Traer la colección de otro dispositivo</button>
        <button class="btn" data-accion="importar">${icono('subir')}Importar una copia de seguridad</button>
        <button class="btn btn-fantasma" data-accion="ejemplo">Probar con una colección de ejemplo</button>
      </div></div>`;
    return;
  }
  const html = [];
  let visibles = 0;
  for (const est of estado.estanterias) {
    const orden = est.orden || 'manual';
    const todos = estado.discos.filter((d) => estanteriaDe(d) === est.id);
    const discos = todos.filter(coincide).sort(ORDENES[orden] || ORDENES.manual);
    if (hayFiltro() && !discos.length) continue;
    visibles += discos.length;
    const arrastrable = orden === 'manual' && !hayFiltro();
    html.push(`<section class="estanteria" data-est="${est.id}">
      <div class="est-cab">
        <div class="est-titulo"><h2 class="serif">${esc(est.nombre)} <small>${todos.length}</small></h2>${est.descripcion ? `<p>${esc(est.descripcion)}</p>` : ''}</div>
        <select class="campo est-orden" data-orden="${est.id}" aria-label="Ordenar ${esc(est.nombre)}">
          ${[['manual', 'A mano'], ['artista', 'Por artista'], ['anio', 'Por año'], ['titulo', 'Por título'], ['reciente', 'Recientes']].map(([v, t]) => `<option value="${v}"${v === orden ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <button class="icon-btn" data-editar-est="${est.id}" aria-label="Editar estantería ${esc(est.nombre)}">${icono('lapiz', 'ico-sm')}</button>
      </div>
      <div class="carrusel">
        <button class="flecha izq" data-desplazar="-1" aria-label="Anteriores" hidden>${icono('izq')}</button>
        <div class="fila" data-fila="${est.id}">
          ${discos.map((d) => tarjeta(d, arrastrable)).join('')}
          ${hayFiltro() ? '' : `<button class="tarjeta-nueva" data-anadir-en="${est.id}">${icono('mas', 'ico-lg')}Añadir aquí</button>`}
        </div>
        <button class="flecha der" data-desplazar="1" aria-label="Siguientes" hidden>${icono('der')}</button>
      </div>
      <div class="balda" aria-hidden="true"></div></section>`);
  }
  if (hayFiltro() && !visibles) html.push(`<div class="vacio"><h2 class="serif">Sin resultados</h2><p>No hay ningún disco que coincida con la búsqueda o los filtros.</p><button class="btn" data-accion="quitar-filtros">Quitar filtros</button></div>`);
  if (!hayFiltro()) html.push(`<button class="btn nueva-estanteria" data-accion="nueva-estanteria">${icono('estante')}Nueva estantería</button>`);
  cont.innerHTML = html.join('');
  hidratarPortadas(cont);
  requestAnimationFrame(() =>
    $$('.carrusel', cont).forEach((c) => {
      const f = c.querySelector('.fila');
      const sobra = f.scrollWidth > f.clientWidth + 4;
      c.querySelectorAll('.flecha').forEach((b) => (b.hidden = !sobra));
    })
  );
}

/* Arrastrar y soltar (ratón). En el móvil se cambia de estantería desde la ficha. */
let arrastrado = null;
function conectarArrastre() {
  const cont = $('#vistaEstanterias');
  cont.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tarjeta[draggable]');
    if (!t) return;
    arrastrado = t.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', arrastrado);
    requestAnimationFrame(() => t.classList.add('arrastrando'));
  });
  cont.addEventListener('dragend', () => {
    arrastrado = null;
    $$('.arrastrando, .destino', cont).forEach((x) => x.classList.remove('arrastrando', 'destino'));
  });
  cont.addEventListener('dragover', (e) => {
    if (!arrastrado || !e.target.closest('.fila')) return;
    e.preventDefault();
    $$('.destino', cont).forEach((x) => x.classList.remove('destino'));
    e.target.closest('.tarjeta')?.classList.add('destino');
  });
  cont.addEventListener('drop', async (e) => {
    const fila = e.target.closest('.fila');
    if (!arrastrado || !fila) return;
    e.preventDefault();
    const destinoId = e.target.closest('.tarjeta')?.dataset.id;
    await moverDisco(arrastrado, fila.dataset.fila, destinoId);
  });
}

/** Coloca un disco en una estantería, antes de otro disco o al final. */
export async function moverDisco(id, estId, antesDeId) {
  const d = disco(id);
  if (!d || id === antesDeId) return;
  const lista = estado.discos.filter((x) => estanteriaDe(x) === estId && x.id !== id).sort(ORDENES.manual);
  let posicion;
  const i = antesDeId ? lista.findIndex((x) => x.id === antesDeId) : -1;
  if (i === -1) posicion = (lista.at(-1)?.posicion ?? 0) + 1000;
  else posicion = ((lista[i - 1]?.posicion ?? lista[i].posicion - 2000) + lista[i].posicion) / 2;
  Object.assign(d, { estanteria_id: estId, posicion });
  render();
  await store.guardarDisco(d);
}

export const posicionFinal = (estId) => Math.max(0, ...estado.discos.filter((x) => estanteriaDe(x) === estId).map((x) => x.posicion || 0)) + 1000;

/* ---------------- Vista: tabla ---------------- */

const COLUMNAS = [
  ['titulo', 'Título'],
  ['artista', 'Artista'],
  ['anio', 'Año'],
  ['genero', 'Género'],
  ['formato', 'Formato'],
  ['estanteria', 'Estantería'],
  ['rating', 'Nota'],
  ['precio', 'Precio'],
];
function renderTabla() {
  const cont = $('#vistaTabla');
  const filas = estado.discos.filter(coincide);
  const { col, dir } = estado.orden;
  const valor = (d) => (col === 'estanteria' ? estanteria(estanteriaDe(d))?.nombre || '' : d[col]);
  filas.sort((a, b) => {
    const va = valor(a) ?? '';
    const vb = valor(b) ?? '';
    return (typeof va === 'number' || typeof vb === 'number' ? (Number(va) || 0) - (Number(vb) || 0) : String(va).localeCompare(String(vb), 'es')) * dir;
  });
  cont.innerHTML = `<div class="tabla-cab"><p>${filas.length} ${filas.length === 1 ? 'disco' : 'discos'}${hayFiltro() ? ' con los filtros actuales' : ''}</p>
      <button class="btn btn-sm" data-accion="exportar-csv">${icono('excel', 'ico-sm')}Exportar a Excel</button></div>
    <div class="tabla-wrap"><table>
      <thead><tr><th><span class="sr-only">Portada</span></th>${COLUMNAS.map(([k, t]) => `<th ${k === col ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}><button data-ordenar="${k}">${t}${k === col ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${
        filas
          .map(
            (d) => `<tr data-id="${d.id}" tabindex="0">
          <td><span class="mini" ${d.portada ? `data-portada="${d.portada}"` : ''}></span></td>
          <td class="texto"><b>${esc(d.titulo)}</b>${d.estado_posesion === 'quiero' ? ' <span class="dato-chip acento">Lo quiero</span>' : ''}</td>
          <td class="texto">${esc(d.artista)}</td><td>${d.anio || ''}</td><td>${esc(d.genero)}</td><td>${esc(d.formato)}</td>
          <td>${esc(estanteria(estanteriaDe(d))?.nombre || '')}</td><td>${d.rating ? '★'.repeat(d.rating) : ''}</td>
          <td class="num">${d.precio != null ? euros(d.precio) : ''}</td></tr>`
          )
          .join('') || `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-3)">Sin resultados</td></tr>`
      }</tbody></table></div>`;
  $$('.mini[data-portada]', cont).forEach(async (el) => {
    const src = await store.urlPortada(el.dataset.portada);
    if (src) el.outerHTML = `<img class="mini" src="${src}" alt="">`;
  });
}

/* ---------------- Vista: estadísticas ---------------- */

function conteo(xs, fn) {
  const c = new Map();
  xs.forEach((d) => {
    const k = fn(d);
    if (k) c.set(k, (c.get(k) || 0) + 1);
  });
  return [...c].sort((a, b) => b[1] - a[1]);
}
function barras(titulo, pares) {
  const max = Math.max(1, ...pares.map((p) => p[1]));
  return `<div class="grafica"><h3 class="serif">${titulo}</h3>${
    pares.length ? pares.map(([k, v]) => `<div class="barra-dato"><span title="${esc(k)}">${esc(k)}</span><span class="barra-pista"><i style="width:${Math.round((v / max) * 100)}%"></i></span><b>${v}</b></div>`).join('') : '<p class="ayuda">Aún sin datos.</p>'
  }</div>`;
}
function renderEstadisticas() {
  const cont = $('#vistaEstadisticas');
  const xs = estado.discos.filter(coincide);
  if (!xs.length) {
    cont.innerHTML = '<div class="vacio"><h2 class="serif">Sin datos todavía</h2><p>Cuando añadas discos verás aquí tus géneros, décadas y artistas favoritos.</p></div>';
    return;
  }
  const tengo = xs.filter((d) => d.estado_posesion === 'tengo');
  const valor = tengo.reduce((s, d) => s + (d.precio || 0), 0);
  const artistas = new Set(xs.map((d) => normalizar(d.artista)).filter(Boolean)).size;
  const valorados = xs.filter((d) => d.rating);
  const media = valorados.length ? (valorados.reduce((s, d) => s + d.rating, 0) / valorados.length).toFixed(1).replace('.', ',') : '—';
  const decadas = conteo(xs, (d) => decadaDe(d.anio)).sort((a, b) => a[0].localeCompare(b[0]));
  cont.innerHTML = `<div class="kpis">
      <div class="kpi"><b>${tengo.length}</b><span>discos en la colección</span></div>
      <div class="kpi"><b>${xs.length - tengo.length}</b><span>en la lista de deseos</span></div>
      <div class="kpi"><b>${artistas}</b><span>artistas distintos</span></div>
      <div class="kpi"><b>${euros(valor)}</b><span>valor estimado · nota media ${media}</span></div>
    </div>
    <div class="graficas">
      ${barras('Géneros', conteo(xs, (d) => d.genero).slice(0, 10))}
      ${barras('Décadas', decadas)}
      ${barras('Artistas con más discos', conteo(xs, (d) => d.artista).slice(0, 10))}
      ${barras('Formatos', conteo(xs, (d) => d.formato))}
      ${barras('Valoraciones', [5, 4, 3, 2, 1].map((n) => ['★'.repeat(n), xs.filter((d) => d.rating === n).length]).filter((p) => p[1]))}
      ${barras('Por estantería', estado.estanterias.map((e) => [e.nombre, xs.filter((d) => estanteriaDe(d) === e.id).length]).filter((p) => p[1]))}
    </div>
    <div style="padding:16px;text-align:center"><button class="btn" data-accion="resumen">${icono('regalo')}Ver el resumen del año</button></div>`;
}

/* ---------------- Render general ---------------- */

export function render() {
  const n = estado.discos.filter((d) => d.estado_posesion === 'tengo').length;
  const c = $('#contador');
  c.hidden = !estado.discos.length;
  c.textContent = n;
  c.title = `${n} discos en la colección`;

  const generos = [...new Set([...estado.discos.map((d) => d.genero).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'es'));
  if (estado.genero && !generos.includes(estado.genero)) estado.genero = '';
  $('#filtroGenero').innerHTML = '<option value="">Todos los géneros</option>' + generos.map((g) => `<option${g === estado.genero ? ' selected' : ''}>${esc(g)}</option>`).join('');
  $('#filtroGenero').hidden = !generos.length;

  for (const v of ['estanterias', 'tabla', 'estadisticas']) $('#vista' + v[0].toUpperCase() + v.slice(1)).hidden = estado.vista !== v;
  $$('[data-vista]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === estado.vista)));
  $$('[data-estado]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.estado === estado.filtro)));

  if (estado.vista === 'estanterias') renderEstanterias();
  else if (estado.vista === 'tabla') renderTabla();
  else renderEstadisticas();

  $('#pie').textContent = estado.discos.length ? (sync.activo() ? 'Sincronizado entre tus dispositivos · ' : 'Guardado en este dispositivo · ') + 'Funciona sin conexión' : '';
  pintarAvisos();
}

/* ---------------- Avisos de la página ---------------- */

const avisosCerrados = new Set();
function pintarAvisos() {
  const avisos = [];
  const dia = 86400000;
  const migr = ls.get('vinilos_aviso_migracion');
  if (migr && !avisosCerrados.has('migracion'))
    avisos.push({ id: 'migracion', icono: 'check', texto: `La app se ha renovado. Tus ${migr} discos siguen aquí; por si acaso, hay una copia de antes del cambio en Copias automáticas.`, cerrar: () => ls.del('vinilos_aviso_migracion') });
  if (!sync.activo() && estado.discos.length >= 5 && !avisosCerrados.has('copia')) {
    const ultima = Number(ls.get('vinilos_ultimo_backup')) || 0;
    const pospuesto = Number(ls.get('vinilos_backup_pospuesto')) || 0;
    if (Date.now() - pospuesto > 7 * dia && Date.now() - ultima > 30 * dia)
      avisos.push({
        id: 'copia',
        icono: 'escudo',
        texto: ultima ? `Hace ${Math.round((Date.now() - ultima) / dia)} días de tu última copia de seguridad.` : 'Tu colección solo está en este dispositivo. Guarda una copia o sincronízala con otro.',
        accion: ['Guardar copia', () => D.exportarJSON()],
        cerrar: () => ls.set('vinilos_backup_pospuesto', String(Date.now())),
      });
  }
  const primer = Number(ls.get('vinilos_wrapped_primer')) || 0;
  const visto = Number(ls.get('vinilos_wrapped_ultimo')) || primer;
  if (estado.discos.length && primer && Date.now() - visto > 365 * dia && !avisosCerrados.has('resumen'))
    avisos.push({ id: 'resumen', icono: 'regalo', texto: 'Tu resumen del año ya está listo.', accion: ['Verlo', () => D.abrirResumen()], cerrar: () => ls.set('vinilos_wrapped_ultimo', String(Date.now())) });

  const cont = $('#avisos');
  cont.innerHTML = avisos
    .map((a) => `<div class="aviso" data-aviso="${a.id}">${icono(a.icono)}<p>${a.texto}</p>${a.accion ? `<button class="btn btn-sm btn-primario" data-aviso-accion>${a.accion[0]}</button>` : ''}<button class="icon-btn" data-aviso-cerrar aria-label="Cerrar aviso">${icono('cerrar', 'ico-sm')}</button></div>`)
    .join('');
  avisos.forEach((a) => {
    const el = cont.querySelector(`[data-aviso="${a.id}"]`);
    el.querySelector('[data-aviso-accion]')?.addEventListener('click', a.accion?.[1]);
    el.querySelector('[data-aviso-cerrar]').addEventListener('click', () => {
      avisosCerrados.add(a.id);
      a.cerrar?.();
      el.remove();
    });
  });
}

function mostrarErrorCarga(err) {
  $('#avisos').innerHTML = `<div class="aviso peligro aviso-bloque" role="alert">
    <h2>No se ha podido leer tu colección</h2>
    <p>No se ha borrado nada. La app no guardará cambios hasta que pueda leerla bien. Cierra la app del todo (también desde la multitarea del móvil) y vuelve a abrirla.</p>
    <p class="ayuda">${esc(err?.message || '')}</p>
    <p style="margin-top:12px"><button class="btn btn-primario" onclick="location.reload()">Reintentar</button></p></div>`;
  $('#principal').hidden = true;
  $$('.fab, .nav-inferior, .filtros, .zona-busqueda').forEach((x) => (x.hidden = true));
}

/* ---------------- Eventos ---------------- */

const ACCIONES = {
  anadir: () => D.abrirEditor(null),
  importar: () => $('#archivoImportar').click(),
  ejemplo: () => D.cargarEjemplo(),
  sincronizar: () => D.abrirSync(),
  'nueva-estanteria': () => D.abrirEstanteria(null),
  'exportar-csv': () => D.exportarCSV(estado.discos.filter(coincide)),
  resumen: () => D.abrirResumen(),
  'quitar-filtros': () => {
    estado.filtro = 'todos';
    estado.genero = '';
    ponerBusqueda('');
    render();
  },
};

function ponerBusqueda(q) {
  estado.q = q;
  $$('#buscarMovil, #buscarEscritorio').forEach((i) => i.value !== q && (i.value = q));
  $$('[data-limpiar]').forEach((b) => (b.hidden = !q));
}

function conectarEventos() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-accion]');
    if (a && ACCIONES[a.dataset.accion]) return ACCIONES[a.dataset.accion]();
    const t = e.target.closest('.tarjeta');
    if (t) return D.abrirFicha(t.dataset.id);
    const fila = e.target.closest('tr[data-id]');
    if (fila) return D.abrirFicha(fila.dataset.id);
    const nuevo = e.target.closest('[data-anadir-en]');
    if (nuevo) return D.abrirEditor(null, { estanteria: nuevo.dataset.anadirEn });
    const ed = e.target.closest('[data-editar-est]');
    if (ed) return D.abrirEstanteria(ed.dataset.editarEst);
    const des = e.target.closest('[data-desplazar]');
    if (des) {
      const f = des.parentElement.querySelector('.fila');
      return f.scrollBy({ left: Number(des.dataset.desplazar) * f.clientWidth * 0.8, behavior: 'smooth' });
    }
    const ord = e.target.closest('[data-ordenar]');
    if (ord) {
      const k = ord.dataset.ordenar;
      estado.orden = { col: k, dir: estado.orden.col === k ? -estado.orden.dir : k === 'rating' || k === 'precio' ? -1 : 1 };
      return renderTabla();
    }
    const v = e.target.closest('[data-vista]');
    if (v) {
      estado.vista = v.dataset.vista;
      ls.set('vinilos_vista', estado.vista);
      render();
      return scrollTo({ top: 0 });
    }
    const f = e.target.closest('[data-estado]');
    if (f) {
      estado.filtro = f.dataset.estado;
      return render();
    }
    const l = e.target.closest('[data-limpiar]');
    if (l) {
      ponerBusqueda('');
      return render();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) D.abrirFicha(e.target.dataset.id);
    if (e.key === '/' && !e.target.closest('input, textarea, select') && !hayDialogoAbierto()) {
      e.preventDefault();
      (matchMedia('(min-width: 900px)').matches ? $('#buscarEscritorio') : $('#buscarMovil')).focus();
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.matches('[data-orden]')) {
      const est = estanteria(e.target.dataset.orden);
      if (!est) return;
      est.orden = e.target.value;
      render();
      await store.guardarEstanteria(est);
    }
  });
  const buscar = debounce(() => render(), 120);
  $$('#buscarMovil, #buscarEscritorio').forEach((i) =>
    i.addEventListener('input', () => {
      ponerBusqueda(i.value);
      buscar();
    })
  );
  $('#filtroGenero').addEventListener('change', (e) => {
    estado.genero = e.target.value;
    render();
  });
  $('#btnMenu').addEventListener('click', () => D.abrirMenu());
  $('#btnSync').addEventListener('click', () => D.abrirSync());
  $('#archivoImportar').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) D.importarArchivo(f);
  });
  conectarArrastre();
}

/* ---------------- Sincronización: indicador ---------------- */

function pintarSync(info) {
  const b = $('#btnSync');
  const p = b.querySelector('.estado-sync');
  b.innerHTML = icono(info.activo ? (info.estado === 'error' ? 'nubeNo' : 'nubeOk') : 'nube');
  b.append(p);
  p.hidden = !info.activo;
  p.className = 'estado-sync ' + (info.estado === 'error' || info.estado === 'sin-conexion' ? 'error' : info.estado === 'sincronizando' ? 'sincronizando' : '');
  b.title = !info.activo ? 'Sincronizar con otros dispositivos' : info.estado === 'error' ? 'Error al sincronizar: ' + info.error : info.estado === 'sin-conexion' ? 'Sin conexión: se sincronizará al volver' : 'Sincronizado';
}

/* ---------------- Service worker y actualizaciones ---------------- */

function registrarSW() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker
    .register('service-worker.js')
    .then((reg) => {
      const avisarNueva = (sw) =>
        tostada('Hay una versión nueva de la app.', {
          accion: 'Actualizar',
          ms: 60000,
          alPulsar: () => sw.postMessage('activar'),
        });
      if (reg.waiting && navigator.serviceWorker.controller) avisarNueva(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => sw.state === 'installed' && navigator.serviceWorker.controller && avisarNueva(sw));
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch(() => {});
  // Solo se recarga al cambiar de versión, no la primera vez que se instala.
  const habiaVersion = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !habiaVersion) return;
    recargando = true;
    location.reload();
  });
}

/* ---------------- Arranque ---------------- */

async function iniciar() {
  pintarIconos();
  conectarEventos();
  try {
    const r = await cargar();
    if (r.migracion?.migrado && r.migracion.discos) ls.set('vinilos_aviso_migracion', String(r.migracion.discos));
  } catch (e) {
    mostrarErrorCarga(e);
    return;
  }
  if (!estado.estanterias.length) {
    const est = await store.guardarEstanteria({ id: uuid(), nombre: 'Mi colección', descripcion: '', orden: 'manual', posicion: 0 }, { silencioso: true });
    estado.estanterias.push(est);
  }
  estado.listo = true;
  render();

  store.alCambiar(() => recargarEnUnRato());
  sync.alCambiarEstado(pintarSync);
  sync.iniciar((r) => {
    recargar();
    if (r?.cambios) tostada(`Colección actualizada desde otro dispositivo.`);
  });
  pintarSync(sync.info());

  if (!ls.get('vinilos_wrapped_primer') && estado.discos.length) ls.set('vinilos_wrapped_primer', String(Date.now()));
  store.copiaDiaria().catch(() => {});
  store.pedirPersistencia().then((p) => (estado.persistente = p));
  if (ls.get('vinilos_limpieza') !== new Date().toISOString().slice(0, 7)) {
    store.limpiarPortadas().catch(() => {});
    ls.set('vinilos_limpieza', new Date().toISOString().slice(0, 7));
  }
  D.manejarEnlace();
  addEventListener('hashchange', () => D.manejarEnlace());
  registrarSW();
}

iniciar();
