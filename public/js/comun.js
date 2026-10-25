async function api(url, opciones = {}) {
  const res = await fetch(url, {
    headers: opciones.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opciones
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

function pintarNav(activo, user) {
  const links = [
    { href: 'dashboard.html', txt: 'Inicio', roles: ['admin', 'vendedor'] },
    { href: 'ventas.html', txt: 'Vender', roles: ['admin', 'vendedor'] },
    { href: 'mesas.html', txt: 'Mesas', roles: ['admin', 'vendedor'] },
    { href: 'productos.html', txt: 'Productos', roles: ['admin'] },
    { href: 'insumos.html', txt: 'Insumos', roles: ['admin'] },
    { href: 'inventario.html', txt: 'Inventario', roles: ['admin'] },
    { href: 'promociones.html', txt: 'Promociones', roles: ['admin'] },
    { href: 'gastos.html', txt: 'Gastos', roles: ['admin'] },
    { href: 'nomina.html', txt: 'Nómina', roles: ['admin'] },
    { href: 'caja.html', txt: 'Caja', roles: ['admin'] },
    { href: 'reportes.html', txt: 'Reportes', roles: ['admin'] },
    { href: 'usuarios.html', txt: 'Usuarios', roles: ['admin'] }
  ];
  const nav = document.getElementById('nav');
  nav.innerHTML = links
    .filter(l => l.roles.includes(user.rol))
    .map(l => `<a href="${l.href}" class="${activo === l.href ? 'active' : ''}">${l.txt}</a>`)
    .join('');
  document.getElementById('userinfo').innerHTML =
    `${user.nombre} <span class="badge ${user.rol === 'admin' ? 'admin' : ''}">${user.rol}</span>
     <button class="small secondary" onclick="cerrarSesion()">Salir</button>`;
}

async function protegerPagina(activo, rolesPermitidos) {
  try {
    const { user } = await api('/api/session');
    if (!user) { window.location.href = 'login.html'; return null; }
    if (rolesPermitidos && !rolesPermitidos.includes(user.rol)) {
      window.location.href = 'dashboard.html';
      return null;
    }
    pintarNav(activo, user);
    return user;
  } catch (e) {
    window.location.href = 'login.html';
    return null;
  }
}

async function cerrarSesion() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = 'login.html';
}

function moneda(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

// IMPORTANTE: usar SIEMPRE esta funcion para "hoy", nunca
// new Date().toISOString().slice(0,10), porque esa siempre da la fecha en
// UTC y en Colombia (UTC-5) puede mostrar el dia siguiente por la noche.
function fechaHoyLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
