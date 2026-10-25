# Sistema de Ventas e Inventario — Comidas Rápidas

Este es tu sistema completo para tu negocio. Corre directamente en tu PC (que hace de "servidor")
y lo usas abriendo el navegador (Chrome, Edge, etc.). No necesita internet para funcionar.

## ¿Qué incluye?
- Registro de ventas (pantalla tipo caja registradora) con impresión de comprobante.
- Informes diarios y mensuales de ventas.
- Registro de facturas/entradas de mercancía (sube el inventario automáticamente).
- Registro de bajas de inventario (mermas, daños, vencimientos).
- Reporte de ganancias / rentabilidad, con gastos fijos descontados.
- Productos con foto, nombre, precio y costo.
- **Insumos y recetas**: puedes definir de qué insumos se compone cada producto (ej: una
  hamburguesa = pan + carne + lechuga + tomate + salsas + papa + empaque). El costo y el stock
  disponible de ese producto se calculan solos según tus insumos, y se actualizan automáticamente
  cada vez que registras una factura de esos insumos.
- **Gastos**: registra arriendo, servicios públicos, nómina, etc. Se descuentan de la ganancia en
  el reporte de rentabilidad, en el rango de fechas que consultes.
- Usuarios con roles: **Administrador** (acceso total) y **Vendedor** (solo registra ventas).
- Toda la información queda guardada en tu propio PC (carpeta `data/`).

### Cómo usar insumos y recetas
1. Ve a **Insumos** y registra tus materias primas (pan, carne, tomate, lechuga, salsas, papa,
   empaques...) con su costo y stock actual. Si compras algo en una unidad pero lo usas en la
   receta en una unidad más pequeña (ej: compras lechuga por unidad pero usas "hojas", o compras
   tomate por gramo pero usas "rodajas"), configura la conversión ahí mismo (ver la explicación
   en esa pantalla).
2. Ve a **Productos**, crea o edita el producto final (ej: "Hamburguesa clásica"), marca la
   casilla "Este producto se prepara con una receta" y agrega cada insumo con la cantidad que
   usas por unidad vendida (en la unidad de uso que definiste, ej: 2 hojas, 1 rodaja).
3. Cuando vendas ese producto, el sistema descuenta automáticamente los insumos usados (no el
   stock del producto en sí). Cuando entres una factura de un insumo (sección Inventario), su
   costo se actualiza y por lo tanto el costo del producto que lo usa también se actualiza solo.

### Gastos fijos y ganancia neta
Registra en **Gastos** el arriendo, servicios públicos, nómina, etc. En **Reportes → Rentabilidad**
verás la Ganancia bruta (ventas - costo de productos) y la Ganancia neta (restando esos gastos).

### Pedidos "para llevar"
En **Insumos**, en la sección "Empaque para pedidos para llevar", configura qué se descuenta
(ej: 1 bolsa) cuando en Ventas se marca un pedido como para llevar. Se descuenta una sola vez
por venta, sin importar cuántos productos tenga.

### Inventario en tiempo real y corrección manual
En **Inventario → Inventario en vivo** puedes ver el stock actual de todo y corregirlo a mano
(por ejemplo, después de un conteo físico). Todo ajuste manual queda registrado en el Kardex.

### Kardex (cruce de todas las transacciones) y log de errores
En **Inventario → Kardex** ves el historial completo de entradas (compras), salidas (ventas y
bajas) y ajustes manuales, para poder cruzar cuentas como en un sistema contable. En
**Inventario → Log de errores** el sistema anota automáticamente anomalías (ej: se intentó
vender algo que ya no existe, una factura con un item eliminado, una receta que usa un insumo
borrado), para que puedas revisarlas.

### Facturas atrasadas
Al registrar una factura en Inventario, puedes cambiar el campo "Fecha de la factura" a un día
anterior si se te quedó pendiente. Solo el administrador puede hacerlo.

### Compra por paquetes
Al agregar un item en una factura, marca la casilla "Por paquete" para ingresar cuántos paquetes
compraste, cuánto contiene cada paquete y cuánto costó el paquete — el sistema calcula solo la
cantidad total y el costo por unidad.

### Combos
En **Productos**, marca "Este producto es un combo armado con otros productos", elige qué
productos incluye y cuántos de cada uno, y pon en "Precio de venta" el precio llamativo del
combo. Verás en vivo cuánto ahorra el cliente frente a comprar todo por separado, y tu ganancia
real. Al vender un combo, el sistema descuenta el stock de cada producto que lo compone (y si
alguno de esos productos usa receta, descuenta sus insumos también). Un combo no se puede
"comprar" directo por factura ni tener receta al mismo tiempo — se arma solo con productos que
ya existen.

### Promociones temporales
En **Promociones**, elige un producto (o combo), ponle un precio promocional y un rango de
fechas (Desde/Hasta). Mientras la fecha de hoy esté en ese rango, el sistema vende ese producto
al precio promocional automáticamente en Ventas — se ve con una etiqueta 🏷️ y el precio normal
tachado — sin que tengas que activarla ni desactivarla a mano cada día. Puedes desactivar o
eliminar una promoción cuando quieras desde esa misma pantalla.

### Caja: cuadre diario, resumen mensual y arqueos
En **Caja** puedes:
- Ver cuánto dinero **debería** haber por cada método de pago (Efectivo, Tarjeta,
  Transferencia) en un día: es lo vendido en ese método, menos los gastos que se pagaron ese
  día con ese mismo método.
- Registrar con el botón **"➕ Gasto ocasional del día"** cualquier gasto rápido e imprevisto
  (hielo, un domicilio, una propina...) que se descuenta directo del dinero esperado de ese
  día, sin tener que ir hasta la pantalla de Gastos.
- Hacer el **arqueo**: contar físicamente el dinero de cada método y anotarlo — el sistema te
  muestra al instante si sobra, falta o cuadra exacto, y lo guarda (un arqueo por día; si vuelves
  a guardar el mismo día, actualiza el anterior).
- Ver el **resumen mensual** por método de pago, con el detalle día por día.
- Revisar el **historial de arqueos** guardados, con sus diferencias.

Los gastos que registras en la pantalla **Gastos** también afectan la caja si les pones un
"Pagado con" (Efectivo/Tarjeta/Transferencia); si no le pones método, se asume Efectivo.

### Mesas (para atención en salón)
En **Mesas** ves un salón visual con el estado de cada mesa: 🪑 verde = libre, 🍽️ naranja =
ocupada (con el total acumulado y hace cuánto se abrió). Un administrador puede entrar a
"⚙️ Configurar mesas" y decirle al sistema cuántas mesas tiene el restaurante (se crean o
eliminan automáticamente), y renombrar cada una con el ✏️ (ej. "Terraza 1", "Barra 2").

Al tocar una mesa libre entras a su detalle: eliges productos igual que en Ventas y se van
agregando a la cuenta de esa mesa (sin cobrar todavía — puedes seguir agregando productos
durante toda la visita del cliente). Cuando el cliente pide la cuenta, tocas **"💰 Cobrar
mesa"**, eliges el método de pago y confirmas: ahí sí se registra la venta, se descuenta el
inventario y se imprime el comprobante — la mesa vuelve a quedar libre. También puedes
**"❌ Cancelar cuenta"** si el cliente se va sin pedir nada (no descuenta inventario ni genera
venta). El sistema evita que dos mesas se "roben" el mismo stock limitado al mismo tiempo.

### Nómina (empleados, horas, abonos y liquidación)
⚠️ **Importante**: este módulo lleva un control básico e informal de nómina. **No calcula**
seguridad social, parafiscales, prestaciones sociales ni nómina electrónica DIAN — para
empleados formalmente vinculados, complementa esto con un contador o un software de nómina
certificado.

En **Nómina**:
- **Empleados**: crea cada empleado con su forma de pago — salario mensual fijo, o por hora
  trabajada (con su valor por hora).
- **Horas trabajadas**: registra cuántas horas trabajó cada empleado cada día (útil para
  control de asistencia, y para calcular el pago de los empleados por hora).
- **Abonos**: cualquier adelanto que le des a un empleado se descuenta automáticamente de la
  caja (queda registrado como gasto) y se resta del saldo cuando liquides el mes.
- **Liquidación mensual**: elige el año y el mes, y ves por cada empleado sus horas, lo
  devengado (según su forma de pago), lo ya abonado, y el saldo a pagar. Al darle "Liquidar" se
  genera automáticamente un gasto por ese saldo (categoría "Nómina / empleados"), que ya queda
  cruzado con el reporte de **Rentabilidad** (ganancia neta) y con **Caja** (por el método de
  pago que elijas). Puedes deshacer una liquidación desde el **Historial** si te equivocaste.

---

## PASO 1: Instalar Node.js (una sola vez)

1. Ve a https://nodejs.org
2. Descarga la versión **LTS** (la recomendada) para Windows/Mac.
3. Instálala haciendo doble clic y dando "Siguiente" a todo (instalación normal).

## PASO 2: Preparar el programa

1. Descomprime la carpeta `pos-comidas-rapidas` en un lugar fijo de tu PC, por ejemplo en el Escritorio.
2. Abre esa carpeta.
3. Abre una terminal dentro de esa carpeta:
   - **Windows**: entra a la carpeta, haz clic en la barra de direcciones de arriba, escribe `cmd` y presiona Enter.
   - **Mac**: clic derecho dentro de la carpeta → "Nueva Terminal en la carpeta" (o abre Terminal y escribe `cd ` y arrastra la carpeta).
4. Escribe este comando y presiona Enter (solo la primera vez, instala lo necesario):
   ```
   npm install
   ```
   Espera a que termine (puede tardar 1-2 minutos).

## PASO 3: Iniciar el sistema

1. En la misma terminal, escribe:
   ```
   npm start
   ```
2. Deja esa ventana abierta (es el "servidor"). Si la cierras, el sistema deja de funcionar.
3. Abre tu navegador y entra a:
   ```
   http://localhost:3000
   ```
4. Inicia sesión con:
   - Usuario: `admin`
   - Contraseña: `admin123`
5. **Importante**: entra a "Usuarios" y crea tu propio usuario administrador con tu contraseña,
   o al menos cambia la contraseña del usuario `admin` para mayor seguridad.

Cada vez que quieras usar el sistema: abre la carpeta, ejecuta `npm start` (paso 3.1) y entra a
`http://localhost:3000` desde el navegador.

### Acceso directo con ícono (para no usar la terminal cada vez)

Dentro de la carpeta hay dos archivos ya listos:
- `iniciar.bat` (Windows): al hacer doble clic, abre el servidor y tu navegador solo.
- `iniciar.command` (Mac): igual, doble clic y abre todo.
- `icono.ico`: un ícono de maíz para tu acceso directo.

**En Windows:**
1. Clic derecho sobre `iniciar.bat` → "Crear acceso directo".
2. Mueve ese acceso directo al Escritorio.
3. Clic derecho sobre el acceso directo → Propiedades → botón "Cambiar icono...".
4. Busca y selecciona el archivo `icono.ico` (está en la misma carpeta del programa).
5. Aceptar. Ya puedes abrir tu sistema con doble clic desde el Escritorio, con su propio ícono.

**En Mac:**
1. Clic derecho sobre `iniciar.command` → "Aliases" o arrástralo al Escritorio con Cmd+Alt.
2. Para el ícono: selecciona `icono.ico` (ábrelo con Vista Previa, Cmd+A, Cmd+C), luego clic derecho
   en el alias → Obtener información → clic en el ícono pequeño de la esquina → Cmd+V.

### Truco: que inicie solo
Si quieres que el sistema arranque automáticamente cuando enciendes el PC, puedes crear un acceso
directo al archivo que ejecuta `npm start`, o preguntarme y te ayudo a configurarlo paso a paso.

---

## Sobre la impresora de comprobantes

El botón "Cobrar e imprimir" abre la ventana de impresión de tu navegador con el comprobante ya
formateado en un ancho angosto (ideal para impresoras térmicas de tickets de 58mm u 80mm).

- Si tienes una **impresora térmica de tickets**: instala el driver que trae tu impresora, y
  selecciónala en la ventana de impresión que aparece. Ajusta el tamaño de papel a "80mm" o "58mm"
  según tu modelo, en las opciones de impresión de Windows/Mac.
- Si usas una **impresora normal (hoja carta/A4)**: funciona igual, solo que el comprobante saldrá
  angosto en la parte de arriba de la hoja. Puedes ajustar el "porcentaje de escala" en la ventana
  de impresión si quieres que se vea más grande.
- También puedes elegir "Guardar como PDF" en vez de imprimir, si quieres enviar el comprobante
  por WhatsApp o correo.

---

## Roles y seguridad

- **Administrador**: puede vender, crear/editar productos, registrar facturas y bajas, ver
  reportes y crear otros usuarios.
- **Vendedor**: solo puede entrar a la pantalla de "Vender". No ve productos, inventario,
  reportes ni usuarios. Ideal para tus empleados de caja.
- Las contraseñas se guardan cifradas (nadie puede leerlas, ni siquiera abriendo el archivo).

## Respaldo de tu información

Toda tu información (ventas, productos, facturas, usuarios) se guarda en el archivo:
```
data/db.json
```
Se recomienda copiar esta carpeta de vez en cuando (por ejemplo a un USB o a Google Drive) como
respaldo, por si el PC falla.

## ¿Problemas?

- Si al abrir `http://localhost:3000` no carga nada: revisa que la terminal con `npm start` siga
  abierta y sin errores en rojo.
- Si te sale que el puerto 3000 ya está en uso: cierra otras ventanas de terminal que tengas
  abiertas con el sistema ya corriendo, o reinicia el PC.
