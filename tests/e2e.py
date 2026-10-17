"""
Pruebas de extremo a extremo con un navegador real (Chromium + Playwright).

    pip install playwright && playwright install chromium
    python tests/e2e.py

Arranca el servidor de sincronización (que también sirve la app) en un
puerto libre y comprueba lo que de verdad importa: que no se pierden datos.
"""

import asyncio
import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
# Para probar contra otro servidor de sincronización (p. ej. el Worker de Cloudflare en local):
#   SERVIDOR_SYNC=http://127.0.0.1:8788 python tests/e2e.py
SYNC = os.environ.get("SERVIDOR_SYNC", "")
FALLOS = []


def comprobar(cond, msg):
    print(("  ok   " if cond else "  FALLO ") + msg)
    if not cond:
        FALLOS.append(msg)


def puerto_libre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def arrancar_servidor():
    puerto = puerto_libre()
    datos = tempfile.mkdtemp(prefix="vinilos-e2e-")
    env = {**os.environ, "PORT": str(puerto), "DATA_DIR": datos, "STATIC_DIR": str(RAIZ), "CREATE_PASSWORD": "clave-e2e"}
    proc = subprocess.Popen(["node", str(RAIZ / "server" / "server.js")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    base = f"http://localhost:{puerto}"
    for _ in range(50):
        try:
            urllib.request.urlopen(base + "/api/health", timeout=1)
            return proc, base
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("El servidor no arranca")


# --- Ayudas que se ejecutan dentro de la página ---

JPEG = """(color) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(8, 8, 20, 20);
  return c.toDataURL('image/jpeg', 0.9); }"""

SEMBRAR_V1 = """async ({ n, portada }) => {
  const conn = await new Promise((res, rej) => { const r = indexedDB.open('vinilosApp', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const est = [{ id: 'e1', nombre: 'Rock', descripcion: 'Del salón' }, { id: 'e2', nombre: 'Jazz', descripcion: '' }];
  const discos = Array.from({ length: n }, (_, i) => ({ id: 'd' + i, titulo: 'Disco ' + i, artista: 'Artista ' + (i % 7), anio: 1960 + i,
    decada: '1960s', genero: i % 2 ? 'Rock' : 'Jazz', estanteria_id: i % 2 ? 'e1' : 'e2', estado_posesion: 'tengo', tags: ['a'], rating: i % 6,
    precio: 10 + i, portada: i < 3 ? portada : null, fecha_alta: new Date(2026, 8, 1).toISOString(), color_vinilo: '#c0392b' }));
  await new Promise((res, rej) => { const tx = conn.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ discos, estanterias: est }, 'vinilos_db'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  conn.close(); return n; }"""

LEER = """async () => {
  const conn = await new Promise((res, rej) => { const r = indexedDB.open('vinilosApp'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const nombres = [...conn.objectStoreNames];
  const get = (st, fn) => new Promise((res) => { const tx = conn.transaction(st, 'readonly'); const q = fn(tx.objectStore(st)); tx.oncomplete = () => res(q.result); });
  const out = { version: conn.version, almacenes: nombres };
  if (nombres.includes('kv')) { const v1 = await get('kv', (s) => s.get('vinilos_db')); out.v1 = v1 ? v1.discos.length : null; }
  if (nombres.includes('discos')) { out.discos = (await get('discos', (s) => s.getAll())).length; out.portadas = (await get('portadas', (s) => s.getAllKeys())).length;
    out.copias = (await get('copias', (s) => s.getAllKeys())).length; out.estanterias = (await get('estanterias', (s) => s.getAll())).map((e) => e.nombre); }
  conn.close(); return out; }"""

FALLAR_IDB = """(() => { if (!location.search.includes('fallar')) return; const orig = indexedDB.open.bind(indexedDB); indexedDB.open = function (...a) {
  const req = {}; setTimeout(() => { req.error = new DOMException('Connection to Indexed Database server lost', 'UnknownError'); req.onerror && req.onerror({}); }, 5); return req; }; })();"""


async def nueva(navegador, base, ruta="/", **kw):
    ctx = await navegador.new_context(**kw)
    pg = await ctx.new_page()
    pg.errores = []
    pg.on("pageerror", lambda e: pg.errores.append(str(e)))
    await pg.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    await pg.goto(base + ruta)
    return ctx, pg


async def esperar(pg, expr, ms=8000):
    await pg.wait_for_function(expr, timeout=ms)


async def main():
    proc, base = arrancar_servidor()
    try:
        async with async_playwright() as p:
            nav = await p.chromium.launch()

            print("1. Migración desde la versión 1 (datos reales de antes)")
            ctx, pg = await nueva(nav, base, "/manifest.json")
            portada = await pg.evaluate(JPEG, "#2255aa")
            await pg.evaluate(SEMBRAR_V1, {"n": 40, "portada": portada})
            await pg.goto(base + "/")
            await esperar(pg, "document.querySelectorAll('.tarjeta').length === 40")
            info = await pg.evaluate(LEER)
            comprobar(info["discos"] == 40, f"los 40 discos pasan al formato nuevo ({info['discos']})")
            comprobar(info["v1"] == 40, "la copia del formato antiguo sigue intacta")
            comprobar(info["portadas"] == 1, "las 3 portadas iguales se guardan una sola vez")
            comprobar(info["copias"] >= 1, "hay una copia automática de antes del cambio")
            comprobar(sorted(info["estanterias"]) == ["Jazz", "Rock"], "se conservan las estanterías")
            await esperar(pg, "document.querySelectorAll('.tarjeta .funda img').length >= 3")
            comprobar(True, "las portadas antiguas se ven en las tarjetas")
            await pg.reload()
            await esperar(pg, "document.querySelectorAll('.tarjeta').length === 40")
            comprobar((await pg.evaluate(LEER))["discos"] == 40, "al recargar no se migra dos veces")
            comprobar(not pg.errores, "sin errores de JavaScript " + str(pg.errores[:2]))

            print("2. Dos ventanas abiertas a la vez")
            pg2 = await ctx.new_page()
            await pg2.route("https://fonts.googleapis.com/**", lambda r: r.abort())
            await pg2.goto(base + "/")
            await esperar(pg2, "document.querySelectorAll('.tarjeta').length === 40")
            await pg2.click("button.btn-anadir")
            await pg2.fill("#e_titulo", "Añadido en la otra ventana")
            await pg2.fill("#e_artista", "Alguien")
            await pg2.click('[data-e="guardar"]')
            await esperar(pg, "[...document.querySelectorAll('.tarjeta .t')].some(t => t.textContent.includes('otra ventana'))")
            comprobar(True, "la primera ventana ve el disco añadido en la segunda sin recargar")
            await pg.click(".tarjeta >> nth=0")
            await pg.click('dialog [data-nota="3"]')
            await pg.wait_for_timeout(400)
            comprobar((await pg.evaluate(LEER))["discos"] == 41, "editar en una ventana no borra lo de la otra")
            await pg2.close()
            await ctx.close()

            print("3. El almacenamiento falla al abrir la app")
            ctx, pg = await nueva(nav, base, "/manifest.json")
            await pg.evaluate(SEMBRAR_V1, {"n": 25, "portada": None})
            await pg.goto(base + "/")
            await esperar(pg, "document.querySelectorAll('.tarjeta').length === 25")
            await ctx.add_init_script(FALLAR_IDB)
            pg3 = await ctx.new_page()
            await pg3.goto(base + "/?fallar")
            await pg3.wait_for_selector(".aviso.peligro", timeout=15000)
            comprobar(await pg3.is_visible(".aviso.peligro"), "se muestra el aviso de que no se pudo leer")
            comprobar(await pg3.locator(".tarjeta").count() == 0, "no se muestra una colección vacía como si fuera la buena")
            info = await pg.evaluate(LEER)
            comprobar(info["discos"] == 25, f"los datos siguen intactos ({info['discos']})")
            await ctx.close()

            print("4. Sincronización entre dos dispositivos")
            movil, pm = await nueva(nav, base, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            pc, pp = await nueva(nav, base)
            for pg in (pm, pp):
                await esperar(pg, "!!document.querySelector('.vacio')")
            # Los dos dispositivos tenían ya cosas (como el padre: lo apuntó en ambos)
            for pg, extra in ((pm, "Solo en el móvil"), (pp, "Solo en el PC")):
                for titulo in ("Abbey Road", extra):
                    await pg.click('[data-accion="anadir"] >> visible=true')
                    await pg.fill("#e_titulo", titulo)
                    await pg.fill("#e_artista", "The Beatles" if titulo == "Abbey Road" else "Varios")
                    await pg.click('[data-e="guardar"]')
                    await pg.wait_for_timeout(250)
            # Portada propia en el PC
            jpg = base64.b64decode((await pp.evaluate(JPEG, "#aa3322")).split(",")[1])
            ruta_jpg = Path(tempfile.mkdtemp()) / "portada.jpg"
            ruta_jpg.write_bytes(jpg)
            await pp.click(".tarjeta >> nth=0")
            await pp.click('dialog [data-f="editar"]')
            async with pp.expect_file_chooser() as fc:
                await pp.click('[data-e="foto"]')
            await (await fc.value).set_files(str(ruta_jpg))
            await pp.wait_for_selector("#e_vista img")
            await pp.click('[data-e="guardar"]')
            await esperar(pp, "document.querySelectorAll('.tarjeta .funda img').length === 1")

            await pp.click("#btnSync")
            await pp.fill("#y_url", SYNC or base)
            await pp.fill("#y_pass", "clave-e2e")
            await pp.click("#y_ok")
            await pp.wait_for_selector(".codigo", timeout=15000)
            codigo = (await pp.text_content(".codigo")).strip()
            comprobar(len(codigo.replace("-", "")) == 20, "el PC crea la colección y da un código")
            enlace = await pp.evaluate("import('./js/sync.js').then(m => m.enlace())")
            await pp.keyboard.press("Escape")

            await pm.goto(enlace)
            await pm.wait_for_selector("#y_codigo")
            comprobar((await pm.input_value("#y_codigo")).replace("-", "") == codigo.replace("-", ""), "el enlace rellena el código en el móvil")
            await pm.click("#y_ok")
            await pm.wait_for_selector("dialog .grupo-dup", timeout=15000)
            comprobar(True, "al conectar, el móvil detecta el disco apuntado en los dos")
            await pm.click("dialog [data-todo]")
            await esperar(pm, "document.querySelectorAll('.tarjeta').length === 3")
            comprobar(True, "tras unir: 3 discos (Abbey Road una vez + uno de cada dispositivo)")
            await esperar(pm, "document.querySelectorAll('.tarjeta .funda img').length === 1", 15000)
            comprobar(True, "la portada hecha en el PC llega cifrada al móvil")

            await pm.evaluate("import('./js/sync.js').then(m => m.sincronizar())")
            await pm.wait_for_timeout(500)
            await pp.evaluate("import('./js/sync.js').then(m => m.sincronizar())")
            await esperar(pp, "document.querySelectorAll('.tarjeta').length === 3", 15000)
            comprobar(True, "el PC recibe la unión y el disco del móvil")
            titulos = sorted(await pp.locator(".tarjeta .t").all_text_contents())
            comprobar(titulos == ["Abbey Road", "Solo en el PC", "Solo en el móvil"], f"misma colección en los dos: {titulos}")

            # Borrar en el móvil se refleja en el PC y no «resucita»
            await pm.click(".tarjeta:has-text('Solo en el PC')")
            await pm.click('dialog [data-f="borrar"]')
            await pm.evaluate("import('./js/sync.js').then(m => m.sincronizar())")
            await pm.wait_for_timeout(800)
            await pp.evaluate("import('./js/sync.js').then(m => m.sincronizar())")
            await esperar(pp, "document.querySelectorAll('.tarjeta').length === 2", 15000)
            comprobar(True, "un borrado en el móvil llega al PC")
            await pp.evaluate("import('./js/sync.js').then(m => m.sincronizar())")
            await pp.wait_for_timeout(800)
            comprobar(await pp.locator(".tarjeta").count() == 2, "el disco borrado no vuelve a aparecer")
            comprobar(not pm.errores and not pp.errores, "sin errores de JavaScript " + str((pm.errores + pp.errores)[:2]))
            await movil.close()
            await pc.close()

            print("5. Buscar datos y portada (MusicBrainz simulado)")
            ctx, pg = await nueva(nav, base)
            jpg_url = await pg.evaluate(JPEG, "#119966")
            jpg_bytes = base64.b64decode(jpg_url.split(",")[1])
            await pg.route("https://musicbrainz.org/**", lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({
                "release-groups": [{"id": "rg-1", "title": "Kind of Blue", "first-release-date": "1959-08-17", "primary-type": "Album",
                                    "artist-credit": [{"name": "Miles Davis", "joinphrase": ""}], "tags": [{"name": "jazz", "count": 9}]}]})))
            await pg.route("https://coverartarchive.org/**", lambda r: r.fulfill(status=200, content_type="image/jpeg", headers={"Access-Control-Allow-Origin": "*"}, body=jpg_bytes))
            await pg.click('[data-accion="anadir"] >> visible=true')
            await pg.fill("#e_titulo", "kind of blue")
            await pg.click('[data-e="buscar"]')
            await pg.click(".resultado")
            await pg.wait_for_selector("#e_vista img")
            comprobar(await pg.input_value("#e_artista") == "Miles Davis", "rellena el artista")
            comprobar(await pg.input_value("#e_anio") == "1959", "rellena el año")
            comprobar(await pg.input_value("#e_genero") == "Jazz", "rellena el género")
            await pg.click('[data-e="guardar"]')
            await esperar(pg, "document.querySelectorAll('.tarjeta .funda img').length === 1")
            comprobar(True, "guarda el disco con la portada descargada")

            print("6. Copias de seguridad y copias automáticas")
            async with pg.expect_download() as dl:
                await pg.click("#btnMenu")
                await pg.click('[data-m="exportar"]')
            archivo = await (await dl.value).path()
            copia = json.loads(Path(archivo).read_text(encoding="utf-8"))
            comprobar(copia["formato"] == 2 and len(copia["discos"]) == 1 and len(copia["portadas"]) == 1, "la copia incluye discos y portadas")
            # Importar una copia del formato antiguo, añadiendo
            antigua = {"discos": [{"id": "x1", "titulo": "Viejo", "artista": "Y", "portada": jpg_url, "estanteria_id": "z"}], "estanterias": [{"id": "z", "nombre": "Antigua"}]}
            ruta = Path(tempfile.mkdtemp()) / "antigua.json"
            ruta.write_text(json.dumps(antigua), encoding="utf-8")
            await pg.set_input_files("#archivoImportar", str(ruta))
            await pg.click('dialog [data-i="anadir"]')
            await esperar(pg, "document.querySelectorAll('.tarjeta').length === 2")
            comprobar(True, "importa una copia antigua sumándola a la colección")
            await pg.click("#btnMenu")
            await pg.click('[data-m="copias"]')
            await pg.click("dialog [data-copia] >> nth=0")
            await pg.click("dialog >> nth=-1 >> [data-si]")
            await esperar(pg, "document.querySelectorAll('.tarjeta').length === 1")
            comprobar(True, "volver a la copia de antes de importar")
            comprobar(not pg.errores, "sin errores de JavaScript " + str(pg.errores[:2]))
            await ctx.close()
            await nav.close()
    finally:
        proc.terminate()

    print()
    if FALLOS:
        print(f"{len(FALLOS)} comprobaciones fallidas")
        sys.exit(1)
    print("Todo correcto")


asyncio.run(main())
