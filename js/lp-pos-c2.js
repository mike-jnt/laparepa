/* La Parepa C2.6 - tablas elegantes, paginación remota exacta y caché de consultas */
(function (global) {
  'use strict';
  const core = global.LP_CORE;
  if (!core) throw new Error('LP_CORE no está disponible.');

  const PAGE_SIZE = 10;
  const CACHE_TTL = 45000;
  const state = {
    original: {},
    salesUnsubscribe: null,
    rebuilding: false,
    pagers: Object.create(null)
  };

  function setGlobal(name, fn) {
    global[name] = fn;
    try { eval(`${name} = global[name]`); } catch (_) {}
  }

  function statusMessage(message, type = 'info') {
    const id = 'lpC2StatusMessage';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99998;max-width:min(92vw,760px);padding:10px 14px;border-radius:14px;font:700 13px Segoe UI,Arial;box-shadow:0 12px 30px rgba(0,0,0,.2);display:none';
      document.body.appendChild(el);
    }
    const styles = {
      info: ['#e0f2fe','#075985'], ok: ['#dcfce7','#166534'], warn: ['#fef3c7','#92400e'], error: ['#fee2e2','#991b1b']
    };
    const [bg, color] = styles[type] || styles.info;
    el.style.background = bg;
    el.style.color = color;
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.display = 'none'; }, 6200);
  }

  function pager(name) {
    if (!state.pagers[name]) {
      state.pagers[name] = { name, signature: '', index: 0, pages: [], endAt: null, loading: false };
    }
    return state.pagers[name];
  }

  function resetPager(name, signature = '') {
    const p = pager(name);
    p.signature = String(signature || '');
    p.index = 0;
    p.pages = [];
    p.endAt = null;
    return p;
  }

  function ensureSignature(name, signature) {
    const p = pager(name);
    if (p.signature !== String(signature || '')) return resetPager(name, signature);
    return p;
  }

  function normalizeSale(doc) {
    const raw = doc?.data ? { _docId: doc.id, ...doc.data() } : doc;
    return typeof global.normalizarVenta === 'function' ? global.normalizarVenta(raw) : raw;
  }

  function mergeSales(remoteSales) {
    const current = typeof global.obtenerVentasStorage === 'function' ? global.obtenerVentasStorage() : [];
    const pending = (global.obtenerVentasPendientesSync?.() || []).map(item => item?.venta).filter(Boolean);
    const map = new Map();
    [...current, ...remoteSales, ...pending].forEach((sale, index) => {
      const normalized = typeof global.normalizarVenta === 'function' ? global.normalizarVenta(sale, index) : sale;
      const key = normalized?._localId || normalized?._docId || `${normalized?.fechaISO || ''}_${index}`;
      if (key) map.set(key, normalized);
    });
    const all = global.ordenarVentasDesc ? global.ordenarVentasDesc([...map.values()]) : [...map.values()];
    global.guardarVentasEnCache?.(all.slice(0, 500));
    return all;
  }

  async function fetchPageExact({ name, signature, queryFactory, targetIndex, force = false, mapDoc = d => ({ id: d.id, ...d.data() }) }) {
    const p = ensureSignature(name, signature);
    const target = Math.max(0, Number(targetIndex || 0));
    if (p.loading) return p.pages[p.index] || null;
    if (p.pages[target] && !force) {
      p.index = target;
      return p.pages[target];
    }
    if (target > 0 && !p.pages[target - 1]) return null;
    p.loading = true;
    try {
      const cursor = target > 0 ? p.pages[target - 1]?.lastDoc : null;
      const cursorKey = cursor?.id || 'inicio';
      const cacheKey = `pos:${name}:${signature}:pagina:${target}:cursor:${cursorKey}`;
      const result = await core.cachedQuery(cacheKey, async () => {
        let query = queryFactory();
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.limit(PAGE_SIZE).get();
        return {
          docs: snapshot.docs,
          data: snapshot.docs.map(mapDoc),
          firstDoc: snapshot.docs[0] || null,
          lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
        };
      }, { ttlMs: CACHE_TTL, force });

      if (target > 0 && !result.docs.length) {
        p.endAt = target - 1;
        p.index = target - 1;
        statusMessage('No hay más registros para mostrar.', 'info');
        return p.pages[p.index] || null;
      }
      p.pages[target] = { ...result, hasPossibleNext: result.docs.length === PAGE_SIZE };
      p.index = target;
      if (result.docs.length < PAGE_SIZE) p.endAt = target;
      return p.pages[target];
    } finally {
      p.loading = false;
    }
  }

  function paginationMeta(p) {
    const page = p.pages[p.index];
    return {
      pageNumber: p.index + 1,
      count: page?.data?.length || 0,
      hasPrev: p.index > 0,
      hasNext: Boolean(page?.hasPossibleNext && p.endAt !== p.index)
    };
  }

  function updatePagerUI(p, ids, label = 'registros') {
    const meta = paginationMeta(p);
    const info = document.getElementById(ids.info);
    const page = document.getElementById(ids.page);
    const prev = document.getElementById(ids.prev);
    const next = document.getElementById(ids.next);
    if (info) info.textContent = meta.count ? `${meta.count} ${label} cargados · máximo ${PAGE_SIZE} por consulta` : `Sin ${label} en esta página`;
    if (page) page.textContent = `Página ${meta.pageNumber}`;
    if (prev) { prev.disabled = !meta.hasPrev; prev.classList.toggle('opacity-50', !meta.hasPrev); }
    if (next) { next.disabled = !meta.hasNext; next.classList.toggle('opacity-50', !meta.hasNext); }
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" class="p-5 text-center text-gray-500">${core.escapeHTML(text)}</td></tr>`;
  }

  function decorateTables() {
    const tableBodies = [
      'ventasGuardadas','cierresCajaBody','historicoDiaBody','historicoSemanaBody','historicoMesBody',
      'ventasDiaDetalleBody','domiciliosDiaBody','domiciliosDetalleBody'
    ];
    tableBodies.forEach(id => {
      const body = document.getElementById(id);
      const table = body?.closest('table');
      const shell = table?.parentElement;
      if (table) table.classList.add('lp-elegant-table');
      if (shell) shell.classList.add('lp-table-shell');
    });
    ['ventasSeccion','cierresDiariosSeccion'].forEach(id => document.getElementById(id)?.classList.add('lp-data-card'));
    ['historicoDiaBody','historicoSemanaBody','historicoMesBody','ventasDiaDetalleBody','domiciliosDiaBody','domiciliosDetalleBody'].forEach(id => {
      document.getElementById(id)?.closest('.border')?.classList.add('lp-data-card');
    });
    ['paginacionVentas','paginacionCierresCaja'].forEach(id => document.getElementById(id)?.classList.add('lp-pagination'));
    [
      'infoPaginacionHistoricoDia','infoPaginacionHistoricoSemana','infoPaginacionHistoricoMes',
      'infoPaginacionHistoricoDetalle','infoPaginacionDomiciliosDia','infoPaginacionDomiciliosDetalle'
    ].forEach(id => document.getElementById(id)?.parentElement?.classList.add('lp-pagination'));
    if (!document.getElementById('lpQueryNoteC26')) {
      const note = document.createElement('span');
      note.id = 'lpQueryNoteC26';
      note.className = 'lp-query-note';
      note.textContent = '⚡ Consultas de 10 documentos con caché';
      document.getElementById('ventasSeccion')?.querySelector('h3')?.insertAdjacentElement('afterend', note);
    }
  }

  async function authorizedProfile(user) {
    if (!user) return null;
    return core.getProfile(user, core.services().db);
  }

  setGlobal('obtenerPerfilUsuarioSistema', async function (user) {
    try { return await authorizedProfile(user || core.services().auth.currentUser); }
    catch (error) { console.error('[C2.6] No se pudo obtener el perfil oficial:', error); return null; }
  });

  function hardenLogin() {
    const cleanLogin = global.lpIniciarSesionFirebaseAuth;
    if (typeof cleanLogin !== 'function') throw new Error('No está disponible el login oficial de Firebase Authentication.');
    cleanLogin.__lpAuthenticationOnly = true;
    setGlobal('iniciarSesion', cleanLogin);
  }

  function disableDestructiveFunctions() {
    const disabled = async () => { throw new Error('Operación destructiva deshabilitada. Usa cancelación lógica y auditoría.'); };
    setGlobal('borrarTodasLasVentasEnFirebase', disabled);
    setGlobal('borrarVentaEnFirebase', disabled);
  }

  // ---------- Ventas del día: listener de solo 10 documentos ----------
  function salesSignature() { return core.dateKeyCO(); }
  function salesQuery() {
    return core.services().db.collection('ventas')
      .where('diaClave', '==', salesSignature())
      .orderBy('fechaISO', 'desc');
  }

  function salesForCurrentPage() {
    const p = pager('salesToday');
    const remote = p.pages[p.index]?.data || [];
    if (p.index !== 0) return remote;
    const pending = (global.obtenerVentasPendientesSync?.() || []).map(x => normalizeSale(x?.venta)).filter(Boolean);
    const map = new Map();
    [...pending, ...remote].forEach(v => map.set(v?._localId || v?._docId, v));
    const sorted = global.ordenarVentasDesc ? global.ordenarVentasDesc([...map.values()]) : [...map.values()];
    return sorted.slice(0, PAGE_SIZE);
  }

  function renderSalesPage() {
    const p = pager('salesToday');
    const filter = String(document.getElementById('filtroCliente')?.value || '').trim().toLowerCase();
    const pageSales = salesForCurrentPage();
    const all = mergeSales(pageSales);
    const visible = pageSales.filter(v => String(v?.cliente || '').toLowerCase().includes(filter));
    const rows = visible.map(v => {
      const key = v?._localId || v?._docId;
      const index = all.findIndex(x => (x?._localId || x?._docId) === key);
      return typeof global.construirFilaVenta === 'function' ? global.construirFilaVenta(v, index) : `<tr><td colspan="10">${core.escapeHTML(v?.cliente || 'Venta')}</td></tr>`;
    });
    const cards = visible.map(v => {
      const key = v?._localId || v?._docId;
      const index = all.findIndex(x => (x?._localId || x?._docId) === key);
      return typeof global.construirTarjetaVenta === 'function' ? global.construirTarjetaVenta(v, index) : '';
    });
    const body = document.getElementById('ventasGuardadas');
    const mobile = document.getElementById('ventasGuardadasMobile');
    if (body) body.innerHTML = rows.length ? rows.join('') : emptyRow(10, filter ? 'No hay coincidencias en esta página.' : 'No hay ventas del día para mostrar.');
    if (mobile) mobile.innerHTML = cards.length ? cards.join('') : '<div class="bg-white border border-yellow-200 rounded-2xl p-4 text-center text-gray-500">No hay ventas para mostrar.</div>';
    updatePagerUI(p, { info:'ventasPaginacionInfo', page:'ventasPaginaActual', prev:'btnPrevVentas', next:'btnNextVentas' }, 'ventas');
    global.actualizarUISeleccionVentas?.();
  }

  async function loadSalesPage(target, force = false) {
    const signature = salesSignature();
    const page = await fetchPageExact({
      name: 'salesToday', signature, queryFactory: salesQuery, targetIndex: target, force,
      mapDoc: normalizeSale
    });
    if (page) mergeSales(page.data);
    renderSalesPage();
    return page;
  }

  function startSalesListener() {
    const signature = salesSignature();
    const p = ensureSignature('salesToday', signature);
    try { if (typeof ventasUnsubscribe === 'function') ventasUnsubscribe(); } catch (_) {}
    try { if (typeof global.ventasUnsubscribe === 'function') global.ventasUnsubscribe(); } catch (_) {}
    try { if (typeof state.salesUnsubscribe === 'function') state.salesUnsubscribe(); } catch (_) {}
    state.salesUnsubscribe = salesQuery().limit(PAGE_SIZE).onSnapshot(snapshot => {
      const data = snapshot.docs.map(normalizeSale);
      const previousIds = (p.pages[0]?.docs || []).map(doc => doc.id).join('|');
      const nextIds = snapshot.docs.map(doc => doc.id).join('|');
      const firstPageChanged = previousIds && previousIds !== nextIds;
      const firstPage = {
        docs: snapshot.docs, data,
        firstDoc: snapshot.docs[0] || null,
        lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
        hasPossibleNext: snapshot.docs.length === PAGE_SIZE
      };
      if (firstPageChanged) {
        p.pages = [firstPage];
        p.endAt = snapshot.docs.length < PAGE_SIZE ? 0 : null;
        if (p.index > 0) {
          p.index = 0;
          statusMessage('La lista cambió por una nueva venta. Se regresó a la primera página para mantener la paginación correcta.', 'info');
        }
      } else {
        p.pages[0] = firstPage;
        if (snapshot.docs.length < PAGE_SIZE) p.endAt = 0;
      }
      mergeSales(data);
      if (p.index === 0) renderSalesPage();
      global.programarSyncVentasPendientes?.(80);
    }, error => {
      console.error('[C2.6] Error escuchando las primeras 10 ventas:', error);
      statusMessage('No fue posible sincronizar las ventas del día. Se conserva el respaldo local.', 'error');
      renderSalesPage();
    });
    global.ventasUnsubscribe = state.salesUnsubscribe;
    try { ventasUnsubscribe = state.salesUnsubscribe; } catch (_) {}
  }

  setGlobal('escucharVentasFirestore', startSalesListener);
  setGlobal('mostrarVentas', function () {
    const input = document.getElementById('filtroCliente');
    if (input) input.value = '';
    pager('salesToday').index = 0;
    renderSalesPage();
    global.renderControlCajaDiaActual?.();
  });
  setGlobal('renderVentasTabla', renderSalesPage);
  setGlobal('filtrarVentasPorCliente', renderSalesPage);
  setGlobal('cambiarPaginaVentas', async function (direction) {
    const p = pager('salesToday');
    const target = Math.max(0, p.index + Number(direction || 0));
    if (direction < 0 && p.pages[target]) { p.index = target; renderSalesPage(); return; }
    await loadSalesPage(target, false);
  });

  // ---------- Resúmenes compactos ----------
  function isCancelled(v) { return typeof global.esVentaCancelada === 'function' ? global.esVentaCancelada(v) : String(v?.estado || '').toLowerCase() === 'cancelada'; }
  function isDelivery(v) { return typeof global.esPedidoDomicilio === 'function' ? global.esPedidoDomicilio(v) : String(v?.tipoPedido || '').toLowerCase() === 'domicilio'; }
  function income(v) { return typeof global.obtenerIngresoRealVenta === 'function' ? Number(global.obtenerIngresoRealVenta(v) || 0) : Number(v?.totalCobrado || v?.total || 0); }
  function deliveryValue(v) { return typeof global.obtenerValorDomicilio === 'function' ? Number(global.obtenerValorDomicilio(v) || 0) : Number(v?.costoDomicilio || 0); }
  function transferDelivery(v) { return typeof global.obtenerValorDomicilioCubiertoPorTransferencia === 'function' ? Number(global.obtenerValorDomicilioCubiertoPorTransferencia(v) || 0) : 0; }
  function cashDelivery(v) { return typeof global.obtenerValorDomicilioCubiertoPorEfectivo === 'function' ? Number(global.obtenerValorDomicilioCubiertoPorEfectivo(v) || 0) : 0; }

  function weekKeyFromDay(day) {
    const d = new Date(`${day}T12:00:00-05:00`);
    return typeof global.obtenerClaveSemana === 'function' ? global.obtenerClaveSemana(d) : day;
  }

  function summarizeSales(day, sales) {
    const normalized = (sales || []).map(normalizeSale);
    const active = normalized.filter(v => !isCancelled(v));
    const cancelled = normalized.filter(isCancelled);
    const deliveries = active.filter(isDelivery);
    return {
      diaClave: day,
      semanaClave: weekKeyFromDay(day),
      mesClave: String(day).slice(0, 7),
      ventas: active.length,
      canceladas: cancelled.length,
      domicilios: deliveries.length,
      domiciliosCancelados: cancelled.filter(isDelivery).length,
      tieneDomicilios: deliveries.length > 0,
      total: active.reduce((sum, v) => sum + income(v), 0),
      totalDomicilios: deliveries.reduce((sum, v) => sum + deliveryValue(v), 0),
      domiciliosTransferencia: deliveries.filter(v => transferDelivery(v) > 0).length,
      domiciliosEfectivo: deliveries.filter(v => cashDelivery(v) > 0).length,
      valorDomiciliosTransferencia: deliveries.reduce((sum, v) => sum + transferDelivery(v), 0),
      valorDomiciliosEfectivo: deliveries.reduce((sum, v) => sum + cashDelivery(v), 0),
      schemaVersion: 3,
      versionSistema: core.VERSION
    };
  }

  function aggregateSummaries(keyField, key, rows) {
    return (rows || []).reduce((acc, row) => {
      acc[keyField] = key;
      acc.ventas += Number(row.ventas || 0);
      acc.canceladas += Number(row.canceladas || 0);
      acc.domicilios += Number(row.domicilios || 0);
      acc.domiciliosCancelados += Number(row.domiciliosCancelados || 0);
      acc.total += Number(row.total || 0);
      acc.totalDomicilios += Number(row.totalDomicilios || 0);
      acc.domiciliosTransferencia += Number(row.domiciliosTransferencia || 0);
      acc.domiciliosEfectivo += Number(row.domiciliosEfectivo || 0);
      acc.valorDomiciliosTransferencia += Number(row.valorDomiciliosTransferencia || 0);
      acc.valorDomiciliosEfectivo += Number(row.valorDomiciliosEfectivo || 0);
      return acc;
    }, {
      [keyField]: key, ventas:0, canceladas:0, domicilios:0, domiciliosCancelados:0, total:0,
      totalDomicilios:0, domiciliosTransferencia:0, domiciliosEfectivo:0,
      valorDomiciliosTransferencia:0, valorDomiciliosEfectivo:0,
      schemaVersion:3, versionSistema:core.VERSION
    });
  }

  async function fetchAllSalesForDay(day, force = false) {
    return core.cachedQuery(`pos:all-day:${day}`, async () => {
      const all = [];
      let cursor = null;
      while (true) {
        let query = core.services().db.collection('ventas').where('diaClave','==',day).orderBy('fechaISO','desc').limit(200);
        if (cursor) query = query.startAfter(cursor);
        const snap = await query.get();
        snap.docs.forEach(doc => all.push(normalizeSale(doc)));
        if (snap.docs.length < 200) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
      return all;
    }, { ttlMs: 120000, force });
  }

  async function writeSummaryForDay(day, sales, context = {}) {
    const { db, auth } = core.services();
    const summary = summarizeSales(day, sales);
    const stamp = global.firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('resumenesDiarios').doc(day).set({
      ...summary,
      actualizadoEn: stamp,
      actualizadoPorUid: auth.currentUser?.uid || '',
      actualizadoPorEmail: auth.currentUser?.email || ''
    }, { merge: true });

    const [weekSnap, monthSnap] = await Promise.all([
      db.collection('resumenesDiarios').where('semanaClave','==',summary.semanaClave).limit(7).get(),
      db.collection('resumenesDiarios').where('mesClave','==',summary.mesClave).limit(31).get()
    ]);
    const weekRows = weekSnap.docs.map(d => d.data());
    const monthRows = monthSnap.docs.map(d => d.data());
    await Promise.all([
      db.collection('resumenesSemanales').doc(summary.semanaClave).set({
        ...aggregateSummaries('semanaClave', summary.semanaClave, weekRows), actualizadoEn: stamp
      }, { merge: true }),
      db.collection('resumenesMensuales').doc(summary.mesClave).set({
        ...aggregateSummaries('mesClave', summary.mesClave, monthRows), actualizadoEn: stamp
      }, { merge: true })
    ]);
    core.invalidateQueryCache('pos:history');
    core.invalidateQueryCache('pos:domicile');
    core.invalidateQueryCache('pos:summary-card');
    return summary;
  }

  async function rebuildSummaries() {
    const profile = global.LP_PROFILE;
    if (!profile || !['admin','administrador'].includes(core.normalizeRole(profile.rol))) return alert('Solo el administrador puede preparar los resúmenes.');
    if (state.rebuilding) return;
    if (!confirm('Esta preparación leerá las ventas históricas una sola vez y creará resúmenes rápidos. ¿Continuar?')) return;
    state.rebuilding = true;
    statusMessage('Preparando resúmenes históricos. No cierres esta pestaña…', 'info');
    try {
      const { db, auth } = core.services();
      const byDay = new Map();
      let cursor = null;
      let read = 0;
      while (true) {
        let query = db.collection('ventas').orderBy('fechaISO','desc').limit(300);
        if (cursor) query = query.startAfter(cursor);
        const snap = await query.get();
        for (const doc of snap.docs) {
          const sale = normalizeSale(doc);
          const day = sale?.diaClave || core.dateKeyCO(sale?.fechaISO || sale?.fecha);
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day).push(sale);
          read += 1;
        }
        statusMessage(`Preparando resúmenes: ${read.toLocaleString('es-CO')} ventas leídas…`, 'info');
        if (snap.docs.length < 300) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
      const daily = [...byDay.entries()].map(([day, sales]) => summarizeSales(day, sales));
      const weeklyMap = new Map();
      const monthlyMap = new Map();
      daily.forEach(row => {
        if (!weeklyMap.has(row.semanaClave)) weeklyMap.set(row.semanaClave, []);
        if (!monthlyMap.has(row.mesClave)) monthlyMap.set(row.mesClave, []);
        weeklyMap.get(row.semanaClave).push(row);
        monthlyMap.get(row.mesClave).push(row);
      });
      const writes = [
        ...daily.map(row => ({ collection:'resumenesDiarios', id:row.diaClave, data:row })),
        ...[...weeklyMap].map(([key, rows]) => ({ collection:'resumenesSemanales', id:key, data:aggregateSummaries('semanaClave',key,rows) })),
        ...[...monthlyMap].map(([key, rows]) => ({ collection:'resumenesMensuales', id:key, data:aggregateSummaries('mesClave',key,rows) }))
      ];
      for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = db.batch();
        writes.slice(offset, offset + 400).forEach(item => batch.set(db.collection(item.collection).doc(item.id), {
          ...item.data,
          actualizadoEn: global.firebase.firestore.FieldValue.serverTimestamp(),
          actualizadoPorUid: auth.currentUser?.uid || '',
          actualizadoPorEmail: auth.currentUser?.email || ''
        }, { merge:true }));
        await batch.commit();
      }
      core.invalidateQueryCache('pos:history');
      core.invalidateQueryCache('pos:domicile');
      core.invalidateQueryCache('pos:summary-card');
      ['historyDay','historyWeek','historyMonth','domicileDay'].forEach(name => resetPager(name));
      await updateHistory(true);
      await updateDomiciles(true);
      await core.audit('resumenes_historicos_reconstruidos', { ventasLeidas:read, dias:daily.length, semanas:weeklyMap.size, meses:monthlyMap.size });
      statusMessage(`Resúmenes listos: ${daily.length} días, ${weeklyMap.size} semanas y ${monthlyMap.size} meses.`, 'ok');
    } catch (error) {
      console.error('[C2.6] Error reconstruyendo resúmenes:', error);
      statusMessage('No se pudieron preparar los resúmenes históricos.', 'error');
    } finally {
      state.rebuilding = false;
    }
  }
  setGlobal('reconstruirResumenesC26', rebuildSummaries);

  // ---------- Históricos remotos ----------
  const summaryConfigs = {
    historyDay: { collection:'resumenesDiarios', order:'diaClave', body:'historicoDiaBody', info:'infoPaginacionHistoricoDia', page:'paginaHistoricoDiaActual', prev:'btnPrevHistoricoDia', next:'btnNextHistoricoDia', label:'días', key:'diaClave' },
    historyWeek: { collection:'resumenesSemanales', order:'semanaClave', body:'historicoSemanaBody', info:'infoPaginacionHistoricoSemana', page:'paginaHistoricoSemanaActual', prev:'btnPrevHistoricoSemana', next:'btnNextHistoricoSemana', label:'semanas', key:'semanaClave' },
    historyMonth: { collection:'resumenesMensuales', order:'mesClave', body:'historicoMesBody', info:'infoPaginacionHistoricoMes', page:'paginaHistoricoMesActual', prev:'btnPrevHistoricoMes', next:'btnNextHistoricoMes', label:'meses', key:'mesClave' }
  };

  function renderSummaryPage(name) {
    const cfg = summaryConfigs[name];
    const p = pager(name);
    const rows = (p.pages[p.index]?.data || []).map(row => `
      <tr>
        <td>${core.escapeHTML(row[cfg.key] || '-')}</td>
        <td>${Number(row.ventas || 0)}${row.canceladas ? ` <span class="text-xs text-red-600">· ${Number(row.canceladas)} canceladas</span>` : ''}</td>
        <td>${Number(row.domicilios || 0)}${row.domiciliosCancelados ? ` <span class="text-xs text-red-600">· ${Number(row.domiciliosCancelados)} cancelados</span>` : ''}</td>
        <td class="font-semibold">${core.money(row.total || 0)}</td>
      </tr>`);
    const body = document.getElementById(cfg.body);
    if (body) body.innerHTML = rows.length ? rows.join('') : emptyRow(4, 'No hay resúmenes preparados. Usa “Preparar resúmenes” una sola vez.');
    updatePagerUI(p, cfg, cfg.label);
  }

  async function loadSummaryPage(name, target = 0, force = false) {
    const cfg = summaryConfigs[name];
    await fetchPageExact({
      name, signature:'global', targetIndex:target, force,
      queryFactory:() => core.services().db.collection(cfg.collection).orderBy(cfg.order,'desc'),
      mapDoc:d => ({ id:d.id, ...d.data() })
    });
    renderSummaryPage(name);
  }


  async function loadCurrentSummaryCards(force = false) {
    const today = core.dateKeyCO();
    const weekKey = weekKeyFromDay(today);
    const monthKey = today.slice(0, 7);
    const db = core.services().db;
    const readDoc = (collection, id) => core.cachedQuery(
      `pos:summary-card:${collection}:${id}`,
      async () => {
        const snap = await db.collection(collection).doc(id).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
      },
      { ttlMs: CACHE_TTL, force }
    );
    const [day, week, month] = await Promise.all([
      readDoc('resumenesDiarios', today),
      readDoc('resumenesSemanales', weekKey),
      readDoc('resumenesMensuales', monthKey)
    ]);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    const apply = (prefix, row, emptyLabel) => {
      set(`${prefix}Ventas`, `${Number(row?.ventas || 0)} pedido(s)${Number(row?.canceladas || 0) ? ` · ${Number(row.canceladas)} cancelado(s)` : ''}`);
      set(`${prefix}Total`, `${core.money(row?.total || 0)} · ${Number(row?.domicilios || 0)} domicilio(s)` || emptyLabel);
    };
    apply('histHoy', day, '$0');
    apply('histSemana', week, '$0');
    apply('histMes', month, '$0');
    return { day, week, month };
  }

  async function loadCurrentDomicileCards(force = false) {
    const today = core.dateKeyCO();
    const row = await core.cachedQuery(
      `pos:summary-card:resumenesDiarios:${today}`,
      async () => {
        const snap = await core.services().db.collection('resumenesDiarios').doc(today).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
      },
      { ttlMs: CACHE_TTL, force }
    );
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('domHoyCantidad', `${Number(row?.domicilios || 0)} domicilio(s)`);
    set('domHoyValor', core.money(row?.totalDomicilios || 0));
    set('domTransferenciaCantidad', `${Number(row?.domiciliosTransferencia || 0)} domicilio(s)`);
    set('domTransferenciaValor', core.money(row?.valorDomiciliosTransferencia || 0));
    set('domEfectivoCantidad', `${Number(row?.domiciliosEfectivo || 0)} domicilio(s)`);
    set('domEfectivoValor', core.money(row?.valorDomiciliosEfectivo || 0));
    return row;
  }

  async function loadHistoryDetail(target = 0, force = false) {
    const input = document.getElementById('filtroHistoricoFecha');
    const day = input?.value || core.dateKeyCO();
    if (input) input.value = day;
    const p = ensureSignature('historyDetail', day);
    await fetchPageExact({
      name:'historyDetail', signature:day, targetIndex:target, force,
      queryFactory:() => core.services().db.collection('ventas').where('diaClave','==',day).orderBy('fechaISO','desc'),
      mapDoc:normalizeSale
    });
    const sales = p.pages[p.index]?.data || [];
    const cache = mergeSales(sales);
    const rows = sales.map(v => {
      const cancelled = isCancelled(v);
      return `<tr class="${cancelled ? 'bg-red-50 text-gray-500' : ''}">
        <td>${v.recibo ?? '-'}</td><td>${v.comanda ?? '-'}</td>
        <td>${global.formatearHoraColombia?.(v.fechaISO || v.fecha) || '-'}</td>
        <td>${core.escapeHTML(v.cliente || 'N/A')}</td><td>${global.obtenerEtiquetaFormaPago?.(v) || '-'}</td>
        <td>${core.escapeHTML(v.tipoPedido || '-')}</td><td>${global.obtenerBadgeEstadoVenta?.(v) || '-'}</td>
        <td>${core.escapeHTML(v.observaciones || '-')}</td><td>${global.resumirProductosPedido?.(v.pedido || []) || '-'}</td>
        <td class="font-semibold">${core.money(global.obtenerIngresoRealVenta?.(v) || 0)}</td></tr>`;
    });
    const body = document.getElementById('ventasDiaDetalleBody');
    if (body) body.innerHTML = rows.length ? rows.join('') : emptyRow(10, 'No hay ventas para esta fecha y página.');
    const totalPage = sales.filter(v => !isCancelled(v)).reduce((sum,v) => sum + income(v),0);
    const summary = document.getElementById('resumenVentasDiaSeleccionado');
    if (summary) summary.innerHTML = `<strong>${day}</strong> · Página ${p.index + 1} · ${sales.length} documentos · Total visible: <strong>${core.money(totalPage)}</strong>`;
    updatePagerUI(p, { info:'infoPaginacionHistoricoDetalle', page:'paginaHistoricoDetalleActual', prev:'btnPrevHistoricoDetalle', next:'btnNextHistoricoDetalle' }, 'ventas');
    return cache;
  }

  async function updateHistory(force = false) {
    const today = core.dateKeyCO();
    const input = document.getElementById('filtroHistoricoFecha');
    if (input && !input.value) input.value = today;
    await Promise.all([
      loadSummaryPage('historyDay', pager('historyDay').index, force),
      loadSummaryPage('historyWeek', pager('historyWeek').index, force),
      loadSummaryPage('historyMonth', pager('historyMonth').index, force),
      loadCurrentSummaryCards(force),
      loadHistoryDetail(pager('historyDetail').index, force)
    ]);
  }

  setGlobal('verVentasDetalladasPorFecha', async function () { resetPager('historyDetail', document.getElementById('filtroHistoricoFecha')?.value || core.dateKeyCO()); return loadHistoryDetail(0, false); });
  setGlobal('actualizarHistoricos', function (force = false) { return updateHistory(force); });
  setGlobal('exportarVentasDelDiaHistorico', async function () {
    const day = document.getElementById('filtroHistoricoFecha')?.value || core.dateKeyCO();
    statusMessage(`Preparando exportación completa del ${day}…`, 'info');
    try {
      const sales = await fetchAllSalesForDay(day, true);
      if (!sales.length) return alert('No hay ventas registradas para la fecha seleccionada.');
      if (typeof global.exportarVentasAExcel !== 'function') throw new Error('La función de exportación no está disponible.');
      await global.exportarVentasAExcel(sales, `Ventas_${day}.xlsx`, `Ventas ${day}`);
      statusMessage(`Exportación completa: ${sales.length} ventas.`, 'ok');
    } catch (error) {
      console.error('[C2.6] No se pudo exportar el día completo:', error);
      statusMessage('No se pudo preparar la exportación completa.', 'error');
    }
  });

  // ---------- Domicilios remotos ----------
  async function loadDomicileDay(target = 0, force = false) {
    const p = ensureSignature('domicileDay','global');
    await fetchPageExact({
      name:'domicileDay', signature:'global', targetIndex:target, force,
      queryFactory:() => core.services().db.collection('resumenesDiarios').where('tieneDomicilios','==',true).orderBy('diaClave','desc'),
      mapDoc:d => ({ id:d.id, ...d.data() })
    });
    const rows = (p.pages[p.index]?.data || []).map(row => `<tr>
      <td>${core.escapeHTML(row.diaClave || '-')}</td><td>${Number(row.domicilios || 0)}</td><td>${Number(row.domiciliosCancelados || 0)}</td>
      <td>${Number(row.domiciliosTransferencia || 0)}</td><td>${Number(row.domiciliosEfectivo || 0)}</td>
      <td>${core.money(row.valorDomiciliosTransferencia || 0)}</td><td>${core.money(row.valorDomiciliosEfectivo || 0)}</td>
      <td class="font-semibold">${core.money(row.totalDomicilios || 0)}</td></tr>`);
    const body = document.getElementById('domiciliosDiaBody');
    if (body) body.innerHTML = rows.length ? rows.join('') : emptyRow(8, 'No hay resúmenes de domicilios preparados.');
    updatePagerUI(p, { info:'infoPaginacionDomiciliosDia', page:'paginaDomiciliosDiaActual', prev:'btnPrevDomiciliosDia', next:'btnNextDomiciliosDia' }, 'días');
  }

  async function loadDomicileDetail(target = 0, force = false) {
    const input = document.getElementById('filtroDomiciliosFecha');
    const day = input?.value || core.dateKeyCO();
    if (input) input.value = day;
    const p = ensureSignature('domicileDetail', day);
    await fetchPageExact({
      name:'domicileDetail', signature:day, targetIndex:target, force,
      queryFactory:() => core.services().db.collection('ventas').where('diaClave','==',day).where('tipoPedido','==','Domicilio').orderBy('fechaISO','desc'),
      mapDoc:normalizeSale
    });
    const sales = p.pages[p.index]?.data || [];
    const all = mergeSales(sales);
    const rows = sales.map(v => {
      const key=v?._localId||v?._docId;
      const idx=all.findIndex(x=>(x?._localId||x?._docId)===key);
      const cancelled=isCancelled(v);
      return `<tr class="${cancelled?'bg-red-50 text-gray-500':''}">
        <td>${v.recibo??'-'}</td><td>${v.comanda??'-'}</td><td>${global.formatearHoraColombia?.(v.fechaISO||v.fecha)||'-'}</td>
        <td>${core.escapeHTML(v.cliente||'N/A')}</td><td>${global.obtenerEtiquetaFormaPago?.(v)||'-'}</td><td>${global.obtenerEtiquetaPagoDomicilio?.(v)||'-'}</td>
        <td class="font-semibold">${core.money(deliveryValue(v))}</td><td>${core.money(income(v))}</td><td>${global.obtenerBadgeEstadoVenta?.(v)||'-'}</td>
        <td>${global.resumirProductosPedido?.(v.pedido||[])||'-'}</td>
        <td class="text-center">${cancelled?'<span class="text-xs text-red-600 font-semibold">Sin recibo</span>':`<button onclick="imprimirVentaCliente(${idx})" class="bg-purple-600 text-white text-xs font-semibold">Abrir recibo</button>`}</td></tr>`;
    });
    const body=document.getElementById('domiciliosDetalleBody');
    if(body)body.innerHTML=rows.length?rows.join(''):emptyRow(11,'No hay domicilios para esta fecha y página.');
    const active=sales.filter(v=>!isCancelled(v));
    const summary=document.getElementById('resumenDomiciliosDiaSeleccionado');
    if(summary)summary.innerHTML=`<strong>${day}</strong> · Página ${p.index+1} · ${sales.length} documentos · Domicilios visibles: <strong>${active.length}</strong> · Valor visible: <strong>${core.money(active.reduce((a,v)=>a+deliveryValue(v),0))}</strong>`;
    updatePagerUI(p,{info:'infoPaginacionDomiciliosDetalle',page:'paginaDomiciliosDetalleActual',prev:'btnPrevDomiciliosDetalle',next:'btnNextDomiciliosDetalle'},'domicilios');
  }

  async function updateDomiciles(force = false) {
    const input=document.getElementById('filtroDomiciliosFecha');
    if(input&&!input.value)input.value=core.dateKeyCO();
    await Promise.all([
      loadDomicileDay(pager('domicileDay').index,force),
      loadDomicileDetail(pager('domicileDetail').index,force),
      loadCurrentDomicileCards(force)
    ]);
  }
  setGlobal('verDomiciliosDetalladosPorFecha',async function(){resetPager('domicileDetail',document.getElementById('filtroDomiciliosFecha')?.value||core.dateKeyCO());return loadDomicileDetail(0,false);});
  setGlobal('actualizarDomiciliosVista',function(force=false){return updateDomiciles(force);});

  // ---------- Cierres de caja remotos ----------
  function closingRow(control) {
    const summary = global.obtenerResumenCajaDiaParaControl?.(control.diaClave, control) || control;
    const expected = Number(control.aperturaMonto || 0) + Number(summary.efectivoNetoSistema || control.montoEsperadoCaja || 0);
    const real = Number(summary.totalSistemaReal || control.totalSistemaReal || 0);
    const transfers = Number(summary.totalTransferencias || control.totalTransferencias || 0);
    const deliveries = Number(summary.ajusteDomiciliosTransferencia || control.ajusteDomiciliosTransferencia || 0);
    const closed = global.tieneCierreRegistradoControl?.(control) || Boolean(control.cierreHora);
    const difference = closed ? Number(control.cierreMonto || 0) - expected : 0;
    const admin = ['admin','administrador'].includes(core.normalizeRole(global.LP_PROFILE?.rol));
    return `<tr>
      <td class="font-semibold">${core.escapeHTML(control.diaClave||'-')}</td>
      <td>${control.aperturaHora||Number(control.aperturaMonto||0)>0?core.money(control.aperturaMonto):'<span class="text-gray-400">Sin apertura</span>'}</td>
      <td>${closed?core.money(control.cierreMonto):'<span class="text-gray-400">Pendiente</span>'}</td>
      <td>${core.money(summary.totalEfectivo||0)}</td><td>${core.money(transfers)}</td><td class="text-red-700">${core.money(deliveries)}</td>
      <td>${core.money(expected)}</td><td class="text-green-700 font-semibold">${core.money(real)}</td>
      <td class="font-semibold ${!closed?'text-gray-500':difference===0?'text-green-700':'text-red-700'}">${closed?core.money(difference):'Pendiente'}</td>
      <td>${core.escapeHTML(control.aperturaUsuario||'-')}</td><td>${core.escapeHTML(control.cierreUsuario||(closed?'-':'Pendiente'))}</td>
      <td><div class="flex flex-wrap gap-1 justify-center"><button onclick="abrirModalDesgloseCierreDia('${core.escapeHTML(control.diaClave)}')" class="bg-slate-800 text-white text-xs">📊 Ver</button>${admin?`<button onclick="abrirModalEditarCierreCaja('${core.escapeHTML(control.diaClave)}')" class="bg-yellow-100 text-yellow-800 text-xs">✏️ Editar</button><button onclick="eliminarCierreCaja('${core.escapeHTML(control.diaClave)}')" class="bg-red-100 text-red-700 text-xs">Anular</button>`:''}</div></td>
    </tr>`;
  }

  async function renderClosings(target=0,force=false) {
    const p=ensureSignature('closings','global');
    await fetchPageExact({name:'closings',signature:'global',targetIndex:target,force,queryFactory:()=>core.services().db.collection('controlCaja').orderBy('diaClave','desc'),mapDoc:d=>global.normalizarControlCaja?.({diaClave:d.id,...d.data()},d.id)||({diaClave:d.id,...d.data()})});
    const rows=(p.pages[p.index]?.data||[]).filter(c=>global.tieneDatosControlCaja?.(c)!==false).map(closingRow);
    const body=document.getElementById('cierresCajaBody');if(body)body.innerHTML=rows.length?rows.join(''):emptyRow(12,'No hay registros de caja en esta página.');
    updatePagerUI(p,{info:'infoPaginacionCierresCaja',page:'paginaCierresCajaActual',prev:'btnPrevCierresCaja',next:'btnNextCierresCaja'},'cierres');
  }
  setGlobal('renderTablaCierresCaja',function(force=false){if(force)resetPager('closings','global');return renderClosings(pager('closings').index,force);});

  // En el cierre se guarda una fotografía completa del día y se generan resúmenes rápidos.
  function hardenCashControl() {
    const originalSave = global.guardarControlCajaDia;
    if (typeof originalSave === 'function' && !originalSave.__lpC26Wrapped) {
      const wrapped = async function(day,payload={}) {
        let data={...payload,diaClave:day,schemaVersion:3,actualizadoPorUid:core.services().auth.currentUser?.uid||'',actualizadoPorEmail:core.services().auth.currentUser?.email||'',versionSistema:core.VERSION};
        if (payload.cierreHora) {
          try {
            const sales=await fetchAllSalesForDay(day,true);
            const summary=summarizeSales(day,sales);
            data={...data,...summary,cantidadVentasActivas:summary.ventas,cantidadDomiciliosActivos:summary.domicilios,totalVentas:summary.total,totalCobradoClientes:summary.total+summary.totalDomicilios,ventaRealNegocio:summary.total};
          } catch(error){console.warn('[C2.6] No se pudo completar la fotografía del cierre:',error);}
        }
        const result=await originalSave.call(this,day,data);
        core.invalidateQueryCache('pos:closings');resetPager('closings','global');
        if(payload.cierreHora){try{const sales=await fetchAllSalesForDay(day,false);await writeSummaryForDay(day,sales);}catch(error){console.warn('[C2.6] Cierre guardado, pero el resumen quedó pendiente:',error);}}
        await core.audit('control_caja_actualizado',{diaClave:day,aperturaMonto:Number(data.aperturaMonto||0),cierreMonto:Number(data.cierreMonto||0),tieneCierre:Boolean(data.cierreHora)});
        return result;
      };
      wrapped.__lpC26Wrapped=true;setGlobal('guardarControlCajaDia',wrapped);
    }
  }

  // ---------- Navegación remota de tablas ----------
  const originalChangeTable = global.cambiarPaginaTabla;
  // Fix specialized call signature for summary pagers.
  setGlobal('cambiarPaginaTabla', async function(key,direction) {
    const pName={cierresCaja:'closings',historicoDia:'historyDay',historicoSemana:'historyWeek',historicoMes:'historyMonth',historicoDetalle:'historyDetail',domiciliosDia:'domicileDay',domiciliosDetalle:'domicileDetail'}[key];
    if(!pName) return typeof originalChangeTable==='function'?originalChangeTable.call(this,key,direction):undefined;
    const p=pager(pName),target=Math.max(0,p.index+Number(direction||0));
    if(direction<0&&p.pages[target]){p.index=target;if(summaryConfigs[pName])renderSummaryPage(pName);else if(pName==='salesToday')renderSalesPage();else if(pName==='closings')await renderClosings(target,false);else if(pName==='historyDetail')await loadHistoryDetail(target,false);else if(pName==='domicileDay')await loadDomicileDay(target,false);else await loadDomicileDetail(target,false);return;}
    if(summaryConfigs[pName])return loadSummaryPage(pName,target,false);
    if(pName==='closings')return renderClosings(target,false);
    if(pName==='historyDetail')return loadHistoryDetail(target,false);
    if(pName==='domicileDay')return loadDomicileDay(target,false);
    if(pName==='domicileDetail')return loadDomicileDetail(target,false);
  });

  function wrapNavigation() {
    // Las funciones heredadas de apertura ya invocan actualizarHistoricos/actualizarDomiciliosVista.
    // No se vuelven a envolver para evitar consultas duplicadas al abrir una sección.
    setGlobal('refrescarVistasAnaliticasSiEstanAbiertas',function(){
      if(!document.getElementById('historicosVista')?.classList.contains('hidden'))updateHistory(false).catch(console.error);
      if(!document.getElementById('domiciliosVista')?.classList.contains('hidden'))updateDomiciles(false).catch(console.error);
    });
  }

  function fixedCharts() {
    const style=document.createElement('style');style.id='lpC2ChartFix';style.textContent='.lp-chart-container-c2{position:relative!important;height:230px!important;max-height:230px!important;overflow:hidden!important}.lp-chart-container-c2 canvas{width:100%!important;height:100%!important;max-height:230px!important}@media(max-width:767px){.lp-chart-container-c2{height:195px!important;max-height:195px!important}.lp-chart-container-c2 canvas{max-height:195px!important}}';document.head.appendChild(style);
    document.querySelectorAll('canvas').forEach(c=>c.parentElement?.classList.add('lp-chart-container-c2'));
  }

  function cleanupOnSignout() {
    const original=global.cerrarSesionRol;if(typeof original!=='function')return;
    setGlobal('cerrarSesionRol',async function(){try{state.salesUnsubscribe?.();}catch(_){}Object.values(state.pagers).forEach(p=>{p.pages=[];p.index=0;});global.LP_PROFILE=null;return original.apply(this,arguments);});
  }

  async function init() {
    try {
      core.ensureFirebase();hardenLogin();disableDestructiveFunctions();hardenCashControl();wrapNavigation();cleanupOnSignout();fixedCharts();decorateTables();
      const {auth,db}=core.services();
      auth.onAuthStateChanged(async user=>{
        if(!user){try{state.salesUnsubscribe?.();}catch(_){}return;}
        const profile=await core.getProfile(user,db).catch(()=>null);
        if(!profile){statusMessage('Sesión sin perfil autorizado en usuariosSistema.','error');return;}
        global.LP_PROFILE=profile;
        startSalesListener();
      });
      console.info(`[La Parepa ${core.VERSION}] Paginación remota de ${PAGE_SIZE} documentos y caché activa.`);
    } catch(error){console.error('[C2.6] No se pudo activar la capa optimizada:',error);statusMessage(error.message||'Error iniciando optimización.','error');}
  }

  function diagnoseQueries() {
    const stats = core.queryCacheStats();
    const report = {
      version: core.VERSION,
      pageSize: PAGE_SIZE,
      cachedQueries: stats.entries,
      inFlightQueries: stats.inflight,
      hits: stats.hits,
      misses: stats.misses,
      shared: stats.shared,
      avoidedRequests: stats.hits + stats.shared
    };
    console.table(report);
    return report;
  }
  global.diagnosticarConsultasC26 = diagnoseQueries;
  global.LP_C2=Object.freeze({state,PAGE_SIZE,loadSalesPage,loadHistoryDetail,loadDomicileDetail,renderClosings,rebuildSummaries,queryStats:core.queryCacheStats,diagnoseQueries});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
