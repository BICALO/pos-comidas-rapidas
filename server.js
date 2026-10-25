const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { cargar, guardar, siguienteId } = require('./db');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(session({
  secret: 'pos-comidas-rapidas-clave-secreta-cambiar-si-quieres',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 horas
}));

// --- Subida de fotos de productos ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'producto_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({ storage });

// --- Servir archivos estaticos (frontend) ---
app.use(express.static(path.join(__dirname, 'public')));

// ================== FECHAS EN HORA LOCAL ==================
// IMPORTANTE: new Date().toISOString() siempre da la hora en UTC, lo que hace
// que una venta de la noche (en Colombia, UTC-5) quede fechada al dia
// siguiente. Por eso usamos la hora LOCAL del PC (la de tu computador) para
// todo lo que se guarda.
function pad(n) { return String(n).padStart(2, '0'); }
function fechaLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fechaHoyLocal() {
  return fechaLocalISO().slice(0, 10);
}
// Para facturas atrasadas: si mandan solo una fecha (YYYY-MM-DD), se guarda
// al mediodia de ese dia para evitar cualquier problema de zona horaria.
function fechaDesdeInput(fechaInput) {
  if (!fechaInput) return fechaLocalISO();
  return `${fechaInput}T12:00:00`;
}

// ================== REGISTRO DE MOVIMIENTOS (KARDEX) Y ERRORES ==================
function registrarMovimiento(data, { tipo, tipo_item, item_id, nombre, cantidad, motivo, referencia, fecha }) {
  data.movimientos.push({
    id: siguienteId(data, 'movimientos'),
    fecha: fecha || fechaLocalISO(),
    tipo, // compra | venta | venta_empaque | baja | ajuste_manual
    tipo_item, // producto | insumo
    item_id, nombre,
    cantidad, // positivo = entrada, negativo = salida
    motivo: motivo || '',
    referencia: referencia || ''
  });
}
function registrarError(data, tipo, mensaje, detalle) {
  data.errorLog.push({ id: siguienteId(data, 'errorLog'), fecha: fechaLocalISO(), tipo, mensaje, detalle: detalle || null });
  if (data.errorLog.length > 300) data.errorLog = data.errorLog.slice(-300); // no crece infinito
}

// ================== CALCULOS DE RECETAS Y CONVERSION DE UNIDADES ==================
// Un insumo se COMPRA en una unidad (ej: gramos, o "unidad" completa) pero se
// USA en la receta en otra unidad mas pequena (ej: "rodaja", "hoja"). El
// campo equivalencia dice cuantas unidades de compra equivalen a 1 unidad de
// uso (ej: 1 rodaja de tomate = 15 gramos -> equivalencia = 15).
function equivalencia(ins) { return Number(ins.equivalencia) > 0 ? Number(ins.equivalencia) : 1; }

function tieneReceta(p) {
  return Array.isArray(p.receta) && p.receta.length > 0;
}
function tieneCombo(p) {
  return Array.isArray(p.combo) && p.combo.length > 0;
}

function costoProducto(data, p) {
  if (tieneCombo(p)) {
    return p.combo.reduce((suma, c) => {
      const comp = data.products.find(x => x.id === Number(c.product_id));
      if (!comp) {
        registrarError(data, 'combo_producto_no_encontrado', `El combo "${p.nombre}" incluye un producto que ya no existe (id ${c.product_id}).`, { producto_id: p.id });
        return suma;
      }
      return suma + costoProducto(data, comp) * Number(c.cantidad);
    }, 0);
  }
  if (!tieneReceta(p)) return Number(p.costo) || 0;
  return p.receta.reduce((suma, r) => {
    const ins = data.insumos.find(i => i.id === Number(r.insumo_id));
    if (!ins) {
      registrarError(data, 'receta_insumo_no_encontrado', `El producto "${p.nombre}" usa un insumo que ya no existe (id ${r.insumo_id}).`, { producto_id: p.id });
      return suma;
    }
    return suma + (Number(ins.costo) || 0) * equivalencia(ins) * Number(r.cantidad);
  }, 0);
}

function stockDisponible(data, p) {
  if (tieneCombo(p)) {
    let disponible = Infinity;
    for (const c of p.combo) {
      const comp = data.products.find(x => x.id === Number(c.product_id));
      if (!comp) { disponible = 0; continue; }
      const cant = Number(c.cantidad) || 1;
      disponible = Math.min(disponible, Math.floor(stockDisponible(data, comp) / cant));
    }
    return disponible === Infinity ? 0 : disponible;
  }
  if (!tieneReceta(p)) return Number(p.stock) || 0;
  let disponible = Infinity;
  for (const r of p.receta) {
    const ins = data.insumos.find(i => i.id === Number(r.insumo_id));
    if (!ins) { disponible = 0; continue; }
    const stockEnUnidadUso = (Number(ins.stock) || 0) / equivalencia(ins);
    const cant = Number(r.cantidad) || 1;
    disponible = Math.min(disponible, Math.floor(stockEnUnidadUso / cant));
  }
  return disponible === Infinity ? 0 : disponible;
}

// Al vender, descuenta el stock del lugar que corresponda: si es un combo,
// baja el stock de cada producto que lo compone (y si ese producto a su vez
// tiene receta, baja los insumos); si tiene receta, baja los insumos; si no,
// baja el stock del producto directamente.
function descontarStockVenta(data, p, cantidadVendida, motivo) {
  if (tieneCombo(p)) {
    for (const c of p.combo) {
      const comp = data.products.find(x => x.id === Number(c.product_id));
      if (comp) descontarStockVenta(data, comp, Number(c.cantidad) * cantidadVendida, `Parte del combo "${p.nombre}"`);
    }
  } else if (tieneReceta(p)) {
    for (const r of p.receta) {
      const ins = data.insumos.find(i => i.id === Number(r.insumo_id));
      if (!ins) continue;
      const consumo = r.cantidad * equivalencia(ins) * cantidadVendida;
      ins.stock -= consumo;
      registrarMovimiento(data, { tipo: 'venta', tipo_item: 'insumo', item_id: ins.id, nombre: ins.nombre, cantidad: -consumo, motivo: motivo || `Usado en ${cantidadVendida} x ${p.nombre}` });
    }
  } else {
    p.stock -= cantidadVendida;
    registrarMovimiento(data, { tipo: 'venta', tipo_item: 'producto', item_id: p.id, nombre: p.nombre, cantidad: -cantidadVendida, motivo: motivo || '' });
  }
}

// ================== PROMOCIONES TEMPORALES ==================
// Una promocion tiene un rango de fechas (desde/hasta, inclusive, en fecha
// LOCAL). Si hoy cae en ese rango y esta activa, su precio reemplaza al
// precio de venta normal del producto.
function promoVigente(data, productId) {
  const hoy = fechaHoyLocal();
  return data.promotions.find(pr => pr.product_id === Number(productId) && pr.activa !== false && pr.desde <= hoy && pr.hasta >= hoy) || null;
}
function precioVigente(data, p) {
  const promo = promoVigente(data, p.id);
  return promo ? Number(promo.precio_promocional) : Number(p.precio_venta);
}

function productoConCalculos(data, p) {
  const promo = promoVigente(data, p.id);
  return {
    ...p,
    costo: costoProducto(data, p),
    stock: stockDisponible(data, p),
    costo_manual: p.costo,
    stock_manual: p.stock,
    tiene_receta: tieneReceta(p),
    tiene_combo: tieneCombo(p),
    precio_actual: promo ? Number(promo.precio_promocional) : Number(p.precio_venta),
    promo_activa: promo ? { id: promo.id, nombre: promo.nombre, precio_promocional: promo.precio_promocional, hasta: promo.hasta } : null
  };
}

// ================== MIDDLEWARES DE SEGURIDAD ==================
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No has iniciado sesion' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede hacer esto' });
  }
  next();
}

// ================== AUTENTICACION ==================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = cargar();
  const user = data.users.find(u => u.username === username && u.activo !== false);
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }
  req.session.user = { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ================== USUARIOS (solo admin) ==================
app.get('/api/users', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, activo: u.activo !== false })));
});

app.post('/api/users', requireLogin, requireAdmin, (req, res) => {
  const { username, password, nombre, rol } = req.body;
  if (!username || !password || !nombre || !rol) return res.status(400).json({ error: 'Faltan datos' });
  const data = cargar();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'Ese usuario ya existe' });
  const nuevo = {
    id: siguienteId(data, 'users'),
    username, nombre, rol,
    password: bcrypt.hashSync(password, 10),
    activo: true
  };
  data.users.push(nuevo);
  guardar(data);
  res.json({ ok: true });
});

app.put('/api/users/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const u = data.users.find(u => u.id === Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, rol, activo, password } = req.body;
  if (nombre !== undefined) u.nombre = nombre;
  if (rol !== undefined) u.rol = rol;
  if (activo !== undefined) u.activo = activo;
  if (password) u.password = bcrypt.hashSync(password, 10);
  guardar(data);
  res.json({ ok: true });
});

// ================== PRODUCTOS ==================
app.get('/api/products', requireLogin, (req, res) => {
  const data = cargar();
  const productos = data.products.filter(p => p.activo !== false).map(p => productoConCalculos(data, p));
  guardar(data); // por si costoProducto() registro algun error de receta
  res.json(productos);
});

function parseReceta(body) {
  if (!body.receta) return null;
  try {
    const r = JSON.parse(body.receta);
    return Array.isArray(r) && r.length ? r.map(x => ({ insumo_id: Number(x.insumo_id), cantidad: Number(x.cantidad) })) : null;
  } catch (e) { return null; }
}
function parseCombo(body) {
  if (!body.combo) return null;
  try {
    const c = JSON.parse(body.combo);
    return Array.isArray(c) && c.length ? c.map(x => ({ product_id: Number(x.product_id), cantidad: Number(x.cantidad) })) : null;
  } catch (e) { return null; }
}

app.post('/api/products', requireLogin, requireAdmin, upload.single('foto'), (req, res) => {
  const { nombre, categoria, precio_venta, costo, stock } = req.body;
  if (!nombre || !precio_venta) return res.status(400).json({ error: 'Faltan datos del producto' });
  const receta = parseReceta(req.body);
  const combo = parseCombo(req.body);
  if (receta && combo) return res.status(400).json({ error: 'Un producto no puede tener receta y combo al mismo tiempo.' });
  const data = cargar();
  const nuevo = {
    id: siguienteId(data, 'products'),
    nombre,
    categoria: categoria || 'General',
    precio_venta: Number(precio_venta),
    costo: Number(costo) || 0,
    stock: Number(stock) || 0,
    receta,
    combo,
    foto: req.file ? '/uploads/' + req.file.filename : null,
    activo: true
  };
  data.products.push(nuevo);
  guardar(data);
  res.json({ ok: true, product: productoConCalculos(data, nuevo) });
});

app.put('/api/products/:id', requireLogin, requireAdmin, upload.single('foto'), (req, res) => {
  const data = cargar();
  const p = data.products.find(p => p.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, categoria, precio_venta, costo, stock } = req.body;
  const receta = req.body.receta !== undefined ? parseReceta(req.body) : undefined;
  const combo = req.body.combo !== undefined ? parseCombo(req.body) : undefined;
  if (nombre !== undefined) p.nombre = nombre;
  if (categoria !== undefined) p.categoria = categoria;
  if (precio_venta !== undefined) p.precio_venta = Number(precio_venta);
  if (costo !== undefined) p.costo = Number(costo);
  if (stock !== undefined) p.stock = Number(stock);
  if (receta !== undefined) { p.receta = receta; if (receta) p.combo = null; }
  if (combo !== undefined) { p.combo = combo; if (combo) p.receta = null; }
  if (req.file) p.foto = '/uploads/' + req.file.filename;
  guardar(data);
  res.json({ ok: true, product: productoConCalculos(data, p) });
});

app.delete('/api/products/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const p = data.products.find(p => p.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  p.activo = false;
  guardar(data);
  res.json({ ok: true });
});

// Ajuste manual directo de stock (para la pantalla "Ver inventario en tiempo real")
app.post('/api/products/:id/ajustar', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const p = data.products.find(p => p.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (tieneReceta(p)) return res.status(400).json({ error: 'Este producto usa receta: ajusta el stock de sus insumos, no el del producto.' });
  if (tieneCombo(p)) return res.status(400).json({ error: 'Este producto es un combo: ajusta el stock de los productos que lo componen.' });
  const nuevo = Number(req.body.stock_nuevo);
  const delta = nuevo - (Number(p.stock) || 0);
  p.stock = nuevo;
  registrarMovimiento(data, { tipo: 'ajuste_manual', tipo_item: 'producto', item_id: p.id, nombre: p.nombre, cantidad: delta, motivo: req.body.motivo || 'Ajuste manual de inventario' });
  guardar(data);
  res.json({ ok: true });
});

// ================== INSUMOS (materias primas: pan, tomate, lechuga, etc.) ==================
app.get('/api/insumos', requireLogin, (req, res) => {
  const data = cargar();
  res.json(data.insumos.filter(i => i.activo !== false));
});

app.post('/api/insumos', requireLogin, requireAdmin, (req, res) => {
  const { nombre, unidad, unidad_uso, equivalencia, costo, stock } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del insumo' });
  const data = cargar();
  const nuevo = {
    id: siguienteId(data, 'insumos'),
    nombre,
    unidad: unidad || 'unidad',
    unidad_uso: unidad_uso || unidad || 'unidad',
    equivalencia: Number(equivalencia) > 0 ? Number(equivalencia) : 1,
    costo: Number(costo) || 0,
    stock: Number(stock) || 0,
    activo: true
  };
  data.insumos.push(nuevo);
  guardar(data);
  res.json({ ok: true, insumo: nuevo });
});

app.put('/api/insumos/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const i = data.insumos.find(i => i.id === Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, unidad, unidad_uso, equivalencia, costo, stock } = req.body;
  if (nombre !== undefined) i.nombre = nombre;
  if (unidad !== undefined) i.unidad = unidad;
  if (unidad_uso !== undefined) i.unidad_uso = unidad_uso;
  if (equivalencia !== undefined) i.equivalencia = Number(equivalencia) > 0 ? Number(equivalencia) : 1;
  if (costo !== undefined) i.costo = Number(costo);
  if (stock !== undefined) i.stock = Number(stock);
  guardar(data);
  res.json({ ok: true, insumo: i });
});

app.delete('/api/insumos/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const i = data.insumos.find(i => i.id === Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'No encontrado' });
  i.activo = false;
  guardar(data);
  res.json({ ok: true });
});

app.post('/api/insumos/:id/ajustar', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const i = data.insumos.find(i => i.id === Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'No encontrado' });
  const nuevo = Number(req.body.stock_nuevo);
  const delta = nuevo - (Number(i.stock) || 0);
  i.stock = nuevo;
  registrarMovimiento(data, { tipo: 'ajuste_manual', tipo_item: 'insumo', item_id: i.id, nombre: i.nombre, cantidad: delta, motivo: req.body.motivo || 'Ajuste manual de inventario' });
  guardar(data);
  res.json({ ok: true });
});

// ================== CONFIGURACION: INSUMOS PARA "LLEVAR" ==================
// Insumos que se descuentan UNA vez por venta (no por cada item) cuando la
// venta se marca como "para llevar" (ej: bolsa, empaque general).
app.get('/api/config/empaque', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  res.json(data.config.empaqueLlevar || []);
});

app.put('/api/config/empaque', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  data.config.empaqueLlevar = items.map(x => ({ insumo_id: Number(x.insumo_id), cantidad: Number(x.cantidad) }));
  guardar(data);
  res.json({ ok: true });
});

// ================== VENTAS ==================
app.post('/api/sales', requireLogin, (req, res) => {
  const { items, metodo_pago, llevar } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'La venta no tiene items' });
  const data = cargar();
  let total = 0;
  const detalle = [];
  for (const it of items) {
    const p = data.products.find(p => p.id === Number(it.product_id));
    if (!p) {
      registrarError(data, 'venta_producto_no_encontrado', `Se intento vender un producto que no existe (id ${it.product_id}).`, it);
      guardar(data);
      return res.status(400).json({ error: 'Producto no encontrado' });
    }
    const disponible = stockDisponible(data, p);
    if (disponible < it.cantidad) return res.status(400).json({ error: `Stock insuficiente de "${p.nombre}" (disponible: ${disponible})` });
    const precioUnitario = precioVigente(data, p);
    const subtotal = precioUnitario * it.cantidad;
    const costoUnitario = costoProducto(data, p);
    total += subtotal;
    detalle.push({
      product_id: p.id, nombre_producto: p.nombre, cantidad: it.cantidad,
      precio_unitario: precioUnitario, subtotal,
      costo_unitario: costoUnitario, costo_total: costoUnitario * it.cantidad
    });
  }

  // Empaque para llevar: se valida que haya stock suficiente ANTES de aplicar nada.
  let costoEmpaque = 0;
  const empaque = (llevar && data.config.empaqueLlevar) ? data.config.empaqueLlevar : [];
  for (const e of empaque) {
    const ins = data.insumos.find(i => i.id === Number(e.insumo_id));
    if (!ins || (Number(ins.stock) || 0) < e.cantidad) {
      return res.status(400).json({ error: `No hay suficiente "${ins ? ins.nombre : 'empaque'}" para el pedido para llevar.` });
    }
  }

  // Descontar stock (combos, recetas o productos simples - ver descontarStockVenta)
  for (const it of items) {
    const p = data.products.find(p => p.id === Number(it.product_id));
    descontarStockVenta(data, p, it.cantidad);
  }
  for (const e of empaque) {
    const ins = data.insumos.find(i => i.id === Number(e.insumo_id));
    if (!ins) continue;
    ins.stock -= e.cantidad;
    costoEmpaque += (Number(ins.costo) || 0) * e.cantidad;
    registrarMovimiento(data, { tipo: 'venta_empaque', tipo_item: 'insumo', item_id: ins.id, nombre: ins.nombre, cantidad: -e.cantidad, motivo: 'Pedido para llevar' });
  }

  const venta = {
    id: siguienteId(data, 'sales'),
    fecha: fechaLocalISO(),
    usuario_id: req.session.user.id,
    usuario_nombre: req.session.user.nombre,
    metodo_pago: metodo_pago || 'Efectivo',
    llevar: !!llevar,
    costo_empaque: costoEmpaque,
    total,
    items: detalle
  };
  data.sales.push(venta);
  guardar(data);
  res.json({ ok: true, sale: venta });
});

app.get('/api/sales', requireLogin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let ventas = data.sales;
  if (desde) ventas = ventas.filter(v => v.fecha >= desde);
  if (hasta) ventas = ventas.filter(v => v.fecha <= hasta + 'T23:59:59');
  res.json(ventas.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

app.get('/api/sales/:id', requireLogin, (req, res) => {
  const data = cargar();
  const v = data.sales.find(v => v.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'No encontrada' });
  res.json(v);
});

// ================== FACTURAS / ENTRADAS DE INVENTARIO ==================
app.post('/api/purchases', requireLogin, requireAdmin, (req, res) => {
  const { proveedor, numero_factura, items, fecha } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'La factura no tiene items' });
  const data = cargar();
  const fechaFactura = fechaDesdeInput(fecha);
  let total = 0;
  const detalle = [];
  // Cada item puede ser un "producto" (para reventa) o un "insumo" (materia
  // prima que se usa en recetas, como pan, tomate, empaques, etc.)
  for (const it of items) {
    const coleccion = it.tipo === 'insumo' ? data.insumos : data.products;
    const elem = coleccion.find(e => e.id === Number(it.item_id));
    if (!elem) {
      registrarError(data, 'factura_item_no_encontrado', `Se intento ingresar una factura con un item que no existe (${it.tipo} id ${it.item_id}).`, it);
      guardar(data);
      return res.status(400).json({ error: 'Un item de la factura no existe. Revisa que no lo hayas eliminado.' });
    }
    if (it.tipo === 'producto' && tieneReceta(elem)) {
      return res.status(400).json({ error: `"${elem.nombre}" usa una receta de insumos: no se compra directamente, compra sus insumos.` });
    }
    if (it.tipo === 'producto' && tieneCombo(elem)) {
      return res.status(400).json({ error: `"${elem.nombre}" es un combo: no se compra directamente, se arma con sus productos.` });
    }
    const subtotal = it.costo_unitario * it.cantidad;
    total += subtotal;
    detalle.push({ tipo: it.tipo, item_id: elem.id, nombre: elem.nombre, cantidad: it.cantidad, costo_unitario: it.costo_unitario, subtotal });
  }
  for (const it of items) {
    const coleccion = it.tipo === 'insumo' ? data.insumos : data.products;
    const elem = coleccion.find(e => e.id === Number(it.item_id));
    elem.stock = (Number(elem.stock) || 0) + Number(it.cantidad);
    elem.costo = Number(it.costo_unitario); // actualiza costo mas reciente
    registrarMovimiento(data, { tipo: 'compra', tipo_item: it.tipo === 'insumo' ? 'insumo' : 'producto', item_id: elem.id, nombre: elem.nombre, cantidad: Number(it.cantidad), motivo: `Factura ${numero_factura || ''} - ${proveedor || ''}`, fecha: fechaFactura });
  }
  const factura = {
    id: siguienteId(data, 'purchases'),
    fecha: fechaFactura,
    usuario_id: req.session.user.id,
    proveedor: proveedor || '',
    numero_factura: numero_factura || '',
    total,
    items: detalle
  };
  data.purchases.push(factura);
  guardar(data);
  res.json({ ok: true, purchase: factura });
});

app.get('/api/purchases', requireLogin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let compras = data.purchases;
  if (desde) compras = compras.filter(c => c.fecha >= desde);
  if (hasta) compras = compras.filter(c => c.fecha <= hasta + 'T23:59:59');
  res.json(compras.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

// ================== BAJAS DE INVENTARIO ==================
app.post('/api/adjustments', requireLogin, requireAdmin, (req, res) => {
  const { tipo, item_id, cantidad, motivo } = req.body;
  const data = cargar();
  const coleccion = tipo === 'insumo' ? data.insumos : data.products;
  const elem = coleccion.find(e => e.id === Number(item_id));
  if (!elem) return res.status(400).json({ error: 'Item no encontrado' });
  if (elem.stock < cantidad) return res.status(400).json({ error: 'No hay suficiente stock para dar de baja esa cantidad' });
  elem.stock -= Number(cantidad);
  const baja = {
    id: siguienteId(data, 'adjustments'),
    fecha: fechaLocalISO(),
    usuario_id: req.session.user.id,
    tipo: tipo === 'insumo' ? 'insumo' : 'producto',
    item_id: elem.id,
    nombre_producto: elem.nombre,
    cantidad: Number(cantidad),
    motivo: motivo || 'No especificado'
  };
  data.adjustments.push(baja);
  registrarMovimiento(data, { tipo: 'baja', tipo_item: baja.tipo, item_id: elem.id, nombre: elem.nombre, cantidad: -Number(cantidad), motivo: baja.motivo });
  guardar(data);
  res.json({ ok: true, adjustment: baja });
});

app.get('/api/adjustments', requireLogin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let bajas = data.adjustments;
  if (desde) bajas = bajas.filter(b => b.fecha >= desde);
  if (hasta) bajas = bajas.filter(b => b.fecha <= hasta + 'T23:59:59');
  res.json(bajas.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

// ================== MOVIMIENTOS (KARDEX: cruce de todas las transacciones) ==================
app.get('/api/movimientos', requireLogin, requireAdmin, (req, res) => {
  const { tipo_item, item_id, desde, hasta } = req.query;
  const data = cargar();
  let mov = data.movimientos;
  if (tipo_item) mov = mov.filter(m => m.tipo_item === tipo_item);
  if (item_id) mov = mov.filter(m => m.item_id === Number(item_id));
  if (desde) mov = mov.filter(m => m.fecha >= desde);
  if (hasta) mov = mov.filter(m => m.fecha <= hasta + 'T23:59:59');
  res.json(mov.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 500));
});

// ================== LOG DE ERRORES / ANOMALIAS ==================
app.get('/api/errores', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  res.json(data.errorLog.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

app.delete('/api/errores', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  data.errorLog = [];
  guardar(data);
  res.json({ ok: true });
});

// ================== PROMOCIONES TEMPORALES ==================
app.get('/api/promotions', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const hoy = fechaHoyLocal();
  const lista = data.promotions.map(pr => {
    const prod = data.products.find(p => p.id === pr.product_id);
    return {
      ...pr,
      nombre_producto: prod ? prod.nombre : '(producto eliminado)',
      precio_normal: prod ? prod.precio_venta : null,
      vigente_hoy: pr.activa !== false && pr.desde <= hoy && pr.hasta >= hoy
    };
  });
  res.json(lista.sort((a, b) => b.desde.localeCompare(a.desde)));
});

app.post('/api/promotions', requireLogin, requireAdmin, (req, res) => {
  const { product_id, nombre, precio_promocional, desde, hasta } = req.body;
  if (!product_id || !precio_promocional || !desde || !hasta) return res.status(400).json({ error: 'Faltan datos de la promocion' });
  if (hasta < desde) return res.status(400).json({ error: 'La fecha "hasta" no puede ser anterior a "desde"' });
  const data = cargar();
  const prod = data.products.find(p => p.id === Number(product_id));
  if (!prod) return res.status(400).json({ error: 'Producto no encontrado' });
  const nueva = {
    id: siguienteId(data, 'promotions'),
    product_id: Number(product_id),
    nombre: nombre || `Promo ${prod.nombre}`,
    precio_promocional: Number(precio_promocional),
    desde, hasta,
    activa: true
  };
  data.promotions.push(nueva);
  guardar(data);
  res.json({ ok: true, promotion: nueva });
});

app.put('/api/promotions/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const pr = data.promotions.find(pr => pr.id === Number(req.params.id));
  if (!pr) return res.status(404).json({ error: 'No encontrada' });
  const { nombre, precio_promocional, desde, hasta, activa } = req.body;
  if (nombre !== undefined) pr.nombre = nombre;
  if (precio_promocional !== undefined) pr.precio_promocional = Number(precio_promocional);
  if (desde !== undefined) pr.desde = desde;
  if (hasta !== undefined) pr.hasta = hasta;
  if (activa !== undefined) pr.activa = activa;
  guardar(data);
  res.json({ ok: true });
});

app.delete('/api/promotions/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const antes = data.promotions.length;
  data.promotions = data.promotions.filter(pr => pr.id !== Number(req.params.id));
  if (data.promotions.length === antes) return res.status(404).json({ error: 'No encontrada' });
  guardar(data);
  res.json({ ok: true });
});

// ================== GASTOS (arriendo, servicios publicos, etc.) ==================
app.get('/api/expenses', requireLogin, requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let gastos = data.expenses;
  if (desde) gastos = gastos.filter(g => g.fecha >= desde);
  if (hasta) gastos = gastos.filter(g => g.fecha <= hasta + 'T23:59:59');
  res.json(gastos.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

app.post('/api/expenses', requireLogin, requireAdmin, (req, res) => {
  const { fecha, categoria, descripcion, monto, metodo_pago, tipo } = req.body;
  if (!categoria || !monto) return res.status(400).json({ error: 'Falta la categoria o el monto' });
  const data = cargar();
  const nuevo = {
    id: siguienteId(data, 'expenses'),
    fecha: fechaDesdeInput(fecha),
    categoria,
    descripcion: descripcion || '',
    monto: Number(monto),
    metodo_pago: metodo_pago || 'Efectivo',
    tipo: tipo === 'ocasional' ? 'ocasional' : 'fijo',
    usuario_id: req.session.user.id
  };
  data.expenses.push(nuevo);
  guardar(data);
  res.json({ ok: true, expense: nuevo });
});

app.delete('/api/expenses/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const antes = data.expenses.length;
  data.expenses = data.expenses.filter(g => g.id !== Number(req.params.id));
  if (data.expenses.length === antes) return res.status(404).json({ error: 'No encontrado' });
  guardar(data);
  res.json({ ok: true });
});

// ================== CAJA: CUADRE DIARIO, RESUMEN MENSUAL Y ARQUEOS ==================
const METODOS_PAGO = ['Efectivo', 'Tarjeta', 'Transferencia'];

// Cuanto dinero DEBERIA haber por cada metodo de pago en un dia: lo vendido
// en ese metodo, menos los gastos pagados ese dia con ese mismo metodo
// (tanto gastos fijos como ocasionales, lo que importa es con que se pagaron).
function resumenCajaDia(data, fecha) {
  const ventasDia = data.sales.filter(v => v.fecha.slice(0, 10) === fecha);
  const gastosDia = data.expenses.filter(g => g.fecha.slice(0, 10) === fecha);
  const metodos = METODOS_PAGO.map(m => {
    const ventas = ventasDia.filter(v => v.metodo_pago === m).reduce((s, v) => s + v.total, 0);
    const numVentas = ventasDia.filter(v => v.metodo_pago === m).length;
    const gastos = gastosDia.filter(g => (g.metodo_pago || 'Efectivo') === m).reduce((s, g) => s + g.monto, 0);
    return { metodo_pago: m, ventas, numero_ventas: numVentas, gastos, esperado: ventas - gastos };
  });
  const totalVentas = metodos.reduce((s, m) => s + m.ventas, 0);
  const totalGastos = metodos.reduce((s, m) => s + m.gastos, 0);
  return {
    fecha, metodos,
    total_ventas: totalVentas, total_gastos: totalGastos, total_esperado: totalVentas - totalGastos,
    numero_ventas: ventasDia.length,
    gastos_detalle: gastosDia.sort((a, b) => b.fecha.localeCompare(a.fecha))
  };
}

app.get('/api/caja/diario', requireLogin, requireAdmin, (req, res) => {
  const fecha = req.query.fecha || fechaHoyLocal();
  const data = cargar();
  const resumen = resumenCajaDia(data, fecha);
  const arqueo = data.arqueos.find(a => a.fecha === fecha) || null;
  res.json({ ...resumen, arqueo });
});

app.get('/api/caja/mensual', requireLogin, requireAdmin, (req, res) => {
  const anio = req.query.anio || String(new Date().getFullYear());
  const mes = String(req.query.mes || (new Date().getMonth() + 1)).padStart(2, '0');
  const prefijo = `${anio}-${mes}`;
  const data = cargar();
  const ventasMes = data.sales.filter(v => v.fecha.slice(0, 7) === prefijo);
  const gastosMes = data.expenses.filter(g => g.fecha.slice(0, 7) === prefijo);

  const metodos = METODOS_PAGO.map(m => {
    const ventas = ventasMes.filter(v => v.metodo_pago === m).reduce((s, v) => s + v.total, 0);
    const gastos = gastosMes.filter(g => (g.metodo_pago || 'Efectivo') === m).reduce((s, g) => s + g.monto, 0);
    return { metodo_pago: m, ventas, gastos, esperado: ventas - gastos };
  });

  // Desglose dia por dia, por metodo (para revisar el mes completo de un vistazo)
  const porDia = {};
  for (const v of ventasMes) {
    const dia = v.fecha.slice(0, 10);
    if (!porDia[dia]) porDia[dia] = { Efectivo: 0, Tarjeta: 0, Transferencia: 0, total: 0 };
    porDia[dia][v.metodo_pago] = (porDia[dia][v.metodo_pago] || 0) + v.total;
    porDia[dia].total += v.total;
  }

  const totalVentas = metodos.reduce((s, m) => s + m.ventas, 0);
  const totalGastos = metodos.reduce((s, m) => s + m.gastos, 0);
  res.json({
    anio, mes, metodos,
    total_ventas: totalVentas, total_gastos: totalGastos, total_esperado: totalVentas - totalGastos,
    numero_ventas: ventasMes.length,
    por_dia: porDia
  });
});

// Arqueo: lo que el administrador CONTO fisicamente, comparado con lo
// esperado por el sistema. Un arqueo por dia (si ya existe uno para esa
// fecha, se actualiza en vez de crear otro).
app.post('/api/arqueos', requireLogin, requireAdmin, (req, res) => {
  const { fecha, metodos, nota } = req.body;
  if (!fecha || !Array.isArray(metodos)) return res.status(400).json({ error: 'Faltan datos del arqueo' });
  const data = cargar();
  const resumen = resumenCajaDia(data, fecha);
  const detalle = METODOS_PAGO.map(m => {
    const enviado = metodos.find(x => x.metodo_pago === m);
    const contado = enviado ? Number(enviado.contado) || 0 : 0;
    const esperado = resumen.metodos.find(r => r.metodo_pago === m).esperado;
    return { metodo_pago: m, esperado, contado, diferencia: contado - esperado };
  });
  let arqueo = data.arqueos.find(a => a.fecha === fecha);
  if (arqueo) {
    arqueo.metodos = detalle;
    arqueo.nota = nota || '';
    arqueo.usuario_id = req.session.user.id;
    arqueo.fecha_registro = fechaLocalISO();
  } else {
    arqueo = {
      id: siguienteId(data, 'arqueos'),
      fecha, metodos: detalle, nota: nota || '',
      usuario_id: req.session.user.id, fecha_registro: fechaLocalISO()
    };
    data.arqueos.push(arqueo);
  }
  guardar(data);
  res.json({ ok: true, arqueo });
});

app.get('/api/arqueos', requireLogin, requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let lista = data.arqueos;
  if (desde) lista = lista.filter(a => a.fecha >= desde);
  if (hasta) lista = lista.filter(a => a.fecha <= hasta);
  res.json(lista.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

// ================== MESAS (comandas abiertas del restaurante) ==================
function mesaConEstado(data, mesa) {
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  const total = cuenta ? cuenta.items.reduce((s, it) => s + it.subtotal, 0) : 0;
  return {
    ...mesa,
    estado: cuenta ? 'ocupada' : 'libre',
    total, numero_items: cuenta ? cuenta.items.length : 0,
    cuenta_id: cuenta ? cuenta.id : null,
    fecha_apertura: cuenta ? cuenta.fecha_apertura : null
  };
}

// Cuanto de un producto ya esta "comprometido" en TODAS las mesas abiertas
// (para no dejar pedir en una mesa lo que ya se aparto en otra).
function stockComprometidoMesas(data, productId) {
  let total = 0;
  for (const c of data.cuentasMesa) {
    if (c.estado !== 'abierta') continue;
    for (const it of c.items) if (it.product_id === Number(productId)) total += it.cantidad;
  }
  return total;
}

app.get('/api/mesas', requireLogin, (req, res) => {
  const data = cargar();
  res.json(data.mesas.filter(m => m.activa !== false).map(m => mesaConEstado(data, m)).sort((a, b) => a.orden - b.orden));
});

app.post('/api/mesas', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const maxOrden = data.mesas.reduce((m, x) => Math.max(m, x.orden || 0), 0);
  const nueva = { id: siguienteId(data, 'mesas'), nombre: req.body.nombre || `Mesa ${maxOrden + 1}`, orden: maxOrden + 1, activa: true };
  data.mesas.push(nueva);
  guardar(data);
  res.json({ ok: true, mesa: mesaConEstado(data, nueva) });
});

app.put('/api/mesas/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const m = data.mesas.find(m => m.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  if (req.body.nombre !== undefined) m.nombre = req.body.nombre;
  guardar(data);
  res.json({ ok: true });
});

app.delete('/api/mesas/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const m = data.mesas.find(m => m.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === m.id && c.estado === 'abierta');
  if (cuenta) return res.status(400).json({ error: 'Esta mesa tiene una cuenta abierta: cóbrala o cancélala antes de eliminarla.' });
  m.activa = false;
  guardar(data);
  res.json({ ok: true });
});

app.get('/api/mesas/:id/cuenta', requireLogin, (req, res) => {
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  const total = cuenta ? cuenta.items.reduce((s, it) => s + it.subtotal, 0) : 0;
  res.json({ mesa, cuenta: cuenta || { items: [] }, total });
});

app.post('/api/mesas/:id/items', requireLogin, (req, res) => {
  const { product_id, cantidad } = req.body;
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const p = data.products.find(p => p.id === Number(product_id));
  if (!p) return res.status(400).json({ error: 'Producto no encontrado' });

  const comprometidoActual = stockComprometidoMesas(data, p.id);
  const disponibleReal = stockDisponible(data, p);
  if (comprometidoActual + Number(cantidad) > disponibleReal) {
    return res.status(400).json({ error: `Stock insuficiente de "${p.nombre}" (disponible real: ${disponibleReal - comprometidoActual})` });
  }

  let cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  if (!cuenta) {
    cuenta = { id: siguienteId(data, 'cuentasMesa'), mesa_id: mesa.id, estado: 'abierta', fecha_apertura: fechaLocalISO(), usuario_id: req.session.user.id, items: [] };
    data.cuentasMesa.push(cuenta);
  }
  const precioUnit = precioVigente(data, p);
  const existente = cuenta.items.find(it => it.product_id === p.id);
  if (existente) {
    existente.cantidad += Number(cantidad);
    existente.subtotal = existente.cantidad * existente.precio_unitario;
  } else {
    cuenta.items.push({
      id: siguienteId(data, 'cuentaItems'),
      product_id: p.id, nombre_producto: p.nombre,
      cantidad: Number(cantidad), precio_unitario: precioUnit, subtotal: precioUnit * Number(cantidad)
    });
  }
  guardar(data);
  res.json({ ok: true, cuenta });
});

app.put('/api/mesas/:id/items/:itemId', requireLogin, (req, res) => {
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  if (!cuenta) return res.status(404).json({ error: 'Esta mesa no tiene una cuenta abierta' });
  const item = cuenta.items.find(it => it.id === Number(req.params.itemId));
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });

  const nuevaCantidad = Number(req.body.cantidad);
  if (nuevaCantidad <= 0) {
    cuenta.items = cuenta.items.filter(it => it.id !== item.id);
  } else {
    const p = data.products.find(p => p.id === item.product_id);
    const comprometidoOtros = stockComprometidoMesas(data, item.product_id) - item.cantidad;
    const disponibleReal = p ? stockDisponible(data, p) : 0;
    if (comprometidoOtros + nuevaCantidad > disponibleReal) {
      return res.status(400).json({ error: `Stock insuficiente (disponible real: ${disponibleReal - comprometidoOtros})` });
    }
    item.cantidad = nuevaCantidad;
    item.subtotal = item.cantidad * item.precio_unitario;
  }
  if (cuenta.items.length === 0) {
    data.cuentasMesa = data.cuentasMesa.filter(c => c.id !== cuenta.id);
  }
  guardar(data);
  res.json({ ok: true });
});

app.delete('/api/mesas/:id/items/:itemId', requireLogin, (req, res) => {
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  if (!cuenta) return res.status(404).json({ error: 'Esta mesa no tiene una cuenta abierta' });
  cuenta.items = cuenta.items.filter(it => it.id !== Number(req.params.itemId));
  if (cuenta.items.length === 0) {
    data.cuentasMesa = data.cuentasMesa.filter(c => c.id !== cuenta.id);
  }
  guardar(data);
  res.json({ ok: true });
});

app.delete('/api/mesas/:id/cuenta', requireLogin, (req, res) => {
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const antes = data.cuentasMesa.length;
  data.cuentasMesa = data.cuentasMesa.filter(c => !(c.mesa_id === mesa.id && c.estado === 'abierta'));
  if (data.cuentasMesa.length === antes) return res.status(404).json({ error: 'Esta mesa no tiene una cuenta abierta' });
  guardar(data);
  res.json({ ok: true });
});

app.post('/api/mesas/:id/cobrar', requireLogin, (req, res) => {
  const data = cargar();
  const mesa = data.mesas.find(m => m.id === Number(req.params.id));
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  const cuenta = data.cuentasMesa.find(c => c.mesa_id === mesa.id && c.estado === 'abierta');
  if (!cuenta || !cuenta.items.length) return res.status(400).json({ error: 'Esta mesa no tiene items para cobrar' });

  // Verificacion final de stock real (por si algo cambio desde que se pidio)
  for (const it of cuenta.items) {
    const p = data.products.find(p => p.id === it.product_id);
    if (!p) return res.status(400).json({ error: `El producto "${it.nombre_producto}" ya no existe` });
    if (stockDisponible(data, p) < it.cantidad) {
      return res.status(400).json({ error: `Stock insuficiente de "${p.nombre}" para cobrar la mesa (disponible: ${stockDisponible(data, p)})` });
    }
  }

  const detalle = cuenta.items.map(it => {
    const p = data.products.find(p => p.id === it.product_id);
    const costoUnitario = p ? costoProducto(data, p) : 0;
    return { ...it, costo_unitario: costoUnitario, costo_total: costoUnitario * it.cantidad };
  });
  for (const it of cuenta.items) {
    const p = data.products.find(p => p.id === it.product_id);
    if (p) descontarStockVenta(data, p, it.cantidad, `Venta mesa "${mesa.nombre}"`);
  }
  const total = detalle.reduce((s, it) => s + it.subtotal, 0);
  const venta = {
    id: siguienteId(data, 'sales'),
    fecha: fechaLocalISO(),
    usuario_id: req.session.user.id,
    usuario_nombre: req.session.user.nombre,
    metodo_pago: req.body.metodo_pago || 'Efectivo',
    llevar: false,
    costo_empaque: 0,
    mesa_id: mesa.id, mesa_nombre: mesa.nombre,
    total,
    items: detalle
  };
  data.sales.push(venta);
  cuenta.estado = 'cerrada';
  cuenta.fecha_cierre = fechaLocalISO();
  cuenta.venta_id = venta.id;
  guardar(data);
  res.json({ ok: true, venta });
});

// ================== NOMINA (empleados, horas, abonos y liquidacion) ==================
// AVISO IMPORTANTE: este modulo lleva un control BASICO e INFORMAL de nomina
// (horas, salario, abonos/adelantos y liquidacion mensual). NO calcula
// seguridad social, parafiscales, prestaciones sociales, recargos nocturnos
// ni festivos, ni ninguna otra obligacion legal laboral colombiana. Para
// nomina formal con empleados vinculados, consulta a un contador o usa un
// software de nomina certificado (ej. la nomina electronica de la DIAN).

app.get('/api/empleados', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  res.json(data.empleados.filter(e => e.activo !== false));
});

app.post('/api/empleados', requireLogin, requireAdmin, (req, res) => {
  const { nombre, cargo, tipo_pago, salario_mensual, valor_hora } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del empleado' });
  const data = cargar();
  const nuevo = {
    id: siguienteId(data, 'empleados'),
    nombre, cargo: cargo || '',
    tipo_pago: tipo_pago === 'por_hora' ? 'por_hora' : 'mensual',
    salario_mensual: Number(salario_mensual) || 0,
    valor_hora: Number(valor_hora) || 0,
    activo: true
  };
  data.empleados.push(nuevo);
  guardar(data);
  res.json({ ok: true, empleado: nuevo });
});

app.put('/api/empleados/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const e = data.empleados.find(e => e.id === Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, cargo, tipo_pago, salario_mensual, valor_hora, activo } = req.body;
  if (nombre !== undefined) e.nombre = nombre;
  if (cargo !== undefined) e.cargo = cargo;
  if (tipo_pago !== undefined) e.tipo_pago = tipo_pago === 'por_hora' ? 'por_hora' : 'mensual';
  if (salario_mensual !== undefined) e.salario_mensual = Number(salario_mensual);
  if (valor_hora !== undefined) e.valor_hora = Number(valor_hora);
  if (activo !== undefined) e.activo = activo;
  guardar(data);
  res.json({ ok: true });
});

// -------- Turnos / horas trabajadas por dia --------
app.get('/api/turnos', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, desde, hasta } = req.query;
  const data = cargar();
  let turnos = data.turnos;
  if (empleado_id) turnos = turnos.filter(t => t.empleado_id === Number(empleado_id));
  if (desde) turnos = turnos.filter(t => t.fecha >= desde);
  if (hasta) turnos = turnos.filter(t => t.fecha <= hasta);
  res.json(turnos.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

app.post('/api/turnos', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, fecha, horas, nota } = req.body;
  if (!empleado_id || !fecha || horas === undefined) return res.status(400).json({ error: 'Faltan datos del turno' });
  const data = cargar();
  const emp = data.empleados.find(e => e.id === Number(empleado_id));
  if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
  const nuevo = { id: siguienteId(data, 'turnos'), empleado_id: Number(empleado_id), fecha, horas: Number(horas), nota: nota || '' };
  data.turnos.push(nuevo);
  guardar(data);
  res.json({ ok: true, turno: nuevo });
});

app.delete('/api/turnos/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const antes = data.turnos.length;
  data.turnos = data.turnos.filter(t => t.id !== Number(req.params.id));
  if (data.turnos.length === antes) return res.status(404).json({ error: 'No encontrado' });
  guardar(data);
  res.json({ ok: true });
});

// -------- Abonos (adelantos): generan un gasto de inmediato --------
app.get('/api/abonos-nomina', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, desde, hasta } = req.query;
  const data = cargar();
  let abonos = data.abonosNomina;
  if (empleado_id) abonos = abonos.filter(a => a.empleado_id === Number(empleado_id));
  if (desde) abonos = abonos.filter(a => a.fecha >= desde);
  if (hasta) abonos = abonos.filter(a => a.fecha <= hasta);
  res.json(abonos.sort((a, b) => b.fecha.localeCompare(a.fecha)));
});

app.post('/api/abonos-nomina', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, fecha, monto, metodo_pago, motivo } = req.body;
  if (!empleado_id || !monto) return res.status(400).json({ error: 'Faltan datos del abono' });
  const data = cargar();
  const emp = data.empleados.find(e => e.id === Number(empleado_id));
  if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });

  const gasto = {
    id: siguienteId(data, 'expenses'),
    fecha: fechaDesdeInput(fecha),
    categoria: 'Nómina / empleados',
    descripcion: `Abono a ${emp.nombre}${motivo ? ' - ' + motivo : ''}`,
    monto: Number(monto),
    metodo_pago: metodo_pago || 'Efectivo',
    tipo: 'ocasional',
    usuario_id: req.session.user.id
  };
  data.expenses.push(gasto);

  const abono = {
    id: siguienteId(data, 'abonosNomina'),
    empleado_id: Number(empleado_id), fecha: gasto.fecha, monto: Number(monto),
    motivo: motivo || '', metodo_pago: gasto.metodo_pago, expense_id: gasto.id, usuario_id: req.session.user.id
  };
  data.abonosNomina.push(abono);
  guardar(data);
  res.json({ ok: true, abono });
});

app.delete('/api/abonos-nomina/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const abono = data.abonosNomina.find(a => a.id === Number(req.params.id));
  if (!abono) return res.status(404).json({ error: 'No encontrado' });
  data.abonosNomina = data.abonosNomina.filter(a => a.id !== abono.id);
  if (abono.expense_id) data.expenses = data.expenses.filter(g => g.id !== abono.expense_id);
  guardar(data);
  res.json({ ok: true });
});

// -------- Resumen y liquidacion mensual --------
function resumenNominaEmpleadoMes(data, emp, anio, mes) {
  const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
  const turnosMes = data.turnos.filter(t => t.empleado_id === emp.id && t.fecha.slice(0, 7) === prefijo);
  const horas = turnosMes.reduce((s, t) => s + Number(t.horas), 0);
  const devengado = emp.tipo_pago === 'por_hora' ? horas * Number(emp.valor_hora || 0) : Number(emp.salario_mensual || 0);
  const abonosMes = data.abonosNomina.filter(a => a.empleado_id === emp.id && a.fecha.slice(0, 7) === prefijo);
  const totalAbonado = abonosMes.reduce((s, a) => s + a.monto, 0);
  const liquidacion = data.liquidacionesNomina.find(l => l.empleado_id === emp.id && l.anio === String(anio) && l.mes === String(mes).padStart(2, '0'));
  return {
    empleado_id: emp.id, nombre: emp.nombre, cargo: emp.cargo, tipo_pago: emp.tipo_pago,
    horas_trabajadas: horas, devengado, total_abonado: totalAbonado,
    saldo_a_pagar: devengado - totalAbonado,
    liquidado: !!liquidacion, liquidacion: liquidacion || null
  };
}

app.get('/api/nomina/mensual', requireLogin, requireAdmin, (req, res) => {
  const anio = req.query.anio || String(new Date().getFullYear());
  const mes = String(req.query.mes || (new Date().getMonth() + 1)).padStart(2, '0');
  const data = cargar();
  const empleados = data.empleados.filter(e => e.activo !== false);
  const resumen = empleados.map(e => resumenNominaEmpleadoMes(data, e, anio, mes));
  const totales = {
    horas: resumen.reduce((s, r) => s + r.horas_trabajadas, 0),
    devengado: resumen.reduce((s, r) => s + r.devengado, 0),
    abonado: resumen.reduce((s, r) => s + r.total_abonado, 0),
    saldo: resumen.reduce((s, r) => s + r.saldo_a_pagar, 0)
  };
  res.json({ anio, mes, empleados: resumen, totales });
});

app.post('/api/nomina/liquidar', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, anio, mes, metodo_pago, nota } = req.body;
  if (!empleado_id || !anio || !mes) return res.status(400).json({ error: 'Faltan datos de la liquidacion' });
  const data = cargar();
  const emp = data.empleados.find(e => e.id === Number(empleado_id));
  if (!emp) return res.status(400).json({ error: 'Empleado no encontrado' });
  const mesPad = String(mes).padStart(2, '0');
  if (data.liquidacionesNomina.find(l => l.empleado_id === emp.id && l.anio === String(anio) && l.mes === mesPad)) {
    return res.status(400).json({ error: 'Ya liquidaste este mes para este empleado. Elimínala primero si quieres rehacerla.' });
  }
  const resumen = resumenNominaEmpleadoMes(data, emp, anio, mesPad);
  let gasto = null;
  if (resumen.saldo_a_pagar > 0) {
    gasto = {
      id: siguienteId(data, 'expenses'),
      fecha: fechaLocalISO(),
      categoria: 'Nómina / empleados',
      descripcion: `Liquidación nómina ${emp.nombre} — ${mesPad}/${anio}`,
      monto: resumen.saldo_a_pagar,
      metodo_pago: metodo_pago || 'Efectivo',
      tipo: 'fijo',
      usuario_id: req.session.user.id
    };
    data.expenses.push(gasto);
  }
  const liquidacion = {
    id: siguienteId(data, 'liquidacionesNomina'),
    empleado_id: emp.id, nombre: emp.nombre, anio: String(anio), mes: mesPad,
    horas_trabajadas: resumen.horas_trabajadas, devengado: resumen.devengado,
    total_abonado: resumen.total_abonado, saldo_pagado: Math.max(resumen.saldo_a_pagar, 0),
    expense_id: gasto ? gasto.id : null, nota: nota || '',
    fecha_liquidacion: fechaLocalISO(), usuario_id: req.session.user.id
  };
  data.liquidacionesNomina.push(liquidacion);
  guardar(data);
  res.json({ ok: true, liquidacion });
});

app.get('/api/nomina/liquidaciones', requireLogin, requireAdmin, (req, res) => {
  const { empleado_id, anio } = req.query;
  const data = cargar();
  let lista = data.liquidacionesNomina;
  if (empleado_id) lista = lista.filter(l => l.empleado_id === Number(empleado_id));
  if (anio) lista = lista.filter(l => l.anio === String(anio));
  res.json(lista.sort((a, b) => (b.anio + b.mes).localeCompare(a.anio + a.mes)));
});

app.delete('/api/nomina/liquidaciones/:id', requireLogin, requireAdmin, (req, res) => {
  const data = cargar();
  const liq = data.liquidacionesNomina.find(l => l.id === Number(req.params.id));
  if (!liq) return res.status(404).json({ error: 'No encontrada' });
  data.liquidacionesNomina = data.liquidacionesNomina.filter(l => l.id !== liq.id);
  if (liq.expense_id) data.expenses = data.expenses.filter(g => g.id !== liq.expense_id);
  guardar(data);
  res.json({ ok: true });
});

// ================== REPORTES ==================
app.get('/api/reports/diario', requireLogin, (req, res) => {
  const fecha = req.query.fecha || fechaHoyLocal();
  const data = cargar();
  const ventasDia = data.sales.filter(v => v.fecha.slice(0, 10) === fecha);
  const total = ventasDia.reduce((s, v) => s + v.total, 0);
  const porProducto = {};
  const cantidadPorProductoId = {};
  for (const v of ventasDia) {
    for (const it of v.items) {
      if (!porProducto[it.nombre_producto]) porProducto[it.nombre_producto] = { cantidad: 0, total: 0 };
      porProducto[it.nombre_producto].cantidad += it.cantidad;
      porProducto[it.nombre_producto].total += it.subtotal;
      cantidadPorProductoId[it.product_id] = (cantidadPorProductoId[it.product_id] || 0) + it.cantidad;
    }
  }
  res.json({ fecha, total_ventas: total, numero_ventas: ventasDia.length, por_producto: porProducto, cantidad_por_producto_id: cantidadPorProductoId, ventas: ventasDia });
});

app.get('/api/reports/mensual', requireLogin, (req, res) => {
  const anio = req.query.anio || String(new Date().getFullYear());
  const mes = String(req.query.mes || (new Date().getMonth() + 1)).padStart(2, '0');
  const prefijo = `${anio}-${mes}`;
  const data = cargar();
  const ventasMes = data.sales.filter(v => v.fecha.slice(0, 7) === prefijo);
  const porDia = {};
  for (const v of ventasMes) {
    const dia = v.fecha.slice(0, 10);
    porDia[dia] = (porDia[dia] || 0) + v.total;
  }
  const total = ventasMes.reduce((s, v) => s + v.total, 0);
  res.json({ anio, mes, total_ventas: total, numero_ventas: ventasMes.length, por_dia: porDia });
});

app.get('/api/reports/rentabilidad', requireLogin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let ventas = data.sales;
  if (desde) ventas = ventas.filter(v => v.fecha >= desde);
  if (hasta) ventas = ventas.filter(v => v.fecha <= hasta + 'T23:59:59');
  let ingresos = 0, costoTotal = 0;
  const porProducto = {};
  for (const v of ventas) {
    for (const it of v.items) {
      // El costo se toma del que quedo guardado en el momento de la venta
      // (calculado con la receta si aplica). Si es una venta antigua sin ese
      // dato, se calcula con el costo actual del producto como respaldo.
      const prod = data.products.find(p => p.id === it.product_id);
      const costoItem = it.costo_total !== undefined ? it.costo_total : (prod ? costoProducto(data, prod) * it.cantidad : 0);
      const ingresoItem = it.subtotal;
      ingresos += ingresoItem;
      costoTotal += costoItem;
      if (!porProducto[it.nombre_producto]) porProducto[it.nombre_producto] = { cantidad: 0, ingresos: 0, costo: 0 };
      porProducto[it.nombre_producto].cantidad += it.cantidad;
      porProducto[it.nombre_producto].ingresos += ingresoItem;
      porProducto[it.nombre_producto].costo += costoItem;
    }
    if (v.costo_empaque) costoTotal += v.costo_empaque;
  }
  let gastos = data.expenses;
  if (desde) gastos = gastos.filter(g => g.fecha >= desde);
  if (hasta) gastos = gastos.filter(g => g.fecha <= hasta + 'T23:59:59');
  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0);

  const ganancia = ingresos - costoTotal;
  const gananciaNeta = ganancia - totalGastos;
  const margen = ingresos > 0 ? (ganancia / ingresos) * 100 : 0;
  const margenNeto = ingresos > 0 ? (gananciaNeta / ingresos) * 100 : 0;
  res.json({
    ingresos, costo: costoTotal, ganancia, margen_porcentaje: margen,
    gastos: totalGastos, ganancia_neta: gananciaNeta, margen_neto_porcentaje: margenNeto,
    por_producto: porProducto
  });
});

app.get('/api/reports/compras', requireLogin, requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const data = cargar();
  let compras = data.purchases;
  if (desde) compras = compras.filter(c => c.fecha >= desde);
  if (hasta) compras = compras.filter(c => c.fecha <= hasta + 'T23:59:59');
  const total = compras.reduce((s, c) => s + c.total, 0);
  const porProveedor = {};
  const porItem = {};
  for (const c of compras) {
    const prov = c.proveedor || '(sin proveedor)';
    porProveedor[prov] = (porProveedor[prov] || 0) + c.total;
    for (const it of c.items) {
      if (!porItem[it.nombre]) porItem[it.nombre] = { cantidad: 0, total: 0 };
      porItem[it.nombre].cantidad += it.cantidad;
      porItem[it.nombre].total += it.subtotal;
    }
  }
  res.json({ total_comprado: total, numero_facturas: compras.length, por_proveedor: porProveedor, por_item: porItem });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log(' Sistema de comidas rapidas activo');
  console.log(' Abre tu navegador en: http://localhost:' + PORT);
  console.log(' Usuario: admin   Contrasena: admin123');
  console.log('========================================');
});
