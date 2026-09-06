(function (global) {
  'use strict';

  const VERSION = 'C2.13.1';
  const COLLECTION = 'sesionesPOS';
  const LEASE_MS = 120000;
  const HEARTBEAT_MS = 30000;
  const LOCAL_HEARTBEAT_MS = 5000;
  const LOCAL_STALE_MS = 18000;
  const SESSION_KEY = 'lp_pos_session_id_c213';
  const SHARED_KEY = 'lp_pos_shared_mode_c2131';
  const LEGACY_CAJA_KEY = 'lpControlCajaPendienteV1';
  const LEGACY_CAJA_BACKUP = 'lpControlCajaPendienteLegacyC212';
  const pageId = (global.crypto?.randomUUID?.() || `page_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  let sessionId = '';
  let currentUid = '';
  let currentEmail = '';
  let active = false;
  let blockedReason = '';
  let sharedMode = false;
  let heartbeatTimer = null;
  let localTimer = null;
  let acquiring = null;

  function services() {
    try {
      const core = global.LP_CORE;
      if (core?.services) return core.services();
    } catch (_) {}
    return { db: global.firestoreDb || null, auth: global.firebaseAuth || null };
  }

  function role() {
    let value = '';
    try { value = global.rolActual || ''; } catch (_) {}
    if (!value) value = localStorage.getItem('rolActual') || '';
    value = String(value).trim().toLowerCase();
    if (value === 'administrador') value = 'admin';
    return value;
  }

  function isOperationsRole() { return ['admin','cajero'].includes(role()); }
  function isAdmin() { return role() === 'admin'; }
  function online() {
    const { db, auth } = services();
    return Boolean(navigator.onLine && db && auth?.currentUser);
  }

  function getSessionId() {
    if (sessionId) return sessionId;
    try { sessionId = sessionStorage.getItem(SESSION_KEY) || ''; } catch (_) {}
    if (!sessionId) {
      sessionId = global.crypto?.randomUUID?.() || `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch (_) {}
    }
    return sessionId;
  }


  function setSharedFlag(value) {
    sharedMode = Boolean(value);
    try {
      if (sharedMode) sessionStorage.setItem(SHARED_KEY, '1');
      else sessionStorage.removeItem(SHARED_KEY);
    } catch (_) {}
  }

  function readSharedFlag() {
    try { return sessionStorage.getItem(SHARED_KEY) === '1'; } catch (_) { return false; }
  }

  function millis(value) {
    try {
      if (value?.toMillis) return value.toMillis();
      const n = new Date(value || 0).getTime();
      return Number.isFinite(n) ? n : 0;
    } catch (_) { return 0; }
  }

  function cleanParticipants(raw = {}, now = Date.now()) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    Object.entries(raw).forEach(([id, item]) => {
      if (!item || typeof item !== 'object') return;
      const last = millis(item.heartbeatAt || item.ultimoLatido || item.joinedAt);
      if (!last || now - last <= LEASE_MS * 2) result[id] = item;
    });
    return result;
  }

  function participant(now = Date.now(), mode = 'principal') {
    return {
      pageId,
      modo: mode,
      dispositivo: `${navigator.platform || 'dispositivo'} · ${navigator.userAgent.slice(0,90)}`,
      heartbeatAt: global.firebase.firestore.Timestamp.fromMillis(now),
      joinedAt: global.firebase.firestore.Timestamp.fromMillis(now)
    };
  }

  function participantCount(data = {}) {
    return Object.keys(cleanParticipants(data.participantes || {}, Date.now())).length;
  }

  function localKey(uid) { return `lp_pos_local_lock_c213_${uid}`; }
  function readLocalLock(uid) {
    try { return JSON.parse(localStorage.getItem(localKey(uid)) || 'null'); } catch (_) { return null; }
  }
  function writeLocalLock(uid) {
    if (!uid) return;
    try {
      localStorage.setItem(localKey(uid), JSON.stringify({ sessionId:getSessionId(), pageId, at:Date.now() }));
    } catch (_) {}
  }
  function localConflict(uid) {
    const lock = readLocalLock(uid);
    if (!lock || !lock.at || Date.now() - Number(lock.at) > LOCAL_STALE_MS) return false;
    if (lock.pageId === pageId) return false;
    const navType = performance?.getEntriesByType?.('navigation')?.[0]?.type || '';
    if (navType === 'reload' && lock.sessionId === getSessionId()) return false;
    if (readSharedFlag() && lock.sessionId === getSessionId()) return false;
    return true;
  }
  function clearLocalLock(uid) {
    if (!uid) return;
    const lock = readLocalLock(uid);
    if (lock?.pageId === pageId) {
      try { localStorage.removeItem(localKey(uid)); } catch (_) {}
    }
  }

  function ensureBanner() {
    let el = document.getElementById('lpConcurrencyBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'lpConcurrencyBanner';
    el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99999;max-width:min(92vw,760px);padding:10px 14px;border-radius:14px;font:700 13px/1.3 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.18);display:none;text-align:center';
    document.body.appendChild(el);
    return el;
  }
  function showBanner(message, kind='warn') {
    const el = ensureBanner();
    const palette = kind === 'ok'
      ? ['#ecfdf5','#166534','#86efac']
      : kind === 'error'
        ? ['#fef2f2','#991b1b','#fecaca']
        : ['#fffbeb','#92400e','#fde68a'];
    el.style.background = palette[0]; el.style.color = palette[1]; el.style.border = `1px solid ${palette[2]}`;
    el.textContent = message; el.style.display = 'block';
  }
  function hideBanner() { const el=document.getElementById('lpConcurrencyBanner'); if(el) el.style.display='none'; }

  function setBlocked(message) {
    active = false;
    blockedReason = message || 'Esta cuenta ya está activa en otro POS.';
    showBanner(`⚠️ ${blockedReason} Este navegador queda en modo consulta. Para vincularlo temporalmente a la sesión activa, presiona Ctrl + M.`, 'error');
  }

  async function acquire(options={}) {
    if (!isOperationsRole()) { active = true; blockedReason=''; return true; }
    if (acquiring) return acquiring;
    acquiring = (async () => {
      const { db, auth } = services();
      const user = auth?.currentUser;
      if (!user || !db) { setBlocked('No se puede validar la sesión operativa con Firebase.'); return false; }
      currentUid = user.uid;
      currentEmail = user.email || '';
      if (!navigator.onLine) { setBlocked('Sin conexión no se habilitan operaciones críticas para evitar duplicados.'); return false; }
      if (localConflict(currentUid)) { setBlocked('La misma cuenta ya está abierta en otra pestaña de este navegador.'); return false; }

      const ref = db.collection(COLLECTION).doc(currentUid);
      const sid = getSessionId();
      const now = Date.now();
      try {
        await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const data = snap.exists ? (snap.data() || {}) : {};
          const exp = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : new Date(data.expiresAt || 0).getTime();
          const same = data.sessionId === sid;
          const expired = !snap.exists || !Number.isFinite(exp) || exp <= now;
          if (!same && !expired) {
            const err = new Error(`Esta cuenta ya está operando en otro POS (${data.dispositivo || data.email || 'otra sesión'}).`);
            err.code = 'lp/session-in-use';
            throw err;
          }
          const participantes = cleanParticipants(data.participantes || {}, now);
          participantes[pageId] = participant(now, readSharedFlag() ? 'compartida' : 'principal');
          const compartida = Boolean(data.modoCompartido && same) || Object.keys(participantes).length > 1;
          tx.set(ref, {
            uid: currentUid,
            email: currentEmail,
            rol: role(),
            sessionId: sid,
            pageId,
            modulo: 'pos',
            dispositivo: `${navigator.platform || 'dispositivo'} · ${navigator.userAgent.slice(0,90)}`,
            participantes,
            modoCompartido: compartida,
            heartbeatAt: global.firebase.firestore.Timestamp.fromMillis(now),
            expiresAt: global.firebase.firestore.Timestamp.fromMillis(now + LEASE_MS),
            version: VERSION
          }, { merge:true });
          if (compartida) setSharedFlag(true);
        });
        active = true; blockedReason=''; writeLocalLock(currentUid); startTimers(); hideBanner();
        if (!options.silent) showBanner(sharedMode ? '🔗 Sesión POS compartida: esta ventana está vinculada a la sesión activa.' : '✅ Sesión POS protegida: esta cuenta tiene el control operativo.', 'ok');
        setTimeout(hideBanner, 1800);
        return true;
      } catch (error) {
        if (String(error?.code || '').includes('session-in-use') || /otro POS|otra sesión|ya está operando/i.test(String(error?.message || ''))) {
          setBlocked(error.message);
        } else {
          console.error('[C2.13.1] No se pudo adquirir la sesión POS:', error);
          setBlocked('No fue posible validar exclusividad de la sesión POS.');
        }
        return false;
      }
    })();
    try { return await acquiring; } finally { acquiring = null; }
  }

  async function renew() {
    if (!currentUid || !active || !online()) return false;
    const { db, auth } = services();
    const user = auth?.currentUser;
    if (!user || user.uid !== currentUid) return false;
    const ref = db.collection(COLLECTION).doc(currentUid);
    const sid = getSessionId();
    const now = Date.now();
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() || {}) : {};
        if (!snap.exists || data.sessionId !== sid) {
          const err = new Error('La sesión POS fue tomada por otro navegador.'); err.code='lp/session-lost'; throw err;
        }
        const participantes = cleanParticipants(data.participantes || {}, now);
        participantes[pageId] = participant(now, readSharedFlag() ? 'compartida' : (data.modoCompartido ? 'compartida' : 'principal'));
        const compartida = Object.keys(participantes).length > 1;
        tx.set(ref, {
          pageId,
          participantes,
          modoCompartido: compartida,
          heartbeatAt: global.firebase.firestore.Timestamp.fromMillis(now),
          expiresAt: global.firebase.firestore.Timestamp.fromMillis(now + LEASE_MS),
          version: VERSION
        }, { merge:true });
        setSharedFlag(compartida || readSharedFlag());
      });
      writeLocalLock(currentUid);
      return true;
    } catch (error) {
      setBlocked(error.message || 'La sesión POS perdió el control operativo.');
      return false;
    }
  }

  function startTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (localTimer) clearInterval(localTimer);
    heartbeatTimer = setInterval(() => renew(), HEARTBEAT_MS);
    localTimer = setInterval(() => { if (active && currentUid) writeLocalLock(currentUid); }, LOCAL_HEARTBEAT_MS);
  }

  async function release() {
    const uid = currentUid;
    const sid = getSessionId();
    active = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (localTimer) clearInterval(localTimer);
    heartbeatTimer = localTimer = null;
    clearLocalLock(uid);
    setSharedFlag(false);
    if (!uid || !online()) return;
    const { db } = services();
    try {
      const ref = db.collection(COLLECTION).doc(uid);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data()?.sessionId !== sid) return;
        const now = Date.now();
        const data = snap.data() || {};
        const participantes = cleanParticipants(data.participantes || {}, now);
        delete participantes[pageId];
        const restantes = Object.keys(participantes).length;
        if (restantes > 0) {
          tx.set(ref, {
            participantes,
            modoCompartido: restantes > 1,
            heartbeatAt: global.firebase.firestore.Timestamp.fromMillis(now),
            expiresAt: global.firebase.firestore.Timestamp.fromMillis(now + LEASE_MS),
            ultimaSalidaCompartidaEn: global.firebase.firestore.FieldValue.serverTimestamp()
          }, { merge:true });
        } else {
          tx.set(ref, {
            participantes: {},
            modoCompartido: false,
            heartbeatAt: global.firebase.firestore.Timestamp.now(),
            expiresAt: global.firebase.firestore.Timestamp.fromMillis(now - 1000),
            liberadaEn: global.firebase.firestore.FieldValue.serverTimestamp()
          }, { merge:true });
        }
      });
    } catch (_) {}
  }


  async function joinActiveSession() {
    if (!isOperationsRole()) {
      alert('Ctrl + M solo aplica a perfiles operativos (admin o cajero).');
      return false;
    }
    const { db, auth } = services();
    const user = auth?.currentUser;
    if (!user || !db || !navigator.onLine) {
      alert('Para vincular una segunda sesión se necesita conexión activa con Firebase.');
      return false;
    }
    currentUid = user.uid;
    currentEmail = user.email || '';
    const ref = db.collection(COLLECTION).doc(currentUid);

    try {
      const preview = await ref.get();
      const data = preview.exists ? (preview.data() || {}) : {};
      const exp = millis(data.expiresAt);
      if (!preview.exists || !data.sessionId || !Number.isFinite(exp) || exp <= Date.now()) {
        const ok = await acquire({silent:false});
        if (ok) alert('No había otra sesión activa. Esta ventana quedó como sesión operativa principal.');
        return ok;
      }

      if (data.sessionId === getSessionId() && active) {
        setSharedFlag(Boolean(data.modoCompartido || participantCount(data) > 1));
        showBanner(sharedMode ? '🔗 Esta ventana ya pertenece a la sesión POS compartida.' : '✅ Esta ventana ya tiene el control operativo.', 'ok');
        setTimeout(hideBanner, 2200);
        return true;
      }

      const target = data.dispositivo || data.email || 'la sesión actualmente activa';
      if (!confirm(`La cuenta ya está operando en:\n${target}\n\nCtrl + M vinculará ESTA ventana a esa misma sesión. Ambas podrán operar al mismo tiempo y compartirán caja y consecutivos.\n\n¿Continuar?`)) return false;

      const now = Date.now();
      let remoteSid = '';
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('La sesión activa ya no existe. Intenta nuevamente.');
        const current = snap.data() || {};
        const currentExp = millis(current.expiresAt);
        if (!current.sessionId || !Number.isFinite(currentExp) || currentExp <= now) {
          throw new Error('La sesión activa venció antes de poder vincularla. Intenta nuevamente.');
        }
        remoteSid = String(current.sessionId);
        const participantes = cleanParticipants(current.participantes || {}, now);
        participantes[pageId] = participant(now, 'compartida');
        tx.set(ref, {
          uid: currentUid,
          email: currentEmail,
          rol: role(),
          sessionId: remoteSid,
          pageId,
          participantes,
          modoCompartido: true,
          compartidoActivadoPorUid: currentUid,
          compartidoActivadoEn: global.firebase.firestore.FieldValue.serverTimestamp(),
          heartbeatAt: global.firebase.firestore.Timestamp.fromMillis(now),
          expiresAt: global.firebase.firestore.Timestamp.fromMillis(now + LEASE_MS),
          version: VERSION
        }, {merge:true});
      });

      sessionId = remoteSid;
      try { sessionStorage.setItem(SESSION_KEY, remoteSid); } catch (_) {}
      setSharedFlag(true);
      active = true;
      blockedReason = '';
      writeLocalLock(currentUid);
      startTimers();
      showBanner('🔗 Modo compartido activado con Ctrl + M. Esta ventana usa la misma sesión operativa, caja y consecutivos.', 'ok');
      setTimeout(hideBanner, 3500);
      try { global.LP_CORE?.audit?.('sesion_pos_compartida',{uid:currentUid,pageId,sessionId:remoteSid}); } catch(_) {}
      return true;
    } catch (error) {
      console.error('[C2.13.1] No se pudo vincular la sesión POS:', error);
      setBlocked(error.message || 'No fue posible vincular esta ventana a la sesión activa.');
      alert(error.message || 'No fue posible vincular esta ventana a la sesión activa.');
      return false;
    }
  }

  async function requireLease(action='operar') {
    if (!isOperationsRole()) return true;
    if (!navigator.onLine) {
      setBlocked('Sin Internet no se permiten ventas, apertura ni cierre de caja en modo seguro.');
      alert(`No se puede ${action} sin conexión. C2.13.1 bloquea operaciones offline para evitar ventas o comandas duplicadas entre dispositivos.`);
      return false;
    }
    if (!active) {
      const ok = await acquire({silent:true});
      if (!ok) { alert(blockedReason || 'Esta cuenta ya está activa en otro POS.'); return false; }
    }
    const ok = await renew();
    if (!ok) { alert(blockedReason || 'La sesión POS ya no tiene el control operativo.'); return false; }
    return true;
  }

  function moveLegacyCajaQueueAside() {
    try {
      const raw = localStorage.getItem(LEGACY_CAJA_KEY);
      if (raw && raw !== '{}' && raw !== 'null') {
        if (!localStorage.getItem(LEGACY_CAJA_BACKUP)) localStorage.setItem(LEGACY_CAJA_BACKUP, raw);
      }
      localStorage.setItem(LEGACY_CAJA_KEY, '{}');
    } catch (_) {}
  }

  function queueOwner(item={}) {
    return String(item.ownerUid || item?.venta?.ownerUid || item?.venta?.usuarioUid || '').trim();
  }
  function currentUser() { return services().auth?.currentUser || null; }
  function readRawSalesQueue() {
    try { const x=JSON.parse(localStorage.getItem('ventasPendientesSync')||'[]'); return Array.isArray(x)?x:[]; } catch (_) { return []; }
  }
  function writeRawSalesQueue(list) {
    try { localStorage.setItem('ventasPendientesSync', JSON.stringify(Array.isArray(list)?list:[])); } catch (_) {}
  }

  global.obtenerVentasPendientesSync = function () {
    const user = currentUser();
    const alias = String(global.usuarioActual || localStorage.getItem('usuarioActual') || '').trim();
    const email = String(user?.email || '').toLowerCase();
    const result=[];
    let changed=false;
    const raw=readRawSalesQueue();
    for (let i=0;i<raw.length;i++) {
      const item0=raw[i];
      const item = item0 && item0.venta ? {...item0} : {venta:item0, ajustesInventario:{}};
      item.venta = global.normalizarVenta ? global.normalizarVenta(item.venta || {}) : (item.venta || {});
      let owner = queueOwner(item);
      if (!owner && user) {
        const vEmail=String(item.venta.usuarioEmail||'').toLowerCase();
        const vAlias=String(item.venta.usuario||'').trim();
        if ((vEmail && vEmail===email) || (vAlias && alias && vAlias===alias)) {
          item.ownerUid=user.uid; item.ownerEmail=user.email||'';
          item.venta.ownerUid=user.uid; item.venta.ownerEmail=user.email||'';
          owner=user.uid; raw[i]=item; changed=true;
        }
      }
      if (user && owner === user.uid) result.push(item);
    }
    if (changed) writeRawSalesQueue(raw);
    return result;
  };

  global.guardarVentaPendienteSync = function (venta, ajustesInventario={}) {
    const user=currentUser();
    if (!user) throw new Error('No hay usuario autenticado para asociar la venta pendiente.');
    const v=global.normalizarVenta ? global.normalizarVenta(venta||{}) : {...(venta||{})};
    v.ownerUid=user.uid; v.ownerEmail=user.email||'';
    const pending={venta:v, ajustesInventario:ajustesInventario||{}, ownerUid:user.uid, ownerEmail:user.email||'', guardadaEn:new Date().toISOString()};
    const raw=readRawSalesQueue();
    const key=v._localId||v._docId;
    const idx=raw.findIndex(x=>((x?.venta?._localId||x?.venta?._docId||x?._localId||x?._docId)===key));
    if(idx>=0) raw[idx]=pending; else raw.push(pending);
    writeRawSalesQueue(raw.slice(-500));
    return pending;
  };

  global.quitarVentaPendienteSync = function (localId='') {
    const key=String(localId||'');
    if(!key) return;
    const raw=readRawSalesQueue().filter(x => (x?.venta?._localId||x?.venta?._docId||x?._localId||x?._docId) !== key);
    writeRawSalesQueue(raw);
  };

  global.guardarControlCajaDia = async function (diaClave, payload={}) {
    if (!online()) throw new Error('Caja requiere conexión en C2.13.1 para evitar que un estado local antiguo sobrescriba Firebase.');
    const {db}=services();
    const ref=db.collection('controlCaja').doc(diaClave);
    let merged=null;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const data=snap.exists?(snap.data()||{}):{};
      merged={...data,...payload,diaClave};
      tx.set(ref,payload,{merge:true});
    });
    global.guardarControlCajaEnCache?.(merged||{...payload,diaClave});
    return merged||{...payload,diaClave};
  };
  try { guardarControlCajaDia=global.guardarControlCajaDia; } catch(_) {}

  const legacyMigrate=global.migrarVentasLocalesAFirebase;
  global.migrarVentasLocalesAFirebase=async function(ventasLocales=[]){
    if(!Array.isArray(ventasLocales)||!ventasLocales.length)return;
    for(const venta0 of ventasLocales){
      const venta=global.normalizarVenta?global.normalizarVenta(venta0):{...venta0};
      venta._localId=venta._localId||venta._docId||`venta_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
      venta._syncEstado='pendiente';
      global.guardarVentaPendienteSync?.(venta,{});
    }
    global.sincronizarVentasPendientesEnSegundoPlano?.();
  };
  try { migrarVentasLocalesAFirebase=global.migrarVentasLocalesAFirebase; } catch(_) {}

  async function transactionalOpening() {
    if (!global.verificarAcceso?.(['admin','cajero'])) return;
    if (!(await requireLease('registrar la apertura de caja'))) return;
    const input=document.getElementById('aperturaCajaMonto');
    const raw=String(input?.value??'').trim();
    if(raw==='') return alert('Ingresa el monto con el que inicia la caja. Si inicia en cero, escribe 0.');
    const monto=Number(raw); if(!Number.isFinite(monto)||monto<0) return alert('Ingresa un monto válido para la apertura.');
    const dia=global.obtenerDiaOperativoCaja?.(new Date()) || global.obtenerFechaLocalISO?.(new Date());
    const {db,auth}=services(); const user=auth.currentUser; const ref=db.collection('controlCaja').doc(dia);
    let adminConfirmed=false;
    if(isAdmin()){
      try{
        const pre=await ref.get();
        if(pre.exists&&pre.data()?.aperturaHora){
          const d=pre.data()||{};
          adminConfirmed=confirm(`Ya existe una apertura para ${dia} por $${Number(d.aperturaMonto||0).toLocaleString('es-CO')}.\n\n¿Deseas ACTUALIZARLA como administrador?`);
          if(!adminConfirmed){global.guardarControlCajaEnCache?.({diaClave:dia,...d});return alert('Se conserva la apertura existente.');}
        }
      }catch(e){console.warn('[C2.13.1] No se pudo prevalidar apertura',e)}
    }
    let outcome='created', finalData=null;
    try {
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref); const data=snap.exists?(snap.data()||{}):{};
        if(data.aperturaHora && !isAdmin()){ outcome='existing'; finalData={diaClave:dia,...data}; return; }
        if(data.aperturaHora && isAdmin() && !adminConfirmed){ outcome='existing'; finalData={diaClave:dia,...data}; return; }
        if(data.aperturaHora && isAdmin()) outcome='updated';
        const patch={
          aperturaMonto:monto,
          aperturaHora:new Date().toISOString(),
          aperturaUsuario:global.usuarioActual||user.email||'',
          aperturaUsuarioUid:user.uid,
          aperturaRol:role(),
          turnoCorte:'00:30', diaOperativo:dia, diaClave:dia,
          aperturaActualizadaEn:global.firebase.firestore.FieldValue.serverTimestamp(),
          aperturaActualizadaPorUid:user.uid
        };
        tx.set(ref,patch,{merge:true}); finalData={...data,...patch,diaClave:dia};
      });
      if(finalData) global.guardarControlCajaEnCache?.(finalData);
      global.LP_APERTURA_CAJA_OBLIGATORIA=false;
      document.getElementById('modalAperturaCaja')?.removeAttribute('data-obligatorio');
      if(outcome==='existing') alert('La caja ya tenía una apertura registrada. Se conserva la apertura existente; el cajero no puede reemplazarla.');
      else alert(outcome==='updated' ? 'Apertura actualizada por administrador.' : 'Apertura de caja registrada.');
      global.cerrarModalCaja?.('modalAperturaCaja');
      await global.renderControlCajaDiaActual?.(true);
      global.renderTablaCierresCaja?.(true);
      try { global.LP_CORE?.audit?.('caja_apertura_concurrencia',{diaClave:dia,resultado:outcome,monto}); } catch(_) {}
    } catch(error){ console.error('[C2.13.1] Apertura:',error); alert(error.message||'No se pudo registrar la apertura.'); }
  }

  async function transactionalClosing() {
    const editing=Boolean(global.cierreCajaEdicionDiaClave);
    if(editing && !isAdmin()) return;
    if(!editing && !global.verificarAcceso?.(['admin','cajero'])) return;
    if(!(await requireLease('registrar el cierre de caja'))) return;
    const dia=global.obtenerDiaObjetivoCierreCaja?.() || global.obtenerDiaOperativoCaja?.(new Date());
    const monto=Number(document.getElementById('cierreCajaMonto')?.value||0);
    const obs=String(document.getElementById('cierreCajaObservaciones')?.value||'').trim().slice(0,500);
    if(!Number.isFinite(monto)||monto<0) return alert('Ingresa un monto válido para el cierre.');
    const {db,auth}=services(); const user=auth.currentUser; const ref=db.collection('controlCaja').doc(dia);
    let adminConfirmed=false;
    if(isAdmin()){
      try{
        const pre=await ref.get(); const d=pre.exists?(pre.data()||{}):{};
        if(d.cierreHora){
          adminConfirmed=confirm(`Ya existe un cierre para ${dia} por $${Number(d.cierreMonto||0).toLocaleString('es-CO')}.\n\n¿Deseas ACTUALIZARLO como administrador?`);
          if(!adminConfirmed){global.guardarControlCajaEnCache?.({diaClave:dia,...d});return alert('Se conserva el cierre existente.');}
        }
      }catch(e){console.warn('[C2.13.1] No se pudo prevalidar cierre',e)}
    }
    let outcome='created', finalData=null;
    try{
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref); if(!snap.exists) throw new Error('Primero registra la apertura de caja.');
        const data=snap.data()||{}; if(!data.aperturaHora) throw new Error('Primero registra la apertura de caja.');
        if(data.cierreHora && !isAdmin()){ outcome='existing'; finalData={diaClave:dia,...data}; return; }
        if(data.cierreHora && isAdmin() && !adminConfirmed){ outcome='existing'; finalData={diaClave:dia,...data}; return; }
        if(data.cierreHora && isAdmin()) outcome='updated';
        const patch={cierreMonto:monto,cierreHora:new Date().toISOString(),cierreUsuario:global.usuarioActual||user.email||'',cierreUsuarioUid:user.uid,cierreObservaciones:obs,cierreActualizadaEn:global.firebase.firestore.FieldValue.serverTimestamp(),cierreActualizadaPorUid:user.uid};
        tx.set(ref,patch,{merge:true}); finalData={...data,...patch,diaClave:dia};
      });
      if(finalData) global.guardarControlCajaEnCache?.(finalData);
      if(outcome==='existing') alert('La caja ya tenía un cierre registrado. Se conserva el cierre existente; el cajero no puede reemplazarlo.');
      else alert(outcome==='updated'?'Cierre actualizado por administrador.':'Cierre de caja registrado.');
      global.cerrarModalCaja?.('modalCierreCaja'); await global.renderControlCajaDiaActual?.(true); global.renderTablaCierresCaja?.(true);
      try { global.LP_CORE?.audit?.('caja_cierre_concurrencia',{diaClave:dia,resultado:outcome,monto}); } catch(_) {}
    }catch(error){console.error('[C2.13.1] Cierre:',error);alert(error.message||'No se pudo registrar el cierre.');}
  }

  async function requireOpenShift(action='guardar la venta') {
    if (!online()) return false;
    const {db}=services();
    const dia=global.obtenerDiaOperativoCaja?.(new Date()) || global.obtenerFechaLocalISO?.(new Date());
    try {
      const snap=await db.collection('controlCaja').doc(dia).get();
      const data=snap.exists?(snap.data()||{}):{};
      if(snap.exists) global.guardarControlCajaEnCache?.({diaClave:dia,...data});
      if(!data.aperturaHora){
        alert(`No se puede ${action}: la caja del día operativo ${dia} no tiene apertura.`);
        global.verificarAperturaCajaObligatoria?.();
        return false;
      }
      if(data.cierreHora){
        alert(`No se puede ${action}: la caja del día operativo ${dia} ya fue cerrada. Solo el administrador puede corregir el cierre antes de continuar vendiendo.`);
        return false;
      }
      return true;
    }catch(error){
      console.error('[C2.13.1] No se pudo validar el turno antes de operar:',error);
      alert('No se pudo validar el estado de caja con Firebase. Por seguridad no se realizará la operación.');
      return false;
    }
  }

  function wrapSale(name, action) {
    const original=global[name]; if(typeof original!=='function'||original.__lpConcurrencyWrap)return;
    const wrapped=async function(){
      if(!(await requireLease(action))) return;
      if(!(await requireOpenShift(action))) return;
      return original.apply(this,arguments);
    };
    wrapped.__lpConcurrencyWrap=true; wrapped.__lpConcurrencyOriginal=original; global[name]=wrapped;
    try { if(name==='guardarVenta') guardarVenta=wrapped; } catch(_){}
  }

  function wrapCritical(name, action) {
    const original=global[name]; if(typeof original!=='function'||original.__lpConcurrencyWrap)return;
    const wrapped=async function(){ if(!(await requireLease(action))) return; return original.apply(this,arguments); };
    wrapped.__lpConcurrencyWrap=true; wrapped.__lpConcurrencyOriginal=original; global[name]=wrapped;
    try { if(name==='guardarVenta') guardarVenta=wrapped; } catch(_){}
  }

  function install() {
    moveLegacyCajaQueueAside();
    global.registrarAperturaCaja=transactionalOpening; try{registrarAperturaCaja=transactionalOpening}catch(_){}
    global.registrarCierreCaja=transactionalClosing; try{registrarCierreCaja=transactionalClosing}catch(_){}
    wrapSale('guardarVenta','guardar la venta');
    wrapSale('cargarPedidoCatalogoEnPOS','reservar el pedido');

    const oldSync=global.sincronizarVentasPendientesEnSegundoPlano;
    if(typeof oldSync==='function'&&!oldSync.__lpConcurrencySync){
      const syncWrapped=async function(){ if(!(await requireLease('sincronizar ventas pendientes'))) return; return oldSync.apply(this,arguments); };
      syncWrapped.__lpConcurrencySync=true; global.sincronizarVentasPendientesEnSegundoPlano=syncWrapped;
      try { sincronizarVentasPendientesEnSegundoPlano=syncWrapped; } catch(_) {}
    }

    const oldLogout=global.cerrarSesionRol;
    if(typeof oldLogout==='function'&&!oldLogout.__lpConcurrencyLogout){
      const w=async function(){await release();return oldLogout.apply(this,arguments)};w.__lpConcurrencyLogout=true;global.cerrarSesionRol=w;try{cerrarSesionRol=w}catch(_){}
    }
    const oldLogin=global.iniciarSesion;
    if(typeof oldLogin==='function'&&!oldLogin.__lpConcurrencyLogin){
      const w=async function(){const r=await oldLogin.apply(this,arguments);setTimeout(()=>acquire({silent:true}),500);return r};w.__lpConcurrencyLogin=true;global.iniciarSesion=w;try{iniciarSesion=w}catch(_){}
    }

    const {auth}=services();
    if(auth?.onAuthStateChanged){
      auth.onAuthStateChanged(user=>{
        if(!user){release();return;}
        setTimeout(()=>{ if(isOperationsRole()) acquire({silent:true}); },700);
      });
    }
    if(services().auth?.currentUser) setTimeout(()=>acquire({silent:true}),800);
  }

  moveLegacyCajaQueueAside();
  global.LP_CONCURRENCY={VERSION,acquire,renew,release,requireLease,joinActiveSession,isActive:()=>active,isShared:()=>sharedMode,reason:()=>blockedReason,sessionId:getSessionId,pageId};
  global.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && String(event.key || '').toLowerCase() === 'm') {
      event.preventDefault();
      event.stopPropagation();
      joinActiveSession();
    }
  }, true);
  global.addEventListener('beforeunload',()=>{clearLocalLock(currentUid);});
  global.addEventListener('online',()=>{setTimeout(()=>acquire({silent:true}),300);});
  global.addEventListener('offline',()=>{if(isOperationsRole())setBlocked('Se perdió Internet. Las operaciones quedan bloqueadas hasta revalidar la sesión.');});

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})(window);
