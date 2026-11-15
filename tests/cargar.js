// Carga los scripts de la app (pensados para el navegador) dentro de Node.
// Los archivos publican su API en `window`; aquí `window` es el propio global.
// Solo se ejercita lo que no depende del navegador: validaciones y generación
// de Excel/CSV. IndexedDB, service worker y cámara se prueban en el navegador.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', 'app', 'js');

function cargar(...archivos) {
  if (!globalThis.window) globalThis.window = globalThis;
  for (const a of archivos) {
    const ruta = path.join(RAIZ, a);
    vm.runInThisContext(fs.readFileSync(ruta, 'utf8'), { filename: ruta });
  }
  return globalThis.window;
}

/* Lector mínimo de ZIP "store" (sin compresión), escrito aparte del generador
   para no validar el código con el mismo código. Devuelve { nombre: Buffer }. */
function leerZip(bytes) {
  const buf = Buffer.from(bytes);
  const fin = buf.length - 22;
  if (buf.readUInt32LE(fin) !== 0x06054b50) throw new Error('sin registro de fin de directorio');
  const n = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('entrada de directorio central inválida');
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tam = buf.readUInt32LE(p + 20);
    const lnom = buf.readUInt16LE(p + 28);
    const lextra = buf.readUInt16LE(p + 30);
    const lcom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lnom);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('cabecera local inválida: ' + nombre);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    salida[nombre] = { metodo, crc, datos: buf.subarray(inicio, inicio + tam) };
    p += 46 + lnom + lextra + lcom;
  }
  return salida;
}

module.exports = { cargar, leerZip };
