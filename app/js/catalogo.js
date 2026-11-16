/* =============================================================================
   CATÁLOGO DE PUNTOS DE MEDICIÓN — DEMOSTRACIÓN

   Todo lo que hay aquí es FICTICIO: una planta inventada con unos pocos puntos
   de cada tipo, para probar la app. En un despliegue real este archivo se
   reemplaza por el catálogo de la operación (rutas, puntos y orden de lectura
   según su procedimiento) y se sube el número de `version` al final.

   Cada tipo de medición define sus campos. Atributos de un campo:
     req        obligatorio
     min / max  límites físicos: fuera de ellos el valor se rechaza (rojo)
     alerta     rango operativo [desde, hasta]: fuera de él se avisa (ámbar)
     monotono   contador acumulado: no puede retroceder sin justificar
     saltoMax   variación máxima esperada frente a la lectura anterior (ámbar)
   ========================================================================== */

const TIPOS = {
  caudalometro: {
    etiqueta: 'Caudalímetro',
    icono: '⌚',
    campos: [
      { k: 'acumulado', label: 'Volumen acumulado', unidad: 'm³', req: true, decimales: 3, monotono: true },
      { k: 'instantaneo', label: 'Caudal instantáneo', unidad: 'l/s', req: false, decimales: 2, min: 0 }
    ]
  },
  piezometro: {
    etiqueta: 'Piezómetro',
    icono: '⇩',
    campos: [
      { k: 'nivel', label: 'Nivel de agua (profundidad)', unidad: 'm', req: true, decimales: 2, min: 0, max: 300, saltoMax: 5 }
    ]
  },
  pozo: {
    etiqueta: 'Pozo / bomba',
    icono: '⤒',
    campos: [
      { k: 'caudal', label: 'Caudal', unidad: 'l/s', req: true, decimales: 2, min: 0, max: 150 },
      { k: 'volumen', label: 'Volumen (totalizador)', unidad: 'm³', req: false, decimales: 0, monotono: true },
      { k: 'horas', label: 'Tiempo de bombeo', unidad: 'h', req: false, decimales: 1, min: 0, max: 24 },
      { k: 'voltios', label: 'Voltaje', unidad: 'V', req: false, decimales: 0, min: 0, max: 1000 },
      { k: 'amperios', label: 'Corriente', unidad: 'A', req: false, decimales: 1, min: 0, max: 500 },
      { k: 'nivelDinamico', label: 'Nivel dinámico', unidad: 'm', req: false, decimales: 1, min: 0 }
    ]
  },
  regla: {
    etiqueta: 'Regla / nivel de reservorio',
    icono: '▤',
    campos: [
      { k: 'regla', label: 'Lectura de regla', unidad: 'm', req: true, decimales: 2, min: 0, max: 50, saltoMax: 1 }
    ]
  },
  ptap: {
    etiqueta: 'Planta de tratamiento — control',
    icono: '⚗',
    campos: [
      { k: 'caudalIngreso', label: 'Caudal de ingreso', unidad: 'l/s', req: false, decimales: 1, min: 0, max: 500 },
      { k: 'turbidezIngreso', label: 'Turbidez de ingreso', unidad: 'NTU', req: false, decimales: 2, min: 0, max: 1000 },
      { k: 'turbidezSalida', label: 'Turbidez de salida', unidad: 'NTU', req: false, decimales: 2, min: 0, max: 50, alerta: [0, 5] },
      { k: 'cloroSalida', label: 'Cloro residual de salida', unidad: 'mg/L', req: false, decimales: 2, min: 0, max: 10, alerta: [0.5, 2.5] },
      { k: 'phSalida', label: 'pH de salida', unidad: 'pH', req: false, decimales: 2, min: 0, max: 14, alerta: [6.5, 8.5] },
      { k: 'nivelTanque', label: 'Nivel del tanque de agua tratada', unidad: '%', req: false, decimales: 0, min: 0, max: 100 },
      { k: 'horometro', label: 'Horómetro', unidad: 'h', req: false, decimales: 1, min: 0, monotono: true }
    ]
  },
  aforo: {
    etiqueta: 'Aforo / calidad de agua',
    icono: '≈',
    campos: [
      { k: 'anchoCauce', label: 'Ancho del cauce', unidad: 'm', req: false, decimales: 2, min: 0, max: 50 },
      { k: 'nSecciones', label: 'N° de secciones', unidad: '', req: false, decimales: 0, min: 1, max: 100 },
      { k: 'caudal', label: 'Caudal aforado', unidad: 'l/s', req: true, decimales: 2, min: 0 },
      { k: 'reglaInicio', label: 'Regla al inicio', unidad: 'cm', req: false, decimales: 1 },
      { k: 'reglaFin', label: 'Regla al final', unidad: 'cm', req: false, decimales: 1 },
      { k: 'ph', label: 'pH', unidad: 'pH', req: false, decimales: 2, min: 0, max: 14, alerta: [6.5, 8.5] },
      { k: 'ce', label: 'Conductividad', unidad: 'µS/cm', req: false, decimales: 0, min: 0, max: 20000 },
      { k: 'od', label: 'Oxígeno disuelto', unidad: 'mg/L', req: false, decimales: 2, min: 0, max: 20 },
      { k: 'temp', label: 'Temperatura', unidad: '°C', req: false, decimales: 1, min: -5, max: 45 },
      { k: 'turbidez', label: 'Turbidez', unidad: 'NTU', req: false, decimales: 2, min: 0, max: 5000 }
    ]
  },
  meteo: {
    etiqueta: 'Estación meteorológica',
    icono: '☂',
    campos: [
      { k: 'precipitacion', label: 'Precipitación 24 h', unidad: 'mm', req: false, decimales: 1, min: 0, max: 300 },
      { k: 'evaporacion', label: 'Evaporación 24 h', unidad: 'mm', req: false, decimales: 1, min: 0, max: 50 },
      { k: 'tempMax', label: 'T° máxima', unidad: '°C', req: false, decimales: 1, min: -30, max: 45 },
      { k: 'tempMin', label: 'T° mínima', unidad: '°C', req: false, decimales: 1, min: -30, max: 45 }
    ]
  }
};

const UNIDAD = 'PLANTA DEMO';

/* Arma los puntos de una ruta en el orden en que se leen. `defs` es una lista
   de [nombre, tipo, extras]. El id se deriva de la ruta y el nombre. */
const ruta = (rutaId, defs) =>
  defs.map(([nombre, tipo, extra], i) => ({
    id: (rutaId + '-' + nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
    nombre, tipo, ruta: rutaId, unidad: UNIDAD, orden: i + 1, ...(extra || {})
  }));

/* ============================ RUTAS ======================================== */
const RUTAS = [
  { id: 'DM-R1', unidad: UNIDAD, nombre: 'Ruta 1 — Caudalímetros de planta', procedimiento: 'PROC-DEMO-01', frecuencia: 'Diaria' },
  { id: 'DM-PZ', unidad: UNIDAD, nombre: 'Piezómetros — sector A', procedimiento: 'PROC-DEMO-02', frecuencia: 'Mensual', formato: 'F-DEMO-02', modoFoto: true },
  { id: 'DM-EX', unidad: UNIDAD, nombre: 'Pozos de bombeo', procedimiento: 'PROC-DEMO-03', frecuencia: 'Semanal', formato: 'F-DEMO-03', modoFoto: true },
  { id: 'DM-PTAP', unidad: UNIDAD, nombre: 'Planta de tratamiento de agua', procedimiento: 'PROC-DEMO-04', frecuencia: 'Por turno' },
  { id: 'DM-AF', unidad: UNIDAD, nombre: 'Aforos y calidad de agua', procedimiento: 'PROC-DEMO-05', frecuencia: 'Programada' },
  { id: 'DM-RES', unidad: UNIDAD, nombre: 'Reservorios y meteorología', procedimiento: 'PROC-DEMO-06', frecuencia: 'Diaria' }
];

/* ============================ PUNTOS ======================================= */
const PUNTOS = [].concat(
  /* En un tanque se lee primero la llegada y después las salidas: si se
     invierte el orden, el balance de consumo del tanque no cierra. */
  ruta('DM-R1', [
    ['TANQUE A — LLEGADA', 'caudalometro', { grupo: 'Tanque A', nota: 'Leer PRIMERO la llegada y luego las salidas.' }],
    ['TANQUE A — SALIDA A PROCESO', 'caudalometro', { grupo: 'Tanque A' }],
    ['TANQUE A — SALIDA A SERVICIOS', 'caudalometro', { grupo: 'Tanque A' }],
    ['LÍNEA DE RIEGO DE ÁREAS VERDES', 'caudalometro', { grupo: 'Distribución' }],
    ['TALLER DE MANTENIMIENTO', 'caudalometro', { grupo: 'Distribución' }],
    ['OFICINAS Y COMEDOR', 'caudalometro', { grupo: 'Distribución' }]
  ]),

  ruta('DM-PZ', ['PZ-01', 'PZ-02', 'PZ-03', 'PZ-04', 'PZ-05', 'PZ-06', 'PZ-07', 'PZ-08']
    .map(n => [n, 'piezometro', { formato: 'F-DEMO-02' }])),

  ruta('DM-EX', ['POZO-01', 'POZO-02', 'POZO-03', 'POZO-04']
    .map(n => [n, 'pozo', { grupo: 'Pozos', formato: 'F-DEMO-03' }])),

  ruta('DM-PTAP', [
    ['PLANTA — TREN 1', 'ptap'],
    ['PLANTA — TANQUES', 'ptap']
  ]),

  ruta('DM-AF', [
    ['RÍO DEMO — AGUAS ARRIBA', 'aforo'],
    ['RÍO DEMO — AGUAS ABAJO', 'aforo'],
    ['CANAL DE DERIVACIÓN', 'aforo']
  ]),

  ruta('DM-RES', [
    ['RESERVORIO PRINCIPAL', 'regla', { grupo: 'Reservorios' }],
    ['TOMA DE CAPTACIÓN', 'regla', { grupo: 'Reglas' }],
    ['ESTACIÓN METEOROLÓGICA', 'meteo', { nota: 'Precipitación y evaporación de las últimas 24 h.' }]
  ])
);

window.CATALOGO = {
  version: 'demo-1',
  demo: true,
  tipos: TIPOS,
  rutas: RUTAS,
  puntos: PUNTOS.map(p => ({ activo: true, ...p }))
};
