/* ==========================================================
   CAPA DE DATOS
   IndexedDB «vinilosApp», versión 2. Cada disco, estantería y
   portada es un registro independiente: guardar un disco nunca
   reescribe la colección entera, así que ni un fallo puntual ni
   dos ventanas abiertas a la vez pueden pisar la colección.

   Almacenes:
     discos       { id, …, portada: hash|null, posicion, updatedAt }
     estanterias  { id, nombre, descripcion, orden, posicion, updatedAt }
     portadas     { hash, blob }            (contenido direccionado por hash)
     copias       { id: ISO, motivo, discos, estanterias }
     meta         { id: 'lapidas' | 'migracion' | … }
     kv           (versión 1; se conserva intacto como copia de seguridad)
   ========================================================== */

import { esperar, sha256Hex, dataURLaBlob, blobADataURL, ls, hoyISO, uuid } from './util.js';

const NOMBRE = 'vinilosApp';
const VERSION = 2;
const CLAVE_V1 = 'vinilos_db';
const MAX_COPIAS = 10;
const LAPIDAS_DIAS = 365;

const ALMACENES = { discos: 'id', estanterias: 'id', portadas: 'hash', copias: 'id', meta: 'id' };

/* ---------------- Conexión ---------------- */

let conexion = null;

function abrirUnaVez() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Este navegador no permite guardar datos (sin IndexedDB).'));
    let req;
    try {
      req = indexedDB.open(NOMBRE, VERSION);
    } catch (e) {
      return reject(e);
    }
    const plazo = setTimeout(() => reject(new Error('El almacenamiento del navegador no responde.')), 5000);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (ev.oldVersion < 1 && !db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      for (const [n, keyPath] of Object.entries(ALMACENES)) {
        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath });
      }
    };
    req.onsuccess = () => {
      clearTimeout(plazo);
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        conexion = null;
      };
      db.onclose = () => {
        conexion = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(plazo);
      reject(req.error || new Error('No se pudo abrir el almacenamiento.'));
    };
    req.onblocked = () => {
      clearTimeout(plazo);
      reject(new Error('Hay otra ventana con una versión antigua de la app abierta. Ciérrala y vuelve a intentarlo.'));
    };
  });
}

async function abrir() {
  if (conexion) return conexion;
  let ultimo;
  for (let i = 0; i < 4; i++) {
    try {
      conexion = await abrirUnaVez();
      return conexion;
    } catch (e) {
      ultimo = e;
      await esperar(350 * (i + 1));
    }
  }
  throw ultimo;
}

/** Ejecuta fn dentro de una transacción. Si la conexión se ha perdido, la reabre y reintenta. */
async function tx(nombres, modo, fn) {
  let ultimo;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const db = await abrir();
      return await new Promise((resolve, reject) => {
        let t;
        try {
          t = db.transaction(nombres, modo);
        } catch (e) {
          conexion = null;
          return reject(e);
        }
        const st = Object.fromEntries([].concat(nombres).map((n) => [n, t.objectStore(n)]));
        let res;
        try {
          res = fn(st, t);
        } catch (e) {
          try {
            t.abort();
          } catch {}
          return reject(e);
        }
        t.oncomplete = () => resolve(res instanceof IDBRequest ? res.result : res);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Operación cancelada'));
      });
    } catch (e) {
      ultimo = e;
      if (e && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /lost|closing|closed/i.test(e.message))) {
        conexion = null;
        await esperar(300 * (intento + 1));
        continue;
      }
      throw e;
    }
  }
  throw ultimo;
}

const leerTodos = (n) => tx(n, 'readonly', (st) => st[n].getAll());
const leer = (n, k) => tx(n, 'readonly', (st) => st[n].get(k));

/* ---------------- Avisos de cambios entre ventanas ---------------- */

const canal = 'BroadcastChannel' in globalThis ? new BroadcastChannel('vinilos_v2') : null;
const oyentes = new Set();
export function alCambiar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
function avisar(motivo, { externo = false, silencioso = false } = {}) {
  if (!externo && canal) canal.postMessage(motivo);
  if (silencioso) return;
  queueMicrotask(() => oyentes.forEach((fn) => fn(motivo, externo)));
}
if (canal) canal.onmessage = (e) => avisar(e.data, { externo: true });

/* ---------------- Normalización ---------------- */

const DISCO_BASE = {
  titulo: '',
  artista: '',
  genero: '',
  anio: null,
  formato: 'LP',
  estado_posesion: 'tengo',
  condicion: 'Muy bueno+ (VG+)',
  precio: null,
  color_vinilo: '#1c1c1c',
  rating: 0,
  escuchando: false,
  estanteria_id: null,
  fecha_compra: '',
  youtube: '',
  tags: [],
  tracklist: '',
  notas: '',
  portada: null,
  mbid: '',
  fecha_alta: null,
  posicion: 0,
  updatedAt: 0,
};

export function normalizarDisco(d) {
  const r = { ...DISCO_BASE, ...d };
  r.tags = Array.isArray(r.tags) ? r.tags : [];
  r.rating = Number(r.rating) || 0;
  r.anio = r.anio ? Number(r.anio) || null : null;
  r.precio = r.precio === '' || r.precio == null || !Number.isFinite(Number(r.precio)) ? null : Number(r.precio);
  if (!r.fecha_alta) r.fecha_alta = new Date().toISOString();
  delete r.decada;
  return r;
}

/* ---------------- Lápidas (borrados, para sincronizar) ---------------- */

async function lapidas() {
  return ((await leer('meta', 'lapidas')) || { items: {} }).items || {};
}
function ponerLapidas(st, actuales, ids) {
  const ahora = Date.now();
  const items = { ...actuales };
  ids.forEach((id) => (items[id] = ahora));
  const limite = ahora - LAPIDAS_DIAS * 86400000;
  for (const [id, ts] of Object.entries(items)) if (ts < limite) delete items[id];
  st.meta.put({ id: 'lapidas', items });
}

/* ---------------- Migración desde la versión 1 ---------------- */

/** Convierte una portada en dataURL (formato antiguo) en registro de portada. */
async function portadaDesdeDataURL(dataURL) {
  const blob = await dataURLaBlob(dataURL);
  const hash = await sha256Hex(await blob.arrayBuffer());
  return { hash, blob };
}

/** Pasa una colección en formato antiguo ({discos:[{portada:dataURL}], estanterias}) al formato nuevo. */
export async function convertirFormatoAntiguo(antiguo) {
  const ahora = Date.now();
  const portadas = new Map();
  const estanterias = (antiguo.estanterias || []).map((e, i) => ({
    id: e.id || uuid(),
    nombre: e.nombre || 'Estantería',
    descripcion: e.descripcion || '',
    orden: e.orden || 'manual',
    posicion: i * 1000,
    updatedAt: ahora,
  }));
  if (!estanterias.length) estanterias.push({ id: uuid(), nombre: 'Mi colección', descripcion: '', orden: 'manual', posicion: 0, updatedAt: ahora });
  const ids = new Set(estanterias.map((e) => e.id));
  const discos = [];
  for (const [i, d0] of (antiguo.discos || []).entries()) {
    const d = { ...d0 };
    if (typeof d.portada === 'string' && d.portada.startsWith('data:')) {
      try {
        const p = await portadaDesdeDataURL(d.portada);
        portadas.set(p.hash, p);
        d.portada = p.hash;
      } catch {
        d.portada = null;
      }
    } else if (typeof d.portada !== 'string' || !/^[0-9a-f]{64}$/.test(d.portada)) {
      d.portada = null;
    }
    if (!ids.has(d.estanteria_id)) d.estanteria_id = estanterias[0].id;
    discos.push(normalizarDisco({ ...d, id: d.id || uuid(), posicion: i * 1000, updatedAt: d.updatedAt || ahora }));
  }
  return { discos, estanterias, portadas: [...portadas.values()] };
}

async function leerV1() {
  try {
    const db = await abrir();
    if (!db.objectStoreNames.contains('kv')) return null;
    const v = await tx('kv', 'readonly', (st) => st.kv.get(CLAVE_V1));
    if (v && Array.isArray(v.discos)) return v;
  } catch (e) {
    throw e;
  }
  const crudo = ls.get(CLAVE_V1);
  if (crudo) {
    const v = JSON.parse(crudo); // si está corrupto, lanza y no se migra nada
    if (v && Array.isArray(v.discos)) return v;
  }
  return null;
}

/** Si hay datos de la versión 1 y aún no se han migrado, los migra (sin borrar el original). */
async function migrarSiHaceFalta() {
  const hecho = await leer('meta', 'migracion');
  if (hecho) return { migrado: false };
  const v1 = await leerV1();
  const ahora = Date.now();
  if (!v1) {
    await tx('meta', 'readwrite', (st) => st.meta.put({ id: 'migracion', version: 2, fecha: ahora, discos: 0 }));
    return { migrado: false };
  }
  const nuevo = await convertirFormatoAntiguo(v1);
  await tx(['discos', 'estanterias', 'portadas', 'copias', 'meta'], 'readwrite', (st) => {
    nuevo.portadas.forEach((p) => st.portadas.put(p));
    nuevo.estanterias.forEach((e) => st.estanterias.put(e));
    nuevo.discos.forEach((d) => st.discos.put(d));
    st.copias.put({ id: new Date(ahora).toISOString(), motivo: 'Antes de actualizar a la versión 2', discos: nuevo.discos, estanterias: nuevo.estanterias });
    st.meta.put({ id: 'migracion', version: 2, fecha: ahora, discos: nuevo.discos.length });
  });
  return { migrado: true, discos: nuevo.discos.length };
}

/* ---------------- Carga ---------------- */

export async function cargar() {
  const mig = await migrarSiHaceFalta();
  const [discos, estanterias] = await Promise.all([leerTodos('discos'), leerTodos('estanterias')]);
  discos.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));
  estanterias.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));
  return { discos: discos.map(normalizarDisco), estanterias, migracion: mig };
}

/* ---------------- Discos ---------------- */

export async function guardarDisco(disco, opts = {}) {
  const r = normalizarDisco({ ...disco, updatedAt: Date.now() });
  await tx('discos', 'readwrite', (st) => st.discos.put(r));
  avisar('disco', opts);
  return r;
}

export async function guardarDiscos(discos, opts = {}) {
  const ahora = Date.now();
  const rs = discos.map((d) => normalizarDisco({ ...d, updatedAt: ahora }));
  await tx('discos', 'readwrite', (st) => rs.forEach((r) => st.discos.put(r)));
  avisar('discos', opts);
  return rs;
}

export async function borrarDisco(id) {
  const prev = await lapidas();
  await tx(['discos', 'meta'], 'readwrite', (st) => {
    st.discos.delete(id);
    ponerLapidas(st, prev, [id]);
  });
  avisar('disco-borrado');
}

/** Vuelve a poner un disco borrado (deshacer). */
export async function restaurarDisco(disco) {
  const prev = await lapidas();
  delete prev[disco.id];
  await tx(['discos', 'meta'], 'readwrite', (st) => {
    st.discos.put(normalizarDisco({ ...disco, updatedAt: Date.now() }));
    st.meta.put({ id: 'lapidas', items: prev });
  });
  avisar('disco');
}

/** Une discos repetidos: guarda el disco resultante y borra los demás, todo de una vez. */
export async function unirDiscos(resultado, idsABorrar) {
  const prev = await lapidas();
  await tx(['discos', 'meta'], 'readwrite', (st) => {
    st.discos.put(normalizarDisco({ ...resultado, updatedAt: Date.now() }));
    idsABorrar.forEach((id) => st.discos.delete(id));
    ponerLapidas(st, prev, idsABorrar);
  });
  avisar('discos');
}

/* ---------------- Estanterías ---------------- */

export async function guardarEstanteria(est, opts = {}) {
  const r = { descripcion: '', orden: 'manual', posicion: 0, ...est, updatedAt: Date.now() };
  await tx('estanterias', 'readwrite', (st) => st.estanterias.put(r));
  avisar('estanteria', opts);
  return r;
}

/** Borra una estantería y pasa sus discos a otra. */
export async function borrarEstanteria(id, destinoId) {
  const prev = await lapidas();
  const discos = await leerTodos('discos');
  const ahora = Date.now();
  await tx(['estanterias', 'discos', 'meta'], 'readwrite', (st) => {
    discos.filter((d) => d.estanteria_id === id).forEach((d) => st.discos.put({ ...d, estanteria_id: destinoId, updatedAt: ahora }));
    st.estanterias.delete(id);
    ponerLapidas(st, prev, [id]);
  });
  avisar('estanteria-borrada');
}

/* ---------------- Portadas ---------------- */

const urls = new Map();

export async function guardarPortada(blob) {
  const hash = await sha256Hex(await blob.arrayBuffer());
  await tx('portadas', 'readwrite', (st) => st.portadas.put({ hash, blob }));
  return hash;
}

export async function tienePortada(hash) {
  return !!(await tx('portadas', 'readonly', (st) => st.portadas.getKey(hash)));
}

export async function leerPortada(hash) {
  const r = await leer('portadas', hash);
  return r?.blob || null;
}

/** URL para <img>. '' si la portada no está en este dispositivo. */
export async function urlPortada(hash) {
  if (!hash) return '';
  if (urls.has(hash)) return urls.get(hash);
  try {
    const blob = await leerPortada(hash);
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    urls.set(hash, u);
    return u;
  } catch {
    return '';
  }
}

export async function guardarPortadaConHash(hash, blob) {
  await tx('portadas', 'readwrite', (st) => st.portadas.put({ hash, blob }));
}

/** Borra portadas que ya no usa ningún disco ni ninguna copia. */
export async function limpiarPortadas() {
  const [discos, copias, claves] = await Promise.all([leerTodos('discos'), leerTodos('copias'), tx('portadas', 'readonly', (st) => st.portadas.getAllKeys())]);
  const usadas = new Set(discos.map((d) => d.portada).filter(Boolean));
  copias.forEach((c) => (c.discos || []).forEach((d) => d.portada && usadas.add(d.portada)));
  const sobran = claves.filter((k) => !usadas.has(k));
  if (sobran.length) await tx('portadas', 'readwrite', (st) => sobran.forEach((k) => st.portadas.delete(k)));
  return sobran.length;
}

/* ---------------- Copias automáticas ---------------- */

export async function crearCopia(motivo) {
  const [discos, estanterias] = await Promise.all([leerTodos('discos'), leerTodos('estanterias')]);
  if (!discos.length) return null;
  const id = new Date().toISOString();
  await tx('copias', 'readwrite', (st) => st.copias.put({ id, motivo, discos, estanterias }));
  await podarCopias();
  return id;
}

/** Una copia al día, la primera vez que se abre la app ese día. */
export async function copiaDiaria() {
  if (ls.get('vinilos_copia_dia') === hoyISO()) return null;
  const id = await crearCopia('Copia diaria');
  ls.set('vinilos_copia_dia', hoyISO());
  return id;
}

async function podarCopias() {
  const claves = (await tx('copias', 'readonly', (st) => st.copias.getAllKeys())).sort().reverse();
  const sobran = claves.slice(MAX_COPIAS);
  if (sobran.length) await tx('copias', 'readwrite', (st) => sobran.forEach((k) => st.copias.delete(k)));
}

export async function listarCopias() {
  const copias = await leerTodos('copias');
  return copias
    .map((c) => ({ id: c.id, motivo: c.motivo, n: (c.discos || []).length }))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

/* ---------------- Sustituir toda la colección ---------------- */

/**
 * Sustituye la colección por otra (importar, restaurar, ejemplo).
 * Siempre hace antes una copia de lo que hay. Lo que desaparece se marca con lápida
 * y lo que entra se marca como recién modificado, para que la sincronización lo respete.
 */
export async function reemplazarTodo({ discos, estanterias, portadas = [] }, motivo) {
  await crearCopia(`Antes de ${motivo}`);
  const [actDiscos, actEst, prev] = await Promise.all([leerTodos('discos'), leerTodos('estanterias'), lapidas()]);
  const ahora = Date.now();
  const nuevosD = new Set(discos.map((d) => d.id));
  const nuevosE = new Set(estanterias.map((e) => e.id));
  const fuera = [...actDiscos.filter((d) => !nuevosD.has(d.id)), ...actEst.filter((e) => !nuevosE.has(e.id))].map((x) => x.id);
  const items = { ...prev };
  [...nuevosD, ...nuevosE].forEach((id) => delete items[id]);
  await tx(['discos', 'estanterias', 'portadas', 'meta'], 'readwrite', (st) => {
    st.discos.clear();
    st.estanterias.clear();
    portadas.forEach((p) => st.portadas.put(p));
    estanterias.forEach((e, i) => st.estanterias.put({ descripcion: '', orden: 'manual', ...e, posicion: e.posicion ?? i * 1000, updatedAt: ahora }));
    discos.forEach((d, i) => st.discos.put(normalizarDisco({ ...d, posicion: d.posicion ?? i * 1000, updatedAt: ahora })));
    ponerLapidas(st, items, fuera);
  });
  avisar('todo');
}

/**
 * Añade una colección a la actual sin borrar nada (importar «añadiendo»).
 * Si un disco ya existe con el mismo id, se queda la versión más reciente.
 */
export async function anadir({ discos, estanterias, portadas = [] }) {
  await crearCopia('Antes de añadir una copia de seguridad');
  const [actD, actE] = await Promise.all([leerTodos('discos'), leerTodos('estanterias')]);
  const mD = new Map(actD.map((d) => [d.id, d]));
  const mE = new Map(actE.map((e) => [e.id, e]));
  let posE = Math.max(0, ...actE.map((e) => e.posicion || 0));
  let posD = Math.max(0, ...actD.map((d) => d.posicion || 0));
  const ahora = Date.now();
  let nuevos = 0;
  await tx(['discos', 'estanterias', 'portadas'], 'readwrite', (st) => {
    portadas.forEach((p) => st.portadas.put(p));
    for (const e of estanterias) if (!mE.has(e.id)) st.estanterias.put({ descripcion: '', orden: 'manual', ...e, posicion: (posE += 1000), updatedAt: ahora });
    for (const d of discos) {
      const ya = mD.get(d.id);
      if (ya && (ya.updatedAt || 0) >= (d.updatedAt || 0)) continue;
      if (!ya) nuevos++;
      st.discos.put(normalizarDisco({ ...d, posicion: ya ? ya.posicion : (posD += 1000), updatedAt: ahora }));
    }
  });
  avisar('todo');
  return nuevos;
}

export async function restaurarCopia(id) {
  const c = await leer('copias', id);
  if (!c) throw new Error('Esa copia ya no existe.');
  await reemplazarTodo({ discos: c.discos, estanterias: c.estanterias }, 'restaurar una copia');
}

/* ---------------- Exportar / importar ---------------- */

export async function exportar() {
  const [discos, estanterias, todas] = await Promise.all([leerTodos('discos'), leerTodos('estanterias'), leerTodos('portadas')]);
  const usadas = new Set(discos.map((d) => d.portada).filter(Boolean));
  const portadas = {};
  for (const p of todas) if (usadas.has(p.hash)) portadas[p.hash] = await blobADataURL(p.blob);
  return { app: 'inventario-vinilos', formato: 2, exportado: new Date().toISOString(), estanterias, discos, portadas };
}

/** Acepta copias de la versión 1 (portadas en cada disco) y de la 2 (portadas aparte). */
export async function leerCopiaDeArchivo(json) {
  if (!json || !Array.isArray(json.discos)) throw new Error('El archivo no es una copia de seguridad de la app.');
  if (json.formato === 2) {
    const portadas = [];
    for (const [hash, dataURL] of Object.entries(json.portadas || {})) {
      try {
        portadas.push({ hash, blob: await dataURLaBlob(dataURL) });
      } catch {}
    }
    const ids = new Set((json.estanterias || []).map((e) => e.id));
    const estanterias = json.estanterias?.length ? json.estanterias : [{ id: uuid(), nombre: 'Mi colección', descripcion: '', orden: 'manual' }];
    const discos = json.discos.map((d) => normalizarDisco({ ...d, estanteria_id: ids.has(d.estanteria_id) ? d.estanteria_id : estanterias[0].id }));
    return { discos, estanterias, portadas };
  }
  return convertirFormatoAntiguo(json);
}

/* ---------------- Para la sincronización ---------------- */

export async function instantanea() {
  const [discos, estanterias, l] = await Promise.all([leerTodos('discos'), leerTodos('estanterias'), lapidas()]);
  return { discos, estanterias, lapidas: l };
}

/**
 * Aplica el resultado de fusionar con el servidor: escribe lo que ha cambiado
 * y borra lo que se borró en otro dispositivo. No toca updatedAt.
 */
export async function aplicarFusion(f) {
  const act = await instantanea();
  const mapa = (xs) => new Map(xs.map((x) => [x.id, x]));
  const mD = mapa(act.discos);
  const mE = mapa(act.estanterias);
  const fD = new Set(f.discos.map((d) => d.id));
  const fE = new Set(f.estanterias.map((e) => e.id));
  let cambios = 0;
  await tx(['discos', 'estanterias', 'meta'], 'readwrite', (st) => {
    for (const d of f.discos) if ((mD.get(d.id)?.updatedAt || -1) !== d.updatedAt) (st.discos.put(normalizarDisco(d)), cambios++);
    for (const e of f.estanterias) if ((mE.get(e.id)?.updatedAt || -1) !== e.updatedAt) (st.estanterias.put(e), cambios++);
    for (const id of mD.keys()) if (!fD.has(id)) (st.discos.delete(id), cambios++);
    for (const id of mE.keys()) if (!fE.has(id)) (st.estanterias.delete(id), cambios++);
    st.meta.put({ id: 'lapidas', items: f.lapidas || {} });
  });
  if (cambios) avisar('sincronizacion');
  return cambios;
}

export async function leerMeta(id) {
  return leer('meta', id);
}
export async function guardarMeta(obj) {
  await tx('meta', 'readwrite', (st) => st.meta.put(obj));
}

/* ---------------- Protección del almacenamiento ---------------- */

export async function pedirPersistencia() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function espacioUsado() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usado: e.usage || 0, cuota: e.quota || 0 } : null;
  } catch {
    return null;
  }
}
