/* La Parepa C2.13.8 - mantenimiento único de integridad de datos */
(function (global) {
  'use strict';

  if (global.__lpMantenimientoDatosC2138) return;
  global.__lpMantenimientoDatosC2138 = true;

  const VERSION = 'C2.13.8';
  const CONFIG_DOC = 'mantenimientoDatosC2138';
  const MODAL_ID = 'lpModalMantenimientoDatos';
  const LOCK_MINUTES = 30;
  const state = { running: false, lastStatus: null };

  function core() { return global.LP_CORE || null; }
  function services() {
    try { return core()?.services?.() || {}; } catch (_) { return {}; }
  }

  function normalizeRole(value) {
    try { return core()?.normalizeRole?.(value) || String(value || '').trim().toLowerCase(); }
    catch (_) { return String(value || '').trim().toLowerCase(); }
  }

  function currentRole() {
    return normalizeRole(global.LP_PROFILE?.rol || global.rolActual || localStorage.getItem('rolActual') || '');
  }

  function isAdmin() { return currentRole() === 'admin'; }

  function escapeHTML(value) {
    try { return core()?.escapeHTML?.(String(value ?? '')) || String(value ?? ''); }
    catch (_) { return String(value ?? ''); }
  }

  function money(value) {
    try { return core()?.money?.(Number(value || 0)) || Number(value || 0).toLocaleString('es-CO'); }
    catch (_) { return String(value || 0); }
  }

  function validDayKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function validNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) >= 0;
  }

  function parseMaintenanceDate(value) {
    if (!value) return null;
    try {
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
      }
    } catch (_) {}
    try {
      const seconds = Number(value?.seconds ?? value?._seconds);
      const nanos = Number(value?.nanoseconds ?? value?._nanoseconds ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) {
        const d = new Date((seconds * 1000) + Math.floor(nanos / 1e6));
        if (!Number.isNaN(d.getTime())) return d;
      }
    } catch (_) {}

    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;

    const text = String(value || '').trim().toLowerCase()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/a\.\s*m\./g, 'am')
      .replace(/p\.\s*m\./g, 'pm');
    const match = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[, ]+\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
    if (!match) return null;
    let hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const meridian = String(match[7] || '').toLowerCase();
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    const d = new Date(`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}-05:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function parseSaleDate(raw) {
    return (
      parseMaintenanceDate(raw?.fechaISO) ||
      parseMaintenanceDate(raw?.fecha) ||
      parseMaintenanceDate(raw?.creadoServidor) ||
      parseMaintenanceDate(raw?.createdAt) ||
      null
    );
  }

  function deriveOperationalDay(raw) {
    // C2.13.6: la fecha/hora real manda. Esto corrige diaClave con formato válido
    // pero perteneciente al día equivocado.
    const date = parseSaleDate(raw);
    if (date) {
      try {
        const day = global.obtenerDiaOperativoCaja?.(date);
        if (validDayKey(day)) return String(day);
      } catch (_) {}
    }
    if (validDayKey(raw?.diaClave)) return String(raw.diaClave);
    return '';
  }

  function normalizedForMaintenance(raw, docId) {
    let n = raw || {};
    try { n = global.normalizarVenta?.({ _docId: docId, ...raw }) || n; } catch (_) {}
    const day = deriveOperationalDay(raw) || (validDayKey(n?.diaClave) ? n.diaClave : '');
    return { ...n, _docId: docId, diaClave: day };
  }

  function isCancelled(v) {
    try { return Boolean(global.esVentaCancelada?.(v)); }
    catch (_) { return String(v?.estado || '').toLowerCase() === 'cancelada'; }
  }

  function isDelivery(v) {
    try { return Boolean(global.esPedidoDomicilio?.(v)); }
    catch (_) { return String(v?.tipoPedido || '').toLowerCase() === 'domicilio'; }
  }

  function income(v) {
    try { return Number(global.obtenerIngresoRealVenta?.(v) || 0); }
    catch (_) { return Number(v?.totalCobrado ?? v?.total ?? 0) || 0; }
  }

  function deliveryValue(v) {
    try { return Number(global.obtenerValorDomicilio?.(v) || 0); }
    catch (_) { return Number(v?.costoDomicilio || 0) || 0; }
  }

  function transferDelivery(v) {
    try { return Number(global.obtenerValorDomicilioCubiertoPorTransferencia?.(v) || 0); }
    catch (_) { return 0; }
  }

  function cashDelivery(v) {
    try { return Number(global.obtenerValorDomicilioCubiertoPorEfectivo?.(v) || 0); }
    catch (_) { return 0; }
  }

  function weekKey(day) {
    try {
      const d = new Date(`${day}T12:00:00-05:00`);
      const key = global.obtenerClaveSemana?.(d);
      if (key) return String(key);
    } catch (_) {}

    // Fallback ISO week.
    const [y,m,d] = String(day).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-S${String(weekNo).padStart(2,'0')}`;
  }

  function summarizeDay(day, sales) {
    const active = sales.filter(v => !isCancelled(v));
    const cancelled = sales.filter(isCancelled);
    const deliveries = active.filter(isDelivery);
    return {
      diaClave: day,
      semanaClave: weekKey(day),
      mesClave: String(day).slice(0,7),
      ventas: active.length,
      canceladas: cancelled.length,
      domicilios: deliveries.length,
      domiciliosCancelados: cancelled.filter(isDelivery).length,
      tieneDomicilios: deliveries.length > 0,
      total: active.reduce((a,v) => a + income(v), 0),
      totalDomicilios: deliveries.reduce((a,v) => a + deliveryValue(v), 0),
      domiciliosTransferencia: deliveries.filter(v => transferDelivery(v) > 0).length,
      domiciliosEfectivo: deliveries.filter(v => cashDelivery(v) > 0).length,
      valorDomiciliosTransferencia: deliveries.reduce((a,v) => a + transferDelivery(v), 0),
      valorDomiciliosEfectivo: deliveries.reduce((a,v) => a + cashDelivery(v), 0),
      schemaVersion: 4,
      versionSistema: VERSION
    };
  }

  function aggregate(keyField, key, rows) {
    return rows.reduce((acc,row) => {
      acc[keyField] = key;
      for (const field of [
        'ventas','canceladas','domicilios','domiciliosCancelados',
        'total','totalDomicilios','domiciliosTransferencia','domiciliosEfectivo',
        'valorDomiciliosTransferencia','valorDomiciliosEfectivo'
      ]) acc[field] += Number(row[field] || 0);
      acc.tieneDomicilios = acc.domicilios > 0;
      return acc;
    }, {
      [keyField]: key,
      ventas:0, canceladas:0, domicilios:0, domiciliosCancelados:0,
      total:0, totalDomicilios:0, domiciliosTransferencia:0, domiciliosEfectivo:0,
      valorDomiciliosTransferencia:0, valorDomiciliosEfectivo:0,
      tieneDomicilios:false, schemaVersion:4, versionSistema:VERSION
    });
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden fixed inset-0 z-[99999] bg-black/60 p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="min-h-full flex items-center justify-center">
        <div class="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-yellow-200 overflow-hidden">
          <div class="flex items-center justify-between gap-4 px-5 py-4 bg-yellow-50 border-b">
            <div>
              <p class="text-xs font-black uppercase tracking-wide text-yellow-700">Herramienta de administrador · ${VERSION}</p>
              <h3 class="text-xl font-black text-gray-900">🔧 Actualización única de datos</h3>
            </div>
            <button id="lpMantenimientoCerrar" type="button" class="w-10 h-10 rounded-full border bg-white hover:bg-yellow-100">✕</button>
          </div>
          <div class="p-5 space-y-4">
            <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              <strong>Esta herramienta no es de uso diario.</strong> Revisa las ventas existentes, repara únicamente campos esenciales que puedan reconstruirse con certeza y vuelve a generar los resúmenes de día, semana y mes desde la colección <code>ventas</code>.
            </div>
            <div class="rounded-xl border p-4 text-sm">
              <p class="font-bold mb-2">No modifica:</p>
              <p>inventario físico, apertura/cierre de caja, usuarios, nómina, finanzas ni pedidos.</p>
            </div>
            <div id="lpMantenimientoEstado" class="rounded-xl bg-gray-50 border p-4 text-sm">Consultando estado…</div>
            <div id="lpMantenimientoProgreso" class="hidden rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-sm whitespace-pre-line"></div>
            <div class="flex flex-col sm:flex-row gap-3 justify-end">
              <button id="lpMantenimientoCancelar" type="button" class="px-4 py-3 rounded-xl border bg-white font-bold">Cerrar</button>
              <button id="lpMantenimientoEjecutar" type="button" class="px-5 py-3 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white font-black">Actualizar base de datos una vez</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#lpMantenimientoCerrar')?.addEventListener('click', closeModal);
    modal.querySelector('#lpMantenimientoCancelar')?.addEventListener('click', closeModal);
    modal.querySelector('#lpMantenimientoEjecutar')?.addEventListener('click', runMaintenance);
    return modal;
  }

  function closeModal() {
    if (state.running) return alert('La actualización está en proceso. Espera a que termine.');
    ensureModal().classList.add('hidden');
  }

  function statusEl() { return ensureModal().querySelector('#lpMantenimientoEstado'); }
  function progressEl() { return ensureModal().querySelector('#lpMantenimientoProgreso'); }
  function runButton() { return ensureModal().querySelector('#lpMantenimientoEjecutar'); }

  function setProgress(text) {
    const el = progressEl();
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = text;
  }

  function configRef() {
    return services().db.collection('configuracion').doc(CONFIG_DOC);
  }

  async function readStatus() {
    if (!isAdmin()) return null;
    try {
      let snap;
      try { snap = await configRef().get({ source:'server' }); }
      catch (_) { snap = await configRef().get(); }
      return snap.exists ? (snap.data() || {}) : {};
    } catch (error) {
      console.error('[C2.13.8] Estado de mantenimiento:', error);
      return { error: String(error?.message || error) };
    }
  }

  function renderStatus(data) {
    state.lastStatus = data || {};
    const el = statusEl();
    const btn = runButton();
    if (!el || !btn) return;

    if (data?.estado === 'completado') {
      const when = data.completadoEn?.toDate ? data.completadoEn.toDate().toLocaleString('es-CO') : 'registrado en Firebase';
      el.innerHTML = `<strong class="text-green-700">✅ Actualización ya completada.</strong><br>
        Ventas revisadas: <strong>${Number(data.ventasLeidas || 0).toLocaleString('es-CO')}</strong><br>
        Ventas reparadas: <strong>${Number(data.ventasReparadas || 0).toLocaleString('es-CO')}</strong><br>
        Registros sin fecha resoluble: <strong>${Number(data.ventasSinFecha || 0).toLocaleString('es-CO')}</strong><br>
        Fecha: ${escapeHTML(when)}`;
      btn.disabled = true;
      btn.classList.add('opacity-50','cursor-not-allowed');
      btn.textContent = 'Actualización ya realizada';
      return;
    }

    if (data?.estado === 'ejecutando') {
      el.innerHTML = '<strong class="text-yellow-800">⏳ Hay una actualización registrada como en proceso.</strong><br>No abras otra ejecución simultánea.';
      btn.disabled = true;
      btn.classList.add('opacity-50','cursor-not-allowed');
      btn.textContent = 'Actualización en proceso';
      return;
    }

    if (data?.error) {
      el.innerHTML = `<strong class="text-red-700">No se pudo consultar el estado.</strong><br>${escapeHTML(data.error)}`;
    } else if (data?.estado === 'error') {
      el.innerHTML = `<strong class="text-red-700">La ejecución anterior no terminó.</strong><br>Puede volver a intentarse.`;
    } else {
      el.innerHTML = '<strong>Lista para ejecutarse.</strong><br>Esta versión corrige también diaClave válidos pero inconsistentes con fechaISO. Ejecútala una sola vez después de publicar C2.13.6.';
    }
    btn.disabled = false;
    btn.classList.remove('opacity-50','cursor-not-allowed');
    btn.textContent = 'Actualizar base de datos una vez';
  }

  async function openModal() {
    if (!isAdmin()) {
      alert('Ctrl + Ñ está disponible únicamente para administrador.');
      return;
    }
    const modal = ensureModal();
    modal.classList.remove('hidden');
    statusEl().textContent = 'Consultando estado en Firebase…';
    renderStatus(await readStatus());
  }

  async function acquireLock() {
    const { db, auth } = services();
    const ref = configRef();
    const now = global.firebase.firestore.Timestamp.now();
    const limitMs = LOCK_MINUTES * 60 * 1000;

    let result = 'ok';
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};

      if (data.estado === 'completado') {
        result = 'completed';
        return;
      }

      if (data.estado === 'ejecutando') {
        const started = data.iniciadoEn?.toMillis ? data.iniciadoEn.toMillis() : 0;
        if (started && (Date.now() - started) < limitMs) {
          result = 'running';
          return;
        }
      }

      tx.set(ref, {
        estado:'ejecutando',
        version:VERSION,
        iniciadoEn:now,
        iniciadoPorUid:auth.currentUser?.uid || '',
        iniciadoPorEmail:auth.currentUser?.email || '',
        ultimoError:''
      }, { merge:true });
    });
    return result;
  }

  async function readAllCollection(collectionName, pageSize = 300) {
    const { db } = services();
    const rows = [];
    let cursor = null;
    while (true) {
      let q = db.collection(collectionName)
        .orderBy(global.firebase.firestore.FieldPath.documentId())
        .limit(pageSize);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get({ source:'server' });
      rows.push(...snap.docs);
      if (snap.docs.length < pageSize) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    return rows;
  }

  async function repairSales() {
    const { db } = services();
    const docs = await readAllCollection('ventas', 250);
    const allSales = [];
    const repairs = [];
    let unresolved = 0;

    for (const doc of docs) {
      const raw = doc.data() || {};
      const normalized = normalizedForMaintenance(raw, doc.id);
      const day = normalized.diaClave;

      if (!validDayKey(day)) {
        unresolved += 1;
        continue;
      }

      const update = {};
      if (!validDayKey(raw.diaClave) || String(raw.diaClave) !== String(day)) {
        update.diaClave = day;
      }

      const normalizedTotal = Number(normalized.totalCobrado);
      if (!validNumber(raw.totalCobrado) && validNumber(normalizedTotal)) {
        update.totalCobrado = normalizedTotal;
      }

      const normalizedSubtotal = Number(normalized.subtotalProductos);
      if (!validNumber(raw.subtotalProductos) && validNumber(normalizedSubtotal)) {
        update.subtotalProductos = normalizedSubtotal;
      }

      if (!String(raw._localId || '').trim()) update._localId = doc.id;

      if (Object.keys(update).length) {
        // Las reglas de venta exigen totalCobrado y diaClave válidos en el resultado.
        if (!('diaClave' in update) && !validDayKey(raw.diaClave)) continue;
        if (!('totalCobrado' in update) && !validNumber(raw.totalCobrado)) continue;
        repairs.push({ ref: doc.ref, update });
      }

      allSales.push({ ...normalized, _localId: normalized._localId || raw._localId || doc.id });
    }

    for (let i = 0; i < repairs.length; i += 400) {
      const batch = db.batch();
      repairs.slice(i, i + 400).forEach(item => batch.update(item.ref, item.update));
      await batch.commit();
      setProgress(`1/3 Revisando ventas…\n${docs.length.toLocaleString('es-CO')} ventas leídas\n${Math.min(i+400, repairs.length).toLocaleString('es-CO')} de ${repairs.length.toLocaleString('es-CO')} reparaciones aplicadas`);
    }

    return { docsRead:docs.length, repaired:repairs.length, unresolved, sales:allSales };
  }

  async function rebuildAllSummaries(sales) {
    const { db, auth } = services();
    const byDay = new Map();
    for (const sale of sales) {
      const day = String(sale?.diaClave || '');
      if (!validDayKey(day)) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(sale);
    }

    const daily = [...byDay.entries()]
      .map(([day, rows]) => summarizeDay(day, rows))
      .sort((a,b) => a.diaClave.localeCompare(b.diaClave));

    const byWeek = new Map();
    const byMonth = new Map();
    daily.forEach(row => {
      if (!byWeek.has(row.semanaClave)) byWeek.set(row.semanaClave, []);
      if (!byMonth.has(row.mesClave)) byMonth.set(row.mesClave, []);
      byWeek.get(row.semanaClave).push(row);
      byMonth.get(row.mesClave).push(row);
    });

    const weekly = [...byWeek].map(([key,rows]) => aggregate('semanaClave', key, rows));
    const monthly = [...byMonth].map(([key,rows]) => aggregate('mesClave', key, rows));

    // También neutralizamos resúmenes viejos que ya no tengan ventas fuente.
    const [existingDaily, existingWeekly, existingMonthly] = await Promise.all([
      readAllCollection('resumenesDiarios', 300),
      readAllCollection('resumenesSemanales', 300),
      readAllCollection('resumenesMensuales', 300)
    ]);

    const dailyMap = new Map(daily.map(r => [r.diaClave, r]));
    const weeklyMap = new Map(weekly.map(r => [r.semanaClave, r]));
    const monthlyMap = new Map(monthly.map(r => [r.mesClave, r]));

    function zeroSummary(type, id) {
      if (type === 'day') return summarizeDay(id, []);
      return aggregate(type === 'week' ? 'semanaClave' : 'mesClave', id, []);
    }

    existingDaily.forEach(d => { if (!dailyMap.has(d.id)) dailyMap.set(d.id, zeroSummary('day', d.id)); });
    existingWeekly.forEach(d => { if (!weeklyMap.has(d.id)) weeklyMap.set(d.id, zeroSummary('week', d.id)); });
    existingMonthly.forEach(d => { if (!monthlyMap.has(d.id)) monthlyMap.set(d.id, zeroSummary('month', d.id)); });

    const stamp = global.firebase.firestore.FieldValue.serverTimestamp();
    const meta = {
      actualizadoEn:stamp,
      actualizadoPorUid:auth.currentUser?.uid || '',
      actualizadoPorEmail:auth.currentUser?.email || '',
      reconstruidoPorMantenimiento:true,
      versionMantenimiento:VERSION
    };

    const writes = [
      ...[...dailyMap].map(([id,data]) => ({collection:'resumenesDiarios', id, data})),
      ...[...weeklyMap].map(([id,data]) => ({collection:'resumenesSemanales', id, data})),
      ...[...monthlyMap].map(([id,data]) => ({collection:'resumenesMensuales', id, data}))
    ];

    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach(item => {
        batch.set(db.collection(item.collection).doc(item.id), { ...item.data, ...meta }, { merge:true });
      });
      await batch.commit();
      setProgress(`2/3 Reconstruyendo históricos…\n${Math.min(i+400,writes.length).toLocaleString('es-CO')} de ${writes.length.toLocaleString('es-CO')} resúmenes escritos`);
    }

    return {
      dias: daily.length,
      semanas: weekly.length,
      meses: monthly.length,
      resumenesEscritos: writes.length
    };
  }

  async function refreshApplication() {
    try { core()?.invalidateQueryCache?.('pos:'); } catch (_) {}
    try { await global.lpActualizarHistoricosCanonico?.(true); } catch (_) {}
    try { await global.actualizarHistoricos?.(true); } catch (_) {}
    try { global.escucharVentasFirestore?.(); } catch (_) {}
  }

  async function runMaintenance() {
    if (state.running) return;
    if (!isAdmin()) return alert('Solo el administrador puede ejecutar esta herramienta.');

    if (!navigator.onLine) {
      alert('Necesitas conexión a Internet para actualizar la base de datos.');
      return;
    }

    const confirmed = confirm(
      'Esta operación revisará todas las ventas y reconstruirá los datos históricos derivados. ' +
      'No borra ventas ni modifica inventario/caja. ¿Ejecutar ahora?'
    );
    if (!confirmed) return;

    state.running = true;
    const btn = runButton();
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Actualizando…';
      btn.classList.add('opacity-60','cursor-wait');
    }

    try {
      const lock = await acquireLock();
      if (lock === 'completed') {
        alert('Esta actualización ya fue realizada anteriormente.');
        renderStatus(await readStatus());
        return;
      }
      if (lock === 'running') {
        alert('Ya existe otra actualización en proceso. Espera a que termine.');
        renderStatus(await readStatus());
        return;
      }

      setProgress('1/3 Revisando todas las ventas de Firestore…');
      const repaired = await repairSales();

      setProgress(`2/3 Reconstruyendo día, semana y mes desde ${repaired.sales.length.toLocaleString('es-CO')} ventas válidas…`);
      const summaries = await rebuildAllSummaries(repaired.sales);

      setProgress('3/3 Actualizando las vistas del sistema…');
      await refreshApplication();

      const { auth } = services();
      await configRef().set({
        estado:'completado',
        version:VERSION,
        completadoEn:global.firebase.firestore.FieldValue.serverTimestamp(),
        completadoPorUid:auth.currentUser?.uid || '',
        completadoPorEmail:auth.currentUser?.email || '',
        ventasLeidas:repaired.docsRead,
        ventasReparadas:repaired.repaired,
        ventasSinFecha:repaired.unresolved,
        dias: summaries.dias,
        semanas: summaries.semanas,
        meses: summaries.meses,
        resumenesEscritos:summaries.resumenesEscritos
      }, { merge:true });

      try {
        await core()?.audit?.('mantenimiento_datos_c2138_completado', {
          ventasLeidas:repaired.docsRead,
          ventasReparadas:repaired.repaired,
          ventasSinFecha:repaired.unresolved,
          dias:summaries.dias,
          semanas:summaries.semanas,
          meses:summaries.meses
        });
      } catch (_) {}

      setProgress(
        `✅ Actualización terminada\n` +
        `Ventas revisadas: ${repaired.docsRead.toLocaleString('es-CO')}\n` +
        `Ventas reparadas: ${repaired.repaired.toLocaleString('es-CO')}\n` +
        `Sin fecha resoluble: ${repaired.unresolved.toLocaleString('es-CO')}\n` +
        `Días: ${summaries.dias} · Semanas: ${summaries.semanas} · Meses: ${summaries.meses}`
      );
      renderStatus(await readStatus());
      alert('Actualización de datos completada correctamente.');
    } catch (error) {
      console.error('[C2.13.8] Error de mantenimiento:', error);
      try {
        await configRef().set({
          estado:'error',
          ultimoError:String(error?.message || error).slice(0,500),
          errorEn:global.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge:true });
      } catch (_) {}
      setProgress(`❌ La actualización no terminó.\n${String(error?.message || error)}`);
      alert('La actualización encontró un error. No quedó marcada como completada y puede volver a intentarse.');
    } finally {
      state.running = false;
      if (btn && state.lastStatus?.estado !== 'completado') {
        btn.disabled = false;
        btn.textContent = 'Actualizar base de datos una vez';
        btn.classList.remove('opacity-60','cursor-wait');
      }
    }
  }

  function hotkey(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const key = String(event.key || '').toLowerCase();
    // En teclado español la tecla física Ñ suele reportar code "Semicolon".
    const isEnye = key === 'ñ' || String(event.code || '') === 'Semicolon';
    if (!isEnye) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    openModal();
  }

  global.lpAbrirMantenimientoDatos = openModal;
  global.lpEjecutarMantenimientoDatos = runMaintenance;

  global.addEventListener('keydown', hotkey, true);
})(window);
