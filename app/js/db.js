/* =============================================================================
   DB.JS — Persistencia local (IndexedDB), validación en campo y cola de envío.

   REGLA DE ORO DE ESTA APP:
   Ningún dato se pierde jamás porque no haya señal. TODA lectura se escribe
   primero en IndexedDB (write-ahead) y recién después se intenta enviar.
   La red es un "extra", nunca un requisito para guardar.
   ========================================================================== */

const DB_NOMBRE = 'registro-campo';
const DB_VERSION = 1;

const S = {
  LECTURAS: 'lecturas',     // cada medición individual
  JORNADAS: 'jornadas',     // recorrido/ruta con su chequeo previo de seguridad
  ULTIMOS: 'ultimos',       // última lectura válida por punto (para validar)
  CATALOGO: 'catalogo',     // puntos (editable/actualizable)
  CONFIG: 'config',         // ajustes del dispositivo
  BITACORA: 'bitacora',     // auditoría: quién hizo qué y cuándo
  FOTOS: 'fotos',           // imágenes guardadas una sola vez y referenciadas
  HOJAS: 'hojas'            // fotos de hoja/panel pendientes de transcribir
};

let _db = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(S.LECTURAS)) {
        const st = db.createObjectStore(S.LECTURAS, { keyPath: 'id' });
        st.createIndex('estado', 'estado');
        st.createIndex('puntoId', 'puntoId');
        st.createIndex('jornadaId', 'jornadaId');
        st.createIndex('fecha', 'fecha');
      }
      if (!db.objectStoreNames.contains(S.JORNADAS)) {
        const st = db.createObjectStore(S.JORNADAS, { keyPath: 'id' });
        st.createIndex('estado', 'estado');
        st.createIndex('fecha', 'fecha');
      }
      if (!db.objectStoreNames.contains(S.ULTIMOS)) db.createObjectStore(S.ULTIMOS, { keyPath: 'puntoId' });
      if (!db.objectStoreNames.contains(S.CATALOGO)) db.createObjectStore(S.CATALOGO, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S.CONFIG)) db.createObjectStore(S.CONFIG, { keyPath: 'k' });
      if (!db.objectStoreNames.contains(S.BITACORA)) {
        const st = db.createObjectStore(S.BITACORA, { keyPath: 'id', autoIncrement: true });
        st.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(S.FOTOS)) db.createObjectStore(S.FOTOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S.HOJAS)) {
        const st = db.createObjectStore(S.HOJAS, { keyPath: 'id' });
        st.createIndex('estado', 'estado');
        st.createIndex('jornadaId', 'jornadaId');
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, modo, fn) {
  return abrir().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, modo);
    const st = t.objectStore(store);
    let out;
    try { out = fn(st); } catch (e) { rej(e); return; }
    // Si fn devolvió un IDBRequest, se entrega su .result (undefined si no existe)
    t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

const put = (store, valor) => tx(store, 'readwrite', st => st.put(valor)).then(() => valor);
const get = (store, key) => tx(store, 'readonly', st => st.get(key));
const del = (store, key) => tx(store, 'readwrite', st => st.delete(key));
const todos = (store) => tx(store, 'readonly', st => st.getAll());
const porIndice = (store, idx, val) => tx(store, 'readonly', st => st.index(idx).getAll(val));

/* ---------------------------------------------------------------- utilidades */
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

async function hash(obj) {
  const txt = JSON.stringify(obj);
  if (!crypto.subtle) return String(txt.length);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fecha LOCAL del equipo, no UTC: al oeste de Greenwich, toISOString() ya es "mañana" por la noche.
const hoyISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const horaHM = (d = new Date()) => d.toTimeString().slice(0, 5);

/* ============================== CONFIGURACIÓN =============================== */
const CONFIG_DEF = {
  operador: '', dni: '', empresa: '',
  unidad: (window.CATALOGO && window.CATALOGO.rutas[0] && window.CATALOGO.rutas[0].unidad) || '',
  endpoint: '', apiKey: '', modoCampo: false, autoGps: true, fotoObligatoriaEnAlerta: true,
  toleranciaDelta: 40   // % de desviación aceptada frente al histórico del punto
};

async function cargarConfig() {
  const filas = await todos(S.CONFIG);
  const cfg = { ...CONFIG_DEF };
  filas.forEach(f => { cfg[f.k] = f.v; });
  return cfg;
}
const guardarConfig = (k, v) => put(S.CONFIG, { k, v });

/* ================================ CATÁLOGO ================================= */
/* Se vuelve a sembrar cuando cambia `version` en catalogo.js: publicar una
   versión nueva actualiza los puntos de todos los equipos al abrir la app.
   Las lecturas guardan el nombre del punto, así que retirar uno no las afecta. */
async function sembrarCatalogo(force = false) {
  const actual = await todos(S.CATALOGO);
  const sembrada = await get(S.CONFIG, 'catalogoVersion');
  if (actual.length && !force && sembrada && sembrada.v === window.CATALOGO.version) return actual;
  const db = await abrir();
  await new Promise((res, rej) => {
    const t = db.transaction(S.CATALOGO, 'readwrite');
    const st = t.objectStore(S.CATALOGO);
    st.clear();
    window.CATALOGO.puntos.forEach(p => st.put(p));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  await guardarConfig('catalogoVersion', window.CATALOGO.version);
  await bitacora('catalogo:sembrado', { version: window.CATALOGO.version, puntos: window.CATALOGO.puntos.length });
  return todos(S.CATALOGO);
}

const puntosDeRuta = async (rutaId) =>
  (await todos(S.CATALOGO)).filter(p => p.ruta === rutaId && p.activo !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));

/* ================================ BITÁCORA ================================= */
const bitacora = (evento, detalle) =>
  put(S.BITACORA, { ts: new Date().toISOString(), evento, detalle: detalle || null });

/* ================================ JORNADAS ================================= */
async function abrirJornada({ rutaId, operador, checklist, clima }) {
  const j = {
    id: uuid(), rutaId, operador, checklist, clima,
    fecha: hoyISO(), inicio: new Date().toISOString(), fin: null,
    estado: 'abierta', dispositivo: await idDispositivo()
  };
  await put(S.JORNADAS, j);
  await bitacora('jornada:abierta', { id: j.id, rutaId });
  return j;
}

async function cerrarJornada(id, notas) {
  const j = await get(S.JORNADAS, id);
  if (!j) return null;
  j.fin = new Date().toISOString(); j.estado = 'cerrada'; j.notas = notas || null;
  await put(S.JORNADAS, j);
  await bitacora('jornada:cerrada', { id });
  return j;
}

const jornadaAbierta = async () =>
  (await porIndice(S.JORNADAS, 'estado', 'abierta')).sort((a, b) => b.inicio.localeCompare(a.inicio))[0] || null;

async function idDispositivo() {
  let id = localStorage.getItem('registro-campo-dispositivo');
  if (!id) { id = uuid().slice(0, 8); localStorage.setItem('registro-campo-dispositivo', id); }
  return id;
}

/* =========================== VALIDACIÓN EN CAMPO ===========================
   Aquí está el mayor ahorro de horas-hombre: el error se detecta con el
   operador todavía parado frente al equipo, no tres semanas después cuando
   el balance hídrico del mes no cierra.
   ========================================================================== */
function validar(punto, valores, ultimo, cfg) {
  const tipo = window.CATALOGO.tipos[punto.tipo];
  const avisos = [];
  if (!tipo) return avisos;

  tipo.campos.forEach(c => {
    const v = valores[c.k];
    const vacio = v === '' || v === null || v === undefined || Number.isNaN(v);

    if (c.req && vacio) { avisos.push({ nivel: 'rojo', campo: c.k, msg: `Falta ${c.label}.` }); return; }
    if (vacio) return;

    const n = Number(v);
    if (!Number.isFinite(n)) { avisos.push({ nivel: 'rojo', campo: c.k, msg: `${c.label}: valor no numérico.` }); return; }
    if (c.min !== undefined && n < c.min) avisos.push({ nivel: 'rojo', campo: c.k, msg: `${c.label} = ${n} está por debajo del mínimo físico (${c.min} ${c.unidad}).` });
    if (c.max !== undefined && n > c.max) avisos.push({ nivel: 'rojo', campo: c.k, msg: `${c.label} = ${n} supera el máximo físico (${c.max} ${c.unidad}).` });
    if (c.alerta && (n < c.alerta[0] || n > c.alerta[1]))
      avisos.push({ nivel: 'ambar', campo: c.k, msg: `${c.label} = ${n} ${c.unidad} fuera del rango operativo (${c.alerta[0]}–${c.alerta[1]}). Verifique y registre observación.` });

    /* --- contadores acumulados: no pueden retroceder ---------------------- */
    if (c.monotono && ultimo && ultimo.valores && ultimo.valores[c.k] != null) {
      const prev = Number(ultimo.valores[c.k]);
      if (Number.isFinite(prev)) {
        if (n < prev) {
          avisos.push({
            nivel: 'rojo', campo: c.k,
            msg: `El acumulado bajó: antes ${prev}, ahora ${n}. ¿Se reinició el contador o se cambió el equipo? Marque el motivo.`,
            requiereMotivo: true
          });
        } else {
          const dias = Math.max(1, (new Date(hoyISO()) - new Date(ultimo.fecha)) / 86400000);
          const deltaDia = (n - prev) / dias;
          const ref = ultimo.deltaDiaProm;
          if (ref && ref > 0) {
            const desv = Math.abs(deltaDia - ref) / ref * 100;
            if (desv > (cfg.toleranciaDelta || 40)) {
              avisos.push({
                nivel: 'ambar', campo: c.k,
                msg: `Consumo diario ${deltaDia.toFixed(1)} vs. histórico ${ref.toFixed(1)} ${c.unidad}/día (${desv.toFixed(0)}% de desviación). Confirme la lectura o anote la causa (fuga, parada, cambio de operación).`
              });
            }
          }
          if (deltaDia === 0)
            avisos.push({ nivel: 'ambar', campo: c.k, msg: 'El acumulado no varió desde la última lectura. ¿Equipo detenido o caudalómetro trabado?' });
        }
      }
    }

    /* --- salto brusco frente a la lectura anterior (p. ej. niveles) ------- */
    if (c.saltoMax !== undefined && ultimo && ultimo.valores && ultimo.valores[c.k] != null) {
      const dif = Math.abs(n - Number(ultimo.valores[c.k]));
      if (dif > c.saltoMax) avisos.push({ nivel: 'ambar', campo: c.k, msg: `Variación de ${dif.toFixed(1)} ${c.unidad} frente a la lectura anterior (${ultimo.valores[c.k]}). Confirme antes de guardar.` });
    }
  });

  return avisos;
}

/* =============================== LECTURAS ================================== */
async function guardarLectura(datos) {
  const cfg = await cargarConfig();
  const id = datos.id || uuid();
  const registro = {
    id,
    jornadaId: datos.jornadaId || null,
    rutaId: datos.rutaId,
    puntoId: datos.puntoId,
    punto: datos.punto,
    tipo: datos.tipo,
    unidad: datos.unidad || cfg.unidad,
    fecha: datos.fecha || hoyISO(),
    hora: datos.hora || horaHM(),
    valores: datos.valores || {},
    obs: datos.obs || '',
    estadoEquipo: datos.estadoEquipo || 'operativo',
    anomalia: datos.anomalia || null,
    noMedido: datos.noMedido || null,
    foto: datos.foto || null,          // imagen incrustada (captura punto a punto)
    fotoId: datos.fotoId || null,      // o referencia a una foto de hoja/panel
    hojaId: datos.hojaId || null,
    origen: datos.origen || 'captura-directa',
    gps: datos.gps || null,
    avisos: datos.avisos || [],
    operador: datos.operador || cfg.operador,
    empresa: cfg.empresa,
    dispositivo: await idDispositivo(),
    appVersion: window.APP_VERSION,
    catalogoVersion: window.CATALOGO.version,
    creado: new Date().toISOString(),
    editadoDe: datos.editadoDe || null,
    estado: 'pendiente',        // pendiente ▸ enviando ▸ enviado | error
    intentos: 0, ultimoError: null
  };
  registro.huella = await hash({
    p: registro.puntoId, f: registro.fecha, h: registro.hora, v: registro.valores, o: registro.operador
  });

  await put(S.LECTURAS, registro);
  await actualizarUltimo(registro);
  await bitacora('lectura:guardada', { id, punto: registro.punto });
  return registro;
}

/* La edición NO sobrescribe: crea una versión nueva enlazada a la anterior,
   y la anterior queda anulada. Trazabilidad ISO 9001 / 14001 (7.5 y 9.1). */
async function corregirLectura(idOriginal, cambios, motivo) {
  const orig = await get(S.LECTURAS, idOriginal);
  if (!orig) return null;
  orig.estado = orig.estado === 'enviado' ? 'anulada-enviada' : 'anulada';
  orig.anuladaEl = new Date().toISOString();
  orig.motivoAnulacion = motivo || 'corrección en campo';
  await put(S.LECTURAS, orig);
  const nueva = await guardarLectura({ ...orig, ...cambios, id: uuid(), editadoDe: idOriginal, estado: 'pendiente' });
  await bitacora('lectura:corregida', { de: idOriginal, a: nueva.id, motivo });
  return nueva;
}

async function actualizarUltimo(reg) {
  if (reg.noMedido) return;
  const prev = await get(S.ULTIMOS, reg.puntoId);
  const registro = {
    puntoId: reg.puntoId, fecha: reg.fecha, hora: reg.hora,
    valores: reg.valores, lecturaId: reg.id, deltaDiaProm: prev ? prev.deltaDiaProm : null
  };
  // media móvil del consumo diario, para afinar la validación con el tiempo
  const campoAcum = (window.CATALOGO.tipos[reg.tipo] || { campos: [] }).campos.find(c => c.monotono);
  if (campoAcum && prev && prev.valores && prev.valores[campoAcum.k] != null) {
    const dias = Math.max(1, (new Date(reg.fecha) - new Date(prev.fecha)) / 86400000);
    const d = (Number(reg.valores[campoAcum.k]) - Number(prev.valores[campoAcum.k])) / dias;
    if (Number.isFinite(d) && d >= 0)
      registro.deltaDiaProm = prev.deltaDiaProm ? (prev.deltaDiaProm * 0.7 + d * 0.3) : d;
  }
  await put(S.ULTIMOS, registro);
}

const ultimaDe = (puntoId) => get(S.ULTIMOS, puntoId);
const lecturasDeJornada = (jid) => porIndice(S.LECTURAS, 'jornadaId', jid);
const pendientes = () => porIndice(S.LECTURAS, 'estado', 'pendiente');
const conError = () => porIndice(S.LECTURAS, 'estado', 'error');

/* ============================ COLA DE ENVÍO ================================
   Idempotente: el servidor recibe siempre el mismo id + huella, así que un
   reenvío por timeout NUNCA duplica un registro.
   - Una sola sincronización a la vez: el evento 'online', el reintento cada
     2 minutos y cada guardado pueden coincidir.
   - Las lecturas en 'error' (8 fallos o más) se siguen reintentando: el
     estado solo avisa que algo anda mal con el servidor.
   - Tras cada envío se relee la lectura: si mientras viajaba se corrigió (y
     quedó anulada), no se la revive como 'enviado'.
   ========================================================================== */
const ESPERA_ENVIO_MS = 30000;
let _sincronizando = null;

function sincronizar(reportar = () => {}) {
  if (!_sincronizando) _sincronizando = _sincronizar(reportar).finally(() => { _sincronizando = null; });
  return _sincronizando;
}

async function _sincronizar(reportar) {
  const cfg = await cargarConfig();
  const cola = (await pendientes()).concat(await conError());
  if (!cola.length) return { enviados: 0, fallidos: 0, total: 0 };
  if (!navigator.onLine || !cfg.endpoint) {
    reportar({ tipo: 'sin-red', total: cola.length });
    return { enviados: 0, fallidos: 0, total: cola.length, motivo: !cfg.endpoint ? 'sin-endpoint' : 'sin-red' };
  }
  let enviados = 0, fallidos = 0;
  for (const reg of cola) {
    let ok = false, error = null;
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), ESPERA_ENVIO_MS);
    try {
      reportar({ tipo: 'enviando', id: reg.id, punto: reg.punto });
      const r = await fetch(cfg.endpoint, {
        method: 'POST', signal: corte.signal,
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}) },
        body: JSON.stringify({ ...reg, foto: undefined, fotoAdjunta: !!reg.foto })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      ok = true;
    } catch (e) {
      error = corte.signal.aborted ? 'sin respuesta en ' + ESPERA_ENVIO_MS / 1000 + ' s' : String(e.message || e);
    } finally {
      clearTimeout(reloj);
    }
    const actual = await get(S.LECTURAS, reg.id);          // relee: pudo cambiar mientras viajaba
    if (!actual) continue;
    if (ok) {
      actual.enviadoEl = new Date().toISOString(); actual.ultimoError = null;
      actual.estado = String(actual.estado).startsWith('anulada') ? 'anulada-enviada' : 'enviado';
      enviados++;
    } else {
      actual.intentos = (actual.intentos || 0) + 1;
      actual.ultimoError = error;
      if (actual.estado === 'pendiente' && actual.intentos >= 8) actual.estado = 'error';
      fallidos++;
    }
    await put(S.LECTURAS, actual);
  }
  await bitacora('sync', { enviados, fallidos });
  return { enviados, fallidos, total: cola.length };
}

/* ================ CAPTURA POR FOTO DE HOJA / PANEL ==========================
   Para rutas con muchos puntos, o con muchos campos por punto, tipear en
   campo es tiempo perdido. El operador
   fotografía la hoja o el panel —que es lo que ya hace— y la transcripción se
   hace después, con la foto al frente, en el celular o en la PC de oficina.
   La foto se guarda UNA vez y las lecturas la referencian.
   ========================================================================== */
async function guardarFoto(dataURL) {
  const foto = { id: uuid(), dataURL, creado: new Date().toISOString() };
  await put(S.FOTOS, foto);
  return foto.id;
}
const obtenerFoto = (id) => get(S.FOTOS, id);

async function crearHoja({ rutaId, jornadaId, puntoIds, fotoIds, gps, obs, operador }) {
  const cfg = await cargarConfig();
  const hoja = {
    id: uuid(), rutaId, jornadaId: jornadaId || null,
    puntoIds: puntoIds || [], fotoIds: fotoIds || [],
    fecha: hoyISO(), hora: horaHM(), gps: gps || null, obs: obs || '',
    operador: operador || cfg.operador, empresa: cfg.empresa, unidad: cfg.unidad,
    dispositivo: await idDispositivo(), creado: new Date().toISOString(),
    estado: 'por-transcribir', transcritaEl: null
  };
  await put(S.HOJAS, hoja);
  await bitacora('hoja:capturada', { id: hoja.id, rutaId, puntos: hoja.puntoIds.length, fotos: hoja.fotoIds.length });
  return hoja;
}

const hojasPendientes = () => porIndice(S.HOJAS, 'estado', 'por-transcribir');

async function agregarFotoAHoja(hojaId, dataURL) {
  const h = await get(S.HOJAS, hojaId);
  if (!h) return null;
  h.fotoIds.push(await guardarFoto(dataURL));
  await put(S.HOJAS, h);
  return h;
}

/* filas = [{ puntoId, valores, obs }] — solo las que traen algún valor se
   convierten en lectura. La hoja queda cerrada cuando ya no falta ninguna. */
async function transcribirHoja(hojaId, filas) {
  const hoja = await get(S.HOJAS, hojaId);
  if (!hoja) throw new Error('La hoja ya no existe en el equipo.');
  const cfg = await cargarConfig();
  const puntos = await todos(S.CATALOGO);
  const creadas = [];

  for (const fila of filas) {
    const conValor = Object.values(fila.valores || {}).some(v => v !== '' && v !== null && v !== undefined);
    if (!conValor) continue;
    const punto = puntos.find(p => p.id === fila.puntoId);
    if (!punto) continue;
    const previo = (await porIndice(S.LECTURAS, 'puntoId', punto.id))
      .find(l => l.hojaId === hojaId && !String(l.estado).startsWith('anulada'));

    // Si el punto ya estaba transcrito y no cambió nada, no se toca:
    // guardar dos veces no debe llenar la bandeja de correcciones vacías.
    if (previo && JSON.stringify(previo.valores) === JSON.stringify(fila.valores)
        && (previo.obs || '') === (fila.obs || '')) continue;

    const datos = {
      jornadaId: hoja.jornadaId, rutaId: punto.ruta, puntoId: punto.id, punto: punto.nombre,
      tipo: punto.tipo, unidad: hoja.unidad || cfg.unidad, fecha: hoja.fecha, hora: fila.hora || hoja.hora,
      valores: fila.valores, obs: fila.obs || '', gps: hoja.gps,
      fotoId: hoja.fotoIds[0] || null, hojaId, origen: 'foto-hoja',
      operador: hoja.operador,
      avisos: validar(punto, fila.valores, await ultimaDe(punto.id), cfg)
    };
    creadas.push(previo ? await corregirLectura(previo.id, datos, 'corrección de transcripción')
                        : await guardarLectura(datos));
  }

  const cubiertos = new Set();
  (await todos(S.LECTURAS)).filter(l => l.hojaId === hojaId && !String(l.estado).startsWith('anulada'))
    .forEach(l => cubiertos.add(l.puntoId));
  const faltan = hoja.puntoIds.filter(id => !cubiertos.has(id));
  hoja.estado = faltan.length ? 'por-transcribir' : 'transcrita';
  hoja.transcritaEl = faltan.length ? null : new Date().toISOString();
  hoja.faltan = faltan.length;
  await put(S.HOJAS, hoja);
  await bitacora('hoja:transcrita', { id: hojaId, lecturas: creadas.length, faltan: faltan.length });
  return { creadas: creadas.length, faltan: faltan.length, estado: hoja.estado };
}

/* ===================== RESPALDO / RELEVO SIN RED ============================
   Cuando no hay ni señal ni red de oficina, el turno se traspasa como archivo
   (WhatsApp, Bluetooth, USB). El paquete es JSON y cada lectura lleva su huella.
   El archivo viaja por canales abiertos: no lleva la clave de API ni el DNI.
   ========================================================================== */
const FORMATO_RESPALDO = 'REGISTRO-CAMPO-RESPALDO-1';
async function exportarRespaldo() {
  const generado = new Date().toISOString();
  const paquete = {
    formato: FORMATO_RESPALDO, generado,
    dispositivo: await idDispositivo(), appVersion: window.APP_VERSION,
    jornadas: await todos(S.JORNADAS),
    lecturas: await todos(S.LECTURAS),
    hojas: await todos(S.HOJAS),
    fotos: await todos(S.FOTOS),
    ultimos: await todos(S.ULTIMOS),
    config: { ...(await cargarConfig()), apiKey: undefined, dni: undefined }
  };
  await guardarConfig('ultimoRespaldo', generado);   // habilita liberar fotos ya respaldadas
  return paquete;
}

/* Libera espacio sin perder evidencia. Las fotos NO viajan al servidor (solo
   la marca fotoAdjunta), así que solo se borran las que ya están dentro de un
   respaldo .json exportado y cuyas lecturas ya se enviaron. */
async function liberarFotos() {
  const cfg = await cargarConfig();
  const corte = cfg.ultimoRespaldo;
  if (!corte) return { n: 0, motivo: 'sin-respaldo' };
  const respaldada = x => x && String(x.creado) <= corte;
  const hojas = await todos(S.HOJAS);
  const lecturas = await todos(S.LECTURAS);
  const enviada = l => l.estado === 'enviado' || l.estado === 'anulada-enviada';
  let n = 0;
  for (const h of hojas) {
    if (h.estado !== 'transcrita' || !(h.fotoIds || []).length || !respaldada(h)) continue;
    const suyas = lecturas.filter(l => l.hojaId === h.id && !String(l.estado).startsWith('anulada'));
    if (!suyas.length || !suyas.every(enviada)) continue;
    for (const fid of h.fotoIds) { await del(S.FOTOS, fid); n++; }
    h.fotoIds = []; h.fotosLiberadas = true;
    await put(S.HOJAS, h);
  }
  for (const l of lecturas) {
    if (enviada(l) && l.foto && respaldada(l)) { l.foto = null; l.fotoLiberada = true; await put(S.LECTURAS, l); n++; }
  }
  await bitacora('fotos:liberadas', { n, respaldo: corte });
  return { n };
}

/* Un respaldo llega de otro equipo por WhatsApp o USB: es dato externo. Antes
   de guardar nada se valida su forma completa; lo que no calza se rechaza
   entero. Los textos se escapan al pintarlos, pero ids, fechas, horas, fotos
   y números se exigen con formato estricto porque también van en atributos. */
const RX = {
  id: /^[A-Za-z0-9_-]{1,64}$/, fecha: /^\d{4}-\d{2}-\d{2}$/, hora: /^\d{2}:\d{2}$/,
  foto: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/
};
const ESTADOS_LECTURA = ['pendiente', 'enviado', 'error', 'anulada', 'anulada-enviada'];

function validarRespaldo(p) {
  const err = [];
  const esObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const lista = (x, nombre) => { if (x === undefined) return []; if (!Array.isArray(x)) { err.push(nombre + ': no es una lista'); return []; } return x; };
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const gpsOk = g => g == null || (esObj(g) && num(g.lat) && num(g.lon) && (g.prec == null || num(g.prec)));
  const texto = x => x == null || typeof x === 'string';
  if (!esObj(p) || p.formato !== FORMATO_RESPALDO) return ['Archivo de respaldo no reconocido.'];

  lista(p.lecturas, 'lecturas').forEach((l, i) => {
    const e = m => err.push(`lectura ${i + 1}: ${m}`);
    if (!esObj(l)) return e('no es un objeto');
    if (!RX.id.test(l.id)) e('id inválido');
    if (!RX.fecha.test(l.fecha)) e('fecha inválida');
    if (!RX.hora.test(l.hora)) e('hora inválida');
    if (!ESTADOS_LECTURA.includes(l.estado)) e('estado inválido');
    if (!window.CATALOGO.tipos[l.tipo]) e('tipo desconocido');
    if (typeof l.puntoId !== 'string' || !RX.id.test(l.puntoId)) e('punto inválido');
    for (const k of ['jornadaId', 'hojaId', 'fotoId', 'editadoDe']) if (l[k] != null && !RX.id.test(l[k])) e(k + ' inválido');
    if (l.foto != null && !RX.foto.test(l.foto)) e('foto inválida');
    if (!esObj(l.valores) || !Object.values(l.valores).every(num)) e('valores no numéricos');
    if (!gpsOk(l.gps)) e('GPS inválido');
    if (l.avisos != null && (!Array.isArray(l.avisos) || !l.avisos.every(a => esObj(a) && ['rojo', 'ambar'].includes(a.nivel) && texto(a.msg)))) e('avisos inválidos');
    for (const k of ['punto', 'obs', 'operador', 'empresa', 'noMedido', 'anomalia', 'huella', 'estadoEquipo', 'creado']) if (!texto(l[k])) e(k + ' no es texto');
  });
  lista(p.jornadas, 'jornadas').forEach((j, i) => {
    if (!esObj(j) || !RX.id.test(j.id) || typeof j.rutaId !== 'string' || !texto(j.operador) || typeof j.inicio !== 'string')
      err.push(`jornada ${i + 1}: inválida`);
  });
  lista(p.hojas, 'hojas').forEach((h, i) => {
    if (!esObj(h) || !RX.id.test(h.id) || !RX.fecha.test(h.fecha) || !RX.hora.test(h.hora)
        || !Array.isArray(h.fotoIds) || !h.fotoIds.every(x => RX.id.test(x))
        || !Array.isArray(h.puntoIds) || !h.puntoIds.every(x => typeof x === 'string' && RX.id.test(x))
        || !gpsOk(h.gps) || !texto(h.obs) || !texto(h.operador)) err.push(`hoja ${i + 1}: inválida`);
  });
  lista(p.fotos, 'fotos').forEach((f, i) => {
    if (!esObj(f) || !RX.id.test(f.id) || !RX.foto.test(f.dataURL)) err.push(`foto ${i + 1}: inválida`);
  });
  return err;
}

async function importarRespaldo(paquete) {
  const errores = validarRespaldo(paquete);
  if (errores.length) throw new Error(errores.length === 1 ? errores[0]
    : `${errores.length} problemas en el archivo; el primero: ${errores[0]}`);
  let nuevas = 0, repetidas = 0;
  for (const l of paquete.lecturas || []) {
    const ex = await get(S.LECTURAS, l.id);
    if (ex) { repetidas++; continue; }
    await put(S.LECTURAS, l); nuevas++;
  }
  // un recorrido ajeno nunca queda abierto en este equipo: se importa cerrado
  for (const j of paquete.jornadas || []) {
    if (await get(S.JORNADAS, j.id)) continue;
    await put(S.JORNADAS, j.estado === 'abierta'
      ? { ...j, estado: 'cerrada', fin: j.fin || paquete.generado, notas: 'Cerrada al importar el relevo.' } : j);
  }
  for (const f of paquete.fotos || []) if (!(await get(S.FOTOS, f.id))) await put(S.FOTOS, f);
  for (const h of paquete.hojas || []) if (!(await get(S.HOJAS, h.id))) await put(S.HOJAS, h);
  await bitacora('respaldo:importado', { nuevas, repetidas, origen: paquete.dispositivo });
  return { nuevas, repetidas };
}

/* =============================== ALMACENAMIENTO ============================ */
async function asegurarPersistencia() {
  if (navigator.storage && navigator.storage.persist) {
    const ya = await navigator.storage.persisted();
    if (!ya) return navigator.storage.persist();   // evita que el SO borre los datos
    return true;
  }
  return false;
}

async function usoAlmacenamiento() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usado: e.usage, cuota: e.quota };
}

window.DB = {
  S, abrir, put, get, del, todos, porIndice, uuid, hoyISO, horaHM,
  cargarConfig, guardarConfig, sembrarCatalogo, puntosDeRuta,
  abrirJornada, cerrarJornada, jornadaAbierta,
  validar, guardarLectura, corregirLectura, ultimaDe, lecturasDeJornada, pendientes,
  validarRespaldo, FORMATO_RESPALDO,
  guardarFoto, obtenerFoto, crearHoja, hojasPendientes, agregarFotoAHoja, transcribirHoja, liberarFotos,
  sincronizar, exportarRespaldo, importarRespaldo,
  asegurarPersistencia, usoAlmacenamiento, bitacora, idDispositivo
};
