/* =============================================================================
   XLSX.JS — Generador de Excel (.xlsx) 100 % offline, sin librerías externas.

   El equipo de campo puede exportar el archivo listo para cargarlo en su
   sistema aunque el teléfono no haya visto internet en tres días. Se escribe
   un ZIP (método "store", sin compresión) con la estructura mínima de OOXML.
   ========================================================================== */

/* --------------------------------------------------------------- CRC32 ---- */
const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ----------------------------------------------------------------- ZIP ---- */
function zip(archivos) {
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  const FECHA = 22561; // 2024-01-01 en formato MS-DOS

  archivos.forEach(f => {
    const nombre = enc.encode(f.nombre);
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nombre.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, FECHA, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nombre.length, true); lv.setUint16(28, 0, true);
    local.set(nombre, 30);

    const cen = new Uint8Array(46 + nombre.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, FECHA, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nombre.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(nombre, 46);

    partes.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  });

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, archivos.length, true); fv.setUint16(10, archivos.length, true);
  fv.setUint32(12, cdSize, true); fv.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const salida = new Uint8Array(total);
  let p = 0;
  partes.concat(central, [fin]).forEach(x => { salida.set(x, p); p += x.length; });
  return salida;
}

/* ---------------------------------------------------------------- OOXML --- */
const escX = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function colLetra(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

function hojaXML(filas) {
  const cuerpo = filas.map((fila, i) => {
    const celdas = fila.map((v, j) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colLetra(j + 1) + (i + 1);
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escX(v)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}">${celdas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cuerpo}</sheetData></worksheet>`;
}

/* hojas = [{nombre, filas:[[...]]}]  →  Uint8Array con el .xlsx completo */
function construirXLSX(hojas) {
  const nombres = hojas.map((h, i) => (h.nombre || ('Hoja' + (i + 1))).slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, '-'));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${nombres.map((n, i) => `<sheet name="${escX(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;

  return zip([
    { nombre: '[Content_Types].xml', data: contentTypes },
    { nombre: '_rels/.rels', data: rels },
    { nombre: 'xl/workbook.xml', data: workbook },
    { nombre: 'xl/_rels/workbook.xml.rels', data: wbRels },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, data: hojaXML(h.filas) }))
  ]);
}

/* ============ ARMADO DE LAS HOJAS: UNA POR TIPO DE REGISTRO ================
   En un despliegue real, el título y las columnas de cada hoja se ajustan
   al formato oficial que la operación ya usa en papel.
   ========================================================================== */

const num = v => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/* Caudalímetros */
function hojaCaudalimetros(lecturas) {
  const filas = [
    ['LECTURAS DE CAUDALÍMETROS'],
    ['PUNTO', 'FECHA', 'HORA', 'ACUMULADO (m³)', 'CAUDAL INSTANTÁNEO (l/s)', 'OBSERVACIONES', 'OPERADOR', 'ESTADO DEL EQUIPO', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'caudalometro').forEach(l => {
    filas.push([l.punto, l.fecha, l.hora, num(l.valores.acumulado), num(l.valores.instantaneo),
      [l.obs, l.anomalia].filter(Boolean).join(' | '), l.operador, l.estadoEquipo, l.id]);
  });
  return { nombre: 'Caudalimetros', filas };
}

/* Piezómetros */
function hojaPiezometros(lecturas) {
  const filas = [
    ['LECTURAS DE PIEZÓMETROS'],
    ['PIEZÓMETRO', 'FECHA', 'HORA', 'NIVEL (m)', 'OBSERVACIONES', 'OPERADOR', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'piezometro').forEach(l =>
    filas.push([l.punto, l.fecha, l.hora, num(l.valores.nivel), l.obs, l.operador, l.id]));
  return { nombre: 'Piezometros', filas };
}

/* Pozos y bombas */
function hojaPozos(lecturas) {
  const filas = [
    ['LECTURAS DE POZOS Y BOMBAS'],
    ['POZO', 'FECHA', 'HORA', 'CAUDAL (l/s)', 'VOLUMEN (m³)', 'HORAS DE BOMBEO', 'VOLTAJE (V)', 'CORRIENTE (A)', 'NIVEL DINÁMICO (m)', 'OBSERVACIONES', 'OPERADOR', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'pozo').forEach(l =>
    filas.push([l.punto, l.fecha, l.hora, num(l.valores.caudal), num(l.valores.volumen),
      num(l.valores.horas), num(l.valores.voltios), num(l.valores.amperios), num(l.valores.nivelDinamico), l.obs, l.operador, l.id]));
  return { nombre: 'Pozos', filas };
}

/* Planta de tratamiento */
function hojaPTAP(lecturas) {
  const filas = [
    ['LECTURAS DE LA PLANTA DE TRATAMIENTO'],
    ['PUNTO', 'FECHA', 'HORA', 'CAUDAL DE INGRESO (l/s)', 'TURBIDEZ DE INGRESO (NTU)', 'TURBIDEZ DE SALIDA (NTU)',
      'CLORO RESIDUAL (mg/L)', 'pH DE SALIDA', 'NIVEL DEL TANQUE (%)', 'HORÓMETRO (h)', 'OBSERVACIONES', 'OPERADOR', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'ptap').forEach(l => {
    const v = l.valores;
    filas.push([l.punto, l.fecha, l.hora, num(v.caudalIngreso), num(v.turbidezIngreso), num(v.turbidezSalida),
      num(v.cloroSalida), num(v.phSalida), num(v.nivelTanque), num(v.horometro), l.obs, l.operador, l.id]);
  });
  return { nombre: 'Planta de tratamiento', filas };
}

/* Aforos y calidad de agua */
function hojaAforos(lecturas) {
  const filas = [
    ['AFOROS Y CALIDAD DE AGUA'],
    ['PUNTO', 'FECHA', 'HORA', 'ANCHO (m)', 'N° DE SECCIONES', 'CAUDAL (l/s)', 'REGLA INICIAL (cm)', 'REGLA FINAL (cm)',
      'pH', 'CONDUCTIVIDAD (µS/cm)', 'OXÍGENO DISUELTO (mg/L)', 'TEMPERATURA (°C)', 'TURBIDEZ (NTU)', 'GPS', 'OBSERVACIONES', 'OPERADOR', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'aforo').forEach(l => {
    const v = l.valores;
    filas.push([l.punto, l.fecha, l.hora, num(v.anchoCauce), num(v.nSecciones), num(v.caudal),
      num(v.reglaInicio), num(v.reglaFin), num(v.ph), num(v.ce), num(v.od), num(v.temp), num(v.turbidez),
      l.gps ? `${l.gps.lat.toFixed(5)}, ${l.gps.lon.toFixed(5)}` : '', l.obs, l.operador, l.id]);
  });
  return { nombre: 'Aforos y calidad', filas };
}

/* Reservorios (reglas) y meteorología comparten hoja */
function hojaReglasMeteo(lecturas) {
  const filas = [
    ['RESERVORIOS Y METEOROLOGÍA'],
    ['PUNTO', 'TIPO', 'FECHA', 'HORA', 'REGLA (m)', 'PRECIPITACIÓN (mm)', 'EVAPORACIÓN (mm)', 'T° MÁXIMA', 'T° MÍNIMA',
      'OBSERVACIONES', 'OPERADOR', 'ID REGISTRO']
  ];
  lecturas.filter(l => l.tipo === 'regla' || l.tipo === 'meteo').forEach(l => {
    const v = l.valores;
    filas.push([l.punto, l.tipo, l.fecha, l.hora, num(v.regla),
      num(v.precipitacion), num(v.evaporacion), num(v.tempMax), num(v.tempMin), l.obs, l.operador, l.id]);
  });
  return { nombre: 'Reservorios y meteorologia', filas };
}

/* Hoja de trazabilidad: lo que pide una auditoría ISO cuando pregunta
   "¿cómo sé que este número lo tomó esa persona, ese día, en ese punto?" */
function hojaTrazabilidad(lecturas, jornadas) {
  const filas = [
    ['TRAZABILIDAD DEL REGISTRO — ISO 9001 7.5 / ISO 14001 9.1 / ISO 45001'],
    ['ID REGISTRO', 'PUNTO', 'FECHA', 'HORA', 'OPERADOR', 'EMPRESA', 'DISPOSITIVO', 'GPS', 'FOTO', 'ORIGEN',
      'ALERTAS DE VALIDACIÓN', 'ESTADO', 'CREADO (UTC)', 'ENVIADO (UTC)', 'CORRIGE A', 'HUELLA', 'RECORRIDO / CHEQUEO PREVIO']
  ];
  const jx = {}; (jornadas || []).forEach(j => { jx[j.id] = j; });
  lecturas.forEach(l => {
    const j = jx[l.jornadaId];
    filas.push([l.id, l.punto, l.fecha, l.hora, l.operador, l.empresa, l.dispositivo,
      l.gps ? `${l.gps.lat.toFixed(5)}, ${l.gps.lon.toFixed(5)} (±${Math.round(l.gps.prec || 0)} m)` : 'sin GPS',
      l.foto || l.fotoId ? 'sí' : 'no',
      l.origen === 'foto-hoja' ? 'transcrito de foto de hoja/panel' : 'digitado en el punto',
      (l.avisos || []).map(a => `[${a.nivel}] ${a.msg}`).join(' · '),
      l.estado, l.creado, l.enviadoEl || '', l.editadoDe || '', l.huella,
      j ? `${j.id.slice(0, 8)} · ${j.rutaId} · checklist ${j.checklist && j.checklist.ok ? 'conforme' : 'con observaciones'}` : '']);
  });
  return { nombre: 'Trazabilidad', filas };
}

function libroCompleto(lecturas, jornadas) {
  const hojas = [];
  const vivas = lecturas.filter(l => !String(l.estado).startsWith('anulada'));
  if (vivas.some(l => l.tipo === 'caudalometro')) hojas.push(hojaCaudalimetros(vivas));
  if (vivas.some(l => l.tipo === 'piezometro')) hojas.push(hojaPiezometros(vivas));
  if (vivas.some(l => l.tipo === 'pozo')) hojas.push(hojaPozos(vivas));
  if (vivas.some(l => l.tipo === 'ptap')) hojas.push(hojaPTAP(vivas));
  if (vivas.some(l => l.tipo === 'aforo')) hojas.push(hojaAforos(vivas));
  if (vivas.some(l => l.tipo === 'regla' || l.tipo === 'meteo')) hojas.push(hojaReglasMeteo(vivas));
  hojas.push(hojaTrazabilidad(lecturas, jornadas));
  if (!hojas.length) hojas.push({ nombre: 'Sin datos', filas: [['No hay lecturas en el rango seleccionado']] });
  return construirXLSX(hojas);
}

/* CSV plano para carga directa a una base de datos o a otro sistema.
   Una columna por cada campo medido que aparezca en las lecturas exportadas.
   Un texto que empieza con = + - @ se prefija con ' para que una hoja de
   cálculo no lo ejecute como fórmula. */
function csvPlano(lecturas) {
  const vivas = lecturas.filter(l => !String(l.estado).startsWith('anulada'));
  const campos = [];
  vivas.forEach(l => Object.keys(l.valores || {}).forEach(k => { if (!campos.includes(k)) campos.push(k); }));
  const cab = ['id', 'unidad', 'ruta', 'punto', 'tipo', 'fecha', 'hora', ...campos,
    'no_medido', 'observacion', 'operador', 'estado', 'huella'];
  const q = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const t = /^[=+\-@\t\r]/.test(String(v)) ? "'" + v : String(v);
    return `"${t.replace(/"/g, '""')}"`;
  };
  const filas = vivas.map(l => [
    l.id, l.unidad, l.rutaId, l.punto, l.tipo, l.fecha, l.hora,
    ...campos.map(k => (l.valores || {})[k]),
    l.noMedido, l.obs, l.operador, l.estado, l.huella
  ].map(q).join(','));
  return '\uFEFF' + cab.join(',') + '\n' + filas.join('\n');
}

window.XLS = { construirXLSX, libroCompleto, csvPlano, zip, crc32 };
