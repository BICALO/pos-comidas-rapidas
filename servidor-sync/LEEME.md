# Servidor de respaldo (nube) para la app Android

Recibe y guarda las copias que envía la app cuando tiene internet. No necesita `npm install`: requiere Node.js 18 o superior.

```bash
SYNC_TOKEN="una-clave-larga-y-secreta" node servidor.js
```

| Variable | Para qué |
|---|---|
| `SYNC_TOKEN` | **Obligatoria.** La misma clave que escribes en la app (mínimo 8 caracteres). |
| `PORT` | Puerto (por defecto 4000; la mayoría de servicios en la nube lo asignan solos). |
| `CARPETA_DATOS` | Dónde guardar los respaldos (por defecto `./datos`). Debe ser un disco **persistente**. |
| `HISTORIAL` | Cuántas copias por hora conservar (por defecto 72). |

Qué guarda en `datos/`:

- `ultimo.json`: el último respaldo. Es un `db.json` idéntico al del PC.
- `meta.json`: de qué teléfono vino, cuándo y un resumen (cuántos productos y ventas).
- `historial/`: una copia por hora, para recuperar datos si algo sale mal.

Para descargar el último respaldo como `db.json` (y llevarlo al PC), abre en el navegador:
`https://TU-SERVIDOR/api/respaldo/db.json?token=TU_CLAVE`
