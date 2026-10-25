// preparar-android.js
// Se ejecuta despues de "npx cap add android" (y se puede repetir sin problema).
//   - instala el plugin nativo de impresion/respaldos (ImpresoraPlugin.java)
//   - registra el plugin en MainActivity
//   - pone el icono de la app
//   - firma siempre con la misma llave (firma/debug.keystore), para que las
//     actualizaciones del APK se instalen ENCIMA sin borrar los datos
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const ANDROID = path.join(APP, 'android');
function fallar(msg) { console.error('\n[ERROR] ' + msg + '\n'); process.exit(1); }
if (!fs.existsSync(ANDROID)) fallar('No existe la carpeta android/. Ejecuta primero: npx cap add android');

const config = JSON.parse(fs.readFileSync(path.join(APP, 'capacitor.config.json'), 'utf8'));
const paquete = config.appId;
const dirJava = path.join(ANDROID, 'app', 'src', 'main', 'java', ...paquete.split('.'));
fs.mkdirSync(dirJava, { recursive: true });

// 1. Plugin nativo
const plugin = fs.readFileSync(path.join(APP, 'android-nativo', 'ImpresoraPlugin.java'), 'utf8').replace('__PAQUETE__', paquete);
fs.writeFileSync(path.join(dirJava, 'ImpresoraPlugin.java'), plugin);

// 2. MainActivity que registra el plugin
fs.writeFileSync(path.join(dirJava, 'MainActivity.java'),
`package ${paquete};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImpresoraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

// 3. Icono
const res = path.join(ANDROID, 'app', 'src', 'main', 'res');
const iconos = path.join(APP, 'recursos', 'iconos');
for (const carpeta of fs.readdirSync(iconos)) {
  fs.mkdirSync(path.join(res, carpeta), { recursive: true });
  for (const f of fs.readdirSync(path.join(iconos, carpeta))) {
    fs.copyFileSync(path.join(iconos, carpeta, f), path.join(res, carpeta, f));
  }
}
// El icono "adaptativo" por defecto de Capacitor taparia el nuestro
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });

// 4. Firma fija
const gradle = path.join(ANDROID, 'app', 'build.gradle');
let g = fs.readFileSync(gradle, 'utf8');
if (!g.includes('firma/debug.keystore')) {
  const bloque =
`    signingConfigs {
        debug {
            storeFile file('../../firma/debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {`;
  if (!/\n\s*buildTypes\s*\{/.test(g)) fallar('No encontre "buildTypes {" en android/app/build.gradle');
  g = g.replace(/\n\s*buildTypes\s*\{/, '\n' + bloque);
}
// 5. Numero de version (GitHub Actions pasa VERSION_CODE = numero de compilacion)
const vc = parseInt(process.env.VERSION_CODE || '', 10);
if (vc > 0) {
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + vc).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${vc}"`);
}
fs.writeFileSync(gradle, g);

console.log('Android preparado: plugin Impresora, icono y firma fija (' + paquete + ')');
