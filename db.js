// db.js - Base de datos simple basada en archivo JSON (sin compilaciones nativas,
// facil de instalar en cualquier PC con Node.js).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function estructuraInicial() {
  return {
    users: [
      {
        id: 1,
        username: 'admin',
        password: bcrypt.hashSync('admin123', 10),
        nombre: 'Administrador',
        rol: 'admin',
        activo: true
      }
    ],
    products: [],
    insumos: [],
    sales: [],
    purchases: [],
    adjustments: [],
    expenses: [],
    movimientos: [],
    errorLog: [],
    promotions: [],
    arqueos: [],
    mesas: [],
    cuentasMesa: [],
    empleados: [],
    turnos: [],
    abonosNomina: [],
    liquidacionesNomina: [],
    config: { empaqueLlevar: [] },
    seq: { users: 1, products: 0, insumos: 0, sales: 0, purchases: 0, adjustments: 0, expenses: 0, movimientos: 0, errorLog: 0, promotions: 0, arqueos: 0, mesas: 0, cuentasMesa: 0, cuentaItems: 0, empleados: 0, turnos: 0, abonosNomina: 0, liquidacionesNomina: 0 }
  };
}

function cargar() {
  if (!fs.existsSync(DB_PATH)) {
    guardar(estructuraInicial());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  const data = JSON.parse(raw);
  // Migracion automatica: si la base de datos es de una version anterior,
  // se completan los campos que falten para que no se rompa nada.
  let cambio = false;
  if (!data.insumos) { data.insumos = []; cambio = true; }
  if (!data.expenses) { data.expenses = []; cambio = true; }
  if (!data.movimientos) { data.movimientos = []; cambio = true; }
  if (!data.errorLog) { data.errorLog = []; cambio = true; }
  if (!data.promotions) { data.promotions = []; cambio = true; }
  if (!data.arqueos) { data.arqueos = []; cambio = true; }
  if (!data.mesas) { data.mesas = []; cambio = true; }
  if (!data.cuentasMesa) { data.cuentasMesa = []; cambio = true; }
  if (!data.empleados) { data.empleados = []; cambio = true; }
  if (!data.turnos) { data.turnos = []; cambio = true; }
  if (!data.abonosNomina) { data.abonosNomina = []; cambio = true; }
  if (!data.liquidacionesNomina) { data.liquidacionesNomina = []; cambio = true; }
  if (!data.config) { data.config = { empaqueLlevar: [] }; cambio = true; }
  if (!data.config.empaqueLlevar) { data.config.empaqueLlevar = []; cambio = true; }
  if (!data.seq) data.seq = {};
  if (data.seq.insumos === undefined) { data.seq.insumos = 0; cambio = true; }
  if (data.seq.expenses === undefined) { data.seq.expenses = 0; cambio = true; }
  if (data.seq.movimientos === undefined) { data.seq.movimientos = 0; cambio = true; }
  if (data.seq.errorLog === undefined) { data.seq.errorLog = 0; cambio = true; }
  if (data.seq.promotions === undefined) { data.seq.promotions = 0; cambio = true; }
  if (data.seq.arqueos === undefined) { data.seq.arqueos = 0; cambio = true; }
  if (data.seq.mesas === undefined) { data.seq.mesas = 0; cambio = true; }
  if (data.seq.cuentasMesa === undefined) { data.seq.cuentasMesa = 0; cambio = true; }
  if (data.seq.cuentaItems === undefined) { data.seq.cuentaItems = 0; cambio = true; }
  if (data.seq.empleados === undefined) { data.seq.empleados = 0; cambio = true; }
  if (data.seq.turnos === undefined) { data.seq.turnos = 0; cambio = true; }
  if (data.seq.abonosNomina === undefined) { data.seq.abonosNomina = 0; cambio = true; }
  if (data.seq.liquidacionesNomina === undefined) { data.seq.liquidacionesNomina = 0; cambio = true; }
  // Los gastos antiguos no tenian metodo de pago (se asume Efectivo, lo mas comun)
  (data.expenses || []).forEach(g => {
    if (g.metodo_pago === undefined) { g.metodo_pago = 'Efectivo'; cambio = true; }
    if (g.tipo === undefined) { g.tipo = 'fijo'; cambio = true; }
  });
  // Los insumos antiguos no tenian unidad de uso/equivalencia (conversion)
  (data.insumos || []).forEach(i => {
    if (i.unidad_uso === undefined) { i.unidad_uso = i.unidad || 'unidad'; cambio = true; }
    if (i.equivalencia === undefined) { i.equivalencia = 1; cambio = true; }
  });
  if (cambio) guardar(data);
  return data;
}

function guardar(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function siguienteId(data, coleccion) {
  data.seq[coleccion] = (data.seq[coleccion] || 0) + 1;
  return data.seq[coleccion];
}

module.exports = { cargar, guardar, siguienteId, DB_PATH };
