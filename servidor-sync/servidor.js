// servidor.js - Servidor de respaldo en la nube para la app Android del POS.
// No necesita "npm install": usa solo modulos que ya trae Node.js (18 o mayor).
//
// Variables de entorno:
//   SYNC_TOKEN    (obligatoria) clave que tambien se escribe en la app
//   PORT          puerto (por defecto 4000; Render/Railway lo ponen solos)
//   CARPETA_DATOS donde se guardan los respaldos (por defecto ./datos)
//   HISTORIAL     cuantas copias horarias conservar (por defecto 72)
//
// Rutas (todas piden "Authorization: Bearer <SYNC_TOKEN>", salvo GET /):
//   GET  /                         pagina de estado (sin datos del negocio)
//   GET  /api/estado               informacion del ultimo respaldo
//   POST /api/respaldo             recibe la base de datos completa (db.json)
//   GET  /api/respaldo             devuelve el ultimo respaldo
//   GET  /api/respaldo/db.json?token=...  descarga el ultimo respaldo como archivo
//                                  (sirve para llevarlo a data/db.json del PC)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.SYNC_TOKEN || '';
const PUERTO = Number(process.env.PORT || 4000);
const DATOS = path.resolve(process.env.CARPETA_DATOS || path.join(__dirname, 'datos'));
const MAX_HISTORIAL = Number(process.env.HISTORIAL || 72);
const LIMITE_BYTES = 60 * 1024 * 1024;

if (TOKEN.length < 8) {
  console.error('Falta la variable SYNC_TOKEN (minimo 8 caracteres). Ejemplo:\n  SYNC_TOKEN=una-clave-larga node servidor.js');
  process.exit(1);
}
fs.mkdirSync(path.join(DATOS, 'historial'), { recursive: true });
const RUTA_ULTIMO = path.join(DATOS, 'ultimo.json');
const RUTA_META = path.join(DATOS, 'meta.json');

function leerMeta() {
  try { return JSON.parse(fs.readFileSync(RUTA_META, 'utf8')); } catch (e) { return null; }
}
function escribirAtomico(ruta, contenido) {
  const tmp = ruta + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, contenido);
  fs.renameSync(tmp, ruta);
}
function tokenValido(recibido) {
  const a = Buffer.from(String(recibido || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function tokenDe(req, url) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token');
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Version, X-Dispositivo, X-Nombre-Dispositivo, X-Reemplazar');
  res.setHeader('Access-Control-Expose-Headers', 'X-Version, X-Dispositivo, X-Fecha');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > LIMITE_BYTES) { reject(Object.assign(new Error('Respaldo demasiado grande'), { codigo: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}
function resumen(data) {
  const ventas = Array.isArray(data.sales) ? data.sales : [];
  const ultima = ventas.length ? ventas[ventas.length - 1] : null;
  return {
    productos: (data.products || []).filter(p => p.activo !== false).length,
    insumos: (data.insumos || []).length,
    ventas: ventas.length,
    ultima_venta: ultima ? ultima.fecha || null : null,
    usuarios: (data.users || []).length
  };
}
function guardarHistorial(buf) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  // Una copia por hora (la de la misma hora se sobrescribe)
  const nombre = `respaldo-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}h-UTC.json`;
  escribirAtomico(path.join(DATOS, 'historial', nombre), buf);
  const archivos = fs.readdirSync(path.join(DATOS, 'historial')).filter(n => n.endsWith('.json')).sort();
  for (const viejo of archivos.slice(0, Math.max(0, archivos.length - MAX_HISTORIAL))) {
    fs.unlinkSync(path.join(DATOS, 'historial', viejo));
  }
}
function paginaEstado(meta) {
  const filas = meta
    ? `<p>Último respaldo recibido: <b>${new Date(meta.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</b></p>
       <p>Dispositivo: <b>${String(meta.nombre_dispositivo || 'sin nombre').replace(/[<>&]/g, '')}</b> · Tamaño: ${(meta.bytes / 1024).toFixed(0)} KB</p>`
    : '<p>Todavía no se ha recibido ningún respaldo.</p>';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Servidor de respaldo POS</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#2b2b2b;background:#f4f1ec}
.card{background:#fff;border-radius:10px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.1)}h1{color:#c0392b;font-size:20px}</style></head>
<body><div class="card"><h1>☁️ Servidor de respaldo — POS Comidas Rápidas</h1><p>✅ Funcionando.</p>${filas}</div></body></html>`;
}

const servidor = http.createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(paginaEstado(leerMeta()));
      return;
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'No encontrado' });
    if (!tokenValido(tokenDe(req, url))) return json(res, 401, { error: 'Clave incorrecta' });

    if (req.method === 'GET' && url.pathname === '/api/estado') {
      return json(res, 200, { ok: true, nube: leerMeta() });
    }

    if (req.method === 'POST' && url.pathname === '/api/respaldo') {
      const buf = await leerCuerpo(req);
      let data;
      try { data = JSON.parse(buf.toString('utf8')); } catch (e) { return json(res, 400, { error: 'El respaldo no es un JSON valido' }); }
      if (!data || !Array.isArray(data.users) || !Array.isArray(data.products)) {
        return json(res, 400, { error: 'El respaldo no tiene el formato de la base de datos del POS' });
      }
      const dispositivo = String(req.headers['x-dispositivo'] || '');
      const nombre = decodeURIComponent(String(req.headers['x-nombre-dispositivo'] || ''));
      const meta = leerMeta();
      // Proteccion: si la nube pertenece a otra instalacion, no se pisa sin permiso explicito
      if (meta && meta.dispositivo_id && meta.dispositivo_id !== dispositivo && req.headers['x-reemplazar'] !== '1') {
        return json(res, 409, { error: 'La nube tiene datos de otro dispositivo. Restaura o confirma el reemplazo desde la app.', nube: meta });
      }
      if (fs.existsSync(RUTA_ULTIMO)) guardarHistorial(fs.readFileSync(RUTA_ULTIMO));
      escribirAtomico(RUTA_ULTIMO, buf);
      const nuevaMeta = {
        dispositivo_id: dispositivo,
        nombre_dispositivo: nombre,
        version: Number(req.headers['x-version'] || 0),
        fecha: new Date().toISOString(),
        bytes: buf.length,
        resumen: resumen(data)
      };
      escribirAtomico(RUTA_META, JSON.stringify(nuevaMeta, null, 2));
      console.log(`[${nuevaMeta.fecha}] respaldo recibido de "${nombre}" (${(buf.length / 1024).toFixed(0)} KB, v${nuevaMeta.version})`);
      return json(res, 200, { ok: true, recibido: nuevaMeta });
    }

    if (req.method === 'GET' && (url.pathname === '/api/respaldo' || url.pathname === '/api/respaldo/db.json')) {
      const meta = leerMeta();
      if (!meta || !fs.existsSync(RUTA_ULTIMO)) return json(res, 404, { error: 'Todavia no hay respaldos' });
      const cab = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Version': String(meta.version || 0),
        'X-Dispositivo': meta.dispositivo_id || '',
        'X-Fecha': meta.fecha
      };
      if (url.pathname.endsWith('/db.json')) cab['Content-Disposition'] = 'attachment; filename="db.json"';
      res.writeHead(200, cab);
      fs.createReadStream(RUTA_ULTIMO).pipe(res);
      return;
    }

    json(res, 404, { error: 'Ruta no encontrada' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.codigo || 500, { error: e.message || 'Error interno' });
    else res.end();
  }
});

servidor.listen(PUERTO, () => {
  console.log('Servidor de respaldo POS escuchando en el puerto ' + PUERTO);
  console.log('Datos en: ' + DATOS);
});
