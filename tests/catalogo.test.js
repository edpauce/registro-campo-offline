// Coherencia del catálogo de demostración (app/js/catalogo.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar');

const { CATALOGO } = cargar('catalogo.js');

test('el catálogo está marcado como demostración y tiene versión', () => {
  assert.equal(CATALOGO.demo, true);
  assert.ok(CATALOGO.version);
});

test('los ids de punto son únicos y seguros para la URL', () => {
  const ids = CATALOGO.puntos.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach(id => assert.match(id, /^[a-z0-9-]+$/));
});

test('cada punto apunta a un tipo y una ruta que existen', () => {
  const rutas = new Set(CATALOGO.rutas.map(r => r.id));
  CATALOGO.puntos.forEach(p => {
    assert.ok(CATALOGO.tipos[p.tipo], `${p.id}: tipo ${p.tipo}`);
    assert.ok(rutas.has(p.ruta), `${p.id}: ruta ${p.ruta}`);
  });
});

test('cada ruta tiene puntos con orden 1..n sin huecos', () => {
  CATALOGO.rutas.forEach(r => {
    const ordenes = CATALOGO.puntos.filter(p => p.ruta === r.id).map(p => p.orden).sort((a, b) => a - b);
    assert.ok(ordenes.length, `${r.id} sin puntos`);
    assert.deepEqual(ordenes, ordenes.map((_, i) => i + 1));
  });
});

test('hay al menos un punto de cada tipo de medición', () => {
  const usados = new Set(CATALOGO.puntos.map(p => p.tipo));
  Object.keys(CATALOGO.tipos).forEach(t => assert.ok(usados.has(t), `sin puntos de tipo ${t}`));
});

test('en el tanque la llegada se lee antes que las salidas', () => {
  const tanque = CATALOGO.puntos.filter(p => p.grupo === 'Tanque A').sort((a, b) => a.orden - b.orden);
  assert.match(tanque[0].nombre, /LLEGADA/);
});
