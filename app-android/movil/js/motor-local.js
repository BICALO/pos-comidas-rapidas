// motor-local.js
// ---------------------------------------------------------------------------
// Este archivo es el "servidor dentro del telefono". En la version de PC,
// server.js corre en Node.js y las pantallas le hablan por fetch('/api/...').
// En Android no hay Node.js, asi que aqui:
//   1. Se imitan las piezas de Node que usan server.js y db.js (express,
//      express-session, multer, fs, path, bcryptjs).
//   2. Se ejecutan server.js y db.js TAL CUAL (los mete el script de
//      construccion en js/servidor-local.js), de modo que toda la logica de
//      ventas, recetas, caja, nomina, etc. es exactamente la misma del PC.
//   3. Se intercepta fetch('/api/...') para que las pantallas, sin ningun
//      cambio, reciban la respuesta de este motor local.
//   4. La base de datos (el mismo db.json) se guarda en IndexedDB, dentro
//      del telefono, y funciona sin internet.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const DIR_APP = '/app';
  const RUTA_DB = '/app/data/db.json';
  const CLAVE_SESION = 'pos_sesion';
  const CLAVE_VERSION = 'pos_version_local';
  const DURACION_SESION_MS = 1000 * 60 * 60 * 12; // 12 horas, igual que en PC

  // ======================= ALMACENAMIENTO (IndexedDB) =======================
  const NOMBRE_IDB = 'pos-comidas-rapidas';
  let idbPromesa = null;
  function abrirIDB() {
    if (!idbPromesa) {
      idbPromesa = new Promise((resolve, reject) => {
        const req = indexedDB.open(NOMBRE_IDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('archivos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return idbPromesa;
  }
  async function idbLeer(clave) {
    const db = await abrirIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('archivos', 'readonly');
      const r = tx.objectStore('archivos').get(clave);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbEscribir(clave, valor) {
    const db = await abrirIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('archivos', 'readwrite');
      tx.objectStore('archivos').put(valor, clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  // Pide al sistema que no borre estos datos para liberar espacio.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  function leerLS(clave, defecto) {
    try { const v = localStorage.getItem(clave); return v === null ? defecto : JSON.parse(v); } catch (e) { return defecto; }
  }
  function escribirLS(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) {}
  }

  // ======================= "fs" falso (solo en memoria) =======================
  const archivos = new Map();
  let hayCambioSinGuardar = false;
  function normalizar(p) { return String(p).replace(/\\/g, '/').replace(/\/+/g, '/'); }
  const fs = {
    existsSync: p => archivos.has(normalizar(p)),
    readFileSync: p => {
      const k = normalizar(p);
      if (!archivos.has(k)) { const e = new Error('ENOENT: no existe ' + k); e.code = 'ENOENT'; throw e; }
      return archivos.get(k);
    },
    writeFileSync: (p, contenido) => {
      const k = normalizar(p);
      const nuevo = String(contenido);
      // Algunas rutas (ej. GET /api/products) guardan aunque nada cambie:
      // solo se cuenta como cambio si el contenido es distinto.
      if (k === RUTA_DB && archivos.get(k) !== nuevo) hayCambioSinGuardar = true;
      archivos.set(k, nuevo);
    },
    mkdirSync: () => {}
  };

  // Cola para que las escrituras en IndexedDB vayan en orden.
  let colaEscritura = Promise.resolve();
  function persistir() {
    if (!hayCambioSinGuardar) return colaEscritura;
    hayCambioSinGuardar = false;
    const texto = archivos.get(RUTA_DB);
    escribirLS(CLAVE_VERSION, (leerLS(CLAVE_VERSION, 0) || 0) + 1);
    escribirLS('pos_ultima_modificacion', new Date().toISOString());
    colaEscritura = colaEscritura
      .then(() => idbEscribir('db.json', texto))
      .then(() => { window.dispatchEvent(new CustomEvent('pos-datos-cambiados')); })
      .catch(err => {
        console.error('[motor-local] No se pudo guardar en el telefono', err);
        alert('ATENCION: no se pudo guardar en la memoria del telefono. ' + (err && err.message ? err.message : ''));
      });
    return colaEscritura;
  }

  // ======================= "path" falso =======================
  const path = {
    join: (...partes) => normalizar(partes.filter(Boolean).join('/')),
    extname: p => { const m = /\.[^./\\]*$/.exec(String(p)); return m ? m[0] : ''; },
    basename: p => String(p).split('/').pop()
  };

  // ======================= "express" falso =======================
  let appActual = null;
  function compilarRuta(ruta) {
    const nombres = [];
    const patron = ruta.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/\/:([A-Za-z0-9_]+)/g, (_, n) => { nombres.push(n); return '/([^/]+)'; });
    return { regex: new RegExp('^' + patron + '/?$'), nombres };
  }
  function express() {
    const rutas = [];
    const app = {
      _rutas: rutas,
      use() {},
      set() {},
      listen(_puerto, cb) { /* en el telefono no hay puerto: nada que hacer */ }
    };
    ['get', 'post', 'put', 'delete', 'patch'].forEach(m => {
      app[m] = (ruta, ...fns) => { rutas.push({ metodo: m.toUpperCase(), ruta, ...compilarRuta(ruta), fns }); };
    });
    appActual = app;
    return app;
  }
  express.json = () => function () {};
  express.urlencoded = () => function () {};
  express.static = () => function () {};
  function expressSession() { return function () {}; }

  // ======================= "multer" falso (fotos) =======================
  // En PC la foto se guarda en public/uploads. En el telefono se reduce de
  // tamano y se guarda dentro de la misma base de datos como imagen en texto
  // (data URL), asi viaja tambien en la sincronizacion.
  function imagenADataURL(archivo, maxLado = 480, calidad = 0.8) {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onerror = () => reject(lector.error);
      lector.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(lector.result); // si no se puede leer, se deja como vino
        img.onload = () => {
          const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * escala);
          c.height = Math.round(img.height * escala);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', calidad));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }
  function multer() {
    return {
      single(campo) {
        return async function (req, res, next) {
          const f = req._archivos[campo];
          if (f && f.size > 0) {
            const url = await imagenADataURL(f);
            req.file = { fieldname: campo, originalname: f.name || 'foto.jpg', mimetype: f.type, size: f.size, url, filename: url };
          }
          next();
        };
      }
    };
  }
  multer.diskStorage = opciones => opciones;
  multer.memoryStorage = () => ({});

  // ======================= Cargador de modulos (require) =======================
  const cache = {};
  const integrados = {
    express,
    'express-session': expressSession,
    multer,
    path,
    fs
  };
  function requerir(nombre) {
    if (nombre === 'bcryptjs' || nombre === 'bcrypt') return window.bcrypt;
    if (integrados[nombre]) return integrados[nombre];
    const clave = nombre.replace(/\.js$/, '');
    if (cache[clave]) return cache[clave].exports;
    const def = (window.POS_MODULOS || {})[clave];
    if (!def) throw new Error('Modulo no disponible en el telefono: ' + nombre);
    const modulo = { exports: {} };
    cache[clave] = modulo;
    def(requerir, modulo, modulo.exports, DIR_APP, DIR_APP + '/' + clave.replace('./', '') + '.js');
    return modulo.exports;
  }

  // ======================= Arranque =======================
  let arranque = null;
  function iniciar() {
    if (!arranque) {
      arranque = (async () => {
        const texto = await idbLeer('db.json');
        if (typeof texto === 'string' && texto.length) archivos.set(RUTA_DB, texto);
        requerir('./server'); // registra todas las rutas /api/...
        if (!fs.existsSync(RUTA_DB)) requerir('./db').cargar(); // crea la base inicial (admin/admin123)
        await persistir();
        return true;
      })();
      arranque.catch(err => {
        console.error('[motor-local] Error al iniciar', err);
        arranque = null;
      });
    }
    return arranque;
  }

  // ======================= Sesion (reemplaza la cookie) =======================
  function cargarSesion() {
    const guardada = leerLS(CLAVE_SESION, null);
    const sesion = {};
    if (guardada && guardada.user && guardada.expira > Date.now()) sesion.user = guardada.user;
    Object.defineProperty(sesion, 'destroy', {
      enumerable: false,
      value(cb) { delete sesion.user; Object.defineProperty(sesion, '_destruida', { value: true }); if (cb) cb(); }
    });
    return sesion;
  }
  function guardarSesion(sesion) {
    if (sesion._destruida || !sesion.user) { try { localStorage.removeItem(CLAVE_SESION); } catch (e) {} return; }
    escribirLS(CLAVE_SESION, { user: sesion.user, expira: Date.now() + DURACION_SESION_MS });
  }

  // ======================= Atender una peticion /api =======================
  function crearRespuesta() {
    return {
      statusCode: 200,
      cuerpo: '',
      enviado: false,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status(c) { this.statusCode = c; return this; },
      set(k, v) { this.headers[k] = v; return this; },
      json(obj) { this.cuerpo = obj === undefined ? '' : JSON.stringify(obj); this.enviado = true; return this; },
      send(x) { this.cuerpo = typeof x === 'string' ? x : JSON.stringify(x); this.enviado = true; return this; },
      end(x) { this.cuerpo = x || ''; this.enviado = true; return this; },
      sendStatus(c) { this.statusCode = c; this.enviado = true; return this; }
    };
  }

  async function atender(metodo, url, cuerpo) {
    await iniciar();
    const req = {
      method: metodo,
      url: url.pathname + url.search,
      path: url.pathname,
      query: {},
      params: {},
      body: {},
      headers: {},
      session: cargarSesion(),
      _archivos: {}
    };
    url.searchParams.forEach((v, k) => { req.query[k] = v; });

    if (typeof FormData !== 'undefined' && cuerpo instanceof FormData) {
      cuerpo.forEach((v, k) => {
        if (typeof v === 'string') req.body[k] = v;
        else req._archivos[k] = v;
      });
    } else if (typeof cuerpo === 'string' && cuerpo.length) {
      try { req.body = JSON.parse(cuerpo); } catch (e) { req.body = {}; }
    }

    const res = crearRespuesta();
    const ruta = appActual && appActual._rutas.find(r => r.metodo === metodo && r.regex.test(url.pathname));
    if (!ruta) {
      res.status(404).json({ error: 'Ruta no encontrada: ' + metodo + ' ' + url.pathname });
    } else {
      const m = ruta.regex.exec(url.pathname);
      ruta.nombres.forEach((n, i) => { req.params[n] = decodeURIComponent(m[i + 1]); });
      try {
        for (const fn of ruta.fns) {
          let siguio = false;
          const r = fn(req, res, err => { if (err) throw err; siguio = true; });
          if (r && typeof r.then === 'function') await r;
          if (res.enviado || !siguio) break;
        }
      } catch (err) {
        console.error('[motor-local] Error en ' + metodo + ' ' + url.pathname, err);
        res.status(500).json({ error: 'Error interno: ' + (err && err.message ? err.message : err) });
      }
    }
    guardarSesion(req.session);
    await persistir(); // la respuesta solo llega cuando los datos ya estan guardados
    return new Response(res.cuerpo, { status: res.statusCode, headers: res.headers });
  }

  // ======================= Interceptar fetch('/api/...') =======================
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function (entrada, opciones) {
    opciones = opciones || {};
    let texto = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
    let url;
    try { url = new URL(texto, location.href); } catch (e) { return fetchOriginal(entrada, opciones); }
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const metodo = String(opciones.method || (entrada && entrada.method) || 'GET').toUpperCase();
      return atender(metodo, url, opciones.body);
    }
    return fetchOriginal(entrada, opciones);
  };

  // ======================= Impresion de comprobantes =======================
  // Las pantallas hacen window.open('') + document.write(...) + print().
  // En Android eso no abre ventanas, asi que se captura el HTML y se manda al
  // servicio de impresion de Android (impresora Bluetooth/WiFi o "Guardar
  // como PDF") con el plugin nativo "Impresora".
  function imprimirHTML(html, nombre) {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    if (plugins && plugins.Impresora) {
      return plugins.Impresora.imprimir({ html, nombre: nombre || 'Comprobante' })
        .catch(err => alert('No se pudo imprimir: ' + (err && err.message ? err.message : err)));
    }
    // En un navegador normal (pruebas): iframe oculto + print()
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(marco);
    marco.contentDocument.open();
    marco.contentDocument.write(html);
    marco.contentDocument.close();
    setTimeout(() => { try { marco.contentWindow.focus(); marco.contentWindow.print(); } catch (e) {} setTimeout(() => marco.remove(), 2000); }, 200);
    return Promise.resolve();
  }
  const abrirOriginal = window.open ? window.open.bind(window) : null;
  window.open = function (url, destino, caracteristicas) {
    if (!url || url === 'about:blank') {
      let html = '';
      let impreso = false;
      const doc = {
        open() { html = ''; },
        write(...partes) { html += partes.join(''); },
        writeln(...partes) { html += partes.join('') + '\n'; },
        close() {}
      };
      return {
        document: doc,
        focus() {},
        close() {},
        print() { if (!impreso) { impreso = true; window.POSUltimoComprobante = html; imprimirHTML(html); } }
      };
    }
    return abrirOriginal ? abrirOriginal(url, destino, caracteristicas) : null;
  };

  // ======================= API para sincronizacion.js =======================
  window.POSLocal = {
    iniciar,
    imprimirHTML,
    rutaDB: RUTA_DB,
    versionLocal: () => leerLS(CLAVE_VERSION, 0) || 0,
    // Texto completo de la base de datos (el mismo formato del db.json del PC)
    async leerDB() { await iniciar(); await colaEscritura; return archivos.get(RUTA_DB); },
    // Reemplaza toda la base de datos (restaurar desde la nube o importar el
    // db.json del PC). contarComoCambio=false cuando viene de la nube.
    async reemplazarDB(texto, { contarComoCambio = true } = {}) {
      const data = JSON.parse(texto);
      if (!data || !Array.isArray(data.users) || !Array.isArray(data.products)) {
        throw new Error('El archivo no parece una base de datos del sistema (faltan usuarios o productos).');
      }
      await iniciar();
      await colaEscritura;
      archivos.set(RUTA_DB, texto);
      requerir('./db').cargar(); // aplica las migraciones automaticas si es de una version anterior
      hayCambioSinGuardar = true;
      const antes = leerLS(CLAVE_VERSION, 0) || 0;
      await persistir();
      if (!contarComoCambio) escribirLS(CLAVE_VERSION, antes);
      try { localStorage.removeItem(CLAVE_SESION); } catch (e) {}
    }
  };
})();
