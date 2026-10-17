/* Pruebas del servidor: node --test server/ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { crearServidor } = require('./server.js');

async function arrancar(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinilos-'));
  const srv = crearServidor({ DATA_DIR: dir, ...env });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (method, ruta, { headers = {}, body } = {}) =>
    fetch(base + ruta, { method, headers, body: body == null ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
  return { srv, base, call, dir, cerrar: () => new Promise((r) => srv.close(r)) };
}

const token = () => crypto.randomBytes(32).toString('hex');

test('crear, guardar con If-Match y detectar conflictos', async () => {
  const s = await arrancar({ CREATE_PASSWORD: 'clave' });
  try {
    const t = token();
    assert.equal((await s.call('POST', '/api/vaults', { body: { token: t } })).status, 403);
    assert.equal((await s.call('POST', '/api/vaults', { headers: { 'X-Create-Password': 'clave' }, body: { token: t } })).status, 201);
    assert.equal((await s.call('POST', '/api/vaults', { headers: { 'X-Create-Password': 'clave' }, body: { token: t } })).status, 409);

    const auth = { Authorization: 'Bearer ' + t };
    let r = await s.call('GET', '/api/vault?meta=1', { headers: auth });
    assert.deepEqual(await r.json().then((j) => [j.rev, j.empty]), [0, true]);

    r = await s.call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'cifrado-1' } });
    assert.equal((await r.json()).rev, 1);

    r = await s.call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'pisaria' } });
    assert.equal(r.status, 409, 'una versión vieja no puede pisar a una nueva');

    r = await s.call('GET', '/api/vault', { headers: auth });
    const j = await r.json();
    assert.equal(j.data, 'cifrado-1');
    assert.equal(j.rev, 1);

    assert.equal((await s.call('GET', '/api/vault', { headers: { Authorization: 'Bearer ' + token() } })).status, 404);
    assert.equal((await s.call('GET', '/api/vault')).status, 401);
  } finally {
    await s.cerrar();
  }
});

test('PUT simultáneos: solo uno gana', async () => {
  const s = await arrancar();
  try {
    const t = token();
    await s.call('POST', '/api/vaults', { body: { token: t } });
    const auth = { Authorization: 'Bearer ' + t, 'If-Match': '0' };
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => s.call('PUT', '/api/vault', { headers: auth, body: { data: 'v' + i } })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1);
    assert.equal(rs.filter((r) => r.status === 409).length, 4);
  } finally {
    await s.cerrar();
  }
});

test('portadas: subir, leer, separadas por colección y con límite de tamaño', async () => {
  const s = await arrancar({ MAX_BLOB_MB: 0.001 });
  try {
    const a = token();
    const b = token();
    await s.call('POST', '/api/vaults', { body: { token: a } });
    await s.call('POST', '/api/vaults', { body: { token: b } });
    const id = 'ab'.repeat(32);
    const bytes = new Uint8Array([1, 2, 3, 250]);
    assert.equal((await s.call('HEAD', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + a } })).status, 404);
    assert.equal((await s.call('PUT', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + a }, body: bytes })).status, 200);
    const r = await s.call('GET', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + a } });
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
    assert.equal((await s.call('GET', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + b } })).status, 404, 'otra colección no la ve');
    assert.equal((await s.call('PUT', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + a }, body: new Uint8Array(5000) })).status, 413);
    assert.equal((await s.call('PUT', '/api/blobs/../../etc', { headers: { Authorization: 'Bearer ' + a }, body: bytes })).status, 404);
  } finally {
    await s.cerrar();
  }
});

test('CORS restringido a los orígenes permitidos', async () => {
  const s = await arrancar({ ALLOWED_ORIGIN: 'https://ivanchux.github.io' });
  try {
    let r = await s.call('OPTIONS', '/api/vault', { headers: { Origin: 'https://ivanchux.github.io' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://ivanchux.github.io');
    r = await s.call('OPTIONS', '/api/vault', { headers: { Origin: 'https://malo.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally {
    await s.cerrar();
  }
});

test('borrar la colección borra también sus portadas', async () => {
  const s = await arrancar();
  try {
    const t = token();
    const auth = { Authorization: 'Bearer ' + t };
    await s.call('POST', '/api/vaults', { body: { token: t } });
    await s.call('PUT', '/api/blobs/' + 'cd'.repeat(32), { headers: auth, body: new Uint8Array([9]) });
    assert.equal((await s.call('DELETE', '/api/vault', { headers: auth })).status, 200);
    assert.equal((await s.call('GET', '/api/vault', { headers: auth })).status, 404);
    const resto = fs.readdirSync(path.join(s.dir, 'blobs'));
    assert.equal(resto.length, 0);
  } finally {
    await s.cerrar();
  }
});

test('sirve la app si STATIC_DIR está definido, sin exponer el servidor', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vinilos-static-'));
  fs.writeFileSync(path.join(raiz, 'index.html'), '<h1>ok</h1>');
  fs.mkdirSync(path.join(raiz, 'server'));
  fs.writeFileSync(path.join(raiz, 'server', 'server.js'), 'secreto');
  const s = await arrancar({ STATIC_DIR: raiz });
  try {
    assert.equal(await (await s.call('GET', '/')).text(), '<h1>ok</h1>');
    assert.equal((await s.call('GET', '/server/server.js')).status, 404);
    assert.equal((await s.call('GET', '/../../etc/passwd')).status, 404);
  } finally {
    await s.cerrar();
  }
});
