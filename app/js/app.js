/* =============================================================================
   APP.JS — Interfaz de campo. Todo el flujo funciona sin conexión.
   ========================================================================== */

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = n => (n == null || n === '' || !Number.isFinite(Number(n))) ? '—'
  : Number(n).toLocaleString('es-PE', { maximumFractionDigits: 3 });
const fFecha = f => { const [a, m, d] = String(f).split('-'); return `${d}/${m}/${a}`; };

const estado = { cfg: null, jornada: null, ruta: null, puntos: [], lecturas: [], filtro: '', capturaAvisos: [], foto: null, gps: null };

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ============================== ARRANQUE ================================== */
async function iniciar() {
  await DB.sembrarCatalogo();
  estado.cfg = await DB.cargarConfig();
  estado.jornada = await DB.jornadaAbierta();
  DB.asegurarPersistencia();
  document.documentElement.dataset.campo = estado.cfg.modoCampo ? '1' : '0';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {/* file:// o sin SW: la app igual funciona */});
  }
  window.addEventListener('online', () => { pintarEstadoRed(); sincronizarAhora(true); });
  window.addEventListener('offline', pintarEstadoRed);
  window.addEventListener('hashchange', enrutar);

  await enrutar();
  pintarEstadoRed();
  setInterval(() => sincronizarAhora(true), 120000);   // reintento silencioso cada 2 min
}

async function pintarEstadoRed() {
  const pend = (await DB.pendientes()).length;
  const hojas = (await DB.hojasPendientes()).length;
  const red = navigator.onLine;
  $('#chipRed').className = 'chip ' + (red ? 'on' : 'off');
  $('#chipRed').textContent = red ? 'En línea' : 'Sin conexión';
  const cp = $('#chipPend');
  cp.style.display = pend ? '' : 'none';
  cp.textContent = pend + ' pend.';
  const b = $('#badgeBandeja');
  const total = pend + hojas;
  b.style.display = total ? '' : 'none'; b.textContent = total;
}

/* =============================== RUTAS/VISTAS ============================= */
async function enrutar() {
  const h = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [vista, arg] = h.split('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('act', a.dataset.v === vista));
  window.scrollTo(0, 0);
  const m = { inicio: vInicio, iniciar: vIniciar, ruta: vRuta, captura: vCaptura, foto: vFotoHoja,
    hojas: vHojas, hoja: vHoja, bandeja: vBandeja, detalle: vDetalle, exportar: vExportar, ajustes: vAjustes };
  await (m[vista] || vInicio)(decodeURIComponent(arg || ''));
}
const ir = h => { location.hash = h; };

/* --------------------------------------------------------------- INICIO --- */
async function vInicio() {
  const todas = await DB.todos(DB.S.LECTURAS);
  const hoy = DB.hoyISO();
  const deHoy = todas.filter(l => l.fecha === hoy && !String(l.estado).startsWith('anulada'));
  const pend = todas.filter(l => l.estado === 'pendiente').length;
  const err = todas.filter(l => l.estado === 'error').length;
  estado.jornada = await DB.jornadaAbierta();
  const alm = await DB.usoAlmacenamiento();

  let jornadaHTML;
  if (estado.jornada) {
    const ruta = CATALOGO.rutas.find(r => r.id === estado.jornada.rutaId) || {};
    const puntos = await DB.puntosDeRuta(estado.jornada.rutaId);
    const hechas = (await DB.lecturasDeJornada(estado.jornada.id)).filter(l => !String(l.estado).startsWith('anulada'));
    const ids = new Set(hechas.map(l => l.puntoId));
    const pct = puntos.length ? Math.round(ids.size / puntos.length * 100) : 0;
    jornadaHTML = `
      <div class="tarjeta">
        <h2>Recorrido en curso</h2>
        <p><b>${esc(ruta.nombre || estado.jornada.rutaId)}</b></p>
        <p>Inició ${new Date(estado.jornada.inicio).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} · ${esc(estado.jornada.operador || 'sin operador')}</p>
        <div class="barra"><i style="width:${pct}%"></i></div>
        <p>${ids.size} de ${puntos.length} puntos registrados</p>
        <div class="fila-btn">
          <button class="primario" onclick="ir('ruta')">Continuar recorrido</button>
          <button class="secundario" onclick="cerrarRecorrido()">Cerrar</button>
        </div>
      </div>`;
  } else {
    jornadaHTML = `
      <div class="tarjeta">
        <h2>Sin recorrido abierto</h2>
        <p>Antes de iniciar se registra el chequeo previo del PETS (IPERC continuo, EPP, tormentas eléctricas).</p>
        <button class="primario" onclick="ir('iniciar')">Iniciar recorrido</button>
      </div>`;
  }

  const hojasPend = await DB.hojasPendientes();
  const hojasHTML = hojasPend.length ? `
      <div class="tarjeta">
        <h2>${hojasPend.length} hoja(s) por transcribir</h2>
        <p>Fotos de hoja o panel tomadas en campo que todavía no tienen los valores digitados.</p>
        <button class="primario" onclick="ir('hojas')">Transcribir ahora</button>
      </div>` : '';

  $('#app').innerHTML = `
    ${jornadaHTML}
    ${hojasHTML}
    <div class="grid">
      <div class="kpi"><b>${deHoy.length}</b><span>lecturas de hoy</span></div>
      <div class="kpi"><b style="color:${pend ? 'var(--ambar)' : 'var(--verde)'}">${pend}</b><span>por enviar</span></div>
      <div class="kpi"><b style="color:${err ? 'var(--rojo)' : 'inherit'}">${err}</b><span>con error</span></div>
      <div class="kpi"><b>${todas.length}</b><span>en el equipo</span></div>
    </div>

    <div class="tarjeta">
      <h2>Sincronización</h2>
      <p>${estado.cfg.endpoint ? 'Servidor: ' + esc(estado.cfg.endpoint) : 'Sin servidor configurado: los datos se conservan aquí y se exportan a Excel.'}</p>
      <div class="fila-btn">
        <button class="secundario" onclick="sincronizarAhora()">Sincronizar ahora</button>
        <button class="secundario" onclick="ir('exportar')">Exportar</button>
      </div>
      ${alm ? `<p class="ayuda">Almacenamiento usado: ${(alm.usado / 1048576).toFixed(1)} MB de ${(alm.cuota / 1048576).toFixed(0)} MB disponibles.</p>` : ''}
    </div>

    <h3 class="sec">Recorridos disponibles</h3>
    <ul class="lista">
      ${CATALOGO.rutas.filter(r => r.unidad === estado.cfg.unidad).map(r => `
        <li class="item pendiente" onclick="ir('iniciar/${r.id}')">
          <div class="txt"><div class="nom">${esc(r.nombre)}</div>
          <div class="det">${esc(r.frecuencia || '')} · ${esc(r.pets || r.formato || '')}</div></div>
          <span class="est">${CATALOGO.puntos.filter(p => p.ruta === r.id).length} pts</span>
        </li>`).join('')}
    </ul>
    <small class="pie">Registro de campo ${APP_VERSION} · catálogo ${esc(CATALOGO.version)} · ${esc(estado.cfg.unidad)}${CATALOGO.demo ? ' · datos ficticios de demostración' : ''}</small>`;
  pintarEstadoRed();
}

/* -------------------------------------------------------------- INICIAR --- */
const CHECKLIST = [
  'Conozco el PETS y el IPERC de línea base de la tarea.',
  'IPERC continuo llenado y firmado por el supervisor.',
  'EPP básico y específico completo y en buen estado.',
  'Herramientas y equipos operativos e inspeccionados según el estándar de la empresa.',
  'Vehículo con check list de preuso conforme; conductor autorizado.',
  'Sin alerta de tormenta eléctrica ni neblina densa en la zona.',
  'Radio operativa y comunicación probada con supervisión.'
];

async function vIniciar(rutaId) {
  const rutas = CATALOGO.rutas.filter(r => r.unidad === estado.cfg.unidad);
  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Chequeo previo al recorrido</h2>
      <p>Queda registrado con hora y responsable: es la evidencia que pide ISO 45001 y el PETS.</p>
      <label>Recorrido</label>
      <select id="selRuta">
        ${rutas.map(r => `<option value="${r.id}" ${r.id === rutaId ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}
      </select>
      <label>Operador responsable</label>
      <input id="inOperador" value="${esc(estado.cfg.operador)}" placeholder="Nombres y apellidos">
      <label>Condición del clima</label>
      <select id="selClima">
        <option>Despejado</option><option>Nublado</option><option>Lluvia ligera</option>
        <option>Nevada / granizo</option><option>Neblina</option>
      </select>
      <h3 class="sec">Verificaciones</h3>
      <div id="checks">
        ${CHECKLIST.map((c, i) => `<div class="check"><input type="checkbox" id="ck${i}"><span>${esc(c)}</span></div>`).join('')}
      </div>
      <div id="avisoCheck"></div>
      <button class="primario" style="margin-top:14px" onclick="confirmarInicio()">Iniciar recorrido</button>
      <button class="secundario" style="margin-top:8px" onclick="ir('inicio')">Cancelar</button>
    </div>`;
}

async function confirmarInicio() {
  const marcados = CHECKLIST.map((_, i) => $('#ck' + i).checked);
  const faltan = marcados.filter(x => !x).length;
  const operador = $('#inOperador').value.trim();
  if (!operador) { toast('Indique el operador responsable.'); return; }
  if (faltan && !confirm(`Hay ${faltan} verificación(es) sin marcar. El recorrido quedará registrado CON OBSERVACIONES. ¿Continuar?`)) return;

  await DB.guardarConfig('operador', operador);
  estado.cfg.operador = operador;
  estado.jornada = await DB.abrirJornada({
    rutaId: $('#selRuta').value,
    operador,
    clima: $('#selClima').value,
    checklist: { ok: !faltan, items: CHECKLIST.map((c, i) => ({ item: c, conforme: marcados[i] })) }
  });
  ir('ruta');
}

async function cerrarRecorrido() {
  if (!estado.jornada) return;
  const notas = prompt('Observaciones de cierre del recorrido (opcional):', '');
  if (notas === null) return;
  await DB.cerrarJornada(estado.jornada.id, notas);
  estado.jornada = null;
  toast('Recorrido cerrado. Los datos quedan guardados en el equipo.');
  ir('inicio');
}

/* ----------------------------------------------------------------- RUTA --- */
async function vRuta() {
  estado.jornada = await DB.jornadaAbierta();
  if (!estado.jornada) { ir('iniciar'); return; }
  const ruta = CATALOGO.rutas.find(r => r.id === estado.jornada.rutaId) || {};
  const puntos = await DB.puntosDeRuta(estado.jornada.rutaId);
  const lecturas = (await DB.lecturasDeJornada(estado.jornada.id)).filter(l => !String(l.estado).startsWith('anulada'));
  const porPunto = {}; lecturas.forEach(l => { porPunto[l.puntoId] = l; });
  const hechos = puntos.filter(p => porPunto[p.id]).length;

  const filtro = estado.filtro.toLowerCase();
  const visibles = puntos.filter(p => !filtro || p.nombre.toLowerCase().includes(filtro) || (p.grupo || '').toLowerCase().includes(filtro));

  const hojasRuta = (await DB.hojasPendientes()).filter(h => h.rutaId === ruta.id);

  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>${esc(ruta.nombre || '')}</h2>
      <div class="barra"><i style="width:${puntos.length ? hechos / puntos.length * 100 : 0}%"></i></div>
      <p>${hechos} de ${puntos.length} puntos · ${esc(estado.jornada.operador)}</p>
      ${ruta.pets ? `<p class="ayuda">Procedimiento aplicable: ${esc(ruta.pets)}${ruta.formato ? ' · formato ' + esc(ruta.formato) : ''}</p>` : ''}
    </div>
    ${ruta.modoFoto ? `
    <div class="tarjeta">
      <h2>Captura por foto</h2>
      <p>Esta ruta tiene ${puntos.length} puntos. En campo basta con fotografiar la hoja
         ${esc(ruta.formato || '')} o el panel; los valores se digitan después, con la foto al frente.</p>
      <button class="primario" onclick="ir('foto/${ruta.id}')">📷 Fotografiar hoja o panel</button>
      ${hojasRuta.length ? `<button class="secundario" style="margin-top:8px" onclick="ir('hojas')">Transcribir ${hojasRuta.length} hoja(s) pendiente(s)</button>` : ''}
      <p class="ayuda">También puede registrar punto por punto desde la lista de abajo.</p>
    </div>` : ''}
    <input class="buscador" id="buscar" placeholder="Buscar punto…" value="${esc(estado.filtro)}"
           oninput="estado.filtro=this.value; vRuta().then(()=>{const b=document.getElementById('buscar'); b.focus(); b.setSelectionRange(b.value.length,b.value.length);})">
    <ul class="lista">
      ${visibles.map(p => {
        const l = porPunto[p.id];
        const cls = !l ? 'pendiente' : (l.noMedido ? 'omitido' : ((l.avisos || []).some(a => a.nivel !== 'verde') ? 'alerta' : 'hecho'));
        const det = !l ? (p.grupo || CATALOGO.tipos[p.tipo].etiqueta)
          : (l.noMedido ? 'No medido: ' + esc(l.noMedido)
            : `${l.hora} · ${resumenValores(p, l.valores)}`);
        return `<li class="item ${cls}" onclick="ir('captura/${encodeURIComponent(p.id)}')">
            <div class="txt"><div class="nom">${esc(p.nombre)}</div><div class="det">${det}</div></div>
            <span class="est">${!l ? 'pendiente' : (l.noMedido ? 'omitido' : '✓')}</span>
          </li>`;
      }).join('')}
    </ul>
    ${!visibles.length ? '<p class="vacio">Sin puntos que coincidan con la búsqueda.</p>' : ''}
    <button class="secundario" onclick="cerrarRecorrido()">Cerrar recorrido</button>`;
}

function resumenValores(punto, valores) {
  const tipo = CATALOGO.tipos[punto.tipo];
  return tipo.campos.filter(c => valores[c.k] != null && valores[c.k] !== '')
    .slice(0, 3).map(c => `${nf(valores[c.k])} ${c.unidad}`).join(' · ') || 'registrado';
}

/* -------------------------------------------------------------- CAPTURA --- */
async function vCaptura(puntoId) {
  const punto = (await DB.todos(DB.S.CATALOGO)).find(p => p.id === puntoId);
  if (!punto) { toast('Punto no encontrado.'); ir('ruta'); return; }
  const tipo = CATALOGO.tipos[punto.tipo];
  const ultimo = await DB.ultimaDe(punto.id);
  estado.foto = null; estado.gps = null; estado.capturaAvisos = [];

  const yaHecha = estado.jornada
    ? (await DB.lecturasDeJornada(estado.jornada.id)).find(l => l.puntoId === punto.id && !String(l.estado).startsWith('anulada'))
    : null;

  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>${esc(punto.nombre)}</h2>
      <p>${esc(tipo.etiqueta)}${punto.grupo ? ' · ' + esc(punto.grupo) : ''}${punto.formato ? ' · ' + esc(punto.formato) : ''}</p>
      ${punto.nota ? `<div class="aviso info">⚠ ${esc(punto.nota)}</div>` : ''}
      ${ultimo ? `<div class="aviso info">Última lectura: <b>${resumenValores(punto, ultimo.valores)}</b><br>
          ${fFecha(ultimo.fecha)} ${ultimo.hora}${ultimo.deltaDiaProm ? ` · promedio histórico ${nf(ultimo.deltaDiaProm.toFixed(1))}/día` : ''}</div>`
        : '<div class="aviso info">Primera lectura registrada para este punto en el equipo.</div>'}
      ${yaHecha ? '<div class="aviso ambar">Este punto ya fue registrado en el recorrido. Si guarda otra vez, quedará como corrección con trazabilidad.</div>' : ''}

      <div class="dos">
        <div><label>Fecha</label><input type="date" id="inFecha" value="${DB.hoyISO()}"></div>
        <div><label>Hora</label><input type="time" id="inHora" value="${DB.horaHM()}"></div>
      </div>

      ${tipo.campos.map(c => `
        <label for="c_${c.k}">${esc(c.label)} <span class="u">${c.unidad ? '(' + esc(c.unidad) + ')' : ''}${c.req ? ' · obligatorio' : ''}</span></label>
        <input type="number" inputmode="decimal" step="any" id="c_${c.k}" oninput="revalidar('${punto.id}')">
      `).join('')}

      <div id="avisos"></div>

      <label>Estado del equipo</label>
      <select id="inEstado" onchange="revalidar('${punto.id}')">
        <option value="operativo">Operativo</option>
        <option value="display-danado">Display dañado / ilegible</option>
        <option value="bateria-baja">Batería baja</option>
        <option value="carcasa-danada">Carcasa dañada</option>
        <option value="fuga">Fuga de agua detectada</option>
        <option value="inoperativo">Inoperativo</option>
      </select>

      <label>Observaciones</label>
      <textarea id="inObs" placeholder="Anomalías, condiciones subestándar, causa de una variación…"></textarea>

      <label>Fotografía del display / punto</label>
      <input type="file" accept="image/*" capture="environment" onchange="tomarFoto(this)">
      <div id="previaFoto"></div>

      <div class="fila-btn" style="margin-top:16px">
        <button class="primario" onclick="guardarCaptura('${punto.id}')">Guardar lectura</button>
      </div>
      <button class="secundario" style="margin-top:8px" onclick="noMedido('${punto.id}')">No se pudo medir</button>
      <button class="secundario" style="margin-top:8px" onclick="ir('ruta')">Volver al recorrido</button>
      <p class="ayuda" id="gpsTxt">Ubicación: obteniendo…</p>
    </div>`;

  if (estado.cfg.autoGps && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => { estado.gps = { lat: p.coords.latitude, lon: p.coords.longitude, prec: p.coords.accuracy };
             $('#gpsTxt').textContent = `Ubicación: ${estado.gps.lat.toFixed(5)}, ${estado.gps.lon.toFixed(5)} (±${Math.round(estado.gps.prec)} m)`; },
      () => { $('#gpsTxt').textContent = 'Ubicación: no disponible (la lectura se guarda igual).'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  } else { $('#gpsTxt').textContent = ''; }
}

function leerValores(punto) {
  const v = {};
  CATALOGO.tipos[punto.tipo].campos.forEach(c => {
    const el = $('#c_' + c.k);
    if (el && el.value !== '') v[c.k] = Number(el.value);
  });
  return v;
}

async function revalidar(puntoId) {
  const punto = (await DB.todos(DB.S.CATALOGO)).find(p => p.id === puntoId);
  const ultimo = await DB.ultimaDe(puntoId);
  const avisos = DB.validar(punto, leerValores(punto), ultimo, estado.cfg);
  estado.capturaAvisos = avisos;
  const cont = $('#avisos');
  if (!cont) return;
  const conValor = CATALOGO.tipos[punto.tipo].campos.some(c => $('#c_' + c.k) && $('#c_' + c.k).value !== '');
  cont.innerHTML = avisos.length
    ? avisos.map(a => `<div class="aviso ${a.nivel}">${a.nivel === 'rojo' ? '⛔' : '⚠'} ${esc(a.msg)}</div>`).join('')
    : (conValor ? '<div class="aviso verde">✓ Valores dentro de lo esperado.</div>' : '');
}

async function tomarFoto(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const img = new Image();
  const url = URL.createObjectURL(f);
  img.onload = () => {
    const max = 900;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    estado.foto = cv.toDataURL('image/jpeg', 0.7);
    URL.revokeObjectURL(url);
    $('#previaFoto').innerHTML = `<div class="previa"><img src="${estado.foto}" alt="foto"><span class="ayuda">Foto lista (${Math.round(estado.foto.length / 1400)} KB aprox.)</span></div>`;
  };
  img.src = url;
}

async function guardarCaptura(puntoId) {
  const punto = (await DB.todos(DB.S.CATALOGO)).find(p => p.id === puntoId);
  const valores = leerValores(punto);
  const obs = $('#inObs').value.trim();
  const ultimo = await DB.ultimaDe(puntoId);
  const avisos = DB.validar(punto, valores, ultimo, estado.cfg);

  if (!Object.keys(valores).length) { toast('Ingrese al menos un valor o use «No se pudo medir».'); return; }

  const rojos = avisos.filter(a => a.nivel === 'rojo');
  const ambares = avisos.filter(a => a.nivel === 'ambar');

  if (rojos.length) {
    const soloMotivo = rojos.every(a => a.requiereMotivo);
    if (!soloMotivo) { await revalidar(puntoId); toast('Corrija los valores marcados en rojo.'); return; }
    if (!obs) { await revalidar(puntoId); toast('Explique en Observaciones por qué el acumulado bajó (reinicio, cambio de equipo…).'); return; }
    if (!confirm('El valor contradice la lectura anterior. Se guardará con la observación registrada y quedará marcado para revisión del hidrólogo. ¿Continuar?')) return;
  }
  if (ambares.length && estado.cfg.fotoObligatoriaEnAlerta && !estado.foto && !obs) {
    toast('Lectura fuera de rango: agregue una foto del display o una observación.');
    await revalidar(puntoId); return;
  }

  const anterior = estado.jornada
    ? (await DB.lecturasDeJornada(estado.jornada.id)).find(l => l.puntoId === puntoId && !String(l.estado).startsWith('anulada'))
    : null;

  const datos = {
    jornadaId: estado.jornada ? estado.jornada.id : null,
    rutaId: punto.ruta, puntoId: punto.id, punto: punto.nombre, tipo: punto.tipo,
    unidad: punto.unidad, fecha: $('#inFecha').value, hora: $('#inHora').value,
    valores, obs, estadoEquipo: $('#inEstado').value,
    anomalia: $('#inEstado').value !== 'operativo' ? $('#inEstado').selectedOptions[0].text : null,
    foto: estado.foto, gps: estado.gps, avisos
  };

  if (anterior) await DB.corregirLectura(anterior.id, datos, 'segunda lectura en el mismo recorrido');
  else await DB.guardarLectura(datos);

  toast('Guardado en el equipo' + (!estado.cfg.endpoint ? '.'
    : navigator.onLine ? ', se enviará al servidor.' : '. Se enviará cuando haya señal, con la app abierta.'));
  sincronizarAhora(true);
  await siguientePunto(punto);
}

async function siguientePunto(punto) {
  if (!estado.jornada) { ir('inicio'); return; }
  const puntos = await DB.puntosDeRuta(punto.ruta);
  const hechas = new Set((await DB.lecturasDeJornada(estado.jornada.id))
    .filter(l => !String(l.estado).startsWith('anulada')).map(l => l.puntoId));
  const sig = puntos.find(p => !hechas.has(p.id));
  if (sig) ir('captura/' + encodeURIComponent(sig.id));
  else { toast('Recorrido completo. Revise y cierre el recorrido.'); ir('ruta'); }
}

async function noMedido(puntoId) {
  const punto = (await DB.todos(DB.S.CATALOGO)).find(p => p.id === puntoId);
  const motivos = ['Sin acceso al punto', 'Equipo inoperativo / display ilegible', 'Tormenta eléctrica o clima adverso',
    'Cisterna o equipo pesado abasteciendo', 'Punto fuera de servicio', 'Otro'];
  const n = prompt('Motivo por el que no se midió:\n' + motivos.map((m, i) => `${i + 1}. ${m}`).join('\n'), '1');
  if (n === null) return;
  const idx = parseInt(n, 10) - 1;
  let motivo = motivos[idx] || n;
  if (motivo === 'Otro') { motivo = prompt('Describa el motivo:', '') || 'Otro'; }
  await DB.guardarLectura({
    jornadaId: estado.jornada ? estado.jornada.id : null,
    rutaId: punto.ruta, puntoId: punto.id, punto: punto.nombre, tipo: punto.tipo, unidad: punto.unidad,
    valores: {}, noMedido: motivo, obs: 'No medido: ' + motivo, gps: estado.gps, foto: estado.foto, avisos: []
  });
  toast('Registrado como no medido.');
  await siguientePunto(punto);
}

/* ============== CAPTURA POR FOTO DE HOJA / PANEL Y TRANSCRIPCIÓN ==========
   Pensado para hojas largas (decenas de piezómetros, o bombas con siete
   campos cada una): en campo se fotografía, en gabinete se digita.
   ========================================================================== */

let _fotosHoja = [];      // fotos de la captura en curso (aún no guardada)

function comprimir(file, max, calidad) {
  return new Promise(res => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

async function vFotoHoja(rutaId) {
  const ruta = CATALOGO.rutas.find(r => r.id === rutaId);
  if (!ruta) { ir('ruta'); return; }
  const puntos = await DB.puntosDeRuta(rutaId);
  _fotosHoja = []; estado.gps = null;

  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Foto de hoja o panel</h2>
      <p>${esc(ruta.nombre)}${ruta.formato ? ' · ' + esc(ruta.formato) : ''}</p>
      <div class="aviso info">Fotografíe la hoja completa. Si el formato tiene dos columnas o dos páginas,
        agregue las fotos que necesite. Los valores se digitan después, con la foto al frente.</div>

      <label>Fotos</label>
      <input type="file" accept="image/*" capture="environment" multiple onchange="agregarFotosHoja(this)">
      <div id="previaHoja" class="previa-grid"></div>

      <label>Puntos que cubre esta hoja</label>
      <div class="fila-btn" style="margin-bottom:8px">
        <button class="secundario" style="min-height:40px" onclick="marcarPuntos(true)">Todos</button>
        <button class="secundario" style="min-height:40px" onclick="marcarPuntos(false)">Ninguno</button>
      </div>
      <div class="caja-scroll">
        ${puntos.map(p => `<div class="check"><input type="checkbox" class="pt" id="pt_${p.id}" value="${p.id}" checked>
          <span>${esc(p.nombre)}${p.grupo ? ' <small style="color:var(--suave)">· ' + esc(p.grupo) + '</small>' : ''}</span></div>`).join('')}
      </div>

      <label>Observaciones de la hoja</label>
      <textarea id="obsHoja" placeholder="Condiciones, puntos sin acceso, incidencias…"></textarea>

      <button class="primario" style="margin-top:14px" onclick="guardarHoja('${rutaId}')">Guardar hoja</button>
      <button class="secundario" style="margin-top:8px" onclick="ir('ruta')">Cancelar</button>
      <p class="ayuda" id="gpsTxt">Ubicación: obteniendo…</p>
    </div>`;

  if (estado.cfg.autoGps && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => { estado.gps = { lat: p.coords.latitude, lon: p.coords.longitude, prec: p.coords.accuracy };
             const t = $('#gpsTxt'); if (t) t.textContent = `Ubicación: ${estado.gps.lat.toFixed(5)}, ${estado.gps.lon.toFixed(5)} (±${Math.round(estado.gps.prec)} m)`; },
      () => { const t = $('#gpsTxt'); if (t) t.textContent = 'Ubicación: no disponible (la hoja se guarda igual).'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
}

const marcarPuntos = v => document.querySelectorAll('.pt').forEach(c => { c.checked = v; });

async function agregarFotosHoja(input) {
  for (const f of Array.from(input.files || [])) {
    const d = await comprimir(f, 1600, 0.82);   // resolución alta: hay que leer números escritos a mano
    if (d) _fotosHoja.push(d);
  }
  input.value = '';
  $('#previaHoja').innerHTML = _fotosHoja.map((d, i) =>
    `<div class="mini"><img src="${d}" onclick="verFoto(${i})"><button class="quitar" onclick="quitarFotoHoja(${i})">✕</button></div>`).join('')
    + (_fotosHoja.length ? `<p class="ayuda">${_fotosHoja.length} foto(s) · ${Math.round(_fotosHoja.reduce((a, d) => a + d.length, 0) / 1400)} KB aprox.</p>` : '');
}

function quitarFotoHoja(i) { _fotosHoja.splice(i, 1); agregarFotosHoja({ files: [] }); }

async function guardarHoja(rutaId) {
  if (!_fotosHoja.length) { toast('Tome al menos una foto de la hoja o el panel.'); return; }
  const puntoIds = Array.from(document.querySelectorAll('.pt:checked')).map(c => c.value);
  if (!puntoIds.length) { toast('Marque al menos un punto que cubra esta hoja.'); return; }

  const fotoIds = [];
  for (const d of _fotosHoja) fotoIds.push(await DB.guardarFoto(d));
  const hoja = await DB.crearHoja({
    rutaId, jornadaId: estado.jornada ? estado.jornada.id : null,
    puntoIds, fotoIds, gps: estado.gps, obs: $('#obsHoja').value.trim()
  });
  _fotosHoja = [];
  toast('Hoja guardada en el equipo. Puede transcribirla cuando quiera.');
  await pintarEstadoRed();
  ir('hoja/' + hoja.id);
}

/* -------- bandeja de hojas por transcribir -------------------------------- */
async function vHojas() {
  const hojas = (await DB.todos(DB.S.HOJAS)).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  const pend = hojas.filter(h => h.estado === 'por-transcribir');
  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Hojas fotografiadas (${pend.length} por transcribir)</h2>
      <p>Cada hoja guarda la foto, el operador, la fecha y el GPS. La transcripción se puede hacer
         en el celular o en la PC de oficina, con la misma app.</p>
    </div>
    <ul class="lista">
      ${hojas.map(h => {
        const ruta = CATALOGO.rutas.find(r => r.id === h.rutaId) || {};
        return `<li class="item ${h.estado === 'transcrita' ? 'hecho' : 'alerta'}" onclick="ir('hoja/${h.id}')">
          <div class="txt"><div class="nom">${esc(ruta.nombre || h.rutaId)}</div>
          <div class="det">${fFecha(h.fecha)} ${h.hora} · ${h.puntoIds.length} puntos · ${h.fotoIds.length} foto(s) · ${esc(h.operador || '')}</div></div>
          <span class="est">${h.estado === 'transcrita' ? '✓' : (h.faltan != null ? 'faltan ' + h.faltan : 'por transcribir')}</span></li>`;
      }).join('')}
    </ul>
    ${!hojas.length ? '<p class="vacio">Todavía no hay hojas fotografiadas.</p>' : ''}`;
}

/* -------- transcripción de una hoja --------------------------------------- */
async function vHoja(id) {
  const hoja = await DB.get(DB.S.HOJAS, id);
  if (!hoja) { ir('hojas'); return; }
  const ruta = CATALOGO.rutas.find(r => r.id === hoja.rutaId) || {};
  const catalogo = await DB.todos(DB.S.CATALOGO);
  const puntos = hoja.puntoIds.map(pid => catalogo.find(p => p.id === pid)).filter(Boolean);
  const yaHechas = (await DB.todos(DB.S.LECTURAS))
    .filter(l => l.hojaId === id && !String(l.estado).startsWith('anulada'));
  const previas = {}; yaHechas.forEach(l => { previas[l.puntoId] = l; });

  estado.fotosVista = [];
  for (const fid of hoja.fotoIds) {
    const f = await DB.obtenerFoto(fid);
    if (f) estado.fotosVista.push(f.dataURL);
  }

  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Transcripción de hoja</h2>
      <p>${esc(ruta.nombre || hoja.rutaId)}${ruta.formato ? ' · ' + esc(ruta.formato) : ''}</p>
      <p>${fFecha(hoja.fecha)} ${hoja.hora} · ${esc(hoja.operador || '')} · ${hoja.puntoIds.length} puntos</p>
      ${hoja.obs ? `<div class="aviso info">${esc(hoja.obs)}</div>` : ''}
      ${OCR.disponible() ? `<button class="secundario" onclick="detectarNumeros()">Detectar números en la foto</button><div id="chipsOCR"></div>` : ''}
    </div>

    <!-- La foto queda fija arriba mientras se baja por los campos -->
    <div class="foto-fija">
      ${estado.fotosVista.map((d, i) => `<img src="${d}" onclick="verFoto(${i})">`).join('')}
      ${estado.fotosVista.length ? '<span class="ayuda">Toque la foto para verla en grande</span>'
        : '<span class="ayuda">Las fotos de esta hoja ya fueron liberadas del equipo para ganar espacio.</span>'}
    </div>

    <div id="avisosHoja"></div>

    ${puntos.map(p => {
      const t = CATALOGO.tipos[p.tipo];
      const pv = previas[p.id];
      return `<div class="tarjeta punto-hoja ${pv ? 'listo' : ''}" id="card_${p.id}">
        <h2>${esc(p.nombre)} ${pv ? '<span class="est">✓ registrado</span>' : ''}</h2>
        <div class="campos">
          ${t.campos.map(c => `<div>
            <label for="t_${p.id}_${c.k}">${esc(c.label)} <span class="u">${c.unidad ? '(' + esc(c.unidad) + ')' : ''}</span></label>
            <input type="number" inputmode="decimal" step="any" class="tcampo" id="t_${p.id}_${c.k}"
                   value="${pv && pv.valores[c.k] != null ? pv.valores[c.k] : ''}" onkeydown="saltarCampo(event)">
          </div>`).join('')}
        </div>
        <input type="text" class="obs-punto" id="o_${p.id}" placeholder="Observación del punto (opcional)"
               value="${pv ? esc(pv.obs) : ''}">
      </div>`;
    }).join('')}

    <button class="primario" onclick="guardarTranscripcion('${id}')">Guardar transcripción</button>
    <button class="secundario" style="margin-top:8px" onclick="ir('hojas')">Volver</button>
    <p class="ayuda">Puede guardar a medias y continuar después: lo que falte queda marcado.</p>`;
}

function saltarCampo(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const campos = Array.from(document.querySelectorAll('.tcampo'));
  const i = campos.indexOf(ev.target);
  if (i > -1 && campos[i + 1]) { campos[i + 1].focus(); campos[i + 1].select(); }
}

async function guardarTranscripcion(id) {
  const hoja = await DB.get(DB.S.HOJAS, id);
  const catalogo = await DB.todos(DB.S.CATALOGO);
  const filas = [];
  hoja.puntoIds.forEach(pid => {
    const punto = catalogo.find(p => p.id === pid);
    if (!punto) return;
    const valores = {};
    CATALOGO.tipos[punto.tipo].campos.forEach(c => {
      const el = $('#t_' + pid + '_' + c.k);
      if (el && el.value !== '') valores[c.k] = Number(el.value);
    });
    const o = $('#o_' + pid);
    filas.push({ puntoId: pid, valores, obs: o ? o.value.trim() : '' });
  });

  const r = await DB.transcribirHoja(id, filas);
  const guardadas = (await DB.todos(DB.S.LECTURAS)).filter(l => l.hojaId === id && !String(l.estado).startsWith('anulada'));
  const conAviso = guardadas.filter(l => (l.avisos || []).length);

  $('#avisosHoja').innerHTML = `
    <div class="aviso ${r.faltan ? 'ambar' : 'verde'}">
      ${r.faltan ? `Se guardaron ${guardadas.length} punto(s). Faltan ${r.faltan} por digitar.`
                 : `Hoja completa: ${guardadas.length} punto(s) registrados.`}
    </div>
    ${conAviso.map(l => `<div class="aviso ambar"><b>${esc(l.punto)}</b>: ${esc((l.avisos[0] || {}).msg || '')}</div>`).join('')}`;
  window.scrollTo(0, 0);
  toast(r.faltan ? `Guardado. Faltan ${r.faltan} punto(s).` : 'Hoja transcrita completa.');
  await pintarEstadoRed();
  sincronizarAhora(true);
}

/* -------- visor de foto con zoom ------------------------------------------ */
function verFoto(i) {
  const src = (estado.fotosVista && estado.fotosVista[i]) || _fotosHoja[i];
  if (!src) return;
  const ov = document.createElement('div');
  ov.className = 'visor';
  ov.innerHTML = `<div class="visor-barra"><button onclick="this.closest('.visor').remove()">✕ Cerrar</button>
    <button onclick="this.closest('.visor').querySelector('img').classList.toggle('zoom')">⤢ Zoom</button></div>
    <div class="visor-cuerpo"><img src="${src}"></div>`;
  document.body.appendChild(ov);
}

async function detectarNumeros() {
  const cont = $('#chipsOCR');
  cont.innerHTML = '<p class="ayuda">Analizando la foto…</p>';
  const nums = await OCR.numeros(estado.fotosVista[0]);
  if (!nums.length) { cont.innerHTML = '<p class="ayuda">No se reconocieron números con seguridad. Digite manualmente.</p>'; return; }
  cont.innerHTML = `<p class="ayuda">Toque un número para colocarlo en el campo seleccionado (verifique siempre contra la foto):</p>
    <div class="filtros">${nums.map(n => `<button class="filtro secundario" onclick="ponerValor('${n}')">${n}</button>`).join('')}</div>`;
}

function ponerValor(n) {
  const el = document.activeElement && document.activeElement.classList.contains('tcampo')
    ? document.activeElement : estado.ultimoCampo;
  if (!el) { toast('Primero toque el campo donde va el número.'); return; }
  el.value = n;
  const campos = Array.from(document.querySelectorAll('.tcampo'));
  const i = campos.indexOf(el);
  if (campos[i + 1]) { campos[i + 1].focus(); estado.ultimoCampo = campos[i + 1]; }
}

document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('tcampo')) estado.ultimoCampo = e.target; });

/* -------------------------------------------------------------- BANDEJA --- */
async function vBandeja(filtro) {
  const f = filtro || 'todas';
  let ls = await DB.todos(DB.S.LECTURAS);
  ls.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
  const total = ls.length;
  if (f === 'pendientes') ls = ls.filter(l => l.estado === 'pendiente');
  if (f === 'error') ls = ls.filter(l => l.estado === 'error');
  if (f === 'alertas') ls = ls.filter(l => (l.avisos || []).length);
  if (f === 'anuladas') ls = ls.filter(l => String(l.estado).startsWith('anulada'));

  const hojasPend = (await DB.hojasPendientes()).length;
  const chip = (k, t) => `<button class="filtro ${f === k ? 'primario' : 'secundario'}" onclick="ir('bandeja/${k}')">${t}</button>`;

  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Bandeja de registros (${ls.length}/${total})</h2>
      <div class="filtros">
        ${chip('todas', 'Todas')}${chip('pendientes', 'Por enviar')}${chip('error', 'Con error')}${chip('alertas', 'Con alerta')}${chip('anuladas', 'Anuladas')}
      </div>
      <div class="fila-btn" style="margin-top:10px">
        <button class="primario" onclick="sincronizarAhora()">Sincronizar</button>
        <button class="secundario" onclick="ir('hojas')">Hojas${hojasPend ? ' (' + hojasPend + ')' : ''}</button>
        <button class="secundario" onclick="ir('exportar')">Exportar</button>
      </div>
    </div>
    <ul class="lista">
      ${ls.slice(0, 300).map(l => {
        const cls = String(l.estado).startsWith('anulada') ? 'omitido'
          : l.estado === 'enviado' ? 'hecho' : (l.avisos || []).length ? 'alerta' : 'pendiente';
        return `<li class="item ${cls}" onclick="ir('detalle/${l.id}')">
          <div class="txt"><div class="nom">${esc(l.punto)}</div>
          <div class="det">${fFecha(l.fecha)} ${l.hora} · ${l.noMedido ? 'no medido' : resumenValoresTipo(l)}</div></div>
          <span class="est">${esc(l.estado)}</span></li>`;
      }).join('')}
    </ul>
    ${!ls.length ? '<p class="vacio">No hay registros con este filtro.</p>' : ''}`;
}

function resumenValoresTipo(l) {
  const t = CATALOGO.tipos[l.tipo];
  if (!t) return '';
  return t.campos.filter(c => l.valores[c.k] != null).slice(0, 2).map(c => `${nf(l.valores[c.k])} ${c.unidad}`).join(' · ');
}

async function vDetalle(id) {
  const l = await DB.get(DB.S.LECTURAS, id);
  if (!l) { ir('bandeja'); return; }
  const t = CATALOGO.tipos[l.tipo] || { campos: [] };
  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>${esc(l.punto)}</h2>
      <p>${fFecha(l.fecha)} ${l.hora} · ${esc(l.operador || '')} · ${esc(l.empresa || '')}</p>
      <p>Estado: <b>${esc(l.estado)}</b>${l.intentos ? ` · ${l.intentos} intento(s) de envío` : ''}${l.ultimoError ? ' · ' + esc(l.ultimoError) : ''}</p>
      <h3 class="sec">Valores</h3>
      ${t.campos.filter(c => l.valores[c.k] != null).map(c => `<p><b>${esc(c.label)}:</b> ${nf(l.valores[c.k])} ${esc(c.unidad)}</p>`).join('') || '<p>Sin valores (no medido).</p>'}
      ${l.noMedido ? `<div class="aviso ambar">No medido: ${esc(l.noMedido)}</div>` : ''}
      ${l.obs ? `<p><b>Observaciones:</b> ${esc(l.obs)}</p>` : ''}
      ${(l.avisos || []).map(a => `<div class="aviso ${a.nivel}">${esc(a.msg)}</div>`).join('')}
      ${l.foto ? `<div class="previa"><img src="${l.foto}" style="width:100%;height:auto;max-height:320px;object-fit:contain"></div>` : ''}
      ${l.hojaId ? `<p class="ayuda">Transcrito de una foto de hoja. <a href="#/hoja/${l.hojaId}">Ver la hoja y su fotografía</a></p>` : ''}
      <h3 class="sec">Trazabilidad</h3>
      <p class="ayuda">ID ${esc(l.id)}<br>Huella ${esc(l.huella)}<br>Dispositivo ${esc(l.dispositivo)} · app ${esc(l.appVersion)}<br>
      Creado ${esc(l.creado)}${l.enviadoEl ? '<br>Enviado ' + esc(l.enviadoEl) : ''}
      ${l.editadoDe ? '<br>Corrige al registro ' + esc(l.editadoDe) : ''}
      ${l.gps ? `<br>GPS ${l.gps.lat.toFixed(5)}, ${l.gps.lon.toFixed(5)} (±${Math.round(l.gps.prec || 0)} m)` : '<br>Sin GPS'}</p>
      <button class="secundario" onclick="ir('captura/${encodeURIComponent(l.puntoId)}')">Registrar corrección</button>
      <button class="secundario" style="margin-top:8px" onclick="ir('bandeja')">Volver</button>
    </div>`;
}

/* ------------------------------------------------------------- EXPORTAR --- */
async function vExportar() {
  const ls = await DB.todos(DB.S.LECTURAS);
  const hoy = DB.hoyISO(); const mes = hoy.slice(0, 7);
  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Exportar información</h2>
      <p>Se genera en el propio equipo: no necesita conexión.</p>
      <label>Rango</label>
      <select id="selRango">
        <option value="jornada">Recorrido actual</option>
        <option value="hoy" selected>Hoy (${fFecha(hoy)})</option>
        <option value="mes">Mes en curso (${mes})</option>
        <option value="pendientes">Solo lo no enviado</option>
        <option value="todo">Todo lo que está en el equipo (${ls.length})</option>
      </select>
      <div class="fila-btn" style="margin-top:14px">
        <button class="primario" onclick="exportar('xlsx')">Excel (.xlsx)</button>
        <button class="secundario" onclick="exportar('csv')">CSV</button>
      </div>
      <button class="secundario" style="margin-top:8px" onclick="exportar('json')">Respaldo / relevo de turno (.json)</button>
      <p class="ayuda">El Excel trae una hoja por tipo de registro (caudalímetros, piezómetros, pozos, planta de tratamiento, aforos, reglas y meteorología) más la hoja de trazabilidad para auditoría.</p>
    </div>
    <div class="tarjeta">
      <h2>Importar respaldo</h2>
      <p>Para consolidar el turno de otro operador cuando no hubo red en campo.</p>
      <input type="file" accept="application/json,.json" onchange="importar(this)">
    </div>`;
}

async function seleccion(rango) {
  const ls = await DB.todos(DB.S.LECTURAS);
  if (rango === 'jornada' && estado.jornada) return ls.filter(l => l.jornadaId === estado.jornada.id);
  if (rango === 'hoy') return ls.filter(l => l.fecha === DB.hoyISO());
  if (rango === 'mes') return ls.filter(l => String(l.fecha).startsWith(DB.hoyISO().slice(0, 7)));
  if (rango === 'pendientes') return ls.filter(l => l.estado === 'pendiente' || l.estado === 'error');
  return ls;
}

async function exportar(formato) {
  const rango = $('#selRango').value;
  const ls = await seleccion(rango);
  if (!ls.length) { toast('No hay registros en el rango elegido.'); return; }
  const jornadas = await DB.todos(DB.S.JORNADAS);
  const sello = DB.hoyISO() + '-' + DB.horaHM().replace(':', '-');   // hora local del equipo
  const base = `registro_${String(estado.cfg.unidad).replace(/[^\w-]+/g, '-')}_${rango}_${sello}`;

  if (formato === 'xlsx') {
    const bytes = XLS.libroCompleto(ls, jornadas);
    descargar(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
  } else if (formato === 'csv') {
    descargar(new Blob([XLS.csvPlano(ls)], { type: 'text/csv;charset=utf-8' }), base + '.csv');
  } else {
    const paq = await DB.exportarRespaldo();
    descargar(new Blob([JSON.stringify(paq)], { type: 'application/json' }), base + '.json');
  }
  DB.bitacora('exportacion', { formato, rango, registros: ls.length });
}

async function descargar(blob, nombre) {
  const file = new File([blob], nombre, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nombre }); return; } catch (e) { /* sigue a descarga */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  toast('Archivo generado: ' + nombre);
}

async function importar(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  try {
    const r = await DB.importarRespaldo(JSON.parse(await f.text()));
    toast(`Importado: ${r.nuevas} registros nuevos, ${r.repetidas} ya existían.`);
    pintarEstadoRed();
  } catch (e) { toast('No se pudo importar: ' + e.message); }
}

/* -------------------------------------------------------------- AJUSTES --- */
async function vAjustes() {
  const alm = await DB.usoAlmacenamiento();
  const idEquipo = await DB.idDispositivo();
  const persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const c = estado.cfg;
  $('#app').innerHTML = `
    <div class="tarjeta">
      <h2>Datos del operador</h2>
      <label>Nombre</label><input id="aOperador" value="${esc(c.operador)}">
      <label>DNI</label><input id="aDni" value="${esc(c.dni)}">
      <label>Empresa</label><input id="aEmpresa" value="${esc(c.empresa)}">
      <label>Unidad</label>
      <select id="aUnidad">
        ${[...new Set(CATALOGO.rutas.map(r => r.unidad))].map(u =>
          `<option ${c.unidad === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}
      </select>
    </div>
    <div class="tarjeta">
      <h2>Servidor</h2>
      <label>Endpoint de sincronización</label>
      <input id="aEndpoint" value="${esc(c.endpoint)}" placeholder="https://…/api/lecturas">
      <label>Clave de API</label><input id="aApiKey" type="password" autocomplete="off" value="${esc(c.apiKey)}" placeholder="opcional">
      <p class="ayuda">Sin servidor la app funciona igual: los datos quedan en el equipo y se exportan a Excel.</p>
    </div>
    <div class="tarjeta">
      <h2>Comportamiento</h2>
      <label>Tolerancia de desviación frente al histórico (%)</label>
      <input type="number" id="aTol" value="${c.toleranciaDelta}" min="5" max="200">
      <div class="check"><input type="checkbox" id="aCampo" ${c.modoCampo ? 'checked' : ''}><span>Modo campo: alto contraste y letra grande</span></div>
      <div class="check"><input type="checkbox" id="aGps" ${c.autoGps ? 'checked' : ''}><span>Registrar ubicación GPS en cada lectura</span></div>
      <div class="check"><input type="checkbox" id="aFoto" ${c.fotoObligatoriaEnAlerta ? 'checked' : ''}><span>Exigir foto u observación cuando el valor sale de rango</span></div>
      <button class="primario" style="margin-top:14px" onclick="guardarAjustes()">Guardar ajustes</button>
    </div>
    <div class="tarjeta">
      <h2>Listo para trabajar sin conexión</h2>
      <div id="estadoOffline"><p class="ayuda">Comprobando…</p></div>
      <button class="secundario" onclick="vAjustes()">Volver a comprobar</button>
    </div>
    <div class="tarjeta">
      <h2>Equipo y datos</h2>
      <p>Dispositivo: <b>${esc(idEquipo)}</b></p>
      <p>Almacenamiento ${persistente ? 'persistente (protegido)' : 'no persistente'}${alm ? ` · ${(alm.usado / 1048576).toFixed(1)} MB usados` : ''}</p>
      <p>Catálogo ${esc(CATALOGO.version)} · ${CATALOGO.puntos.length} puntos</p>
      <button class="secundario" onclick="recargarCatalogo()">Actualizar catálogo de puntos</button>
      <button class="peligro" style="margin-top:8px" onclick="limpiarEnviados()">Liberar espacio: borrar fotos ya enviadas</button>
    </div>
    <small class="pie">Registro de campo ${APP_VERSION}</small>`;
  revisarOffline();
}

/* El operador necesita saber, ANTES de salir a campo, si la app ya quedó
   guardada en el equipo. Esto se lo dice sin tecnicismos. */
async function revisarOffline() {
  const cont = $('#estadoOffline');
  if (!cont) return;
  const partes = [];
  let listo = true;

  if (!('serviceWorker' in navigator)) {
    listo = false;
    partes.push('Este navegador no permite guardar la app en el equipo. Use Chrome (Android) o Safari (iPhone), y abra la app por su dirección https, no como archivo.');
  } else {
    const reg = await navigator.serviceWorker.getRegistration();
    const claves = await caches.keys();
    let archivos = 0;
    if (claves.length) archivos = (await (await caches.open(claves[0])).keys()).length;
    if (!reg) { listo = false; partes.push('La app todavía no se guardó en el equipo.'); }
    else if (!archivos) { listo = false; partes.push('La app se está guardando; espere unos segundos con señal y vuelva a comprobar.'); }
    else partes.push(`Aplicación guardada en el equipo (${archivos} archivos). Abre aunque no haya señal.`);
  }

  const persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  partes.push(persistente
    ? 'Almacenamiento protegido: el sistema no borrará las lecturas por falta de espacio.'
    : 'Almacenamiento no protegido todavía: se activa al instalar la app en la pantalla de inicio.');

  const pend = (await DB.pendientes()).length;
  const hojas = (await DB.hojasPendientes()).length;
  if (pend || hojas) partes.push(`Hay ${pend} lectura(s) por enviar y ${hojas} hoja(s) por transcribir en este equipo.`);

  cont.innerHTML = `<div class="aviso ${listo ? 'verde' : 'ambar'}">
      <b>${listo ? '✓ Puede salir a campo sin señal' : '⚠ Todavía no está lista para trabajar sin señal'}</b>
    </div>
    ${partes.map(p => `<p class="ayuda">· ${esc(p)}</p>`).join('')}
    ${!listo ? '<p class="ayuda">Solución: con señal, cierre y vuelva a abrir la app una vez; luego instálela desde el menú del navegador («Añadir a pantalla de inicio»).</p>' : ''}`;
}

async function guardarAjustes() {
  const pares = {
    operador: $('#aOperador').value.trim(), dni: $('#aDni').value.trim(), empresa: $('#aEmpresa').value.trim(),
    unidad: $('#aUnidad').value, endpoint: $('#aEndpoint').value.trim(), apiKey: $('#aApiKey').value.trim(),
    toleranciaDelta: Number($('#aTol').value) || 40, modoCampo: $('#aCampo').checked,
    autoGps: $('#aGps').checked, fotoObligatoriaEnAlerta: $('#aFoto').checked
  };
  for (const [k, v] of Object.entries(pares)) await DB.guardarConfig(k, v);
  estado.cfg = await DB.cargarConfig();
  document.documentElement.dataset.campo = estado.cfg.modoCampo ? '1' : '0';
  toast('Ajustes guardados.');
}

async function recargarCatalogo() {
  if (!confirm('Se reemplazarán los puntos con el catálogo de esta versión de la app. Las lecturas ya tomadas no se tocan. ¿Continuar?')) return;
  await DB.sembrarCatalogo(true);
  toast('Catálogo actualizado.');
}

async function limpiarEnviados() {
  if (!confirm('Se borrarán solo las fotos de hojas ya transcritas y de lecturas ya enviadas al servidor. ¿Continuar?')) return;
  const n = await DB.liberarFotos();
  toast(`${n} fotografía(s) liberadas del equipo.`);
}

/* --------------------------------------------------------- SINCRONIZAR --- */
async function sincronizarAhora(silencioso) {
  const r = await DB.sincronizar();
  await pintarEstadoRed();
  if (silencioso) return r;
  if (r.total === 0) toast('No hay nada pendiente de enviar.');
  else if (r.motivo === 'sin-endpoint') toast('No hay servidor configurado. Use Exportar para entregar el Excel.');
  else if (r.motivo === 'sin-red') toast(`Sin conexión. ${r.total} registro(s) esperando; se enviarán al recuperar señal, con la app abierta.`);
  else toast(`Enviados ${r.enviados} de ${r.total}${r.fallidos ? `, ${r.fallidos} reintentarán luego` : ''}.`);
  if (location.hash.includes('bandeja')) enrutar();
  return r;
}

document.addEventListener('DOMContentLoaded', iniciar);
