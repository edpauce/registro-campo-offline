// Prueba de punta a punta en Chrome headless, vía DevTools Protocol, sin dependencias.
//
//   1. Sirve app/ con un servidor propio y la carga con red: se instala el service worker.
//   2. Corta la red en el navegador y APAGA el servidor.
//   3. Recarga: la app debe abrir desde la caché.
//   4. Registra lecturas sin conexión, incluido el bloqueo del acumulado que retrocede.
//   5. Exporta el Excel y verifica que el archivo es un ZIP/OOXML válido.
//
// Uso:  node tests/e2e/sin-conexion.mjs        (CHROME=/ruta/al/chrome para otro binario)
//       CAPTURAS=dir  guarda capturas de pantalla en ese directorio.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { leerZip } = createRequire(import.meta.url)('../cargar.js');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-campo-e2e-'));
const DESCARGAS = path.join(TMP, 'descargas');
const CAPTURAS = process.env.CAPTURAS || null;
fs.mkdirSync(DESCARGAS);
if (CAPTURAS) fs.mkdirSync(CAPTURAS, { recursive: true });

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('No encontré Chrome. Indique la ruta con CHROME=…'); process.exit(2); }

const esperar = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { if (!cond) throw new Error('FALLÓ: ' + msg); console.log('  ✓', msg); };

/* ---------- servidor estático mínimo ---------- */
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404).end(); return;
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const URL_APP = `http://127.0.0.1:${servidor.address().port}/`;

/* ---------- Chrome + CDP ---------- */
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(TMP, 'perfil')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-sandbox', '--lang=es-PE', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const wsBrowser = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); });
  setTimeout(() => rej(new Error('Chrome no expuso DevTools a tiempo')), 20000);
});
const puertoCdp = new URL(wsBrowser).port;

let ws, id = 0; const pend = new Map(), dialogos = [];
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const hasta = async (expr, msg, ms = 10000) => {
  for (const fin = Date.now() + ms; Date.now() < fin; await esperar(100)) {
    try { if (await ev(expr)) return; } catch { /* la página puede estar recargando */ }
  }
  throw new Error('FALLÓ (tiempo agotado): ' + msg);
};
const captura = async (nombre) => {
  if (!CAPTURAS) return;
  await ev(`document.querySelectorAll('.toast').forEach(t => t.remove())`);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(CAPTURAS, nombre + '.png'), Buffer.from(data, 'base64'));
};
const hash = () => ev(`location.hash.replace('#/', '#')`);

let codigo = 0;
try {
  const pagina = (await (await fetch(`http://127.0.0.1:${puertoCdp}/json`)).json()).find(t => t.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Page.javascriptDialogOpening') {       // confirm()/prompt() de la app: se aceptan
      dialogos.push(d.params.message);
      cdp('Page.handleJavaScriptDialog', { accept: true, promptText: '' });
    }
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DESCARGAS });

  console.log('1. Primera carga con red');
  await cdp('Page.navigate', { url: URL_APP });
  await hasta(`typeof DB === 'object' && document.querySelector('#app .tarjeta') !== null`, 'la app carga');
  await hasta(`navigator.serviceWorker.ready.then(() => caches.keys()).then(async k => k.length && (await (await caches.open(k[0])).keys()).length >= 10)`,
    'el service worker guarda la app en caché', 20000);
  ok(true, 'service worker instalado y app en caché');

  console.log('2. Sin red y sin servidor');
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  servidor.closeAllConnections(); await new Promise(r => servidor.close(r));
  ok(await fetch(URL_APP).then(() => false, () => true), 'servidor apagado');

  console.log('3. Recarga');
  await cdp('Page.reload', {});
  await hasta(`typeof DB === 'object' && document.querySelector('#app .tarjeta') !== null`, 'la app abre desde la caché');
  ok(await ev('navigator.onLine') === false, 'la app abre sin red ni servidor y se sabe sin conexión');
  await hasta(`document.getElementById('chipRed').textContent === 'Sin conexión'`, 'chip "Sin conexión"');
  await captura('1-inicio-sin-conexion');

  console.log('4. Registro sin conexión');
  await ev(`location.hash = '#/iniciar/DM-R1'`);
  await hasta(`!!document.getElementById('inOperador')`, 'pantalla de chequeo previo');
  await ev(`document.getElementById('inOperador').value = 'Operador Demo';
            document.querySelectorAll('#checks input').forEach(c => c.checked = true); confirmarInicio()`);
  await hasta(`location.hash.replace('#/', '#') === '#ruta'`, 'recorrido iniciado');
  ok(true, 'recorrido iniciado con chequeo previo conforme');

  const p1 = 'dm-r1-tanque-a-llegada';
  await ev(`location.hash = '#/captura/${p1}'`);
  await hasta(`!!document.getElementById('c_acumulado')`, 'formulario del punto');
  await ev(`document.getElementById('c_acumulado').value = '15230.5';
            document.getElementById('c_instantaneo').value = '12.4'; guardarCaptura('${p1}')`);
  await hasta(`DB.pendientes().then(l => l.length === 1)`, 'lectura guardada');
  ok(true, 'lectura guardada en el equipo (1 pendiente de envío)');
  await hasta(`location.hash.replace('#/', '#') === '#captura/dm-r1-tanque-a-salida-a-proceso'`, 'salto al siguiente punto');
  ok(true, 'pasa solo al siguiente punto del recorrido');
  ok(await ev(`DB.todos(DB.S.LECTURAS).then(l => l[0].fecha === DB.hoyISO())`), 'la lectura lleva la fecha local del equipo');

  await ev(`location.hash = '#/captura/${p1}'`);
  await hasta(`!!document.getElementById('c_acumulado') && document.getElementById('c_acumulado').value === ''`, 'formulario limpio');
  await ev(`document.getElementById('c_acumulado').value = '15100'; revalidar('${p1}')`);
  await hasta(`/acumulado bajó/.test(document.getElementById('avisos').textContent)`, 'aviso de retroceso');
  ok(true, 'avisa en rojo que el acumulado bajó');
  await captura('2-acumulado-retrocede');
  await ev(`guardarCaptura('${p1}')`); await esperar(500);
  ok(await ev(`DB.todos(DB.S.LECTURAS).then(l => l.length)`) === 1, 'sin justificar, el retroceso NO se guarda');

  await ev(`document.getElementById('inObs').value = 'Cambio de caudalímetro'; guardarCaptura('${p1}')`);
  await hasta(`DB.todos(DB.S.LECTURAS).then(l => l.length === 2)`, 'corrección guardada');
  const estados = await ev(`DB.todos(DB.S.LECTURAS).then(l => l.map(x => x.estado).sort().join(','))`);
  ok(estados === 'anulada,pendiente', 'con motivo, se guarda como corrección y la anterior queda anulada');
  ok(dialogos.some(d => /contradice la lectura anterior/.test(d)), 'pide confirmación antes de guardar la corrección');

  console.log('5. Exportar Excel sin conexión');
  await ev(`location.hash = '#/exportar'`);
  await hasta(`!!document.getElementById('selRango')`, 'pantalla de exportación');
  await captura('3-exportar');
  await ev(`navigator.canShare = undefined; document.getElementById('selRango').value = 'todo'; exportar('xlsx')`);
  let archivo;
  for (const fin = Date.now() + 10000; !archivo && Date.now() < fin; await esperar(100)) {
    archivo = fs.readdirSync(DESCARGAS).find(f => f.endsWith('.xlsx'));
  }
  ok(!!archivo, 'Excel generado y descargado: ' + archivo);
  const bytes = fs.readFileSync(path.join(DESCARGAS, archivo));
  const partes = leerZip(bytes);
  for (const p of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) ok(!!partes[p], 'contiene ' + p);
  ok(Object.values(partes).every(e => e.crc === zlib.crc32(e.datos)), 'el CRC de cada parte del ZIP es correcto');
  const hojas = [...partes['xl/workbook.xml'].datos.toString('utf8').matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  ok(hojas.join(',') === 'Caudalimetros,Trazabilidad', 'hojas: ' + hojas.join(', '));
} catch (e) {
  console.error(e.message); codigo = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  if (servidor.listening) servidor.close();
  await esperar(300);
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(codigo ? '\nPRUEBA FALLIDA' : '\nPRUEBA SUPERADA');
process.exit(codigo);
