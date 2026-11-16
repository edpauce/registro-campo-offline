// Validaciones en el punto de medición (DB.validar en app/js/db.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar');

const w = cargar('catalogo.js', 'db.js');
const { validar, hoyISO } = w.DB;
const CFG = { toleranciaDelta: 40 };

const punto = (tipo) => w.CATALOGO.puntos.find(p => p.tipo === tipo);
const haceDias = (n) => hoyISO(new Date(Date.now() - n * 86400000));
const niveles = (avisos) => avisos.map(a => a.nivel);

test('un campo obligatorio vacío se rechaza', () => {
  const avisos = validar(punto('caudalometro'), {}, null, CFG);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].nivel, 'rojo');
  assert.equal(avisos[0].campo, 'acumulado');
});

test('un valor fuera del límite físico se rechaza', () => {
  const avisos = validar(punto('piezometro'), { nivel: -3 }, null, CFG);
  assert.deepEqual(niveles(avisos), ['rojo']);
  assert.match(avisos[0].msg, /mínimo físico/);
});

test('un valor fuera del rango operativo solo avisa', () => {
  const avisos = validar(punto('ptap'), { phSalida: 9.2 }, null, CFG);
  assert.deepEqual(niveles(avisos), ['ambar']);
  assert.match(avisos[0].msg, /rango operativo/);
});

test('valores normales no generan avisos', () => {
  assert.deepEqual(validar(punto('ptap'), { phSalida: 7.4, cloroSalida: 1.1 }, null, CFG), []);
  assert.deepEqual(validar(punto('caudalometro'), { acumulado: 1000 }, null, CFG), []);
});

test('el acumulado que retrocede bloquea y exige motivo', () => {
  const ultimo = { fecha: haceDias(2), valores: { acumulado: 5000 } };
  const avisos = validar(punto('caudalometro'), { acumulado: 4990 }, ultimo, CFG);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].nivel, 'rojo');
  assert.equal(avisos[0].requiereMotivo, true);
});

test('el acumulado que no varía avisa de equipo trabado', () => {
  const ultimo = { fecha: haceDias(1), valores: { acumulado: 5000 } };
  const avisos = validar(punto('caudalometro'), { acumulado: 5000 }, ultimo, CFG);
  assert.deepEqual(niveles(avisos), ['ambar']);
  assert.match(avisos[0].msg, /no varió/);
});

test('un consumo diario lejos del histórico avisa según la tolerancia', () => {
  // histórico 100 m³/día; hoy 200 m³/día en un día = 100 % de desviación
  const ultimo = { fecha: haceDias(1), valores: { acumulado: 5000 }, deltaDiaProm: 100 };
  const avisos = validar(punto('caudalometro'), { acumulado: 5200 }, ultimo, CFG);
  assert.deepEqual(niveles(avisos), ['ambar']);
  assert.match(avisos[0].msg, /desviación/);
  // con tolerancia de 150 % ya no avisa
  assert.deepEqual(validar(punto('caudalometro'), { acumulado: 5200 }, ultimo, { toleranciaDelta: 150 }), []);
});

test('un consumo dentro de la tolerancia no avisa', () => {
  const ultimo = { fecha: haceDias(2), valores: { acumulado: 5000 }, deltaDiaProm: 100 };
  assert.deepEqual(validar(punto('caudalometro'), { acumulado: 5220 }, ultimo, CFG), []);
});

test('un salto brusco de nivel frente a la lectura anterior avisa', () => {
  const ultimo = { fecha: haceDias(30), valores: { nivel: 40 } };
  const avisos = validar(punto('piezometro'), { nivel: 47.5 }, ultimo, CFG);
  assert.deepEqual(niveles(avisos), ['ambar']);
  assert.match(avisos[0].msg, /Variación de 7\.5 m/);
  assert.deepEqual(validar(punto('piezometro'), { nivel: 42 }, ultimo, CFG), []);
});

test('un texto no numérico se rechaza', () => {
  const avisos = validar(punto('pozo'), { caudal: 'abc' }, null, CFG);
  assert.equal(avisos[0].nivel, 'rojo');
  assert.match(avisos[0].msg, /no numérico/);
});

test('un tipo de punto desconocido no rompe la validación', () => {
  assert.deepEqual(validar({ tipo: 'inexistente' }, { x: 1 }, null, CFG), []);
});

test('hoyISO devuelve AAAA-MM-DD', () => {
  assert.match(hoyISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('hoyISO usa la fecha local: a las 22:00 en UTC-5 sigue siendo el mismo día', () => {
  const tzAntes = process.env.TZ;
  process.env.TZ = 'Etc/GMT+5';   // UTC-5 (el signo de Etc/ va invertido)
  try {
    // 03:00 UTC del 15-ene = 22:00 del 14-ene en UTC-5
    assert.equal(hoyISO(new Date('2026-01-15T03:00:00Z')), '2026-01-14');
    assert.equal(hoyISO(new Date('2026-01-15T12:00:00Z')), '2026-01-15');
  } finally {
    if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes;
  }
});
