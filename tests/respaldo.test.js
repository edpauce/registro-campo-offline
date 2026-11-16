// Validación de un respaldo importado (DB.validarRespaldo en app/js/db.js).
// El respaldo llega de otro equipo por WhatsApp o USB: es dato externo.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar');

const w = cargar('catalogo.js', 'db.js');
const { validarRespaldo, FORMATO_RESPALDO } = w.DB;

const lectura = (extra) => ({
  id: '0b5c1d2e-aaaa-4bbb-8ccc-123456789abc', fecha: '2026-01-15', hora: '07:30', estado: 'pendiente',
  tipo: 'caudalometro', puntoId: 'dm-r1-tanque-a-llegada', punto: 'TANQUE A — LLEGADA',
  valores: { acumulado: 1000 }, obs: '', operador: 'Operador Demo', avisos: [], gps: null, foto: null, ...extra
});
const paquete = (extra) => ({ formato: FORMATO_RESPALDO, lecturas: [lectura()], jornadas: [], hojas: [], fotos: [], ...extra });

test('un respaldo bien formado pasa', () => {
  assert.deepEqual(validarRespaldo(paquete()), []);
});

test('un archivo que no es respaldo se rechaza', () => {
  assert.equal(validarRespaldo({ formato: 'otro' }).length, 1);
  assert.equal(validarRespaldo(null).length, 1);
});

test('HTML en la hora, la fecha o el id se rechaza (XSS al abrir la bandeja)', () => {
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ hora: '<img src=x onerror=alert(1)>' })] })).length);
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ fecha: '2026-01-15"><script>' })] })).length);
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ id: "x');alert(1);('" })] })).length);
});

test('una foto que no es una imagen en base64 se rechaza', () => {
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ foto: 'javascript:alert(1)' })] })).length);
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ foto: 'data:image/svg+xml;base64,PHN2Zz4=' })] })).length);
  assert.deepEqual(validarRespaldo(paquete({ lecturas: [lectura({ foto: 'data:image/jpeg;base64,/9j/4AAQ' })] })), []);
});

test('valores no numéricos, GPS malformado o tipo desconocido se rechazan', () => {
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ valores: { acumulado: '1<b>' } })] })).length);
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ gps: { lat: 'x' } })] })).length);
  assert.ok(validarRespaldo(paquete({ lecturas: [lectura({ tipo: 'otro' })] })).length);
});

test('una hoja sin lista de fotos se rechaza', () => {
  const hoja = { id: 'h1', fecha: '2026-01-15', hora: '08:00', puntoIds: ['dm-pz-pz-01'], obs: '', operador: 'X' };
  assert.ok(validarRespaldo(paquete({ hojas: [hoja] })).length);
  assert.deepEqual(validarRespaldo(paquete({ hojas: [{ ...hoja, fotoIds: [] }] })), []);
});
