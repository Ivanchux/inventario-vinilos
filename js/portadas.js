/* Fotos de portada: compresión en el dispositivo y búsqueda de datos
   y portadas en MusicBrainz + Cover Art Archive (gratis, sin clave). */

export function comprimir(archivo, max = 1000, calidad = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > max || h > max) {
        if (w > h) (h = Math.round((h * max) / w)), (w = max);
        else (w = Math.round((w * max) / h)), (h = max);
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen.'))), 'image/jpeg', calidad);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Esa imagen no se puede abrir.'));
    };
    img.src = url;
  });
}

const GENEROS = {
  rock: 'Rock', 'hard rock': 'Rock', 'classic rock': 'Rock', 'progressive rock': 'Rock', 'psychedelic rock': 'Rock', grunge: 'Rock', 'alternative rock': 'Rock', 'indie rock': 'Rock',
  pop: 'Pop', 'synth-pop': 'Pop', 'pop rock': 'Pop', jazz: 'Jazz', 'hard bop': 'Jazz', 'modal jazz': 'Jazz', blues: 'Blues', soul: 'Soul', funk: 'Funk', disco: 'Disco',
  reggae: 'Reggae', 'hip hop': 'Hip Hop', rap: 'Hip Hop', electronic: 'Electrónica', house: 'Electrónica', techno: 'Electrónica', ambient: 'Electrónica', idm: 'Electrónica',
  classical: 'Clásica', opera: 'Ópera', country: 'Country', folk: 'Folk', 'heavy metal': 'Metal', metal: 'Metal', 'thrash metal': 'Metal', punk: 'Punk', 'punk rock': 'Punk',
  salsa: 'Latin / Salsa', latin: 'Latin / Salsa', 'r&b': 'R&B', 'rhythm and blues': 'R&B', gospel: 'Gospel', flamenco: 'Flamenco', soundtrack: 'Bandas Sonoras', experimental: 'Experimental',
};

const comillas = (s) => '"' + String(s).replace(/["\\]/g, ' ').trim() + '"';

/** Busca discos por título y artista. Devuelve como mucho 8 resultados. */
export async function buscarDiscos(titulo, artista, { signal } = {}) {
  const partes = [];
  if (titulo) partes.push('releasegroup:' + comillas(titulo));
  if (artista) partes.push('artist:' + comillas(artista));
  if (!partes.length) return [];
  const url = 'https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=8&query=' + encodeURIComponent(partes.join(' AND '));
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) throw new Error('El buscador de discos no responde ahora mismo.');
  const j = await res.json();
  return (j['release-groups'] || []).map((rg) => {
    const tags = (rg.tags || []).sort((a, b) => (b.count || 0) - (a.count || 0));
    const genero = tags.map((t) => GENEROS[String(t.name).toLowerCase()]).find(Boolean) || '';
    const anio = parseInt(String(rg['first-release-date'] || '').slice(0, 4)) || null;
    return {
      mbid: rg.id,
      titulo: rg.title,
      artista: (rg['artist-credit'] || []).map((c) => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join('').trim(),
      anio,
      tipo: rg['primary-type'] || '',
      genero,
    };
  });
}

export const miniatura = (mbid) => `https://coverartarchive.org/release-group/${mbid}/front-250`;

/** Descarga la portada de un disco de MusicBrainz y la comprime. null si no hay. */
export async function descargarPortada(mbid) {
  try {
    const res = await fetch(`https://coverartarchive.org/release-group/${mbid}/front-500`, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return comprimir(blob);
  } catch {
    return null;
  }
}

export const urlBusquedaGoogle = (titulo, artista) =>
  'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent([artista, titulo].filter(Boolean).join(' ') + ' portada vinilo');
