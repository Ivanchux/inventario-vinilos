/* ==========================================================
   Servidor de sincronización para Cloudflare Workers (plan gratuito)
   Misma API que server/server.js, guardando en Workers KV.

   El servidor no puede leer nada: la app lo cifra todo en el
   dispositivo antes de subirlo.

   Enlaces (wrangler.toml):
     VINILOS          espacio de nombres KV
   Variables:
     CREATE_PASSWORD  contraseña para crear colecciones (secreto)
     ALLOWED_ORIGIN   orígenes permitidos, separados por comas
   ========================================================== */

const MAX_VAULT = 8 * 1024 * 1024;
const MAX_BLOB = 4 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;

async function sha256(texto) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cors(req, env) {
  const permitidos = String(env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origen = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-Create-Password',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (permitidos.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origen && permitidos.includes(origen)) h['Access-Control-Allow-Origin'] = origen;
  return h;
}

const json = (status, obj, h) => new Response(JSON.stringify(obj), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function idDesdeToken(req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') || '');
  return m ? sha256('vinilos-vault:' + m[1]) : null;
}

async function leerCuerpo(req, max) {
  if (Number(req.headers.get('Content-Length')) > max) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > max ? null : buf;
}

async function manejar(req, env) {
  const h = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const url = new URL(req.url);
  const p = url.pathname;
  const kv = env.VINILOS;
  if (!kv) return json(500, { error: 'Falta el enlace KV «VINILOS» en el Worker.' }, h);

  if (p === '/' || p === '/api/health') return json(200, { ok: true, app: 'inventario-vinilos', crearConContrasena: !!env.CREATE_PASSWORD }, h);

  if (p === '/api/vaults' && req.method === 'POST') {
    if (env.CREATE_PASSWORD && req.headers.get('X-Create-Password') !== env.CREATE_PASSWORD) return json(403, { error: 'Contraseña de creación incorrecta.' }, h);
    const cuerpo = await leerCuerpo(req, 4096);
    let token;
    try {
      token = JSON.parse(new TextDecoder().decode(cuerpo)).token;
    } catch {
      return json(400, { error: 'Petición no válida.' }, h);
    }
    if (!HEX64.test(token || '')) return json(400, { error: 'Token no válido.' }, h);
    const id = await sha256('vinilos-vault:' + token);
    if (await kv.get('vault:' + id)) return json(409, { error: 'Ya existe.' }, h);
    await kv.put('vault:' + id, JSON.stringify({ rev: 0, data: null, creado: Date.now(), actualizado: Date.now() }));
    return json(201, { ok: true, rev: 0 }, h);
  }

  if (p === '/api/vault') {
    const id = await idDesdeToken(req);
    if (!id) return json(401, { error: 'Falta el código de la colección.' }, h);
    const v = await kv.get('vault:' + id, 'json');
    if (!v) return json(404, { error: 'No existe ninguna colección con ese código en este servidor.' }, h);

    if (req.method === 'GET') {
      if (url.searchParams.get('meta') === '1') return json(200, { rev: v.rev, empty: !v.data, actualizado: v.actualizado }, h);
      return json(200, { rev: v.rev, data: v.data, actualizado: v.actualizado }, h);
    }
    if (req.method === 'PUT') {
      const buf = await leerCuerpo(req, MAX_VAULT + 4096);
      if (!buf) return json(413, { error: 'Demasiado grande.' }, h);
      let data;
      try {
        data = JSON.parse(new TextDecoder().decode(buf)).data;
      } catch {
        return json(400, { error: 'Petición no válida.' }, h);
      }
      if (typeof data !== 'string') return json(400, { error: 'Faltan los datos.' }, h);
      // KV no tiene transacciones: dos guardados en el mismo instante podrían cruzarse.
      // La app fusiona siempre con lo que hay en el servidor, así que el siguiente
      // guardado vuelve a juntarlo todo sin perder nada.
      if (Number(req.headers.get('If-Match')) !== v.rev) return json(409, { error: 'Hay una versión más reciente.' }, h);
      const nuevo = { ...v, rev: v.rev + 1, data, actualizado: Date.now() };
      await kv.put('vault:' + id, JSON.stringify(nuevo));
      return json(200, { rev: nuevo.rev }, h);
    }
    if (req.method === 'DELETE') {
      let cursor;
      do {
        const lista = await kv.list({ prefix: `blob:${id}:`, cursor });
        await Promise.all(lista.keys.map((k) => kv.delete(k.name)));
        cursor = lista.list_complete ? null : lista.cursor;
      } while (cursor);
      await kv.delete('vault:' + id);
      return json(200, { ok: true }, h);
    }
    return json(405, { error: 'Método no permitido.' }, h);
  }

  const mb = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(p);
  if (mb) {
    const id = await idDesdeToken(req);
    if (!id) return json(401, { error: 'Falta el código de la colección.' }, h);
    if (!(await kv.get('vault:' + id))) return json(404, { error: 'No existe ninguna colección con ese código en este servidor.' }, h);
    const clave = `blob:${id}:${mb[1]}`;
    if (req.method === 'PUT') {
      const buf = await leerCuerpo(req, MAX_BLOB);
      if (!buf) return json(413, { error: 'Demasiado grande.' }, h);
      await kv.put(clave, buf);
      return json(200, { ok: true }, h);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const buf = await kv.get(clave, 'arrayBuffer');
      if (!buf) return req.method === 'HEAD' ? new Response(null, { status: 404, headers: h }) : json(404, { error: 'No encontrada.' }, h);
      return new Response(req.method === 'HEAD' ? null : buf, {
        status: 200,
        headers: { ...h, 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength), 'Cache-Control': 'private, max-age=31536000, immutable' },
      });
    }
    return json(405, { error: 'Método no permitido.' }, h);
  }

  return json(404, { error: 'Ruta desconocida.' }, h);
}

export default {
  async fetch(req, env) {
    try {
      return await manejar(req, env);
    } catch (e) {
      return json(500, { error: 'Error interno.' }, cors(req, env));
    }
  },
};
