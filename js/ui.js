/* Piezas de interfaz reutilizables: ventanas, confirmaciones y avisos. */

import { pintarIconos, icono } from './iconos.js';
import { esc } from './util.js';

/**
 * Abre una ventana modal nativa (<dialog>). En móvil sale como hoja desde abajo.
 * Devuelve el elemento; se elimina del DOM al cerrarse.
 */
export function dialogo({ titulo = '', cuerpo = '', pie = '', clase = '', alCerrar, etiqueta } = {}) {
  const d = document.createElement('dialog');
  d.className = clase;
  d.setAttribute('aria-label', etiqueta || titulo.replace(/<[^>]+>/g, ''));
  d.innerHTML = `<div class="asa" aria-hidden="true"></div>
    <div class="dlg-cab">${titulo ? `<h2 class="serif">${titulo}</h2>` : '<span style="flex:1"></span>'}
      <button class="icon-btn" data-cerrar aria-label="Cerrar">${icono('cerrar')}</button></div>
    <div class="dlg-cuerpo">${cuerpo}</div>${pie ? `<div class="dlg-pie">${pie}</div>` : ''}`;
  document.body.append(d);
  pintarIconos(d);
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-cerrar]')) d.close();
  });
  d.addEventListener('close', () => {
    alCerrar?.(d.returnValue);
    d.remove();
  });
  d.showModal();
  // En móvil no se abre el teclado solo: el foco va al botón de cerrar.
  if (matchMedia('(pointer: coarse)').matches) d.querySelector('[data-cerrar]')?.focus();
  return d;
}

export const hayDialogoAbierto = () => !!document.querySelector('dialog[open]');

export function preguntar(mensaje, { si = 'Sí, continuar', no = 'Cancelar', peligro = false, titulo = '' } = {}) {
  return new Promise((resolve) => {
    let r = false;
    const d = dialogo({
      titulo,
      clase: 'dlg-mensaje',
      cuerpo: `<p style="margin:0">${mensaje}</p>`,
      pie: `<button class="btn" data-cerrar>${esc(no)}</button><button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-si>${esc(si)}</button>`,
      alCerrar: () => resolve(r),
    });
    d.querySelector('[data-si]').onclick = () => {
      r = true;
      d.close();
    };
    d.querySelector('[data-si]').focus();
  });
}

export function avisar(mensaje, { titulo = '', boton = 'Entendido' } = {}) {
  return new Promise((resolve) => {
    const d = dialogo({ titulo, clase: 'dlg-mensaje', cuerpo: `<p style="margin:0">${mensaje}</p>`, pie: `<button class="btn btn-primario" data-cerrar>${esc(boton)}</button>`, alCerrar: resolve });
    d.querySelector('.dlg-pie .btn').focus();
  });
}

let tostadaActual = null;
export function tostada(mensaje, { accion, alPulsar, ms = 4500 } = {}) {
  tostadaActual?.remove();
  const t = document.createElement('div');
  t.className = 'tostada';
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(mensaje)}</span>${accion ? `<button>${esc(accion)}</button>` : ''}`;
  if (accion) {
    t.querySelector('button').onclick = () => {
      t.remove();
      alPulsar?.();
    };
  }
  // Por encima de las ventanas abiertas, si las hay
  (document.querySelector('dialog[open]:last-of-type') || document.body).append(t);
  tostadaActual = t;
  setTimeout(() => t.remove(), ms);
  return t;
}
