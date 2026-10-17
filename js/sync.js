/* ==========================================================
   SINCRONIZACIÓN ENTRE DISPOSITIVOS (opcional)
   - La app sigue funcionando sin servidor: esto solo mantiene
     la misma colección en el móvil y en el ordenador.
   - Todo se cifra en el dispositivo (AES-GCM, clave derivada del
     código con PBKDF2). El servidor solo ve texto ilegible.
   - Fusión disco a disco: gana la versión modificada más tarde;
     los borrados se recuerdan para que no reaparezcan.
   - Si dos dispositivos guardan a la vez, el servidor rechaza al
     segundo (If-Match) y este vuelve a fusionar y reintenta.
   ========================================================== */

import * as store from './store.js';
import { sha256Hex, ls, debounce } from './util.js';

const CLAVE = 'vinilos-sync';
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let cfg = null; // { url, code, rev, sucio, ultima, error }
let estado = 'off'; // off | ok | sincronizando | error | sin-conexion
let enMarcha = false;
let otraVez = false;
let ultimaVez = 0;
const oyentes = new Set();

const cargarCfg = () => {
  try {
    cfg = JSON.parse(ls.get(CLAVE)) || null;
  } catch {
    cfg = null;
  }
};
const guardarCfg = () => (cfg ? ls.set(CLAVE, JSON.stringify(cfg)) : ls.del(CLAVE));
export const info = () => ({ estado, activo: !!cfg, url: cfg?.url || '', ultima: cfg?.ultima || null, error: cfg?.error || null });
function ponerEstado(e, err) {
  estado = e;
  if (cfg) cfg.error = err || null;
  oyentes.forEach((fn) => fn(info()));
}
export const alCambiarEstado = (fn) => (oyentes.add(fn), () => oyentes.delete(fn));

/* ---------------- Códigos y cifrado ---------------- */

export const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatearCodigo = (c) => normalizarCodigo(c).replace(/(.{4})(?=.)/g, '$1-');

function generarCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('');
}

const enc = new TextEncoder();
const tokenDe = (code) => sha256Hex('vinilos-auth:' + normalizarCodigo(code));
const idPortada = (code, hash) => sha256Hex('vinilos-portada:' + normalizarCodigo(code) + ':' + hash);

let claveCache = { code: null, key: null };
async function clave(code) {
  if (claveCache.code === code) return claveCache.key;
  const base = await crypto.subtle.importKey('raw', enc.encode('vinilos-enc:' + normalizarCodigo(code)), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('inventario-vinilos-sync-v1'), iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  claveCache = { code, key };
  return key;
}

async function cifrarBytes(bytes, code) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await clave(code), bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function descifrarBytes(bytes, code) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await clave(code), bytes.slice(12)));
  } catch {
    throw new Error('No se pudo descifrar: el código no corresponde a esta colección.');
  }
}
const aB64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cifrarJSON = async (obj, code) => 'v1.' + aB64(await cifrarBytes(enc.encode(JSON.stringify(obj)), code));
async function descifrarJSON(txt, code) {
  if (!String(txt).startsWith('v1.')) throw new Error('Formato desconocido en el servidor.');
  return JSON.parse(new TextDecoder().decode(await descifrarBytes(deB64(txt.slice(3)), code)));
}

/* ---------------- Fusión ---------------- */

export function fusionar(a, b) {
  const lapidas = { ...(a.lapidas || {}) };
  for (const [id, ts] of Object.entries(b.lapidas || {})) lapidas[id] = Math.max(lapidas[id] || 0, ts);
  const unir = (xs = [], ys = []) => {
    const m = new Map();
    for (const x of [...xs, ...ys]) {
      const cur = m.get(x.id);
      if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) m.set(x.id, x);
    }
    return [...m.values()].filter((x) => !(lapidas[x.id] && lapidas[x.id] >= (x.updatedAt || 0)));
  };
  return { discos: unir(a.discos, b.discos), estanterias: unir(a.estanterias, b.estanterias), lapidas };
}

export function firma(d) {
  const ids = (xs) => (xs || []).map((x) => `${x.id}:${x.updatedAt || 0}`).sort().join(',');
  return [ids(d.discos), ids(d.estanterias), Object.keys(d.lapidas || {}).sort().join(',')].join('|');
}

/* ---------------- Red ---------------- */

export function limpiarUrl(url) {
  let s = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? 'http://' : 'https://') + s;
  return s;
}

async function api(metodo, ruta, { url = cfg?.url, code = cfg?.code, headers = {}, body, binario = false, conToken = true } = {}) {
  const h = { ...headers };
  if (conToken) h.Authorization = 'Bearer ' + (await tokenDe(code));
  if (body && !binario) h['Content-Type'] = 'application/json';
  if (binario) h['Content-Type'] = 'application/octet-stream';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(url + ruta, { method: metodo, headers: h, body: body == null ? undefined : binario ? body : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
  } catch {
    const e = new Error(
      location.protocol === 'https:' && url.startsWith('http:')
        ? 'La app va por https y el servidor por http: el navegador lo bloquea.'
        : navigator.onLine === false
          ? 'Sin conexión.'
          : 'No se pudo conectar con el servidor.'
    );
    e.sinConexion = true;
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (binario === 'respuesta') {
    if (!res.ok) throw Object.assign(new Error('Error ' + res.status), { status: res.status });
    return new Uint8Array(await res.arrayBuffer());
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `Error ${res.status} del servidor`), { status: res.status });
  return j;
}

/* ---------------- Portadas ---------------- */

async function sincronizarPortadas(datos, alDescargar) {
  const code = cfg.code;
  const meta = (await store.leerMeta('syncPortadas')) || { id: 'syncPortadas', code, subidas: [] };
  if (meta.code !== code) Object.assign(meta, { code, subidas: [] });
  const subidas = new Set(meta.subidas);
  const usadas = [...new Set(datos.discos.map((d) => d.portada).filter(Boolean))];
  const pendientes = [];
  for (const h of usadas) pendientes.push({ h, local: await store.tienePortada(h) });
  let bajadas = 0;

  const trabajar = async ({ h, local }) => {
    const id = await idPortada(code, h);
    if (local && !subidas.has(h)) {
      const blob = await store.leerPortada(h);
      const cifrado = await cifrarBytes(new Uint8Array(await blob.arrayBuffer()), code);
      await api('PUT', '/api/blobs/' + id, { body: cifrado, binario: true });
      subidas.add(h);
    } else if (!local) {
      try {
        const bytes = await descifrarBytes(await api('GET', '/api/blobs/' + id, { binario: 'respuesta' }), code);
        if ((await sha256Hex(bytes)) !== h) return;
        await store.guardarPortadaConHash(h, new Blob([bytes], { type: 'image/jpeg' }));
        subidas.add(h);
        bajadas++;
      } catch (e) {
        if (e.status !== 404) throw e; // 404: el otro dispositivo aún no la ha subido
      }
    }
  };
  const cola = [...pendientes];
  await Promise.all(
    [0, 1, 2].map(async () => {
      while (cola.length) await trabajar(cola.shift());
    })
  );
  meta.subidas = [...subidas];
  await store.guardarMeta(meta);
  if (bajadas && alDescargar) alDescargar(bajadas);
}

/* ---------------- Sincronizar ---------------- */

let alTerminar = null; // callback de la app para repintar

export async function sincronizar() {
  if (!cfg) return;
  if (enMarcha) {
    otraVez = true;
    return;
  }
  enMarcha = true;
  ponerEstado('sincronizando');
  let objetivo = null;
  let cambios = 0;
  const sucioAlEmpezar = contador;
  try {
    for (let intento = 0; intento < 4; intento++) {
      const meta = await api('GET', '/api/vault?meta=1');
      const local = await store.instantanea();
      objetivo = local;
      if (meta.rev === cfg.rev && !cfg.sucio) break;

      let firmaRemota = null;
      if (!meta.empty) {
        const remoto = await descifrarJSON((await api('GET', '/api/vault')).data, cfg.code);
        firmaRemota = firma(remoto);
        // Siempre se fusiona con lo del servidor, aunque la versión coincida:
        // si dos guardados se cruzaron, aquí se vuelven a juntar.
        objetivo = fusionar(local, remoto);
      }
      if (firma(objetivo) !== firma(local)) cambios += await store.aplicarFusion(objetivo);
      if (firmaRemota !== null && firmaRemota === firma(objetivo)) {
        cfg.rev = meta.rev;
        if (contador === sucioAlEmpezar) cfg.sucio = false;
        break;
      }
      try {
        const put = await api('PUT', '/api/vault', { headers: { 'If-Match': String(meta.rev) }, body: { data: await cifrarJSON({ app: 'inventario-vinilos', formato: 2, ...objetivo }, cfg.code) } });
        cfg.rev = put.rev;
        if (contador === sucioAlEmpezar) cfg.sucio = false;
        break;
      } catch (e) {
        if (e.status === 409 && intento < 3) continue;
        throw e;
      }
    }
    await sincronizarPortadas(objetivo, (n) => alTerminar?.({ portadas: n }));
    cfg.ultima = Date.now();
    guardarCfg();
    ponerEstado('ok');
    if (cambios) alTerminar?.({ cambios });
  } catch (e) {
    guardarCfg();
    ponerEstado(e.sinConexion ? 'sin-conexion' : 'error', e.message);
  } finally {
    enMarcha = false;
    ultimaVez = Date.now();
    if (otraVez) {
      otraVez = false;
      setTimeout(sincronizar, 500);
    }
  }
}

const sincronizarEnUnRato = debounce(sincronizar, 4000);
let contador = 0;

/* ---------------- Conectar ---------------- */

export async function comprobarServidor(url) {
  const r = await api('GET', '/api/health', { url: limpiarUrl(url), conToken: false });
  if (r.app !== 'inventario-vinilos') throw new Error('Esa dirección no es un servidor de Inventario de Vinilos.');
  return r;
}

export async function crear(url, contrasena = '') {
  if (!crypto?.subtle) throw new Error('Este navegador no permite cifrar aquí. Abre la app por https.');
  url = limpiarUrl(url);
  await comprobarServidor(url);
  const code = generarCodigo();
  await api('POST', '/api/vaults', { url, conToken: false, headers: contrasena ? { 'X-Create-Password': contrasena } : {}, body: { token: await tokenDe(code) } });
  cfg = { url, code, rev: 0, sucio: true, ultima: null, error: null };
  guardarCfg();
  await sincronizar();
  if (estado === 'error' || estado === 'sin-conexion') throw new Error(cfg.error);
  return formatearCodigo(code);
}

export async function conectar(url, codigo) {
  if (!crypto?.subtle) throw new Error('Este navegador no permite cifrar aquí. Abre la app por https.');
  url = limpiarUrl(url);
  const code = normalizarCodigo(codigo);
  if (code.length < 16) throw new Error('El código es demasiado corto.');
  await api('GET', '/api/vault?meta=1', { url, code });
  cfg = { url, code, rev: -1, sucio: true, ultima: null, error: null };
  guardarCfg();
  await sincronizar();
  if (estado === 'error' || estado === 'sin-conexion') {
    const msg = cfg.error;
    cfg = null;
    guardarCfg();
    ponerEstado('off');
    throw new Error(msg);
  }
}

export function desconectar() {
  cfg = null;
  guardarCfg();
  ponerEstado('off');
}

export const codigo = () => (cfg ? formatearCodigo(cfg.code) : '');
export const enlace = () => (cfg ? `${location.origin}${location.pathname}#enlazar=${encodeURIComponent(cfg.url)}&codigo=${cfg.code}` : '');
export const activo = () => !!cfg;

export function iniciar(repintar) {
  alTerminar = repintar;
  cargarCfg();
  estado = cfg ? 'ok' : 'off';
  store.alCambiar((motivo, externo) => {
    if (!cfg || externo || motivo === 'sincronizacion') return;
    contador++;
    cfg.sucio = true;
    guardarCfg();
    sincronizarEnUnRato();
  });
  if (cfg) setTimeout(sincronizar, 1200);
  addEventListener('online', () => cfg && sincronizar());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cfg && Date.now() - ultimaVez > 20000) sincronizar();
  });
  setInterval(() => cfg && document.visibilityState === 'visible' && sincronizar(), 5 * 60 * 1000);
}
