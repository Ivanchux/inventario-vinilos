/* Prueba de la API contra un servidor ya en marcha (Node o Cloudflare):
   SERVIDOR=http://127.0.0.1:8788 CREATE_PASSWORD=clave node server/api.test.mjs */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const base = process.env.SERVIDOR || 'http://127.0.0.1:8787';
const pass = process.env.CREATE_PASSWORD || '';
const call = (m, r, { headers = {}, body } = {}) => fetch(base + r, { method: m, headers, body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
const token = () => randomBytes(32).toString('hex');
const ok = (msg) => console.log('  ok   ' + msg);

const t = token();
const auth = { Authorization: 'Bearer ' + t };
assert.equal((await call('POST', '/api/vaults', { body: { token: t } })).status, pass ? 403 : 201); ok('sin contraseña no se crea');
assert.equal((await call('POST', '/api/vaults', { headers: { 'X-Create-Password': pass }, body: { token: t } })).status, pass ? 201 : 409); ok('con contraseña se crea');
let r = await call('GET', '/api/vault?meta=1', { headers: auth });
let j = await r.json(); assert.deepEqual([j.rev, j.empty], [0, true]); ok('colección nueva vacía');
r = await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'cifrado-1' } });
assert.equal((await r.json()).rev, 1); ok('guardar con la versión correcta');
assert.equal((await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'x' } })).status, 409); ok('una versión vieja no pisa');
j = await (await call('GET', '/api/vault', { headers: auth })).json(); assert.equal(j.data, 'cifrado-1'); ok('se lee lo guardado');
const id = 'ab'.repeat(32), bytes = new Uint8Array([1, 2, 3, 250]);
assert.equal((await call('PUT', '/api/blobs/' + id, { headers: auth, body: bytes })).status, 200);
assert.deepEqual(new Uint8Array(await (await call('GET', '/api/blobs/' + id, { headers: auth })).arrayBuffer()), bytes); ok('portadas: subir y bajar');
assert.equal((await call('GET', '/api/blobs/' + id, { headers: { Authorization: 'Bearer ' + token() } })).status, 404); ok('otra colección no las ve');
assert.equal((await call('GET', '/api/vault')).status, 401); ok('sin código no hay acceso');
assert.equal((await call('DELETE', '/api/vault', { headers: auth })).status, 200);
assert.equal((await call('GET', '/api/blobs/' + id, { headers: auth })).status, 404); ok('borrar la colección borra sus portadas');
console.log('API correcta en ' + base);
