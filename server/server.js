/* ==========================================================
   Servidor de sincronización de Inventario de Vinilos
   Node ≥ 18, sin dependencias.

   El servidor no puede leer nada: la app cifra la colección y
   las portadas en el dispositivo (AES-GCM) antes de subirlas.
   Solo guarda texto cifrado, el hash del token y un número de
   versión para que dos dispositivos no se pisen.

   Variables de entorno:
     PORT             puerto (8787)
     DATA_DIR         carpeta de datos (./data)
     CREATE_PASSWORD  contraseña para crear colecciones nuevas (recomendado)
     ALLOWED_ORIGIN   orígenes permitidos, separados por comas (* por defecto)
     STATIC_DIR       carpeta de la app que se sirve (por defecto, la raíz del repositorio)
     MAX_VAULT_MB     tamaño máximo de la colección cifrada (8)
     MAX_BLOB_MB      tamaño máximo de cada portada cifrada (4)
   ========================================================== */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

function crearServidor(opciones = {}) {
  const env = { ...process.env, ...opciones };
  const DATA = path.resolve(env.DATA_DIR || './data');
  const MAX_VAULT = (Number(env.MAX_VAULT_MB) || 8) * 1024 * 1024;
  const MAX_BLOB = (Number(env.MAX_BLOB_MB) || 4) * 1024 * 1024;
  const ORIGENES = String(env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const STATIC = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null;
  const PASS = env.CREATE_PASSWORD || '';

  fs.mkdirSync(path.join(DATA, 'vaults'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'blobs'), { recursive: true });

  const rutaVault = (id) => path.join(DATA, 'vaults', id + '.json');
  const rutaBlobs = (id) => path.join(DATA, 'blobs', id);

  // Un cerrojo por colección: dos PUT simultáneos se atienden de uno en uno.
  const cerrojos = new Map();
  async function conCerrojo(id, fn) {
    const previo = cerrojos.get(id) || Promise.resolve();
    let liberar;
    const actual = new Promise((r) => (liberar = r));
    cerrojos.set(id, previo.then(() => actual));
    await previo;
    try {
      return await fn();
    } finally {
      liberar();
      if (cerrojos.get(id) === actual) cerrojos.delete(id);
    }
  }

  async function escribirAtomico(ruta, datos) {
    const tmp = ruta + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fsp.writeFile(tmp, datos);
    await fsp.rename(tmp, ruta);
  }

  async function leerVault(id) {
    try {
      return JSON.parse(await fsp.readFile(rutaVault(id), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  function cabecerasCors(req) {
    const origen = req.headers.origin;
    const h = {
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-Create-Password',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (ORIGENES.includes('*')) h['Access-Control-Allow-Origin'] = '*';
    else if (origen && ORIGENES.includes(origen)) h['Access-Control-Allow-Origin'] = origen;
    return h;
  }

  function leerCuerpo(req, max) {
    return new Promise((resolve, reject) => {
      const grande = () => Object.assign(new Error('Demasiado grande'), { status: 413 });
      if (Number(req.headers['content-length']) > max) {
        req.resume(); // se descarta el cuerpo sin cortar la conexión, para que el cliente reciba el 413
        return reject(grande());
      }
      const trozos = [];
      let total = 0;
      let excedido = false;
      req.on('data', (c) => {
        if (excedido) return;
        total += c.length;
        if (total > max) {
          excedido = true;
          trozos.length = 0;
          return reject(grande());
        }
        trozos.push(c);
      });
      req.on('end', () => !excedido && resolve(Buffer.concat(trozos)));
      req.on('error', reject);
    });
  }

  const json = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(obj));
  };
  const error = (res, status, msg, extra) => json(res, status, { error: msg }, extra);

  function idDesdeToken(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
    return m ? sha256('vinilos-vault:' + m[1]) : null;
  }

  const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

  async function servirEstatico(req, res, cors) {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const ruta = path.join(STATIC, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!ruta.startsWith(STATIC + path.sep) && ruta !== STATIC) return error(res, 403, 'Prohibido', cors);
    const relativa = '/' + path.relative(STATIC, ruta);
    if (/[/\\](server|tests|\.git|\.github|data)([/\\]|$)/.test(relativa)) return error(res, 404, 'No encontrado', cors);
    try {
      const datos = await fsp.readFile(ruta);
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': rel.endsWith('.html') || rel.endsWith('service-worker.js') ? 'no-cache' : 'public, max-age=3600' });
      res.end(datos);
    } catch {
      error(res, 404, 'No encontrado', cors);
    }
  }

  async function manejar(req, res) {
    const cors = cabecerasCors(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/api/health') return json(res, 200, { ok: true, app: 'inventario-vinilos', crearConContrasena: !!PASS }, cors);

    if (p === '/api/vaults' && req.method === 'POST') {
      if (PASS && req.headers['x-create-password'] !== PASS) return error(res, 403, 'Contraseña de creación incorrecta.', cors);
      const cuerpo = JSON.parse((await leerCuerpo(req, 4096)).toString('utf8') || '{}');
      if (!HEX64.test(cuerpo.token || '')) return error(res, 400, 'Token no válido.', cors);
      const id = sha256('vinilos-vault:' + cuerpo.token);
      return conCerrojo(id, async () => {
        if (await leerVault(id)) return error(res, 409, 'Ya existe.', cors);
        await escribirAtomico(rutaVault(id), JSON.stringify({ rev: 0, data: null, creado: Date.now(), actualizado: Date.now() }));
        json(res, 201, { ok: true, rev: 0 }, cors);
      });
    }

    if (p === '/api/vault') {
      const id = idDesdeToken(req);
      if (!id) return error(res, 401, 'Falta el código de la colección.', cors);
      const v = await leerVault(id);
      if (!v) return error(res, 404, 'No existe ninguna colección con ese código en este servidor.', cors);

      if (req.method === 'GET') {
        if (url.searchParams.get('meta') === '1') return json(res, 200, { rev: v.rev, empty: !v.data, actualizado: v.actualizado }, cors);
        return json(res, 200, { rev: v.rev, data: v.data, actualizado: v.actualizado }, cors);
      }
      if (req.method === 'PUT') {
        const cuerpo = JSON.parse((await leerCuerpo(req, MAX_VAULT + 4096)).toString('utf8') || '{}');
        if (typeof cuerpo.data !== 'string') return error(res, 400, 'Faltan los datos.', cors);
        const esperado = Number(req.headers['if-match']);
        return conCerrojo(id, async () => {
          const actual = await leerVault(id);
          if (!Number.isFinite(esperado) || esperado !== actual.rev) return error(res, 409, 'Hay una versión más reciente.', { ...cors });
          const nuevo = { ...actual, rev: actual.rev + 1, data: cuerpo.data, actualizado: Date.now() };
          await escribirAtomico(rutaVault(id), JSON.stringify(nuevo));
          json(res, 200, { rev: nuevo.rev }, cors);
        });
      }
      if (req.method === 'DELETE') {
        return conCerrojo(id, async () => {
          await fsp.rm(rutaVault(id), { force: true });
          await fsp.rm(rutaBlobs(id), { recursive: true, force: true });
          json(res, 200, { ok: true }, cors);
        });
      }
      return error(res, 405, 'Método no permitido.', cors);
    }

    const mb = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(p);
    if (mb) {
      const id = idDesdeToken(req);
      if (!id) return error(res, 401, 'Falta el código de la colección.', cors);
      if (!(await leerVault(id))) return error(res, 404, 'No existe ninguna colección con ese código en este servidor.', cors);
      const ruta = path.join(rutaBlobs(id), mb[1]);
      if (req.method === 'PUT') {
        const datos = await leerCuerpo(req, MAX_BLOB);
        await fsp.mkdir(rutaBlobs(id), { recursive: true });
        await escribirAtomico(ruta, datos);
        return json(res, 200, { ok: true }, cors);
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          const st = await fsp.stat(ruta);
          res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
          if (req.method === 'HEAD') return res.end();
          fs.createReadStream(ruta).pipe(res);
        } catch {
          if (req.method === 'HEAD') {
            res.writeHead(404, cors);
            return res.end();
          }
          error(res, 404, 'No encontrada.', cors);
        }
        return;
      }
      return error(res, 405, 'Método no permitido.', cors);
    }

    if (p.startsWith('/api/')) return error(res, 404, 'Ruta desconocida.', cors);
    if (STATIC && (req.method === 'GET' || req.method === 'HEAD')) return servirEstatico(req, res, cors);
    return error(res, 404, 'No encontrado.', cors);
  }

  return http.createServer((req, res) => {
    manejar(req, res).catch((e) => {
      if (res.headersSent) return res.destroy();
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      error(res, status, status === 413 ? 'Demasiado grande.' : status === 400 ? 'Petición no válida.' : 'Error interno.', cabecerasCors(req));
    });
  });
}

module.exports = { crearServidor };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  // Sin STATIC_DIR: si el servidor está dentro del repositorio, sirve la app de la carpeta de arriba.
  const raizRepo = path.resolve(__dirname, '..');
  const estatico = process.env.STATIC_DIR || (fs.existsSync(path.join(raizRepo, 'index.html')) ? raizRepo : '');
  crearServidor({ STATIC_DIR: estatico }).listen(port, () => console.log(`Sincronización de vinilos escuchando en :${port}`));
}
