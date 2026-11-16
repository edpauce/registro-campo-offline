/* =============================================================================
   DB.JS — Persistencia local (IndexedDB), validación en campo y cola de envío.

   REGLA DE ORO DE ESTA APP:
   Ningún dato se pierde jamás porque no haya señal. TODA lectura se escribe
   primero en IndexedDB (write-ahead) y recién después se intenta enviar.
   La red es un "extra", nunca un requisito para guardar.
   ========================================================================== */

const DB_NOMBRE = 'registro-campo';
const DB_VERSION = 2;

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
async function sembrarCatalogo(force = false) {
  const actual = await todos(S.CATALOGO);
  if (actual.length && !force) return actual;
  const db = await abrir();
  await new Promise((res, rej) => {
    const t = db.transaction(S.CATALOGO, 'readwrite');
    const st = t.objectStore(S.CATALOGO);
    window.CATALOGO.puntos.forEach(p => st.put(p));
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
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

/* ============================ COLA DE ENVÍO ================================
   Idempotente: el servidor recibe siempre el mismo id + huella, así que un
   reenvío por timeout NUNCA duplica un registro.
   ========================================================================== */
async function sincronizar(reportar = () => {}) {
  const cfg = await cargarConfig();
  const cola = await pendientes();
  if (!cola.length) return { enviados: 0, fallidos: 0, total: 0 };
  if (!navigator.onLine || !cfg.endpoint) {
    reportar({ tipo: 'sin-red', total: cola.length });
    return { enviados: 0, fallidos: 0, total: cola.length, motivo: !cfg.endpoint ? 'sin-endpoint' : 'sin-red' };
  }
  let enviados = 0, fallidos = 0;
  for (const reg of cola) {
    try {
      reportar({ tipo: 'enviando', id: reg.id, punto: reg.punto });
      const r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}) },
        body: JSON.stringify({ ...reg, foto: undefined, fotoAdjunta: !!reg.foto })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      reg.estado = 'enviado'; reg.enviadoEl = new Date().toISOString(); reg.ultimoError = null;
      enviados++;
    } catch (e) {
      reg.intentos = (reg.intentos || 0) + 1;
      reg.ultimoError = String(e.message || e);
      if (reg.intentos >= 8) reg.estado = 'error';
      fallidos++;
    }
    await put(S.LECTURAS, reg);
  }
  await bitacora('sync', { enviados, fallidos });
  return { enviados, fallidos, total: cola.length };
}

/* ================ CAPTURA POR FOTO DE HOJA / PANEL ==========================
   Para rutas con muchos puntos (decenas de piezómetros, o bombas con siete
   campos cada una) tipear en campo es tiempo perdido. El operador
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
   ========================================================================== */
const FORMATO_RESPALDO = 'REGISTRO-CAMPO-RESPALDO-1';
async function exportarRespaldo() {
  return {
    formato: FORMATO_RESPALDO, generado: new Date().toISOString(),
    dispositivo: await idDispositivo(), appVersion: window.APP_VERSION,
    jornadas: await todos(S.JORNADAS),
    lecturas: await todos(S.LECTURAS),
    hojas: await todos(S.HOJAS),
    fotos: await todos(S.FOTOS),
    ultimos: await todos(S.ULTIMOS),
    // el respaldo viaja por WhatsApp o USB: la clave de API no sale del equipo
    config: { ...(await cargarConfig()), apiKey: undefined }
  };
}

/* Libera espacio sin perder trazabilidad: solo borra fotos de hojas ya
   transcritas cuyas lecturas están enviadas al servidor. */
async function liberarFotos() {
  const hojas = await todos(S.HOJAS);
  const lecturas = await todos(S.LECTURAS);
  let n = 0;
  for (const h of hojas) {
    if (h.estado !== 'transcrita' || !h.fotoIds.length) continue;
    const suyas = lecturas.filter(l => l.hojaId === h.id);
    if (!suyas.length || suyas.some(l => l.estado === 'pendiente' || l.estado === 'error')) continue;
    for (const fid of h.fotoIds) { await del(S.FOTOS, fid); n++; }
    h.fotoIds = []; h.fotosLiberadas = true;
    await put(S.HOJAS, h);
  }
  for (const l of lecturas) {
    if (l.estado === 'enviado' && l.foto) { l.foto = null; l.fotoLiberada = true; await put(S.LECTURAS, l); n++; }
  }
  await bitacora('fotos:liberadas', { n });
  return n;
}

async function importarRespaldo(paquete) {
  if (!paquete || paquete.formato !== FORMATO_RESPALDO) throw new Error('Archivo de respaldo no reconocido.');
  let nuevas = 0, repetidas = 0;
  for (const l of paquete.lecturas || []) {
    const ex = await get(S.LECTURAS, l.id);
    if (ex) { repetidas++; continue; }
    await put(S.LECTURAS, l); nuevas++;
  }
  for (const j of paquete.jornadas || []) if (!(await get(S.JORNADAS, j.id))) await put(S.JORNADAS, j);
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
  guardarFoto, obtenerFoto, crearHoja, hojasPendientes, agregarFotoAHoja, transcribirHoja, liberarFotos,
  sincronizar, exportarRespaldo, importarRespaldo,
  asegurarPersistencia, usoAlmacenamiento, bitacora, idDispositivo
};
