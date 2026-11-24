(function () {
  'use strict';

  const core = window.LP_CORE;
  const PAGE = 10;
  const MAX_ANALYTICS = 10000;
  const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_FIRESTORE_IMAGE_BYTES = 520 * 1024;
  const CACHE = 'finanzas_recientes';

  let ctx = null;
  let editing = null;
  let page = { index: 0, cursor: null, cursors: [null], hasNext: false };
  let analytics = [];
  const charts = { pie: null, cat: null };
  const $ = id => document.getElementById(id);

  function admin() {
    return ['admin', 'administrador'].includes(core.normalizeRole(ctx?.profile?.rol));
  }

  function msg(text, kind = '') {
    const el = $('message');
    el.textContent = text;
    el.className = `notice ${kind}`;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 7000);
  }

  function status(text, kind = '') {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind}`;
  }

  function normal(data, id = '') {
    const inlineReceipt = data.imagen || data.comprobanteDataUrl || data.comprobanteUrl || null;
    return {
      id,
      estado: data.estado || 'activo',
      tipo: data.tipo === 'ingreso' ? 'ingreso' : 'gasto',
      monto: Math.max(0, core.number(data.monto)),
      categoria: core.text(data.categoria || 'Otro', 80),
      fecha: String(data.fecha || core.dateKeyCO()).slice(0, 10),
      descripcion: core.text(data.descripcion || '', 500),
      origen: core.text(data.origen || 'manual', 50),
      sourceKey: data.sourceKey || null,
      bloqueoEdicion: Boolean(data.bloqueoEdicion || data.origen !== 'manual'),
      tieneComprobante: Boolean(data.tieneComprobante || data.comprobanteDocId || inlineReceipt),
      comprobanteDocId: data.comprobanteDocId || id || null,
      comprobanteInline: inlineReceipt,
      detalleNomina: data.detalleNomina || null,
      detalleControlCaja: data.detalleControlCaja || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  }

  function monthBounds() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    $('from').value = core.dateKeyCO(from);
    $('to').value = core.dateKeyCO(to);
  }

  function filters() {
    return {
      from: $('from').value,
      to: $('to').value,
      type: $('filterType').value,
      category: $('filterCategory').value
    };
  }

  function baseQuery(order = true) {
    let query = ctx.db.collection('finanzas_movimientos').where('estado', '==', 'activo');
    const f = filters();
    if (f.from) query = query.where('fecha', '>=', f.from);
    if (f.to) query = query.where('fecha', '<=', f.to);
    if (f.type) query = query.where('tipo', '==', f.type);
    if (f.category) query = query.where('categoria', '==', f.category);
    if (order) query = query.orderBy('fecha', 'desc');
    return query;
  }

  async function loadPage(direction = 0) {
    if (direction < 0) {
      if (page.index === 0) return;
      page.index -= 1;
      page.cursor = page.cursors[page.index] || null;
    } else if (direction > 0) {
      if (!page.hasNext) return;
      page.index += 1;
      page.cursor = page.cursors[page.index] || page.cursor;
    }

    status('Consultando movimientos…', 'sync');
    try {
      let query = baseQuery(true).limit(PAGE + 1);
      if (page.cursor) query = query.startAfter(page.cursor);
      const snapshot = await query.get();
      const docs = snapshot.docs.slice(0, PAGE);
      page.hasNext = snapshot.docs.length > PAGE;
      if (!page.cursors[page.index] && page.cursor) page.cursors[page.index] = page.cursor;
      if (page.hasNext && docs.length) page.cursors[page.index + 1] = docs[docs.length - 1];
      renderRows(docs.map(doc => normal(doc.data(), doc.id)));
      $('pageInfo').textContent = `Página ${page.index + 1}`;
      $('prev').disabled = page.index === 0;
      $('next').disabled = !page.hasNext;
      // No se guardan las imágenes Base64 en localStorage para evitar exceder la cuota.
      core.writeStorage(CACHE, docs.map(doc => {
        const item = { id: doc.id, ...doc.data() };
        delete item.imagen;
        delete item.comprobanteDataUrl;
        return item;
      }), { maxItems: 50 });
      status(`Conectado · ${ctx.profile.nombre}`, 'online');
    } catch (error) {
      console.error(error);
      status('Error de consulta');
      const cached = core.readStorage(CACHE, []).map(item => normal(item, item.id));
      renderRows(cached);
      msg(core.classifyError(error) === 'INDICE'
        ? 'Falta publicar un índice de Firestore incluido en el paquete C2.6.'
        : 'No se pudo consultar Firestore; se muestra la caché reciente.', 'error');
    }
  }

  function resetPage() {
    page = { index: 0, cursor: null, cursors: [null], hasNext: false };
  }

  async function loadAnalytics() {
    status('Calculando totales del rango…', 'sync');
    const all = [];
    let cursor = null;
    try {
      while (all.length < MAX_ANALYTICS) {
        let query = baseQuery(true).limit(501);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs.slice(0, 500);
        docs.forEach(doc => all.push(normal(doc.data(), doc.id)));
        if (snapshot.docs.length <= 500 || !docs.length) break;
        cursor = docs[docs.length - 1];
      }
      analytics = all;
      renderAnalytics();
      if (all.length >= MAX_ANALYTICS) {
        msg(`El filtro alcanzó el límite de seguridad de ${MAX_ANALYTICS.toLocaleString('es-CO')} movimientos. Reduce el rango para un total exacto.`, 'warn');
      }
    } catch (error) {
      console.error(error);
      msg('No fue posible calcular los totales del rango.', 'error');
    } finally {
      status(`Conectado · ${ctx.profile.nombre}`, 'online');
    }
  }

  function renderRows(rows) {
    $('body').innerHTML = rows.length ? rows.map(item => {
      const canEdit = !item.bloqueoEdicion;
      const canCancel = !item.bloqueoEdicion || admin();
      const actions = [
        canEdit ? `<button class="btn secondary" data-edit="${item.id}">Editar</button>` : '',
        canCancel ? `<button class="btn danger" data-cancel="${item.id}">Anular</button>` : '<span class="tag">Solo Administración</span>'
      ].join('');
      const receipt = item.tieneComprobante
        ? `<button class="btn secondary" data-receipt="${item.id}">Ver</button>`
        : '—';
      return `<tr><td>${core.escapeHTML(item.fecha)}</td><td><span class="tag ${item.tipo === 'ingreso' ? 'ok' : 'bad'}">${item.tipo}</span></td><td>${core.money(item.monto)}</td><td>${core.escapeHTML(item.categoria)}</td><td>${core.escapeHTML(item.descripcion)}</td><td>${core.escapeHTML(item.origen)}</td><td>${receipt}</td><td><div class="actions">${actions}</div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No hay movimientos en esta página.</td></tr>';
  }

  function renderAnalytics() {
    const active = analytics.filter(item => item.estado === 'activo');
    const income = active.filter(item => item.tipo === 'ingreso').reduce((acc, item) => acc + item.monto, 0);
    const expenses = active.filter(item => item.tipo === 'gasto').reduce((acc, item) => acc + item.monto, 0);
    $('income').textContent = core.money(income);
    $('expenses').textContent = core.money(expenses);
    $('balance').textContent = core.money(income - expenses);
    $('count').textContent = active.length.toLocaleString('es-CO');

    const categories = {};
    active.filter(item => item.tipo === 'gasto').forEach(item => {
      categories[item.categoria] = (categories[item.categoria] || 0) + item.monto;
    });
    charts.pie?.destroy();
    charts.cat?.destroy();
    charts.pie = new Chart($('pieChart'), {
      type: 'doughnut',
      data: { labels: ['Ingresos', 'Gastos'], datasets: [{ data: [income, expenses] }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
    charts.cat = new Chart($('categoryChart'), {
      type: 'bar',
      data: { labels: Object.keys(categories), datasets: [{ label: 'Gastos', data: Object.values(categories) }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: value => core.money(value) } } }
      }
    });

    const months = {};
    active.forEach(item => {
      const month = item.fecha.slice(0, 7);
      months[month] ||= { i: 0, g: 0 };
      months[month][item.tipo === 'ingreso' ? 'i' : 'g'] += item.monto;
    });
    $('monthly').innerHTML = Object.entries(months)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, values]) => `<tr><td>${month}</td><td>${core.money(values.i)}</td><td>${core.money(values.g)}</td><td>${core.money(values.i - values.g)}</td></tr>`)
      .join('') || '<tr><td colspan="4" class="empty">Sin datos.</td></tr>';

    const payroll = active.filter(item => item.origen === 'nomina');
    $('payrollCount').textContent = payroll.length;
    $('payrollTotal').textContent = core.money(payroll.reduce((acc, item) => acc + item.monto, 0));
    $('payrollBody').innerHTML = payroll.slice(0, 20)
      .map(item => `<tr><td>${item.fecha}</td><td>${core.escapeHTML(item.detalleNomina?.nombre || '-')}</td><td>${core.escapeHTML(item.detalleNomina?.quincena || '-')}</td><td>${core.money(item.monto)}</td></tr>`)
      .join('') || '<tr><td colspan="4" class="empty">No hay pagos sincronizados.</td></tr>';
  }

  function stringBytes(value) {
    return new TextEncoder().encode(String(value || '')).length;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen seleccionada.'));
      };
      image.src = url;
    });
  }

  async function compressReceiptForFirestore(file) {
    if (!file) return null;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('El comprobante debe ser una imagen.');
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error('La imagen original supera 5 MB.');
    }

    const image = await loadImage(file);
    const plans = [
      [1400, 0.80], [1200, 0.76], [1000, 0.72], [900, 0.66],
      [800, 0.60], [700, 0.54], [600, 0.48]
    ];

    for (const [maxSide, quality] of plans) {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/webp', quality);
      const bytes = stringBytes(dataUrl);
      if (bytes <= MAX_FIRESTORE_IMAGE_BYTES) {
        return {
          dataUrl,
          bytes,
          mime: 'image/webp',
          originalName: core.text(file.name || 'comprobante', 120)
        };
      }
    }

    throw new Error('La imagen no pudo reducirse lo suficiente para guardarla de forma segura en Firestore. Usa una foto más pequeña o recórtala.');
  }

  function renderImageInPopup(popup, dataUrl, title = 'Comprobante') {
    popup.opener = null;
    popup.document.title = title;
    popup.document.body.innerHTML = '';
    popup.document.body.style.cssText = 'margin:0;background:#21110f;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box';
    const image = popup.document.createElement('img');
    image.alt = title;
    image.src = dataUrl;
    image.style.cssText = 'max-width:100%;max-height:calc(100vh - 32px);object-fit:contain;background:white;border-radius:10px';
    popup.document.body.appendChild(image);
  }

  async function viewReceipt(movementId) {
    const popup = window.open('', '_blank');
    if (!popup) return msg('El navegador bloqueó la ventana del comprobante. Habilita las ventanas emergentes para este sitio.', 'error');
    popup.document.body.innerHTML = '<p style="font-family:Segoe UI,Arial;padding:24px">Cargando comprobante…</p>';
    try {
      status('Cargando comprobante…', 'sync');
      const receiptDoc = await ctx.db.collection('finanzas_comprobantes').doc(String(movementId)).get();
      if (receiptDoc.exists && receiptDoc.data()?.imagen) {
        renderImageInPopup(popup, receiptDoc.data().imagen, `Comprobante ${movementId}`);
        return;
      }
      // Compatibilidad con registros históricos que guardaron la imagen dentro del movimiento.
      const movementDoc = await ctx.db.collection('finanzas_movimientos').doc(String(movementId)).get();
      const data = movementDoc.data() || {};
      const legacy = data.imagen || data.comprobanteDataUrl || data.comprobanteUrl || null;
      if (!legacy) throw new Error('Este movimiento no tiene comprobante disponible.');
      if (String(legacy).startsWith('data:image/')) renderImageInPopup(popup, legacy, `Comprobante ${movementId}`);
      else popup.location.href = legacy;
    } catch (error) {
      console.error(error);
      try { popup.close(); } catch (_) {}
      msg(error.message || 'No se pudo abrir el comprobante.', 'error');
    } finally {
      status(`Conectado · ${ctx.profile.nombre}`, 'online');
    }
  }

  async function saveMovement(event) {
    event.preventDefault();
    const id = editing || ctx.db.collection('finanzas_movimientos').doc().id;
    const amount = core.number($('amount').value);
    if (amount <= 0) return msg('El monto debe ser mayor que cero.', 'error');
    $('saveButton').disabled = true;

    try {
      const movementRef = ctx.db.collection('finanzas_movimientos').doc(id);
      const receiptRef = ctx.db.collection('finanzas_comprobantes').doc(id);
      const oldDoc = editing ? await movementRef.get() : null;
      const oldData = oldDoc?.data() || {};
      const selectedFile = $('receipt').files[0] || null;
      const compressed = selectedFile ? await compressReceiptForFirestore(selectedFile) : null;
      const hadLegacyReceipt = Boolean(oldData.imagen || oldData.comprobanteDataUrl || oldData.comprobanteUrl);
      const hasReceipt = Boolean(compressed || oldData.tieneComprobante || oldData.comprobanteDocId || hadLegacyReceipt);

      const payload = {
        tipo: $('type').value,
        monto: amount,
        categoria: $('category').value,
        fecha: $('date').value,
        descripcion: core.text($('description').value, 500),
        tieneComprobante: hasReceipt,
        comprobanteDocId: hasReceipt ? id : null,
        comprobanteAlmacenamiento: compressed ? 'firestore-documento' : (oldData.comprobanteAlmacenamiento || (hadLegacyReceipt ? 'inline-legacy' : null)),
        origen: oldData.origen || 'manual',
        sourceKey: oldData.sourceKey || null,
        bloqueoEdicion: Boolean(oldData.bloqueoEdicion),
        estado: 'activo',
        schemaVersion: 4,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        actualizadoPorUid: ctx.user.uid,
        actualizadoPorEmail: ctx.user.email || ''
      };
      if (!editing) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      if (compressed) {
        // Al reemplazar un comprobante histórico, se retira el Base64/URL del documento principal.
        payload.imagen = firebase.firestore.FieldValue.delete();
        payload.comprobanteDataUrl = firebase.firestore.FieldValue.delete();
        payload.comprobanteUrl = firebase.firestore.FieldValue.delete();
      }

      const batch = ctx.db.batch();
      batch.set(movementRef, payload, { merge: true });
      if (compressed) {
        batch.set(receiptRef, {
          movimientoId: id,
          imagen: compressed.dataUrl,
          mime: compressed.mime,
          nombreOriginal: compressed.originalName,
          bytes: compressed.bytes,
          schemaVersion: 1,
          actualizadoPorUid: ctx.user.uid,
          actualizadoPorEmail: ctx.user.email || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await batch.commit();

      await core.audit(editing ? 'finanzas_movimiento_editado' : 'finanzas_movimiento_creado', {
        movimientoId: id,
        monto: amount,
        tipo: payload.tipo,
        categoria: payload.categoria,
        comprobanteFirestore: Boolean(compressed),
        comprobanteBytes: compressed?.bytes || 0
      });
      clearForm();
      resetPage();
      await Promise.all([loadPage(), loadAnalytics()]);
      msg('Movimiento guardado en Firestore.');
    } catch (error) {
      console.error(error);
      msg(error.message || 'No se pudo guardar.', 'error');
    } finally {
      $('saveButton').disabled = false;
    }
  }

  function clearForm() {
    $('movementForm').reset();
    $('date').value = core.dateKeyCO();
    editing = null;
    $('cancelEdit').classList.add('hidden');
    $('saveButton').textContent = 'Guardar movimiento';
  }

  async function edit(id) {
    const doc = await ctx.db.collection('finanzas_movimientos').doc(id).get();
    if (!doc.exists) return;
    const item = normal(doc.data(), doc.id);
    if (item.bloqueoEdicion) return msg('Los movimientos automáticos se corrigen en su módulo de origen.', 'warn');
    editing = id;
    $('type').value = item.tipo;
    $('amount').value = item.monto;
    $('category').value = item.categoria;
    $('date').value = item.fecha;
    $('description').value = item.descripcion;
    $('cancelEdit').classList.remove('hidden');
    $('saveButton').textContent = 'Actualizar movimiento';
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function cancel(id) {
    const ref = ctx.db.collection('finanzas_movimientos').doc(id);
    const doc = await ref.get();
    const data = doc.data() || {};
    if (data.origen && data.origen !== 'manual' && !admin()) {
      return msg('Solo Administración puede anular movimientos automáticos de caja o nómina.', 'error');
    }
    const reason = core.text(prompt('Motivo de anulación:') || '', 300);
    if (!reason) return msg('Debes indicar un motivo.', 'warn');
    if (!confirm('¿Anular este movimiento? Se conservará para auditoría.')) return;
    const batch = ctx.db.batch();
    batch.set(ref, {
      estado: 'anulado',
      motivoAnulacion: reason,
      anuladoPorUid: ctx.user.uid,
      anuladoPorEmail: ctx.user.email || '',
      fechaAnulacion: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    if (data.sourceKey && data.origen !== 'manual') {
      batch.set(ctx.db.collection('finanzas_exclusiones').doc(String(data.sourceKey)), {
        activo: true,
        sourceKey: String(data.sourceKey),
        motivo: reason,
        uid: ctx.user.uid,
        email: ctx.user.email || '',
        fechaServidor: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    await core.audit('finanzas_movimiento_anulado', { movimientoId: id, motivo: reason, sourceKey: data.sourceKey || null });
    resetPage();
    await Promise.all([loadPage(), loadAnalytics()]);
    msg('Movimiento anulado.');
  }

  function closingMovement(control, id) {
    const day = String(control.diaClave || id);
    const summary = control.resumenCierre || {};
    const sales = core.number(summary.ventaRealNegocio ?? control.ventaRealNegocio ?? control.totalSistemaReal ?? control.cierreRealDia ?? Math.max(core.number(control.cierreMonto) - core.number(control.aperturaMonto), 0));
    return {
      id: `cierre_caja_${day}`,
      tipo: 'ingreso',
      monto: Math.max(0, sales),
      categoria: 'Ventas',
      fecha: day,
      descripcion: `Ventas del día según cierre de caja ${day}`,
      origen: 'cierre_caja',
      sourceKey: `cierre_caja_${day}`,
      bloqueoEdicion: true,
      detalleControlCaja: {
        aperturaMonto: core.number(control.aperturaMonto),
        cierreMonto: core.number(control.cierreMonto),
        cierreHora: control.cierreHora || null
      }
    };
  }

  function payrollMovement(payment, id) {
    const total = core.number(payment.totalPagado);
    if (total <= 0) return null;
    const paymentId = String(payment.pagoId || id);
    return {
      id: `nomina_pago_${paymentId}`,
      tipo: 'gasto',
      monto: total,
      categoria: 'Empleados',
      fecha: String(payment.fechaPago || payment.fecha || core.dateKeyCO()).slice(0, 10),
      descripcion: `Pago de nómina · ${core.text(payment.nombre || 'Empleado', 120)}${payment.quincena ? ` · ${core.text(payment.quincena, 80)}` : ''}`,
      origen: 'nomina',
      sourceKey: `nomina_pago_${paymentId}`,
      bloqueoEdicion: true,
      detalleNomina: {
        pagoId: paymentId,
        nombre: core.text(payment.nombre || 'Empleado', 120),
        cargo: core.text(payment.cargo || '', 100),
        quincena: core.text(payment.quincena || '', 80),
        fechaPago: payment.fechaPago || payment.fecha || null,
        totalPagado: total
      }
    };
  }

  async function loadExclusions() {
    const set = new Set();
    let cursor = null;
    do {
      let query = ctx.db.collection('finanzas_exclusiones').where('activo', '==', true).limit(501);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      const docs = snapshot.docs.slice(0, 500);
      docs.forEach(doc => set.add(String(doc.data()?.sourceKey || doc.id)));
      cursor = snapshot.docs.length > 500 ? docs[docs.length - 1] : null;
    } while (cursor && set.size < 10000);
    return set;
  }

  function sourceFingerprint(item) {
    return JSON.stringify([item.sourceKey, item.tipo, Number(item.monto || 0), item.categoria, item.fecha, item.descripcion, item.origen, item.detalleControlCaja || null, item.detalleNomina || null]);
  }

  async function upsertAuto(item, exclusions) {
    if (!item || exclusions.has(String(item.sourceKey))) return false;
    const ref = ctx.db.collection('finanzas_movimientos').doc(item.id);
    const existing = await ref.get();
    const fingerprint = sourceFingerprint(item);
    const old = existing.exists ? existing.data() : null;
    if (old && old.estado === 'activo' && old.sourceFingerprint === fingerprint) return false;
    const payload = {
      ...item,
      sourceFingerprint: fingerprint,
      estado: 'activo',
      schemaVersion: 3,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!existing.exists) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await ref.set(payload, { merge: true });
    return true;
  }

  async function syncSources() {
    if (!admin()) return msg('Solo Administración puede sincronizar cierres y nómina.', 'error');
    status('Sincronizando fuentes…', 'sync');
    $('syncSources').disabled = true;
    let writes = 0;
    let reviewed = 0;
    try {
      const exclusions = await loadExclusions();
      let cursor = null;
      do {
        let query = ctx.db.collection('controlCaja').orderBy('diaClave', 'desc').limit(101);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs.slice(0, 100);
        for (const doc of docs) {
          reviewed += 1;
          const data = { diaClave: doc.id, ...doc.data() };
          if (data.cierreHora && data.estado !== 'anulado' && await upsertAuto(closingMovement(data, doc.id), exclusions)) writes += 1;
        }
        cursor = snapshot.docs.length > 100 ? docs[docs.length - 1] : null;
      } while (cursor && reviewed < 5000);

      cursor = null;
      do {
        let query = ctx.db.collection('nomina').where('recordType', '==', 'pago').orderBy('fechaPago', 'desc').limit(101);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const docs = snapshot.docs.slice(0, 100);
        for (const doc of docs) {
          reviewed += 1;
          if (doc.data()?.estado !== 'anulado' && await upsertAuto(payrollMovement(doc.data(), doc.id), exclusions)) writes += 1;
        }
        cursor = snapshot.docs.length > 100 ? docs[docs.length - 1] : null;
      } while (cursor && reviewed < 10000);

      await core.audit('finanzas_fuentes_sincronizadas', { revisados: reviewed, actualizados: writes, exclusiones: exclusions.size });
      resetPage();
      await Promise.all([loadPage(), loadAnalytics()]);
      msg(`Sincronización terminada: ${reviewed} revisados · ${writes} actualizados.`);
    } catch (error) {
      console.error(error);
      msg(core.classifyError(error) === 'INDICE' ? 'Faltan índices. Publica firestore.indexes.json.' : error.message || 'Error sincronizando.', 'error');
    } finally {
      $('syncSources').disabled = false;
      status(`Conectado · ${ctx.profile.nombre}`, 'online');
    }
  }

  async function exportExcel() {
    if (!analytics.length) return msg('No hay datos en el filtro actual.', 'warn');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Movimientos');
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Monto', key: 'monto', width: 16 },
      { header: 'Categoría', key: 'categoria', width: 20 },
      { header: 'Descripción', key: 'descripcion', width: 45 },
      { header: 'Origen', key: 'origen', width: 18 },
      { header: 'Comprobante', key: 'comprobante', width: 30 }
    ];
    analytics.forEach(item => sheet.addRow({
      fecha: item.fecha,
      tipo: item.tipo,
      monto: item.monto,
      categoria: item.categoria,
      descripcion: item.descripcion,
      origen: item.origen,
      comprobante: item.tieneComprobante ? 'Sí · guardado en Firestore' : ''
    }));
    sheet.getColumn('monto').numFmt = '"$"#,##0';
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `finanzas_${$('from').value}_${$('to').value}.xlsx`);
    await core.audit('finanzas_exportacion', { desde: $('from').value, hasta: $('to').value, registros: analytics.length });
  }

  async function apply() {
    resetPage();
    await Promise.all([loadPage(), loadAnalytics()]);
  }

  async function init() {
    ctx = await core.guardPage({ roles: ['admin', 'administrador', 'contabilidad', 'contador'], module: 'finanzas' });
    if (!ctx) return;
    status(`Conectado · ${ctx.profile.nombre}`, 'online');
    monthBounds();
    $('date').value = core.dateKeyCO();
    $('movementForm').addEventListener('submit', saveMovement);
    $('cancelEdit').addEventListener('click', clearForm);
    $('applyFilters').addEventListener('click', apply);
    $('resetFilters').addEventListener('click', () => {
      monthBounds();
      $('filterType').value = '';
      $('filterCategory').value = '';
      apply();
    });
    $('syncSources').addEventListener('click', syncSources);
    $('refresh').addEventListener('click', apply);
    $('prev').addEventListener('click', () => loadPage(-1));
    $('next').addEventListener('click', () => loadPage(1));
    $('exportExcel').addEventListener('click', exportExcel);
    $('body').addEventListener('click', event => {
      const editButton = event.target.closest('[data-edit]');
      const cancelButton = event.target.closest('[data-cancel]');
      const receiptButton = event.target.closest('[data-receipt]');
      if (editButton) edit(editButton.dataset.edit);
      if (cancelButton) cancel(cancelButton.dataset.cancel);
      if (receiptButton) viewReceipt(receiptButton.dataset.receipt);
    });
    if (!admin()) {
      $('syncSources').disabled = true;
      $('syncSources').title = 'Solo Administración puede sincronizar fuentes automáticas';
    }
    await apply();
    if (admin()) setTimeout(() => syncSources(), 1500);
  }

  init().catch(error => {
    console.error(error);
    core.renderBlocked('No fue posible iniciar Finanzas.', 'index.html');
  });
})();
