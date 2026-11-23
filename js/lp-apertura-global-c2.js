/* La Parepa C2.13.4 - apertura global de caja por día operativo */
(function (global) {
  'use strict';

  if (global.__lpAperturaGlobalC2134Instalada) return;
  global.__lpAperturaGlobalC2134Instalada = true;

  const VERSION = 'C2.13.4';
  const DISMISS_PREFIX = 'lpAperturaModalCerrado:';
  const STATE = {
    unsubscribe: null,
    day: '',
    timer: null,
    checking: false
  };

  function role() {
    let value = '';
    try {
      value = global.rolActual || localStorage.getItem('rolActual') || '';
    } catch (_) {
      value = global.rolActual || '';
    }
    value = String(value || '').trim().toLowerCase();
    if (value === 'administrador') return 'admin';
    if (value === 'contador' || value === 'contable') return 'contabilidad';
    return value;
  }

  function canOperateCash() {
    const r = role();
    return r === 'admin' || r === 'cajero';
  }

  function authUser() {
    try {
      return global.LP_CORE?.services?.().auth?.currentUser || global.firebase?.auth?.().currentUser || null;
    } catch (_) {
      return null;
    }
  }

  function db() {
    try {
      return global.LP_CORE?.services?.().db || global.firestoreDb || global.firebase?.firestore?.() || null;
    } catch (_) {
      return null;
    }
  }

  function operationalDay() {
    try {
      const value = global.obtenerDiaOperativoCaja?.(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
    } catch (_) {}
    try {
      const value = global.obtenerFechaLocalISO?.(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
    } catch (_) {}
    return new Date().toISOString().slice(0, 10);
  }

  function dismissKey(day = operationalDay()) {
    return `${DISMISS_PREFIX}${day}`;
  }

  function dismissed(day = operationalDay()) {
    try { return sessionStorage.getItem(dismissKey(day)) === '1'; }
    catch (_) { return false; }
  }

  function setDismissed(day = operationalDay(), value = true) {
    try {
      if (value) sessionStorage.setItem(dismissKey(day), '1');
      else sessionStorage.removeItem(dismissKey(day));
    } catch (_) {}
  }

  function modal() {
    return document.getElementById('modalAperturaCaja');
  }

  function forceHideModal() {
    const el = modal();
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('data-obligatorio');
    el.removeAttribute('data-turno-nuevo');
    global.LP_APERTURA_CAJA_OBLIGATORIA = false;
  }

  function forceShowModal() {
    const el = modal();
    if (!el) return;
    el.setAttribute('data-obligatorio', 'true');
    el.setAttribute('data-turno-nuevo', 'true');
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    global.LP_APERTURA_CAJA_OBLIGATORIA = true;

    const title = el.querySelector('h3');
    const info = document.getElementById('aperturaCajaInfoModal');
    const turno = document.getElementById('aperturaCajaTurnoTexto');
    const input = document.getElementById('aperturaCajaMonto');
    const day = operationalDay();

    if (title) title.textContent = 'Apertura de caja';
    if (info) info.textContent = `Aún no existe apertura para el día operativo ${day}. Puedes cerrarlo con la X y continuar navegando.`;
    if (turno) turno.textContent = `Cuando cualquier admin o cajero registre la apertura de ${day}, se utilizará para todos los usuarios.`;
    setTimeout(() => input?.focus(), 80);
  }

  function cacheControl(day, data) {
    try {
      global.guardarControlCajaEnCache?.({ diaClave: day, ...(data || {}) });
    } catch (_) {}
  }

  function openingExists(data) {
    return Boolean(data && data.aperturaHora);
  }

  function applyExistingOpening(day, data) {
    cacheControl(day, data);
    setDismissed(day, false);
    forceHideModal();
    global.dispatchEvent(new CustomEvent('lp:apertura-caja-global', {
      detail: {
        version: VERSION,
        diaClave: day,
        abierta: true,
        aperturaMonto: Number(data?.aperturaMonto || 0),
        aperturaUsuario: String(data?.aperturaUsuario || '')
      }
    }));
  }

  async function readOpeningFromServer(day = operationalDay()) {
    const database = db();
    if (!database) return { exists: false, data: null, unavailable: true };

    try {
      const ref = database.collection('controlCaja').doc(day);
      let snap;
      try {
        snap = await ref.get({ source: 'server' });
      } catch (_) {
        snap = await ref.get();
      }
      const data = snap?.exists ? (snap.data() || {}) : {};
      if (snap?.exists) cacheControl(day, data);
      return { exists: openingExists(data), data, unavailable: false };
    } catch (error) {
      console.warn('[C2.13.4] No se pudo consultar la apertura global:', error);
      // Fallback únicamente para no volver a pedir algo que ya está confirmado en caché.
      try {
        const local = global.obtenerControlCajaLocal?.(day) || {};
        if (openingExists(local)) return { exists: true, data: local, unavailable: true };
      } catch (_) {}
      return { exists: false, data: null, unavailable: true, error };
    }
  }

  function stopRealtimeOpening() {
    try { STATE.unsubscribe?.(); } catch (_) {}
    STATE.unsubscribe = null;
    STATE.day = '';
  }

  function ensureRealtimeOpening(day = operationalDay()) {
    if (!canOperateCash() || !authUser()) {
      stopRealtimeOpening();
      return;
    }
    if (STATE.unsubscribe && STATE.day === day) return;

    stopRealtimeOpening();
    const database = db();
    if (!database) return;

    STATE.day = day;
    try {
      STATE.unsubscribe = database.collection('controlCaja').doc(day).onSnapshot(
        { includeMetadataChanges: true },
        snap => {
          const data = snap?.exists ? (snap.data() || {}) : {};
          if (snap?.exists) cacheControl(day, data);

          if (openingExists(data)) {
            applyExistingOpening(day, data);
          }
          // Si todavía no hay apertura no reabrimos automáticamente aquí:
          // la apertura automática la decide verificarAperturaCajaGlobal(),
          // respetando si el usuario cerró el modal con la X.
        },
        error => console.warn('[C2.13.4] Listener apertura global:', error)
      );
    } catch (error) {
      console.warn('[C2.13.4] No se pudo instalar listener de apertura:', error);
    }
  }

  async function verifyGlobalOpening(options = {}) {
    const {
      showWhenMissing = true,
      ignoreDismissed = false
    } = (typeof options === 'object' && options) ? options : {};

    if (!canOperateCash() || !authUser()) return true;
    if (STATE.checking) return false;

    const day = operationalDay();
    STATE.checking = true;
    try {
      const result = await readOpeningFromServer(day);
      ensureRealtimeOpening(day);

      if (result.exists) {
        applyExistingOpening(day, result.data);
        return true;
      }

      global.LP_APERTURA_CAJA_OBLIGATORIA = true;

      // La X permite continuar navegando sin que los temporizadores vuelvan a abrir el modal.
      if (showWhenMissing && (ignoreDismissed || !dismissed(day))) {
        forceShowModal();
      }
      return false;
    } finally {
      STATE.checking = false;
    }
  }

  // X exclusiva: cierra el modal aunque las capas antiguas lo hayan marcado obligatorio.
  global.lpCerrarAperturaYContinuar = function () {
    const day = operationalDay();
    setDismissed(day, true);
    global.LP_APERTURA_CAJA_OBLIGATORIA = false;
    forceHideModal();

    try {
      global.LP_CORE?.audit?.('apertura_modal_cerrado_sin_apertura', {
        diaClave: day,
        usuarioUid: authUser()?.uid || ''
      });
    } catch (_) {}

    return true;
  };

  // Punto único que utilizan los wrappers antiguos.
  global.lpVerificarAperturaCajaGlobal = verifyGlobalOpening;
  global.verificarAperturaCajaObligatoria = function () {
    return verifyGlobalOpening({ showWhenMissing: true, ignoreDismissed: false });
  };
  global.lpVerificarAperturaCajaNuevoTurno = global.verificarAperturaCajaObligatoria;

  // Cuando se registra una apertura, la función transaccional de C2.13.x sigue siendo
  // la autoridad. Este wrapper solo vuelve a leer el documento oficial al terminar.
  const openingSave = global.registrarAperturaCaja;
  if (typeof openingSave === 'function' && !openingSave.__lpGlobalOpeningRefresh) {
    const wrapped = async function () {
      const result = await openingSave.apply(this, arguments);
      await verifyGlobalOpening({ showWhenMissing: false, ignoreDismissed: true });
      return result;
    };
    wrapped.__lpGlobalOpeningRefresh = true;
    wrapped.__lpOriginal = openingSave;
    global.registrarAperturaCaja = wrapped;
    try { registrarAperturaCaja = wrapped; } catch (_) {}
  }

  function installCloseButton() {
    const el = modal();
    if (!el) return;
    const close = el.querySelector('.lp-modal-header button[data-lp-apertura-cerrar="true"]');
    if (close) {
      close.setAttribute('data-lp-apertura-x', 'true');
      close.setAttribute('aria-label', 'Cerrar apertura de caja y continuar');
      close.setAttribute('title', 'Cerrar y continuar');
      close.setAttribute('onclick', 'lpCerrarAperturaYContinuar()');
    }
  }

  function installSessionWatch() {
    try {
      const auth = global.LP_CORE?.services?.().auth || global.firebase?.auth?.();
      auth?.onAuthStateChanged?.(user => {
        if (!user) {
          stopRealtimeOpening();
          forceHideModal();
          return;
        }
        if (!canOperateCash()) return;
        setTimeout(() => verifyGlobalOpening({ showWhenMissing: true }), 250);
      });
    } catch (error) {
      console.warn('[C2.13.4] No se pudo instalar vigilancia de sesión:', error);
    }

    // Si cambia el día operativo, cambia también el documento que se vigila.
    STATE.timer = setInterval(() => {
      if (!authUser() || !canOperateCash()) return;
      const day = operationalDay();
      if (STATE.day && STATE.day !== day) {
        stopRealtimeOpening();
        verifyGlobalOpening({ showWhenMissing: true }).catch(() => {});
      }
    }, 60000);
  }

  function install() {
    installCloseButton();
    installSessionWatch();

    if (authUser() && canOperateCash()) {
      setTimeout(() => verifyGlobalOpening({ showWhenMissing: true }), 100);
    }

    global.addEventListener('beforeunload', stopRealtimeOpening, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);
