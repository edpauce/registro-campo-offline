// Generador de Excel y CSV sin librerías (app/js/xlsx.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { cargar, leerZip } = require('./cargar');

const { XLS } = cargar('xlsx.js');
const txt = (zip, nombre) => zip[nombre].datos.toString('utf8');

const lectura = (extra) => ({
  id: 'id-' + Math.random().toString(16).slice(2, 8), punto: 'TANQUE A — LLEGADA', tipo: 'caudalometro',
  fecha: '2026-01-15', hora: '07:30', valores: { acumulado: 1234.5, instantaneo: 12.4 },
  obs: '', operador: 'Operador Demo', empresa: 'Empresa Demo', estado: 'pendiente',
  dispositivo: 'abcd1234', creado: '2026-01-15T12:30:00Z', huella: 'h1', avisos: [], ...extra
});

test('crc32 coincide con el valor de referencia', () => {
  assert.equal(XLS.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(XLS.crc32(new Uint8Array(0)), 0);
});

test('el ZIP es legible y cada CRC coincide con el de zlib', () => {
  const bytes = XLS.zip([{ nombre: 'a.txt', data: 'hola' }, { nombre: 'b/ñ.xml', data: '<x>ü</x>' }]);
  const zip = leerZip(bytes);
  assert.deepEqual(Object.keys(zip), ['a.txt', 'b/ñ.xml']);
  for (const e of Object.values(zip)) {
    assert.equal(e.metodo, 0);
    assert.equal(e.crc, zlib.crc32(e.datos));
  }
  assert.equal(txt(zip, 'b/ñ.xml'), '<x>ü</x>');
});

test('el libro trae las partes mínimas de OOXML', () => {
  const zip = leerZip(XLS.construirXLSX([{ nombre: 'Uno', filas: [['a']] }, { nombre: 'Dos', filas: [[1]] }]));
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(zip[parte], 'falta ' + parte);
  }
  assert.match(txt(zip, 'xl/workbook.xml'), /<sheet name="Uno" sheetId="1" r:id="rId1"\/><sheet name="Dos" sheetId="2" r:id="rId2"\/>/);
});

test('números como número, texto escapado y celdas vacías omitidas', () => {
  const zip = leerZip(XLS.construirXLSX([{ nombre: 'H', filas: [[42.5, 'A & B <c> "d"', null, '', 'fin']] }]));
  const hoja = txt(zip, 'xl/worksheets/sheet1.xml');
  assert.match(hoja, /<c r="A1"><v>42\.5<\/v><\/c>/);
  assert.match(hoja, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">A &amp; B &lt;c&gt; &quot;d&quot;<\/t><\/is><\/c>/);
  assert.doesNotMatch(hoja, /r="C1"|r="D1"/);
  assert.match(hoja, /<c r="E1" t="inlineStr">/);
});

test('las columnas después de la Z siguen AA, AB…', () => {
  const fila = Array.from({ length: 28 }, (_, i) => i);
  const hoja = txt(leerZip(XLS.construirXLSX([{ nombre: 'H', filas: [fila] }])), 'xl/worksheets/sheet1.xml');
  assert.match(hoja, /<c r="Z1"><v>25<\/v>/);
  assert.match(hoja, /<c r="AA1"><v>26<\/v>/);
  assert.match(hoja, /<c r="AB1"><v>27<\/v>/);
});

test('los nombres de hoja se recortan a 31 caracteres sin caracteres prohibidos', () => {
  const zip = leerZip(XLS.construirXLSX([{ nombre: 'Hoja/con:caracteres*raros?[y]muy-larga-de-verdad', filas: [] }]));
  const nombre = txt(zip, 'xl/workbook.xml').match(/<sheet name="([^"]+)"/)[1];
  assert.ok(nombre.length <= 31);
  assert.doesNotMatch(nombre, /[\\/?*[\]:]/);
});

test('los caracteres de control no llegan al XML', () => {
  const hoja = txt(leerZip(XLS.construirXLSX([{ nombre: 'H', filas: [['a\u0001b\u001Fc']] }])), 'xl/worksheets/sheet1.xml');
  assert.match(hoja, />abc</);
});

test('el libro completo arma una hoja por tipo y deja las anuladas solo en trazabilidad', () => {
  const viva = lectura({ id: 'viva-1' });
  const anulada = lectura({ id: 'anulada-1', estado: 'anulada', valores: { acumulado: 999 } });
  const pz = lectura({ id: 'pz-1', tipo: 'piezometro', punto: 'PZ-01', valores: { nivel: 41.2 } });
  const zip = leerZip(XLS.libroCompleto([viva, anulada, pz], []));
  const libro = txt(zip, 'xl/workbook.xml');
  const nombres = [...libro.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(nombres, ['Caudalimetros', 'Piezometros', 'Trazabilidad']);

  const caudal = txt(zip, 'xl/worksheets/sheet1.xml');
  assert.match(caudal, /viva-1/);
  assert.doesNotMatch(caudal, /anulada-1/);
  assert.match(txt(zip, 'xl/worksheets/sheet2.xml'), /<v>41\.2<\/v>/);
  assert.match(txt(zip, 'xl/worksheets/sheet3.xml'), /anulada-1/);
});

test('el CSV lleva BOM, comillas escapadas y omite las anuladas', () => {
  const csv = XLS.csvPlano([
    lectura({ id: 'c1', obs: 'dijo "ok", luego se fue' }),
    lectura({ id: 'c2', estado: 'anulada-enviada' })
  ]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const lineas = csv.slice(1).split('\n');
  assert.equal(lineas.length, 2);
  assert.ok(lineas[0].startsWith('id,unidad,ruta,punto,tipo,fecha,hora'));
  assert.match(lineas[1], /^"c1",/);
  assert.match(lineas[1], /"dijo ""ok"", luego se fue"/);
});

test('el CSV trae una columna por cada campo medido, sin perder parámetros', () => {
  const csv = XLS.csvPlano([
    lectura({ id: 'a', valores: { acumulado: 10 } }),
    lectura({ id: 'b', tipo: 'ptap', valores: { phSalida: 7.2, cloroSalida: 1.1 } })
  ]);
  const [cab, a, b] = csv.slice(1).split('\n').map(l => l.split(','));
  for (const c of ['acumulado', 'phSalida', 'cloroSalida']) assert.ok(cab.includes(c), 'falta ' + c);
  assert.equal(b[cab.indexOf('phSalida')], '7.2');
  assert.equal(a[cab.indexOf('phSalida')], '');
});

test('el CSV neutraliza textos que una hoja de cálculo ejecutaría como fórmula', () => {
  const csv = XLS.csvPlano([lectura({ obs: '=HYPERLINK("http://x")', operador: '@cmd' })]);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(csv, /"'@cmd"/);
});
