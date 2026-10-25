// construir-web.js
// Arma la carpeta app-android/www (lo que va dentro del APK) a partir del
// proyecto de PC, SIN modificar el proyecto de PC:
//   - copia public/ (pantallas, estilos, fotos)
//   - copia las piezas de movil/ (motor local, bcrypt, sincronizacion, css)
//   - empaqueta server.js y db.js en www/js/servidor-local.js
//   - agrega a cada pantalla los scripts del motor y el ajuste para celular
// Uso: node scripts/construir-web.js
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const PROYECTO = path.resolve(APP, '..');
const WWW = path.join(APP, 'www');
const MOVIL = path.join(APP, 'movil');

function fallar(msg) { console.error('\n[ERROR] ' + msg + '\n'); process.exit(1); }
function copiar(origen, destino) {
  const st = fs.statSync(origen);
  if (st.isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const n of fs.readdirSync(origen)) copiar(path.join(origen, n), path.join(destino, n));
  } else {
    fs.copyFileSync(origen, destino);
  }
}
// Reemplazo exacto que se detiene si el texto esperado no esta (asi, si algun
// dia cambias server.js o comun.js, el error avisa en vez de fallar callado).
function reemplazar(texto, buscar, poner, vecesEsperadas, archivo) {
  const veces = texto.split(buscar).length - 1;
  if (veces !== vecesEsperadas) fallar(`En ${archivo} se esperaba encontrar ${vecesEsperadas} vez/veces:\n  ${buscar}\npero aparece ${veces}.`);
  return texto.split(buscar).join(poner);
}

for (const f of ['server.js', 'db.js', 'public']) {
  if (!fs.existsSync(path.join(PROYECTO, f))) fallar('No encuentro ' + f + ' en ' + PROYECTO + '. La carpeta app-android debe estar dentro del proyecto pos-comidas-rapidas.');
}

// 1. Limpiar y copiar
fs.rmSync(WWW, { recursive: true, force: true });
copiar(path.join(PROYECTO, 'public'), WWW);
copiar(MOVIL, WWW);

// 2. Empaquetar server.js y db.js
let server = fs.readFileSync(path.join(PROYECTO, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(PROYECTO, 'db.js'), 'utf8');
// La foto ya viene lista (data URL) desde el motor local, no como archivo en /uploads
server = reemplazar(server, "'/uploads/' + req.file.filename", 'req.file.url', 2, 'server.js');
const envolver = (nombre, codigo) =>
  `POS_MODULOS[${JSON.stringify(nombre)}] = function (require, module, exports, __dirname, __filename) {\n${codigo}\n};\n`;
const servidorLocal =
  '// GENERADO AUTOMATICAMENTE por scripts/construir-web.js a partir de server.js y db.js.\n' +
  '// No lo edites a mano: edita server.js / db.js del proyecto de PC y vuelve a construir.\n' +
  'window.POS_MODULOS = window.POS_MODULOS || {};\n' +
  envolver('./db', db) + envolver('./server', server);
fs.writeFileSync(path.join(WWW, 'js', 'servidor-local.js'), servidorLocal);

// 3. Agregar la opcion "Sincronizar" al menu (solo administrador)
const rutaComun = path.join(WWW, 'js', 'comun.js');
let comun = fs.readFileSync(rutaComun, 'utf8');
comun = reemplazar(comun,
  "{ href: 'usuarios.html', txt: 'Usuarios', roles: ['admin'] }",
  "{ href: 'usuarios.html', txt: 'Usuarios', roles: ['admin'] },\n    { href: 'sincronizacion.html', txt: '☁️ Sincronizar', roles: ['admin'] }",
  1, 'public/js/comun.js');
fs.writeFileSync(rutaComun, comun);

// 4. Inyectar en cada pantalla: viewport de celular, motor local y estilos moviles
const cabecera =
  '\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '\n<script src="js/bcrypt-navegador.js"></script>' +
  '\n<script src="js/motor-local.js"></script>' +
  '\n<script src="js/servidor-local.js"></script>' +
  '\n<script src="js/sincronizacion.js"></script>';
let paginas = 0;
for (const n of fs.readdirSync(WWW)) {
  if (!n.endsWith('.html')) continue;
  const ruta = path.join(WWW, n);
  let html = fs.readFileSync(ruta, 'utf8');
  if (!html.includes('<head>') || !html.includes('</head>')) fallar(n + ' no tiene <head>');
  // .replace con texto solo cambia la PRIMERA aparicion (las plantillas del
  // comprobante dentro de los scripts tambien tienen <head>, y no se tocan).
  const charset = /<meta charset=["']?utf-8["']?\s*\/?>/i.exec(html.slice(0, html.indexOf('</head>')));
  if (charset) html = html.replace(charset[0], charset[0] + cabecera);
  else html = html.replace('<head>', '<head>\n<meta charset="UTF-8">' + cabecera);
  html = html.replace('</head>', '<link rel="stylesheet" href="css/movil.css">\n</head>');
  fs.writeFileSync(ruta, html);
  paginas++;
}

console.log(`Listo: www/ construido (${paginas} pantallas) desde ${PROYECTO}`);
