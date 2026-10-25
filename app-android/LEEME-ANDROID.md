# App Android (APK): POS Comidas Rápidas

La app es el mismo sistema del PC instalado en un celular o tablet Android.

- **Funciona sin internet.** Todo se guarda dentro del teléfono.
- **Respalda solo.** Cuando hay conexión, envía una copia de los datos a un servidor en la nube.

## ¿Cómo funciona?

| En el PC | En el celular |
|---|---|
| `server.js` corre en Node.js | El **mismo** `server.js` corre dentro de la app (`movil/js/motor-local.js` imita Express) |
| Datos en `data/db.json` | El **mismo** `db.json`, guardado en la memoria interna del teléfono (IndexedDB) |
| Sesión con cookie | Sesión guardada en el teléfono (12 horas) |
| Fotos en `public/uploads` | Fotos reducidas y guardadas dentro de la base de datos |
| Imprimir con el navegador | Servicio de impresión de Android: impresora WiFi o Bluetooth, o "Guardar como PDF" |

Toda la lógica del negocio (ventas, recetas, combos, caja, nómina, Kardex) **no se reescribió**. El script `scripts/construir-web.js` toma `server.js`, `db.js` y `public/` del proyecto de PC y arma la app. Si mejoras algo en el PC, vuelve a construir y la app queda igual.

### La sincronización (un solo dispositivo)

- Cada cambio (venta, factura, gasto…) queda marcado como **pendiente**. En la barra roja aparece un indicador: `Sincronizado`, `2 pendientes`, `Sin internet · 3 pend.`.
- Al volver la conexión, la app envía la copia sola. También lo hace al abrir cualquier pantalla y cada minuto.
- **Protección contra borrados:** si instalas la app en otro teléfono, o la reinstalas vacía, la nube **no se sobrescribe**. La app pregunta si quieres traer los datos de la nube o reemplazarlos.
- El servidor guarda además un historial de copias por hora (las últimas 72).

---

## 1. Obtener el APK

### Opción A: sin instalar nada, con GitHub (recomendada)

1. Crea un repositorio en GitHub y sube **toda** la carpeta `pos-comidas-rapidas`. Debe incluir `.github/`, `app-android/` y `servidor-sync/`.
2. En el repositorio, abre la pestaña **Actions**. Si GitHub pregunta, habilita los workflows.
3. El workflow **"Compilar APK Android"** arranca solo con cada `push` a `main`. También puedes iniciarlo a mano con **Run workflow**. Tarda unos 5 a 8 minutos.
4. Entra a la ejecución terminada (✅). Abajo, en **Artifacts**, descarga `POS-Comidas-Rapidas-APK` (es un .zip con el `.apk` adentro).

### Opción B: con Android Studio en tu PC

Necesitas Node.js 20 o superior, Android Studio y JDK 21 (Android Studio ya lo incluye).

```bash
cd app-android
npm install
npm run android:crear      # solo la primera vez
npm run android:abrir      # abre Android Studio → botón ▶ o Build > Build APK(s)
```

Después de cambiar algo en `server.js` o en `public/`, usa `npm run android:actualizar`.

## 2. Instalar en el celular

1. Pasa el `.apk` al teléfono (WhatsApp, Drive, cable…) y ábrelo.
2. Android pedirá permitir **"Instalar apps desconocidas"** para esa app (Archivos, Chrome, etc.). Acepta.
3. Abre **POS Comidas Rápidas** y entra con `admin` / `admin123`. **Cambia esa contraseña en Usuarios.**

**Actualizaciones:** instala el APK nuevo encima del anterior y **los datos se conservan**. Todas las compilaciones se firman con la misma llave (`firma/debug.keystore`). No borres esa llave ni desinstales la app: desinstalar sí borra los datos del teléfono, aunque luego puedes restaurarlos desde la nube.

## 3. Montar el servidor de respaldo (la "nube")

Está en la carpeta `servidor-sync/`. No necesita `npm install`; basta con Node.js 18 o superior.

```bash
cd servidor-sync
SYNC_TOKEN="una-clave-larga-y-secreta" node servidor.js
```

En Windows (PowerShell): `$env:SYNC_TOKEN="una-clave-larga"; node servidor.js`

Para que funcione desde cualquier lugar, súbelo a un servicio que ejecute Node.js **y tenga disco persistente**. Por ejemplo, un VPS, Railway con un "volume" o Fly.io con un volumen. Si el disco no es persistente, los respaldos se borran cada vez que el servicio se reinicia. Revisa los planes vigentes de cada proveedor.

Configúralo así:

- Comando de inicio: `node servidor.js`
- Variable `SYNC_TOKEN` con tu clave
- Variable `CARPETA_DATOS` apuntando al disco persistente

Al abrir la dirección del servidor en el navegador debe decir **"✅ Funcionando"**.

Para pruebas en la misma red WiFi, puedes correrlo en tu PC y usar `http://IP-de-tu-PC:4000` en la app.

## 4. Conectar la app con la nube

En la app: **☁️ Sincronizar** (menú del administrador).

1. Escribe la dirección del servidor y la misma `SYNC_TOKEN`.
2. Toca **Guardar y conectar**. Si la nube está vacía, envía la primera copia de inmediato.

En la misma pantalla también puedes:

- **Guardar copia en Descargas.** Deja un `.json` en la carpeta `Descargas/POS Comidas Rapidas` del teléfono.
- **Restaurar desde la nube.** Sirve si cambias de teléfono o reinstalas la app.
- **Importar db.json del PC.** Pasa al celular los datos que ya tienes en el computador (`data/db.json`). Las fotos de productos no vienen en ese archivo: vuelve a subirlas.

**Llevar los datos del celular al PC:** abre en el navegador `https://TU-SERVIDOR/api/respaldo/db.json?token=TU_CLAVE`. Se descarga `db.json`; reemplaza con él el archivo `data/db.json` del PC con el sistema apagado.

## 5. Imprimir comprobantes

Al pulsar **Imprimir comprobante** se abre el diálogo de impresión de Android.

- **Impresoras térmicas Bluetooth:** instala una app de servicio de impresión compatible con tu impresora (por ejemplo RawBT u otra que tu impresora recomiende) y elígela en ese diálogo.
- **Sin impresora:** elige "Guardar como PDF".

## Limitaciones a tener en cuenta

- Está pensada para **un solo dispositivo**. Si dos teléfonos venden a la vez, la nube guarda la copia de uno solo; la app avisa antes de pisar datos.
- El APK es de tipo "debug" (ideal para instalar directo). Para publicarlo en Google Play hace falta una firma de publicación y una cuenta de desarrollador.
- Si cambias en `server.js` las líneas de las fotos (`'/uploads/' + req.file.filename`) o el menú de `comun.js`, el script de construcción se detiene y te dice qué ajustar.

## Archivos de esta carpeta

```
app-android/
├─ movil/                    piezas exclusivas del celular (se copian sobre public/)
│  ├─ js/motor-local.js        "servidor" dentro del teléfono + guardado sin internet
│  ├─ js/bcrypt-navegador.js   contraseñas (compatible con las del PC)
│  ├─ js/sincronizacion.js     cola de cambios y envío a la nube
│  ├─ css/movil.css            ajustes para pantalla de celular
│  └─ sincronizacion.html      pantalla ☁️ Sincronizar
├─ android-nativo/ImpresoraPlugin.java   impresión y guardado en Descargas
├─ scripts/construir-web.js    arma www/ desde el proyecto de PC
├─ scripts/preparar-android.js plugin, icono, firma y versión
├─ recursos/iconos/            icono de la app (sacado de icono.ico)
├─ firma/debug.keystore        llave fija para que las actualizaciones no borren datos
└─ capacitor.config.json
```
