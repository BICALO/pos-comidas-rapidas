// sincronizacion.js
// ---------------------------------------------------------------------------
// La app trabaja SIEMPRE con los datos del telefono (funciona sin internet).
// Cada vez que se guarda algo, se anota que hay "cambios pendientes". Cuando
// hay internet (al abrir una pantalla, al volver la conexion, cada minuto y
// unos segundos despues de cada cambio) se envia una copia completa de la
// base de datos al servidor de respaldo configurado.
//
// Proteccion contra borrados accidentales: el servidor recuerda el
// "id de instalacion" del telefono que le envia datos. Si un telefono
// distinto (o la app recien instalada, vacia) intenta enviar, el servidor
// responde 409 y la app pregunta si restaurar desde la nube o reemplazarla.
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  const CLAVE_CONFIG = 'pos_sync_config';
  const CLAVE_ESTADO = 'pos_sync_estado';
  const CLAVE_ID = 'pos_dispositivo_id';
  const INTERVALO_MS = 60 * 1000;
  const ESPERA_TRAS_CAMBIO_MS = 4000;
  const TIEMPO_MAX_MS = 45 * 1000;

  function leer(clave, defecto) {
    try { const v = localStorage.getItem(clave); return v === null ? defecto : JSON.parse(v); } catch (e) { return defecto; }
  }
  function escribir(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) {} }

  function idDispositivo() {
    let id = leer(CLAVE_ID, null);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      escribir(CLAVE_ID, id);
    }
    return id;
  }
  function config() {
    return Object.assign({ url: '', token: '', nombre: 'Celular caja', activo: false }, leer(CLAVE_CONFIG, {}));
  }
  function guardarConfig(c) { escribir(CLAVE_CONFIG, Object.assign(config(), c)); pintar(); }
  function estado() {
    return Object.assign({ versionEnviada: 0, ultimoEnvio: null, ultimoIntento: null, ultimoError: null, conflicto: null }, leer(CLAVE_ESTADO, {}));
  }
  function guardarEstado(cambios) { escribir(CLAVE_ESTADO, Object.assign(estado(), cambios)); pintar(); }
  function pendientes() {
    const v = window.POSLocal ? window.POSLocal.versionLocal() : 0;
    return Math.max(0, v - estado().versionEnviada);
  }
  function base(url) { return String(url || '').trim().replace(/\/+$/, ''); }

  async function pedir(ruta, opciones = {}) {
    const c = config();
    if (!c.url) throw new Error('No has configurado el servidor de sincronizacion.');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), TIEMPO_MAX_MS) : null;
    try {
      const res = await fetch(base(c.url) + ruta, {
        ...opciones,
        signal: ctrl ? ctrl.signal : undefined,
        headers: Object.assign({ Authorization: 'Bearer ' + c.token, 'X-Dispositivo': idDispositivo(), 'X-Nombre-Dispositivo': encodeURIComponent(c.nombre || '') }, opciones.headers || {})
      });
      return res;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('El servidor tardo demasiado en responder.');
      throw new Error('No se pudo conectar con el servidor (' + (e && e.message ? e.message : e) + ').');
    } finally { if (t) clearTimeout(t); }
  }
  async function leerError(res) {
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) return 'Clave de sincronizacion incorrecta.';
    return d.error || ('El servidor respondio ' + res.status);
  }

  // ---------------- Envio de cambios ----------------
  let enCurso = null;
  function sincronizar({ forzar = false, reemplazarNube = false } = {}) {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      const c = config();
      if (!c.url || !c.activo) return { ok: false, motivo: 'sin_config' };
      if (estado().conflicto && !reemplazarNube) return { ok: false, motivo: 'conflicto' };
      if (!navigator.onLine) { pintar(); return { ok: false, motivo: 'sin_conexion' }; }
      const version = window.POSLocal.versionLocal();
      if (!forzar && !reemplazarNube && version <= estado().versionEnviada) { pintar(); return { ok: true, motivo: 'al_dia' }; }
      pintar('enviando');
      guardarEstado({ ultimoIntento: new Date().toISOString() });
      try {
        const cuerpo = await window.POSLocal.leerDB();
        const res = await pedir('/api/respaldo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Version': String(version), ...(reemplazarNube ? { 'X-Reemplazar': '1' } : {}) },
          body: cuerpo
        });
        if (res.status === 409) {
          const d = await res.json().catch(() => ({}));
          guardarEstado({ conflicto: d.nube || { mensaje: d.error }, ultimoError: d.error || 'La nube tiene datos de otro dispositivo.' });
          return { ok: false, motivo: 'conflicto', detalle: d };
        }
        if (!res.ok) throw new Error(await leerError(res));
        guardarEstado({ versionEnviada: version, ultimoEnvio: new Date().toISOString(), ultimoError: null, conflicto: null });
        return { ok: true, motivo: 'enviado' };
      } catch (e) {
        guardarEstado({ ultimoError: e.message });
        return { ok: false, motivo: 'error', error: e.message };
      }
    })().finally(() => { enCurso = null; pintar(); });
    return enCurso;
  }

  // ---------------- Consultas y restauracion ----------------
  async function probar() {
    const res = await pedir('/api/estado');
    if (!res.ok) throw new Error(await leerError(res));
    return res.json(); // { ok, nube: {dispositivo_id, nombre_dispositivo, fecha, version, bytes, resumen} | null }
  }
  async function restaurarDesdeNube() {
    const res = await pedir('/api/respaldo');
    if (res.status === 404) throw new Error('La nube todavia no tiene ningun respaldo.');
    if (!res.ok) throw new Error(await leerError(res));
    const texto = await res.text();
    const idNube = res.headers.get('X-Dispositivo');
    await window.POSLocal.reemplazarDB(texto, { contarComoCambio: false });
    // Este telefono continua siendo "el dispositivo" de esos datos
    if (idNube) escribir(CLAVE_ID, idNube);
    guardarEstado({ versionEnviada: window.POSLocal.versionLocal(), conflicto: null, ultimoError: null, ultimoEnvio: new Date().toISOString() });
  }
  async function importarArchivo(texto) {
    await window.POSLocal.reemplazarDB(texto, { contarComoCambio: true });
    pintar();
  }
  // Guarda una copia del db.json en la carpeta Descargas del telefono
  async function exportarArchivo() {
    const texto = await window.POSLocal.leerDB();
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const nombre = `respaldo-pos-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    if (plugins && plugins.Impresora && plugins.Impresora.guardarArchivo) {
      const r = await plugins.Impresora.guardarArchivo({ nombre, contenido: texto, tipo: 'application/json' });
      return r && r.ruta ? r.ruta : 'Descargas/' + nombre;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    return nombre;
  }

  // ---------------- Indicador en la barra superior ----------------
  function textoIndicador(forzado) {
    const c = config();
    if (forzado === 'enviando') return ['enviando', 'Sincronizando…'];
    if (!c.url || !c.activo) return ['offline', 'Solo local'];
    const e = estado();
    const n = pendientes();
    if (e.conflicto) return ['error', 'Revisar nube'];
    if (!navigator.onLine) return ['offline', n ? `Sin internet · ${n} pend.` : 'Sin internet'];
    if (e.ultimoError && n) return ['error', `${n} pend. · error`];
    if (n) return ['pendiente', `${n} pendiente${n === 1 ? '' : 's'}`];
    return ['ok', 'Sincronizado'];
  }
  function pintar(forzado) {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    let el = document.getElementById('pos-sync-ind');
    if (!el) {
      el = document.createElement('button');
      el.id = 'pos-sync-ind';
      el.type = 'button';
      el.addEventListener('click', async () => {
        const c = config();
        if (!c.url || !c.activo) { location.href = 'sincronizacion.html'; return; }
        const r = await sincronizar({ forzar: true });
        if (r.motivo === 'conflicto') location.href = 'sincronizacion.html';
        else if (!r.ok && r.motivo === 'sin_conexion') alert('No hay internet. Los datos estan guardados en el telefono y se enviaran cuando vuelva la conexion.');
        else if (!r.ok && r.error) alert('No se pudo sincronizar: ' + r.error);
      });
      const h1 = bar.querySelector('h1');
      if (h1 && h1.nextSibling) bar.insertBefore(el, h1.nextSibling); else bar.appendChild(el);
    }
    const [clase, texto] = textoIndicador(forzado || (enCurso ? 'enviando' : null));
    el.className = 'sync-ind ' + clase;
    el.textContent = texto;
    const e = estado();
    el.title = e.ultimoEnvio ? 'Ultimo envio: ' + new Date(e.ultimoEnvio).toLocaleString('es-CO') : 'Aun no se ha enviado nada a la nube';
    window.dispatchEvent(new CustomEvent('pos-sync-estado'));
  }

  // ---------------- Disparadores automaticos ----------------
  let temporizador = null;
  window.addEventListener('pos-datos-cambiados', () => {
    pintar();
    clearTimeout(temporizador);
    temporizador = setTimeout(() => sincronizar(), ESPERA_TRAS_CAMBIO_MS);
  });
  window.addEventListener('online', () => { pintar(); sincronizar(); });
  window.addEventListener('offline', () => pintar());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
  document.addEventListener('DOMContentLoaded', () => {
    pintar();
    setTimeout(() => sincronizar(), 2000);
    setInterval(() => sincronizar(), INTERVALO_MS);
  });

  window.POSSync = {
    config, guardarConfig, estado, guardarEstado, pendientes, idDispositivo,
    sincronizar, probar, restaurarDesdeNube, importarArchivo, exportarArchivo, pintar
  };
})();
