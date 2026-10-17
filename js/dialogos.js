/* ==========================================================
   Ventanas de la app: ficha, editor, estanterías, menú,
   sincronización, duplicados, copias, resumen anual…
   ========================================================== */

import * as store from './store.js';
import * as sync from './sync.js';
import * as A from './app.js';
import { buscarDiscos, descargarPortada, miniatura, comprimir, urlBusquedaGoogle } from './portadas.js';
import { $, $$, esc, normalizar, euros, descargar, ls, hoyISO, uuid, haceCuanto, decadaDe } from './util.js';
import { icono } from './iconos.js';
import { dialogo, preguntar, avisar, tostada } from './ui.js';
import { SERVIDOR, VERSION } from './config.js';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const anioActual = new Date().getFullYear();

/* ---------------- Ficha de un disco ---------------- */

let audioURL = null;

export function abrirFicha(id) {
  const d = A.disco(id);
  if (!d) return;
  const est = A.estanteria(A.estanteriaDe(d));
  const chips = [
    d.estado_posesion === 'quiero' ? '<span class="dato-chip acento">Lo quiero</span>' : '',
    d.escuchando ? '<span class="dato-chip acento">Sonando ahora</span>' : '',
    d.anio ? `<span class="dato-chip">${d.anio}</span>` : '',
    d.genero ? `<span class="dato-chip">${esc(d.genero)}</span>` : '',
    ...(d.tags || []).map((t) => `<span class="dato-chip">#${esc(t)}</span>`),
  ].join('');
  const datos = [
    ['Precio', d.precio != null ? euros(d.precio) : ''],
    ['Formato', d.formato],
    ['Condición', d.condicion],
    ['Estantería', est?.nombre],
    ['Comprado', fecha(d.fecha_compra)],
    ['Añadido', fecha(d.fecha_alta)],
  ].filter((x) => x[1]);
  const pistas = (d.tracklist || '').split('\n').map((x) => x.trim()).filter(Boolean);

  const dlg = dialogo({
    clase: 'ancho',
    etiqueta: d.titulo,
    cuerpo: `<div class="ficha-ancha">
      <div class="ficha-portada"><span class="vinilo" style="--vc:${esc(d.color_vinilo || '#1c1c1c')}"></span>
        <div class="funda" ${d.portada ? `data-portada="${d.portada}"` : ''}><span class="inicial">${A.inicial(d)}</span></div></div>
      <div>
        <h2 class="ficha-titulo serif">${esc(d.titulo)}</h2>
        <div class="ficha-artista">${esc(d.artista || 'Artista desconocido')}</div>
        <div class="ficha-chips">${chips}</div>
        <div class="estrellas" role="radiogroup" aria-label="Valoración">${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${n === d.rating}" aria-label="${n} de 5" data-nota="${n}" class="${n <= d.rating ? 'on' : ''}">${icono('estrella')}</button>`).join('')}</div>
        ${datos.length ? `<dl class="ficha-datos">${datos.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${d.notas ? `<div class="ficha-notas">${esc(d.notas)}</div>` : ''}
        ${pistas.length ? `<ol class="ficha-pistas">${pistas.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
        <div class="ficha-acciones">
          <button class="btn btn-sm" data-f="audio">${icono('auriculares', 'ico-sm')}Escuchar un archivo</button>
          ${d.youtube ? `<a class="btn btn-sm" href="${esc(d.youtube)}" target="_blank" rel="noopener">${icono('play', 'ico-sm')}YouTube</a>` : ''}
          ${!d.portada ? `<button class="btn btn-sm" data-f="portada">${icono('imagen', 'ico-sm')}Añadir portada</button>` : ''}
        </div>
        <div data-f="reproductor"></div>
      </div></div>`,
    pie: `<button class="btn btn-peligro" data-f="borrar" aria-label="Eliminar disco">${icono('papelera')}</button><button class="btn" data-cerrar>Cerrar</button><button class="btn btn-primario" data-f="editar">${icono('lapiz')}Editar</button>`,
    alCerrar: () => {
      if (audioURL) URL.revokeObjectURL(audioURL);
      audioURL = null;
    },
  });
  A.hidratarPortadas(dlg);
  const funda = dlg.querySelector('.ficha-portada .funda');
  funda.addEventListener('click', () => {
    const img = funda.querySelector('img');
    if (!img) return;
    const z = document.createElement('div');
    z.className = 'zoom';
    z.innerHTML = `<img src="${img.src}" alt="Portada de ${esc(d.titulo)}">`;
    z.onclick = () => z.remove();
    dlg.append(z);
  });
  dlg.querySelectorAll('[data-nota]').forEach((b) =>
    b.addEventListener('click', async () => {
      const n = Number(b.dataset.nota);
      d.rating = d.rating === n ? 0 : n;
      dlg.querySelectorAll('[data-nota]').forEach((x) => {
        x.classList.toggle('on', Number(x.dataset.nota) <= d.rating);
        x.setAttribute('aria-checked', String(Number(x.dataset.nota) === d.rating));
      });
      await store.guardarDisco(d);
    })
  );
  dlg.querySelector('[data-f="editar"]').onclick = () => {
    dlg.close();
    abrirEditor(d.id);
  };
  dlg.querySelector('[data-f="borrar"]').onclick = async () => {
    dlg.close();
    await borrarConDeshacer(d);
  };
  dlg.querySelector('[data-f="portada"]')?.addEventListener('click', () => {
    dlg.close();
    abrirEditor(d.id, { buscar: true });
  });
  dlg.querySelector('[data-f="audio"]').onclick = () => {
    const inp = $('#archivoAudio');
    inp.onchange = () => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      if (audioURL) URL.revokeObjectURL(audioURL);
      audioURL = URL.createObjectURL(f);
      const cont = dlg.querySelector('[data-f="reproductor"]');
      cont.innerHTML = `<audio class="ficha-audio" controls src="${audioURL}"></audio>`;
      const au = cont.querySelector('audio');
      const vin = dlg.querySelector('.vinilo');
      au.onplay = () => vin.classList.add('sonando');
      au.onpause = au.onended = () => vin.classList.remove('sonando');
      au.play().catch(() => {});
    };
    inp.click();
  };
}

async function borrarConDeshacer(d) {
  await store.borrarDisco(d.id);
  tostada(`«${d.titulo}» eliminado`, { accion: 'Deshacer', ms: 8000, alPulsar: () => store.restaurarDisco(d) });
}

/* ---------------- Editor (añadir / editar) ---------------- */

const COLORES = [
  ['#1c1c1c', 'Negro'],
  ['#e8e8e8', 'Blanco'],
  ['#c0392b', 'Rojo'],
  ['#2f6fd1', 'Azul'],
  ['#3fae6b', 'Verde'],
  ['#f4d35e', 'Amarillo'],
  ['#e67e22', 'Naranja'],
  ['#8e44ad', 'Morado'],
  ['#e78fb3', 'Rosa'],
];
const FORMATOS = ['LP', 'Doble LP', 'EP', 'Single', 'Maxi', 'Box Set', 'Otro'];
const CONDICIONES = ['Mint (M)', 'Near Mint (NM)', 'Muy bueno+ (VG+)', 'Muy bueno (VG)', 'Bueno (G)', 'Aceptable'];

export function abrirEditor(id, { estanteria, buscar = false } = {}) {
  const previo = id ? A.disco(id) : null;
  if (id && !previo) return;
  const d = previo
    ? { ...previo, tags: [...(previo.tags || [])] }
    : { ...store.normalizarDisco({ id: uuid(), estanteria_id: estanteria || A.estado.estanterias[0]?.id }), fecha_alta: null };
  const estOriginal = previo ? A.estanteriaDe(previo) : null;
  let portadaNueva; // Blob = nueva, null = quitar, undefined = sin cambios
  const generos = [...new Set([...A.GENEROS, ...A.estado.discos.map((x) => x.genero).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'es'));
  const generoOtro = d.genero && !generos.includes(d.genero);
  const artistas = [...new Set(A.estado.discos.map((x) => x.artista).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  const dlg = dialogo({
    titulo: previo ? 'Editar disco' : 'Añadir disco',
    cuerpo: `<form id="formDisco" autocomplete="off" novalidate>
      <label class="etiqueta" for="e_titulo">Título del disco</label>
      <input class="campo" id="e_titulo" value="${esc(d.titulo)}" placeholder="Por ejemplo: Abbey Road" required enterkeyhint="next">
      <label class="etiqueta" for="e_artista">Artista o grupo</label>
      <input class="campo" id="e_artista" value="${esc(d.artista)}" list="listaArtistas" placeholder="Por ejemplo: The Beatles" enterkeyhint="search">
      <datalist id="listaArtistas">${artistas.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>

      <label class="etiqueta">Portada</label>
      <div class="editor-portada">
        <div class="vista" id="e_vista">${icono('imagen', 'ico-lg')}</div>
        <div class="botones">
          <button type="button" class="btn btn-sm btn-primario" data-e="buscar">${icono('buscar', 'ico-sm')}Buscar datos y portada</button>
          <button type="button" class="btn btn-sm" data-e="foto">${icono('camara', 'ico-sm')}Hacer o elegir foto</button>
          <button type="button" class="btn btn-sm btn-fantasma" data-e="quitar" hidden>Quitar</button>
        </div>
      </div>
      <div id="e_resultados" class="resultados" aria-live="polite"></div>

      <label class="etiqueta" for="e_estanteria">Estantería</label>
      <select class="campo" id="e_estanteria">${A.estado.estanterias.map((e) => `<option value="${e.id}"${e.id === (estOriginal || d.estanteria_id) ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select>

      <label class="etiqueta">¿Lo tienes?</label>
      <div class="segmentado" role="radiogroup" id="e_posesion">
        <button type="button" role="radio" data-v="tengo" aria-checked="${d.estado_posesion !== 'quiero'}">Lo tengo</button>
        <button type="button" role="radio" data-v="quiero" aria-checked="${d.estado_posesion === 'quiero'}">Lo quiero</button>
      </div>

      <details class="desplegable" ${previo ? 'open' : ''}>
        <summary>Más detalles</summary>
        <div class="fila-campos">
          <div><label class="etiqueta" for="e_anio">Año</label><input class="campo" id="e_anio" type="number" inputmode="numeric" min="1900" max="${anioActual + 1}" value="${d.anio || ''}" placeholder="1977"></div>
          <div><label class="etiqueta" for="e_genero">Género</label>
            <select class="campo" id="e_genero"><option value="">—</option>${generos.map((g) => `<option${g === d.genero ? ' selected' : ''}>${esc(g)}</option>`).join('')}<option value="__otro"${generoOtro ? ' selected' : ''}>Otro…</option></select></div>
        </div>
        <input class="campo" id="e_generoOtro" placeholder="Escribe el género" value="${generoOtro ? esc(d.genero) : ''}" style="margin-top:8px" ${generoOtro ? '' : 'hidden'}>
        <div class="fila-campos">
          <div><label class="etiqueta" for="e_formato">Formato</label><select class="campo" id="e_formato">${FORMATOS.map((f) => `<option${f === d.formato ? ' selected' : ''}>${f}</option>`).join('')}</select></div>
          <div><label class="etiqueta" for="e_precio">Precio (€)</label><input class="campo" id="e_precio" type="number" inputmode="decimal" step="0.01" min="0" value="${d.precio ?? ''}"></div>
        </div>
        <label class="etiqueta" for="e_condicion">Estado del disco</label>
        <select class="campo" id="e_condicion">${CONDICIONES.map((c) => `<option${c === d.condicion ? ' selected' : ''}>${c}</option>`).join('')}</select>
        <label class="etiqueta">Valoración</label>
        <div class="estrellas" style="justify-content:flex-start;margin:0 0 0 -4px" role="radiogroup" id="e_nota">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-nota="${n}" aria-label="${n} de 5" aria-checked="${n === d.rating}" class="${n <= d.rating ? 'on' : ''}">${icono('estrella')}</button>`).join('')}</div>
        <label class="etiqueta">Color del vinilo</label>
        <div class="colores" role="radiogroup" id="e_color">${COLORES.map(([c, n]) => `<button type="button" class="color" role="radio" style="--c:${c}" data-c="${c}" aria-label="${n}" title="${n}" aria-checked="${c === d.color_vinilo}"></button>`).join('')}</div>
        <label class="etiqueta" for="e_fecha">Fecha de compra</label>
        <input class="campo" id="e_fecha" type="date" value="${esc(d.fecha_compra)}">
        <label class="etiqueta" for="e_tags">Etiquetas (separadas por comas)</label>
        <input class="campo" id="e_tags" value="${esc(d.tags.join(', '))}" placeholder="edición limitada, firmado…">
        <label class="etiqueta" for="e_youtube">Enlace de YouTube</label>
        <input class="campo" id="e_youtube" type="url" value="${esc(d.youtube)}" placeholder="https://youtube.com/…">
        <label class="etiqueta" for="e_tracklist">Canciones (una por línea)</label>
        <textarea class="campo" id="e_tracklist" rows="4">${esc(d.tracklist)}</textarea>
        <label class="etiqueta" for="e_notas">Notas</label>
        <textarea class="campo" id="e_notas" rows="3">${esc(d.notas)}</textarea>
        <label class="check"><input type="checkbox" id="e_escuchando" ${d.escuchando ? 'checked' : ''}> Es el que está sonando ahora</label>
      </details></form>`,
    pie: `${previo ? `<button class="btn btn-peligro" data-e="borrar" aria-label="Eliminar disco">${icono('papelera')}</button>` : `<button class="btn" data-e="otro">Guardar y añadir otro</button>`}
      <button class="btn btn-primario" data-e="guardar">${icono('check')}Guardar</button>`,
  });

  const q = (s) => dlg.querySelector(s);
  const vista = q('#e_vista');
  const ponerVista = async () => {
    q('[data-e="quitar"]').hidden = portadaNueva === null || (portadaNueva === undefined && !d.portada);
    if (portadaNueva instanceof Blob) vista.innerHTML = `<img src="${URL.createObjectURL(portadaNueva)}" alt="">`;
    else if (portadaNueva === undefined && d.portada) {
      const src = await store.urlPortada(d.portada);
      vista.innerHTML = src ? `<img src="${src}" alt="">` : icono('imagen', 'ico-lg');
    } else vista.innerHTML = icono('imagen', 'ico-lg');
  };
  ponerVista();

  // Botones de opción (estado, nota, color)
  const radios = (sel, fn) =>
    q(sel).addEventListener('click', (e) => {
      const b = e.target.closest('[role="radio"]');
      if (!b) return;
      fn(b);
    });
  radios('#e_posesion', (b) => {
    d.estado_posesion = b.dataset.v;
    $$('#e_posesion [role="radio"]', dlg).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  radios('#e_nota', (b) => {
    const n = Number(b.dataset.nota);
    d.rating = d.rating === n ? 0 : n;
    $$('#e_nota [data-nota]', dlg).forEach((x) => {
      x.classList.toggle('on', Number(x.dataset.nota) <= d.rating);
      x.setAttribute('aria-checked', String(Number(x.dataset.nota) === d.rating));
    });
  });
  radios('#e_color', (b) => {
    d.color_vinilo = b.dataset.c;
    $$('#e_color [role="radio"]', dlg).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  q('#e_genero').addEventListener('change', (e) => {
    q('#e_generoOtro').hidden = e.target.value !== '__otro';
    if (e.target.value === '__otro') q('#e_generoOtro').focus();
  });

  // Portada: foto propia
  q('[data-e="foto"]').onclick = () => {
    const inp = $('#archivoPortada');
    inp.onchange = async () => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      try {
        portadaNueva = await comprimir(f);
        ponerVista();
      } catch (e) {
        avisar(e.message);
      }
    };
    inp.click();
  };
  q('[data-e="quitar"]').onclick = () => {
    portadaNueva = null;
    ponerVista();
  };

  // Portada y datos: buscar en MusicBrainz
  let ctrl = null;
  const buscarDatos = async () => {
    const titulo = q('#e_titulo').value.trim();
    const artista = q('#e_artista').value.trim();
    const res = q('#e_resultados');
    if (!titulo && !artista) {
      res.innerHTML = '<p class="ayuda">Escribe primero el título o el artista.</p>';
      q('#e_titulo').focus();
      return;
    }
    ctrl?.abort();
    ctrl = new AbortController();
    res.innerHTML = '<p class="ayuda">Buscando…</p>';
    const google = `<a class="btn btn-sm btn-fantasma" href="${urlBusquedaGoogle(titulo, artista)}" target="_blank" rel="noopener">${icono('externo', 'ico-sm')}Buscar la imagen en Google</a>`;
    try {
      const lista = await buscarDiscos(titulo, artista, { signal: ctrl.signal });
      if (!lista.length) {
        res.innerHTML = `<p class="ayuda">No lo he encontrado. Puedes hacerle una foto a la portada.</p>${google}`;
        return;
      }
      res.innerHTML =
        lista
          .map(
            (r, i) => `<button type="button" class="resultado" data-r="${i}">
          <img src="${miniatura(r.mbid)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;hueco&quot;></span>'">
          <span><b>${esc(r.titulo)}</b><span>${esc(r.artista)}${r.anio ? ' · ' + r.anio : ''}${r.tipo ? ' · ' + esc(r.tipo) : ''}</span></span></button>`
          )
          .join('') + google;
      res.querySelectorAll('[data-r]').forEach((b) =>
        b.addEventListener('click', async () => {
          const r = lista[Number(b.dataset.r)];
          if (!q('#e_titulo').value.trim()) q('#e_titulo').value = r.titulo;
          if (!q('#e_artista').value.trim()) q('#e_artista').value = r.artista;
          if (!q('#e_anio').value && r.anio) q('#e_anio').value = r.anio;
          if (!q('#e_genero').value && r.genero) q('#e_genero').value = r.genero;
          d.mbid = r.mbid;
          res.innerHTML = '<p class="ayuda">Descargando la portada…</p>';
          const blob = await descargarPortada(r.mbid);
          if (blob) {
            portadaNueva = blob;
            ponerVista();
            res.innerHTML = `<p class="ayuda">${icono('check', 'ico-sm')} Datos y portada añadidos. Revisa que sea tu edición.</p>`;
          } else {
            res.innerHTML = `<p class="ayuda">He completado los datos, pero este disco no tiene portada en la base de datos.</p>${google}`;
          }
        })
      );
    } catch (e) {
      if (e.name === 'AbortError') return;
      res.innerHTML = `<p class="ayuda">${navigator.onLine === false ? 'Sin conexión: la búsqueda necesita internet.' : esc(e.message)}</p>${google}`;
    }
  };
  q('[data-e="buscar"]').onclick = buscarDatos;
  q('#e_titulo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      q('#e_artista').focus();
    }
  });
  q('#e_artista').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarDatos();
    }
  });

  const guardar = async (otro) => {
    const titulo = q('#e_titulo').value.trim();
    if (!titulo) {
      q('#e_titulo').focus();
      q('#e_titulo').setCustomValidity('Falta el título');
      q('#e_titulo').reportValidity();
      q('#e_titulo').setCustomValidity('');
      return;
    }
    const artista = q('#e_artista').value.trim();
    const dup = A.estado.discos.find((x) => x.id !== d.id && normalizar(x.titulo) === normalizar(titulo) && normalizar(x.artista) === normalizar(artista));
    if (dup && !(await preguntar(`Ya tienes «${esc(dup.titulo)}»${dup.artista ? ' de ' + esc(dup.artista) : ''}. ¿Lo guardo igualmente?`, { si: 'Guardar igualmente' }))) return;
    const genero = q('#e_genero').value === '__otro' ? q('#e_generoOtro').value.trim() : q('#e_genero').value;
    const anio = parseInt(q('#e_anio').value) || null;
    const precio = q('#e_precio').value === '' ? null : Number(q('#e_precio').value);
    const estId = q('#e_estanteria').value;
    Object.assign(d, {
      titulo,
      artista,
      genero,
      anio,
      precio,
      estanteria_id: estId,
      formato: q('#e_formato').value,
      condicion: q('#e_condicion').value,
      fecha_compra: q('#e_fecha').value,
      tags: q('#e_tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      youtube: q('#e_youtube').value.trim(),
      tracklist: q('#e_tracklist').value,
      notas: q('#e_notas').value,
      escuchando: q('#e_escuchando').checked,
    });
    if (!previo || estId !== estOriginal) d.posicion = A.posicionFinal(estId);
    if (!d.fecha_alta) d.fecha_alta = new Date().toISOString();
    q('[data-e="guardar"]').disabled = true;
    try {
      if (portadaNueva instanceof Blob) d.portada = await store.guardarPortada(portadaNueva);
      else if (portadaNueva === null) d.portada = null;
      if (d.escuchando) {
        const otros = A.estado.discos.filter((x) => x.escuchando && x.id !== d.id);
        if (otros.length) await store.guardarDiscos(otros.map((x) => ({ ...x, escuchando: false })));
      }
      await store.guardarDisco(d);
    } catch (e) {
      q('[data-e="guardar"]').disabled = false;
      return avisar('No se ha podido guardar: ' + esc(e.message));
    }
    dlg.close();
    tostada(previo ? 'Cambios guardados' : `«${titulo}» añadido`);
    if (otro) setTimeout(() => abrirEditor(null, { estanteria: estId }), 120);
  };
  q('[data-e="guardar"]').onclick = () => guardar(false);
  q('[data-e="otro"]')?.addEventListener('click', () => guardar(true));
  q('[data-e="borrar"]')?.addEventListener('click', async () => {
    dlg.close();
    await borrarConDeshacer(previo);
  });
  q('#formDisco').addEventListener('submit', (e) => e.preventDefault());
  if (!matchMedia('(pointer: coarse)').matches || !previo) setTimeout(() => q('#e_titulo').focus(), 60);
  if (buscar) buscarDatos();
}

/* ---------------- Estanterías ---------------- */

export function abrirEstanteria(id) {
  const est = id ? A.estanteria(id) : null;
  const lista = A.estado.estanterias;
  const i = est ? lista.indexOf(est) : -1;
  const dlg = dialogo({
    titulo: est ? 'Editar estantería' : 'Nueva estantería',
    cuerpo: `<label class="etiqueta" for="s_nombre">Nombre</label>
      <input class="campo" id="s_nombre" value="${esc(est?.nombre || '')}" placeholder="Rock, Jazz, Salón, Favoritos…" enterkeyhint="done">
      <label class="etiqueta" for="s_desc">Descripción (opcional)</label>
      <input class="campo" id="s_desc" value="${esc(est?.descripcion || '')}" placeholder="Una frase sobre esta balda">
      ${
        est && lista.length > 1
          ? `<label class="etiqueta">Posición</label><div style="display:flex;gap:8px">
        <button class="btn btn-sm" data-s="subir" ${i === 0 ? 'disabled' : ''}>↑ Subir</button>
        <button class="btn btn-sm" data-s="bajar" ${i === lista.length - 1 ? 'disabled' : ''}>↓ Bajar</button></div>`
          : ''
      }`,
    pie: `${est && lista.length > 1 ? `<button class="btn btn-peligro" data-s="borrar" aria-label="Eliminar estantería">${icono('papelera')}</button>` : ''}<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" data-s="guardar">Guardar</button>`,
  });
  const q = (s) => dlg.querySelector(s);
  const guardar = async () => {
    const nombre = q('#s_nombre').value.trim();
    if (!nombre) return q('#s_nombre').focus();
    await store.guardarEstanteria({
      ...(est || { id: uuid(), orden: 'manual', posicion: Math.max(0, ...lista.map((e) => e.posicion || 0)) + 1000 }),
      nombre,
      descripcion: q('#s_desc').value.trim(),
    });
    dlg.close();
  };
  q('[data-s="guardar"]').onclick = guardar;
  q('#s_nombre').addEventListener('keydown', (e) => e.key === 'Enter' && guardar());
  const mover = async (dir) => {
    const otra = lista[i + dir];
    const [a, b] = [est.posicion || 0, otra.posicion || 0];
    await store.guardarEstanteria({ ...est, posicion: a === b ? b + dir : b });
    await store.guardarEstanteria({ ...otra, posicion: a === b ? a : a });
    dlg.close();
  };
  q('[data-s="subir"]')?.addEventListener('click', () => mover(-1));
  q('[data-s="bajar"]')?.addEventListener('click', () => mover(1));
  q('[data-s="borrar"]')?.addEventListener('click', async () => {
    const otras = lista.filter((e) => e.id !== est.id);
    const n = A.estado.discos.filter((d) => A.estanteriaDe(d) === est.id).length;
    dlg.close();
    if (!n) {
      if (await preguntar(`¿Eliminar la estantería «${esc(est.nombre)}»? Está vacía.`, { si: 'Eliminar', peligro: true })) await store.borrarEstanteria(est.id, otras[0].id);
      return;
    }
    const d2 = dialogo({
      titulo: 'Eliminar estantería',
      cuerpo: `<p class="parrafo">«${esc(est.nombre)}» tiene ${n} ${n === 1 ? 'disco' : 'discos'}. No se borran: pasan a otra estantería.</p>
        <label class="etiqueta" for="s_destino">Mover los discos a</label>
        <select class="campo" id="s_destino">${otras.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select>`,
      pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-peligro" data-ok>Eliminar estantería</button>`,
    });
    d2.querySelector('[data-ok]').onclick = async () => {
      await store.borrarEstanteria(est.id, d2.querySelector('#s_destino').value);
      d2.close();
      tostada('Estantería eliminada');
    };
  });
  setTimeout(() => q('#s_nombre').focus(), 60);
}

/* ---------------- Menú ---------------- */

const TEMAS = [
  ['ambar', 'Ámbar', '#e8a54b', '#13100d'],
  ['medianoche', 'Noche', '#86a3ff', '#0b0e17'],
  ['verde', 'Verde', '#63dfa0', '#0a110c'],
  ['synth', 'Synth', '#ff73c8', '#130b1a'],
  ['papel', 'Claro', '#b3631f', '#f4efe7'],
];
let promptInstalar = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalar = e;
});
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function abrirMenu() {
  const s = sync.info();
  const vacia = !A.estado.discos.length;
  const item = (m, ic, texto, sub = '', der = '') => `<button class="menu-item" data-m="${m}">${icono(ic)}<span>${texto}${sub ? `<small>${sub}</small>` : ''}</span>${der ? `<span class="der">${der}</span>` : ''}</button>`;
  const tema = document.documentElement.dataset.tema || 'ambar';
  const dlg = dialogo({
    titulo: 'Opciones',
    cuerpo: `
      <div class="menu-grupo"><h3>Colección</h3><div class="menu-lista">
        ${item('anadir', 'mas', 'Añadir disco')}
        ${item('estanteria', 'estante', 'Nueva estantería')}
        ${vacia ? '' : item('azar', 'dado', 'Sorpréndeme', 'Un disco al azar para escuchar hoy')}
        ${vacia ? '' : item('duplicados', 'unir', 'Buscar discos repetidos')}
        ${vacia ? '' : item('resumen', 'regalo', 'Resumen del año')}
      </div></div>
      <div class="menu-grupo"><h3>Tus datos</h3><div class="menu-lista">
        ${item('sync', s.activo ? 'nubeOk' : 'nube', 'Sincronizar dispositivos', s.activo ? 'Activada · ' + haceCuanto(s.ultima) : 'Ten la misma colección en el móvil y el ordenador')}
        ${item('exportar', 'descargar', 'Guardar copia de seguridad', 'Un archivo con toda la colección y las portadas')}
        ${item('importar', 'subir', 'Abrir una copia de seguridad')}
        ${item('copias', 'salvavidas', 'Copias automáticas', 'Volver a cómo estaba la colección otro día')}
        ${vacia ? '' : item('csv', 'excel', 'Exportar a Excel')}
      </div></div>
      <div class="menu-grupo"><h3>Colores</h3>
        <div class="temas" role="radiogroup">${TEMAS.map(([k, n, a, b]) => `<button class="tema" role="radio" data-tema="${k}" aria-checked="${k === tema}"><i style="--a:${a};--b:${b}"></i>${n}</button>`).join('')}</div>
      </div>
      <div class="menu-grupo"><h3>App</h3><div class="menu-lista">
        ${instalada() ? '' : item('instalar', 'instalar', 'Instalar en este dispositivo', 'Abrirla como una app más, también sin conexión')}
        ${vacia ? item('ejemplo', 'disco', 'Cargar una colección de ejemplo') : ''}
        ${item('acerca', 'info', 'Almacenamiento y versión', '', 'v' + VERSION)}
      </div></div>`,
  });
  const acciones = {
    anadir: () => abrirEditor(null),
    estanteria: () => abrirEstanteria(null),
    azar: sorprendeme,
    duplicados: () => abrirDuplicados(),
    resumen: abrirResumen,
    sync: () => abrirSync(),
    exportar: exportarJSON,
    importar: () => $('#archivoImportar').click(),
    copias: abrirCopias,
    csv: () => exportarCSV(A.estado.discos),
    instalar,
    ejemplo: cargarEjemplo,
    acerca: abrirAcerca,
  };
  dlg.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) {
      dlg.close();
      acciones[m.dataset.m]?.();
    }
    const t = e.target.closest('[data-tema]');
    if (t) {
      document.documentElement.dataset.tema = t.dataset.tema;
      ls.set('vinilos_tema', t.dataset.tema);
      document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      $$('[data-tema]', dlg).forEach((x) => x.setAttribute('aria-checked', String(x === t)));
    }
  });
}

function sorprendeme() {
  const xs = A.estado.discos.filter((d) => d.estado_posesion === 'tengo');
  if (!xs.length) return avisar('Aún no hay discos en tu colección.');
  abrirFicha(xs[Math.floor(Math.random() * xs.length)].id);
}

async function instalar() {
  if (promptInstalar) {
    promptInstalar.prompt();
    promptInstalar = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  avisar(
    ios
      ? 'En el iPhone o iPad: abre esta página en <b>Safari</b>, pulsa el botón <b>Compartir</b> (el cuadrado con la flecha) y elige <b>Añadir a pantalla de inicio</b>.<br><br>Ábrela siempre desde ese icono: Safari y la app instalada guardan los datos por separado.'
      : 'En Chrome o Edge: abre el menú del navegador (⋮) y elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.',
    { titulo: 'Instalar la app' }
  );
}

async function abrirAcerca() {
  const esp = await store.espacioUsado();
  const mb = (b) => (b / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' MB';
  const pers = A.estado.persistente;
  dialogo({
    titulo: 'Almacenamiento',
    cuerpo: `<dl class="ficha-datos">
      <div><dt>Versión</dt><dd>${VERSION}</dd></div>
      <div><dt>Discos</dt><dd>${A.estado.discos.length}</dd></div>
      <div><dt>Espacio usado</dt><dd>${esp ? mb(esp.usado) : '—'}</dd></div>
      <div><dt>Protegido frente a limpiezas del navegador</dt><dd>${pers ? 'Sí' : 'No'}</dd></div>
      <div><dt>Sincronización</dt><dd>${sync.activo() ? 'Activada' : 'Desactivada'}</dd></div>
      <div><dt>Instalada como app</dt><dd>${instalada() ? 'Sí' : 'No'}</dd></div></dl>
      <p class="ayuda" style="margin-top:14px">${
        pers
          ? 'El navegador se ha comprometido a no borrar estos datos por su cuenta.'
          : 'El navegador puede borrar los datos de webs que no se usan o si falta espacio. Instalar la app y activar la sincronización (o guardar copias) evita perder nada.'
      }</p>`,
    pie: `<button class="btn" data-cerrar>Cerrar</button>`,
  });
}

/* ---------------- Sincronización ---------------- */

export function abrirSync({ url = '', codigo = '' } = {}) {
  const dlg = dialogo({ titulo: 'Sincronizar dispositivos', cuerpo: '<div id="syncCuerpo"></div>' });
  const cuerpo = dlg.querySelector('#syncCuerpo');
  let modo = codigo ? 'conectar' : 'crear';
  const quitar = sync.alCambiarEstado(() => sync.activo() && pintar());
  dlg.addEventListener('close', quitar);

  function pintar(codigoNuevo) {
    const s = sync.info();
    if (!s.activo) {
      cuerpo.innerHTML = `<p class="parrafo">Guarda la colección cifrada en tu servidor para tener los mismos discos en el móvil y en el ordenador. Lo que apuntes en uno aparece en el otro, también las portadas.</p>
        <div class="segmentado" role="radiogroup" style="margin-bottom:6px">
          <button role="radio" data-modo="crear" aria-checked="${modo === 'crear'}">Es el primero</button>
          <button role="radio" data-modo="conectar" aria-checked="${modo === 'conectar'}">Ya tengo un código</button>
        </div>
        <label class="etiqueta" for="y_url">Dirección del servidor</label>
        <input class="campo" id="y_url" type="url" inputmode="url" value="${esc(url || SERVIDOR || ls.get('vinilos_ultimo_servidor', ''))}" placeholder="https://vinilos.tudominio.com">
        ${
          modo === 'crear'
            ? `<label class="etiqueta" for="y_pass">Contraseña del servidor</label><input class="campo" id="y_pass" type="password" autocomplete="off" placeholder="La que pusiste en CREATE_PASSWORD">
               <p class="ayuda">Solo hace falta en el primer dispositivo. Después te daré un código para conectar los demás.</p>`
            : `<label class="etiqueta" for="y_codigo">Código de la colección</label><input class="campo" id="y_codigo" value="${esc(sync.formatearCodigo(codigo))}" placeholder="ABCD-EFGH-…" autocapitalize="characters" spellcheck="false">
               <p class="ayuda">Lo que haya en este dispositivo se juntará con lo del servidor; no se pierde nada.</p>`
        }
        <p class="ayuda" id="y_error" role="alert" style="color:var(--danger)"></p>
        <button class="btn btn-primario btn-bloque" id="y_ok" style="margin-top:8px">${modo === 'crear' ? 'Activar sincronización' : 'Conectar'}</button>`;
      cuerpo.querySelectorAll('[data-modo]').forEach((b) =>
        b.addEventListener('click', () => {
          modo = b.dataset.modo;
          url = cuerpo.querySelector('#y_url').value;
          pintar();
        })
      );
      cuerpo.querySelector('#y_ok').onclick = async () => {
        const btn = cuerpo.querySelector('#y_ok');
        const err = cuerpo.querySelector('#y_error');
        url = cuerpo.querySelector('#y_url').value.trim();
        if (!url) return (err.textContent = 'Falta la dirección del servidor.');
        btn.disabled = true;
        btn.textContent = modo === 'crear' ? 'Creando…' : 'Conectando…';
        err.textContent = '';
        try {
          ls.set('vinilos_ultimo_servidor', sync.limpiarUrl(url));
          if (modo === 'crear') {
            const c = await sync.crear(url, cuerpo.querySelector('#y_pass').value);
            pintar(c);
          } else {
            await sync.conectar(url, cuerpo.querySelector('#y_codigo').value);
            pintar();
            await A.recargar();
            const dups = buscarDuplicados();
            if (dups.discos.length || dups.estanterias.length) {
              dlg.close();
              abrirDuplicados(true);
            } else tostada('Conectado. Colección sincronizada.');
          }
        } catch (e) {
          err.textContent = e.message;
          btn.disabled = false;
          btn.textContent = modo === 'crear' ? 'Activar sincronización' : 'Conectar';
        }
      };
      return;
    }
    const cls = s.estado === 'error' || s.estado === 'sin-conexion' ? 'error' : s.estado === 'sincronizando' ? 'sincronizando' : '';
    const txt = s.estado === 'sincronizando' ? 'Sincronizando…' : s.estado === 'error' ? 'Error: ' + esc(s.error) : s.estado === 'sin-conexion' ? 'Sin conexión. Se sincronizará al volver.' : 'Todo sincronizado';
    cuerpo.innerHTML = `${codigoNuevo ? `<div class="aviso" style="margin:0 0 14px">${icono('check')}<p>Sincronización activada. Guarda este código: es la llave de tu colección y nadie más la tiene.</p></div>` : ''}
      <div class="estado-linea"><span class="punto ${cls}"></span><div style="flex:1"><b>${txt}</b><br><small class="ayuda" style="margin:0">Última vez: ${haceCuanto(s.ultima)} · ${esc(s.url)}</small></div>
        <button class="icon-btn" id="y_ahora" aria-label="Sincronizar ahora">${icono('refrescar')}</button></div>
      <h3 class="serif" style="margin:18px 0 6px;font-size:1.05rem">Conectar otro dispositivo</h3>
      <p class="parrafo">Abre este enlace en el otro dispositivo (envíatelo por WhatsApp o correo), o escribe el código a mano en «Ya tengo un código».</p>
      <div class="codigo">${esc(sync.codigo())}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-sm" id="y_enlace">${icono('enlace', 'ico-sm')}${navigator.share ? 'Enviar enlace' : 'Copiar enlace'}</button>
        <button class="btn btn-sm" id="y_copiar">${icono('copiar', 'ico-sm')}Copiar código</button>
      </div>
      <p class="ayuda" style="margin-top:14px">Si pierdes el código y todos los dispositivos, no se puede recuperar lo del servidor: está cifrado.</p>
      <button class="btn btn-peligro btn-bloque" id="y_desconectar" style="margin-top:18px">Desconectar este dispositivo</button>`;
    cuerpo.querySelector('#y_ahora').onclick = () => sync.sincronizar();
    cuerpo.querySelector('#y_copiar').onclick = () => copiar(sync.codigo(), 'Código copiado');
    cuerpo.querySelector('#y_enlace').onclick = async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Conectar mi colección de vinilos', text: 'Abre este enlace en el otro dispositivo para sincronizar la colección:', url: sync.enlace() });
        } catch {}
      } else copiar(sync.enlace(), 'Enlace copiado');
    };
    cuerpo.querySelector('#y_desconectar').onclick = async () => {
      if (await preguntar('Este dispositivo dejará de sincronizarse. Los discos se quedan aquí y en el servidor.', { si: 'Desconectar', peligro: true })) {
        sync.desconectar();
        pintar();
        A.render();
      }
    };
  }
  pintar();
}

async function copiar(texto, ok) {
  try {
    await navigator.clipboard.writeText(texto);
    tostada(ok);
  } catch {
    avisar(`Cópialo a mano:<br><br><code style="word-break:break-all">${esc(texto)}</code>`);
  }
}

/** Abre la sincronización si se ha entrado con un enlace de conexión. */
export function manejarEnlace() {
  const h = location.hash.slice(1);
  if (!h) return;
  const p = new URLSearchParams(h);
  if (p.has('enlazar')) {
    history.replaceState(null, '', location.pathname + location.search);
    if (sync.activo()) return tostada('Este dispositivo ya está sincronizado.');
    abrirSync({ url: p.get('enlazar'), codigo: p.get('codigo') || '' });
  } else if (h === 'anadir') {
    history.replaceState(null, '', location.pathname + location.search);
    abrirEditor(null);
  }
}

/* ---------------- Duplicados ---------------- */

const peso = (d) => (d.portada ? 5 : 0) + Object.entries(d).filter(([k, v]) => !['id', 'updatedAt', 'posicion', 'fecha_alta'].includes(k) && v && (!Array.isArray(v) || v.length)).length;

export function buscarDuplicados() {
  const grupos = new Map();
  for (const d of A.estado.discos) {
    if (!normalizar(d.titulo)) continue;
    const k = normalizar(d.titulo) + '|' + normalizar(d.artista);
    grupos.set(k, [...(grupos.get(k) || []), d]);
  }
  const est = new Map();
  for (const e of A.estado.estanterias) est.set(normalizar(e.nombre), [...(est.get(normalizar(e.nombre)) || []), e]);
  return { discos: [...grupos.values()].filter((g) => g.length > 1), estanterias: [...est.values()].filter((g) => g.length > 1) };
}

function unirGrupo(grupo) {
  const [base, ...resto] = [...grupo].sort((a, b) => peso(b) - peso(a));
  const r = { ...base, tags: [...(base.tags || [])] };
  for (const o of resto) {
    for (const [k, v] of Object.entries(o)) {
      if (['id', 'updatedAt', 'posicion'].includes(k)) continue;
      const vacio = r[k] == null || r[k] === '' || r[k] === 0 || (Array.isArray(r[k]) && !r[k].length);
      if (vacio && v) r[k] = v;
    }
    r.tags = [...new Set([...r.tags, ...(o.tags || [])])];
    if (o.notas && r.notas && !r.notas.includes(o.notas)) r.notas += '\n' + o.notas;
    if (o.fecha_alta && o.fecha_alta < r.fecha_alta) r.fecha_alta = o.fecha_alta;
    if (o.estado_posesion === 'tengo') r.estado_posesion = 'tengo';
  }
  return { r, borrar: resto.map((x) => x.id) };
}

export function abrirDuplicados(trasConectar = false) {
  const { discos, estanterias } = buscarDuplicados();
  if (!discos.length && !estanterias.length) return avisar('No hay discos ni estanterías repetidos.', { titulo: 'Todo en orden' });
  const dlg = dialogo({
    titulo: 'Discos repetidos',
    cuerpo: `${trasConectar ? '<p class="parrafo">Ya tienes la colección de los dos dispositivos junta. Algunos discos estaban apuntados en ambos: puedes unirlos en uno solo (se conserva la portada y los datos más completos).</p>' : '<p class="parrafo">Discos con el mismo título y artista. Al unirlos se queda uno solo, con la portada y los datos más completos de todos.</p>'}
      ${estanterias.length ? `<div class="grupo-dup"><header><b>${estanterias.length} ${estanterias.length === 1 ? 'estantería repetida' : 'estanterías repetidas'}</b></header><ul>${estanterias.map((g) => `<li>${esc(g[0].nombre)} ×${g.length}</li>`).join('')}</ul></div>` : ''}
      ${discos
        .map(
          (g, i) => `<div class="grupo-dup" data-g="${i}"><header><b>${esc(g[0].titulo)}</b><button class="btn btn-sm" data-unir="${i}">${icono('unir', 'ico-sm')}Unir</button></header>
        <ul>${g.map((d) => `<li>${esc(d.artista || 'Sin artista')}${d.anio ? ' · ' + d.anio : ''} · ${esc(A.estanteria(A.estanteriaDe(d))?.nombre || '')}${d.portada ? ' · con portada' : ''}</li>`).join('')}</ul></div>`
        )
        .join('')}`,
    pie: `<button class="btn" data-cerrar>Ahora no</button><button class="btn btn-primario" data-todo>Unir todo</button>`,
  });
  const unirEstanterias = async () => {
    for (const g of estanterias) {
      const [prim, ...otras] = g;
      for (const o of otras) await store.borrarEstanteria(o.id, prim.id);
    }
  };
  dlg.querySelectorAll('[data-unir]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { r, borrar } = unirGrupo(discos[Number(b.dataset.unir)]);
      await store.unirDiscos(r, borrar);
      b.closest('.grupo-dup').remove();
      if (!dlg.querySelector('[data-unir]')) dlg.close();
    })
  );
  dlg.querySelector('[data-todo]').onclick = async () => {
    dlg.querySelector('[data-todo]').disabled = true;
    await unirEstanterias();
    for (const g of discos) {
      const { r, borrar } = unirGrupo(g);
      await store.unirDiscos(r, borrar);
    }
    dlg.close();
    tostada(`${discos.length} ${discos.length === 1 ? 'disco unido' : 'discos unidos'}`);
  };
}

/* ---------------- Copias ---------------- */

async function abrirCopias() {
  const copias = await store.listarCopias();
  const dlg = dialogo({
    titulo: 'Copias automáticas',
    cuerpo: `<p class="parrafo">La app guarda sola una copia al día y otra antes de cada cambio grande (importar, restaurar, unir colecciones…). Se conservan las 10 últimas en este dispositivo.</p>
      <div class="lista-simple">${
        copias
          .map(
            (c) => `<div class="linea"><div><b>${new Date(c.id).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</b><small>${esc(c.motivo)} · ${c.n} discos</small></div>
        <button class="btn btn-sm" data-copia="${esc(c.id)}">Volver a esta</button></div>`
          )
          .join('') || '<p class="ayuda">Todavía no hay ninguna copia.</p>'
      }</div>`,
    pie: `<button class="btn" data-cerrar>Cerrar</button>`,
  });
  dlg.querySelectorAll('[data-copia]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = copias.find((x) => x.id === b.dataset.copia);
      if (!(await preguntar(`La colección volverá a como estaba (${c.n} discos). Antes se guarda una copia de cómo está ahora, por si te arrepientes.`, { si: 'Volver a esta copia' }))) return;
      await store.restaurarCopia(c.id);
      dlg.close();
      tostada('Colección restaurada');
    })
  );
}

/* ---------------- Exportar / importar ---------------- */

export async function exportarJSON() {
  try {
    const datos = await store.exportar();
    const nombre = `vinilos-copia-${hoyISO()}.json`;
    const blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
    const archivo = new File([blob], nombre, { type: 'application/json' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo], title: 'Copia de mis vinilos' });
      } catch (e) {
        if (e.name === 'AbortError') return;
        descargar(nombre, blob);
      }
    } else descargar(nombre, blob);
    ls.set('vinilos_ultimo_backup', String(Date.now()));
    A.render();
    tostada('Copia de seguridad guardada');
  } catch (e) {
    avisar('No se ha podido crear la copia: ' + esc(e.message));
  }
}

export function exportarCSV(discos) {
  const cols = [
    ['Título', 'titulo'],
    ['Artista', 'artista'],
    ['Año', 'anio'],
    ['Género', 'genero'],
    ['Formato', 'formato'],
    ['Estado', (d) => (d.estado_posesion === 'quiero' ? 'Lo quiero' : 'Lo tengo')],
    ['Condición', 'condicion'],
    ['Estantería', (d) => A.estanteria(A.estanteriaDe(d))?.nombre || ''],
    ['Valoración', 'rating'],
    ['Precio', (d) => (d.precio != null ? String(d.precio).replace('.', ',') : '')],
    ['Fecha de compra', 'fecha_compra'],
    ['Etiquetas', (d) => (d.tags || []).join(', ')],
    ['Notas', 'notas'],
  ];
  const celda = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = [cols.map((c) => celda(c[0])).join(';'), ...discos.map((d) => cols.map(([, k]) => celda(typeof k === 'function' ? k(d) : d[k])).join(';'))];
  descargar(`vinilos-${hoyISO()}.csv`, '﻿' + filas.join('\r\n'), 'text/csv;charset=utf-8');
}

export async function importarArchivo(file) {
  let datos;
  try {
    datos = await store.leerCopiaDeArchivo(JSON.parse(await file.text()));
  } catch (e) {
    return avisar('Ese archivo no es una copia de seguridad de la app.');
  }
  const vacia = !A.estado.discos.length;
  const dlg = dialogo({
    titulo: 'Abrir copia de seguridad',
    cuerpo: `<p class="parrafo">El archivo tiene <b>${datos.discos.length} discos</b> en ${datos.estanterias.length} ${datos.estanterias.length === 1 ? 'estantería' : 'estanterías'}${datos.portadas.length ? ` y ${datos.portadas.length} portadas` : ''}.</p>
      ${vacia ? '' : '<p class="parrafo"><b>Añadir</b> suma los discos del archivo a los que ya tienes. <b>Sustituir</b> deja solo los del archivo (antes se guarda una copia de lo actual).</p>'}`,
    pie: vacia
      ? `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" data-i="sustituir">Importar</button>`
      : `<button class="btn" data-i="sustituir">Sustituir</button><button class="btn btn-primario" data-i="anadir">Añadir</button>`,
  });
  dlg.querySelector('[data-i="sustituir"]').onclick = async () => {
    dlg.close();
    await store.reemplazarTodo(datos, 'abrir una copia de seguridad');
    tostada(`${datos.discos.length} discos importados`);
  };
  dlg.querySelector('[data-i="anadir"]')?.addEventListener('click', async () => {
    dlg.close();
    const n = await store.anadir(datos);
    await A.recargar();
    tostada(`${n} ${n === 1 ? 'disco añadido' : 'discos añadidos'}`);
    const dups = buscarDuplicados();
    if (dups.discos.length) abrirDuplicados(true);
  });
}

export async function cargarEjemplo() {
  if (A.estado.discos.length) return avisar('La colección de ejemplo solo se puede cargar con la colección vacía.');
  const e = [uuid(), uuid(), uuid()];
  const d = (titulo, artista, anio, genero, i, extra = {}) => ({ id: uuid(), titulo, artista, anio, genero, estanteria_id: e[i], ...extra });
  await store.reemplazarTodo(
    {
      estanterias: [
        { id: e[0], nombre: 'Clásicos del rock', descripcion: 'Los de siempre' },
        { id: e[1], nombre: 'Jazz y soul', descripcion: 'Para los domingos' },
        { id: e[2], nombre: 'Pop y electrónica', descripcion: '' },
      ],
      discos: [
        d('The Dark Side of the Moon', 'Pink Floyd', 1973, 'Rock', 0, { rating: 5, precio: 28 }),
        d('Rumours', 'Fleetwood Mac', 1977, 'Rock', 0, { rating: 4, precio: 24, color_vinilo: '#c0392b' }),
        d('Led Zeppelin IV', 'Led Zeppelin', 1971, 'Rock', 0, { rating: 5 }),
        d('Abbey Road', 'The Beatles', 1969, 'Rock', 0, { rating: 5, precio: 30 }),
        d('Born to Run', 'Bruce Springsteen', 1975, 'Rock', 0, { estado_posesion: 'quiero' }),
        d('Kind of Blue', 'Miles Davis', 1959, 'Jazz', 1, { rating: 5, precio: 22 }),
        d("What's Going On", 'Marvin Gaye', 1971, 'Soul', 1, { rating: 4, escuchando: true }),
        d('A Love Supreme', 'John Coltrane', 1965, 'Jazz', 1, { estado_posesion: 'quiero' }),
        d('Thriller', 'Michael Jackson', 1982, 'Pop', 2, { rating: 4, color_vinilo: '#e8e8e8' }),
        d('Discovery', 'Daft Punk', 2001, 'Electrónica', 2, { rating: 5, color_vinilo: '#f4d35e' }),
        d('Violator', 'Depeche Mode', 1990, 'Electrónica', 2, { rating: 4 }),
      ],
    },
    'cargar el ejemplo'
  );
  tostada('Colección de ejemplo cargada');
}

/* ---------------- Resumen anual ---------------- */

export function abrirResumen() {
  const todos = A.estado.discos.filter((x) => x.estado_posesion === 'tengo');
  if (!todos.length) return avisar('Añade algunos discos para ver tu resumen.');
  const desde = Date.now() - 365 * 86400000;
  const nuevos = todos.filter((d) => d.fecha_alta && new Date(d.fecha_alta).getTime() >= desde);
  const base = nuevos.length ? nuevos : todos;
  const top = (fn) => {
    const c = new Map();
    base.forEach((d) => fn(d) && c.set(fn(d), (c.get(fn(d)) || 0) + 1));
    return [...c].sort((a, b) => b[1] - a[1])[0];
  };
  const gen = top((d) => d.genero);
  const art = top((d) => d.artista);
  const dec = top((d) => (d.anio ? decadaDe(d.anio) : ''));
  const mejor = [...base].filter((d) => d.rating).sort((a, b) => b.rating - a.rating)[0];
  const gasto = base.reduce((s, d) => s + (d.precio || 0), 0);
  const slides = [
    ['Tu año en vinilos', nuevos.length || todos.length, nuevos.length ? 'discos nuevos en los últimos 12 meses' : 'discos en tu colección'],
    gen && ['Tu género del año', gen[0], `${gen[1]} discos`, true],
    art && ['El artista que más se repite', art[0], `${art[1]} discos`, true],
    dec && ['Tu década favorita', dec[0].replace('s', ''), 'la que más suena en tus estanterías'],
    mejor && ['Tu disco mejor valorado', mejor.titulo, '★'.repeat(mejor.rating) + ' · ' + (mejor.artista || ''), true],
    gasto && ['Valor de estos discos', euros(gasto), 'según los precios que apuntaste', true],
    ['En total', todos.length, `discos en ${A.estado.estanterias.length} estanterías. ¡A seguir coleccionando!`],
  ].filter(Boolean);
  let i = 0;
  const dlg = dialogo({
    titulo: 'Resumen del año',
    cuerpo: '<div id="r_slide"></div><div class="puntos" id="r_puntos"></div>',
    pie: `<button class="btn" data-r="-1">${icono('izq')}Anterior</button><button class="btn btn-primario" data-r="1"><span>Siguiente</span>${icono('der')}</button>`,
  });
  const pintar = () => {
    const [h, b, p, largo] = slides[i];
    dlg.querySelector('#r_slide').innerHTML = `<div class="resumen"><h3>${esc(h)}</h3><b class="${largo ? 'largo' : ''}">${esc(b)}</b><p>${esc(p)}</p></div>`;
    dlg.querySelector('#r_puntos').innerHTML = slides.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('');
    dlg.querySelector('[data-r="-1"]').disabled = i === 0;
    dlg.querySelector('[data-r="1"] span').textContent = i === slides.length - 1 ? 'Cerrar' : 'Siguiente';
  };
  dlg.querySelectorAll('[data-r]').forEach((b) =>
    b.addEventListener('click', () => {
      const n = i + Number(b.dataset.r);
      if (n >= slides.length) return dlg.close();
      i = Math.max(0, n);
      pintar();
    })
  );
  pintar();
  ls.set('vinilos_wrapped_ultimo', String(Date.now()));
}
