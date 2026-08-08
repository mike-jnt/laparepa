/* La Parepa C2.11 - núcleo compartido, caché de consultas y perfiles Authentication */
(function (global) {
  'use strict';

  const VERSION = 'C2.11-LOCAL-JSON-RECOVERY';
  const PROJECT_ID = 'laparepa';
  const CONFIG = Object.freeze({
    apiKey: 'AIzaSyDRnuHOt_hH7BWvoEmbDhsarehUE_ItzWg',
    authDomain: 'laparepa.firebaseapp.com',
    projectId: PROJECT_ID,
    storageBucket: 'laparepa.firebasestorage.app',
    messagingSenderId: '1039882805860',
    appId: '1:1039882805860:web:af8a054d0aa32ae014f571',
    measurementId: 'G-TSN6MY1H8K'
  });

  const PERMISSIONS = Object.freeze({
    admin: new Set(['pos','ventas','caja','historicos','domicilios','inventario','finanzas','nomina','usuarios','catalogo','reportes','auditoria']),
    administrador: new Set(['pos','ventas','caja','historicos','domicilios','inventario','finanzas','nomina','usuarios','catalogo','reportes','auditoria']),
    cajero: new Set(['pos','ventas','caja','inventario']),
    contabilidad: new Set(['historicos','finanzas','nomina','reportes']),
    contador: new Set(['historicos','finanzas','nomina','reportes'])
  });


  const BOOTSTRAP_USERS = Object.freeze({
    'admin@local.io': Object.freeze({ usuario: 'admin', nombre: 'Administrador', rol: 'admin' }),
    'cajero@local.io': Object.freeze({ usuario: 'cajero', nombre: 'Cajero Principal', rol: 'cajero' }),
    'alfredo@local.io': Object.freeze({ usuario: 'alfredo', nombre: 'Alfredo', rol: 'cajero' }),
    'cajero1@local.io': Object.freeze({ usuario: 'cajero1', nombre: 'Cajero 1', rol: 'cajero' })
  });

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function bootstrapProfileFor(user) {
    const email = normalizeEmail(user?.email);
    const base = BOOTSTRAP_USERS[email];
    if (!user?.uid || !base) return null;
    return {
      uid: user.uid,
      email,
      usuario: base.usuario,
      nombre: base.nombre,
      rol: base.rol,
      activo: true,
      autoCreado: true,
      origen: 'bootstrap_authentication',
      versionSistema: VERSION,
      creadoEn: global.firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoEn: global.firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  async function ensureProfile(user, db) {
    if (!user?.uid || !db) return null;
    const ref = db.collection('usuariosSistema').doc(user.uid);
    const first = await ref.get();
    if (first.exists) return first;

    const payload = bootstrapProfileFor(user);
    if (!payload) return null;

    try {
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) transaction.set(ref, payload);
      });
    } catch (error) {
      // Si otro inicio de sesión creó el documento al mismo tiempo, se relee.
      const retry = await ref.get().catch(() => null);
      if (!retry?.exists) throw error;
      return retry;
    }
    return ref.get();
  }

  const STORAGE_PREFIX = 'lp_c2_';
  const CRITICAL_PENDING_KEYS = new Set([
    'ventasPendientesSync', 'lpVentasPendientesSync', 'lpControlCajaPendienteV1',
    'lpInventarioPendientesC2', 'lpFinanzasPendientesC2'
  ]);

  function normalizeRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (role === 'contable') return 'contabilidad';
    return role;
  }

  function text(value, max = 500) {
    const raw = String(value ?? '');
    const div = document.createElement('div');
    div.innerHTML = raw;
    return String(div.textContent || div.innerText || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    return number(value).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }

  function dateKeyCO(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(safe);
  }

  function dateTimeCO(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(safe);
  }

  function safeParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function storageKey(key) {
    return String(key || '').startsWith(STORAGE_PREFIX) ? String(key) : STORAGE_PREFIX + String(key || '');
  }

  function readStorage(key, fallback = null, options = {}) {
    const realKey = options.raw ? String(key) : storageKey(key);
    try {
      const raw = localStorage.getItem(realKey);
      return raw == null ? fallback : safeParse(raw, fallback);
    } catch (error) {
      console.warn('[La Parepa] No se pudo leer localStorage:', realKey, error);
      return fallback;
    }
  }

  function cleanupStorage() {
    try {
      const candidates = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || CRITICAL_PENDING_KEYS.has(key)) continue;
        if (/cache|respaldo|ultimaVenta|hist[oó]rico/i.test(key)) {
          const value = localStorage.getItem(key) || '';
          candidates.push({ key, size: value.length });
        }
      }
      candidates.sort((a, b) => b.size - a.size).slice(0, 8).forEach(item => localStorage.removeItem(item.key));
    } catch (error) {
      console.warn('[La Parepa] No se pudo limpiar caché antigua:', error);
    }
  }

  function writeStorage(key, value, options = {}) {
    const realKey = options.raw ? String(key) : storageKey(key);
    const maxItems = Number(options.maxItems || 0);
    let data = value;
    if (maxItems > 0 && Array.isArray(data)) data = data.slice(0, maxItems);
    try {
      localStorage.setItem(realKey, JSON.stringify(data));
      return true;
    } catch (error) {
      if (error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message || ''))) {
        cleanupStorage();
        try {
          if (Array.isArray(data)) data = data.slice(0, Math.min(maxItems || 100, 100));
          localStorage.setItem(realKey, JSON.stringify(data));
          return true;
        } catch (retryError) {
          console.error('[La Parepa] Caché llena; no fue posible persistir:', realKey, retryError);
          return false;
        }
      }
      console.error('[La Parepa] No se pudo guardar localStorage:', realKey, error);
      return false;
    }
  }

  function removeStorage(key, options = {}) {
    try { localStorage.removeItem(options.raw ? String(key) : storageKey(key)); } catch (_) {}
  }


  // Caché de consultas en memoria: evita repetir lecturas idénticas y comparte solicitudes simultáneas.
  const QUERY_CACHE = new Map();
  const QUERY_INFLIGHT = new Map();
  const QUERY_STATS = { hits: 0, misses: 0, shared: 0, invalidations: 0 };

  async function cachedQuery(key, loader, options = {}) {
    const cacheKey = String(key || '');
    const ttlMs = Math.max(0, Number(options.ttlMs ?? 45000));
    const force = options.force === true;
    const now = Date.now();
    if (!force) {
      const cached = QUERY_CACHE.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        QUERY_STATS.hits += 1;
        return cached.value;
      }
      if (QUERY_INFLIGHT.has(cacheKey)) {
        QUERY_STATS.shared += 1;
        return QUERY_INFLIGHT.get(cacheKey);
      }
    }
    QUERY_STATS.misses += 1;
    const promise = Promise.resolve().then(loader).then(value => {
      QUERY_CACHE.set(cacheKey, { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() });
      return value;
    }).finally(() => QUERY_INFLIGHT.delete(cacheKey));
    QUERY_INFLIGHT.set(cacheKey, promise);
    return promise;
  }

  function invalidateQueryCache(prefix = '') {
    const normalized = String(prefix || '');
    let removed = 0;
    for (const key of [...QUERY_CACHE.keys()]) {
      if (!normalized || key.startsWith(normalized)) { QUERY_CACHE.delete(key); removed += 1; }
    }
    QUERY_STATS.invalidations += removed;
    return removed;
  }

  function queryCacheStats() {
    return { ...QUERY_STATS, entries: QUERY_CACHE.size, inflight: QUERY_INFLIGHT.size };
  }

  function classifyError(error) {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    if (code.includes('permission-denied') || message.includes('insufficient permissions')) return 'PERMISOS';
    if (code.includes('failed-precondition') && message.includes('index')) return 'INDICE';
    if (message.includes('requires an index')) return 'INDICE';
    if (code.includes('unavailable') || message.includes('network') || message.includes('offline')) return 'CONEXION';
    if (message.includes('quota') || error?.name === 'QuotaExceededError') return 'CACHE';
    if (message.includes('is not defined') || error instanceof ReferenceError) return 'FUNCION';
    if (message.includes('chrome-extension://') || message.includes('contentint.js') || message.includes('contentyt.js') || message.includes('removechild')) return 'EXTENSION';
    return 'SISTEMA';
  }

  function validateConfig(config) {
    const keys = ['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
    for (const key of keys) {
      if (String(config?.[key] || '') !== String(CONFIG[key])) {
        throw new Error(`Configuración Firebase no autorizada en ${key}.`);
      }
    }
    return true;
  }

  let firebaseLogShown = false;
  let cachedServices = null;

  function ensureFirebase() {
    if (!global.firebase?.initializeApp) throw new Error('SDK de Firebase no disponible.');
    const apps = Array.isArray(global.firebase.apps) ? global.firebase.apps : [];
    for (const app of apps) validateConfig(app.options || {});
    const app = apps.length ? global.firebase.app() : global.firebase.initializeApp(CONFIG);
    validateConfig(app.options || {});
    if (!firebaseLogShown) {
      firebaseLogShown = true;
      console.info(`[La Parepa ${VERSION}] Firebase activo y autorizado:`, app.options.projectId);
    }
    return app;
  }

  function services() {
    if (cachedServices) return cachedServices;
    const app = ensureFirebase();
    const auth = global.firebase.auth(app);
    const db = global.firebase.firestore(app);
    cachedServices = Object.freeze({ app, auth, db });
    return cachedServices;
  }

  function waitForUser(auth, timeoutMs = 5000) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise(resolve => {
      let done = false;
      let unsub = () => {};
      const finish = user => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { unsub(); } catch (_) {}
        resolve(user || null);
      };
      const timer = setTimeout(() => finish(auth.currentUser || null), timeoutMs);
      unsub = auth.onAuthStateChanged(finish);
    });
  }

  async function getProfile(user, db) {
    if (!user) return null;
    const ref = db.collection('usuariosSistema').doc(user.uid);
    const doc = await ensureProfile(user, db) || await ref.get();
    if (!doc?.exists) return null;
    const data = doc.data() || {};
    const role = normalizeRole(data.rol);
    if (!PERMISSIONS[role] || data.activo === false) return null;
    return {
      uid: user.uid,
      email: String(data.email || user.email || '').trim().toLowerCase(),
      nombre: text(data.nombre || data.usuario || user.displayName || user.email || 'Usuario', 120),
      rol: role,
      activo: data.activo !== false,
      ...data
    };
  }

  function can(profile, moduleName) {
    const role = normalizeRole(profile?.rol);
    return Boolean(PERMISSIONS[role]?.has(String(moduleName || '')));
  }

  async function guardPage({ roles = [], module = '', redirect = 'index.html', render = true } = {}) {
    const { auth, db } = services();
    const user = await waitForUser(auth);
    let profile = null;
    try { profile = await getProfile(user, db); } catch (error) {
      if (render) renderBlocked('No fue posible validar tus permisos. Revisa conexión y reglas de Firebase.', redirect);
      throw error;
    }
    const normalizedRoles = roles.map(normalizeRole);
    const allowed = Boolean(profile && (!normalizedRoles.length || normalizedRoles.includes(profile.rol)) && (!module || can(profile, module)));
    if (!allowed) {
      if (render) renderBlocked(user ? 'Tu usuario no tiene permisos para este módulo.' : 'Debes iniciar sesión desde el POS principal.', redirect);
      return null;
    }
    global.LP_PROFILE = profile;
    return { auth, db, user, profile };
  }

  function renderBlocked(message, redirect = 'index.html') {
    document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;background:#fff4df;font-family:Segoe UI,Arial;padding:24px"><section style="max-width:560px;background:#fff;border:1px solid #fecaca;border-radius:24px;padding:30px;box-shadow:0 18px 42px rgba(0,0,0,.13);text-align:center"><h1 style="color:#991b1b;margin:0 0 12px">Acceso restringido</h1><p style="line-height:1.55;color:#3b2318">${escapeHTML(message)}</p><a href="${escapeHTML(redirect)}" style="display:inline-block;margin-top:18px;background:#b91c1c;color:white;text-decoration:none;border-radius:14px;padding:12px 18px;font-weight:800">← Volver al POS</a></section></main>`;
  }

  async function audit(type, detail = {}, context = {}) {
    try {
      const { auth, db } = context.db ? context : services();
      const user = context.user || auth.currentUser;
      if (!user) return false;
      const profile = context.profile || global.LP_PROFILE || null;
      await db.collection('auditoria').add({
        tipo: text(type, 80),
        detalle: detail && typeof detail === 'object' ? detail : { valor: text(detail, 500) },
        uid: user.uid,
        email: String(user.email || profile?.email || '').toLowerCase(),
        rol: normalizeRole(profile?.rol),
        fechaServidor: global.firebase.firestore.FieldValue.serverTimestamp(),
        diaClave: dateKeyCO(),
        versionSistema: VERSION,
        ruta: location.pathname
      });
      return true;
    } catch (error) {
      console.warn('[La Parepa] Auditoría no registrada:', error);
      return false;
    }
  }

  async function diagnose() {
    const result = { version: VERSION, projectExpected: PROJECT_ID, projectActive: null, auth: false, profile: false, firestoreRead: false, error: null };
    try {
      const { app, auth, db } = services();
      result.projectActive = app.options.projectId;
      const user = await waitForUser(auth, 2500);
      result.auth = Boolean(user);
      if (user) {
        result.profile = Boolean(await getProfile(user, db));
        await db.collection('usuariosSistema').doc(user.uid).get();
        result.firestoreRead = true;
      }
    } catch (error) {
      result.error = { type: classifyError(error), code: error?.code || '', message: String(error?.message || error) };
    }
    console.table(result);
    return result;
  }

  function injectVersionBadge() {
    if (document.getElementById('lpVersionC2Badge')) return;
    const badge = document.createElement('div');
    badge.id = 'lpVersionC2Badge';
    badge.textContent = `${VERSION} · Firebase: ${PROJECT_ID}`;
    badge.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999;background:#21110f;color:#fff4df;padding:6px 10px;border-radius:999px;font:700 11px Segoe UI,Arial;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:.92';
    document.body.appendChild(badge);
  }

  const api = Object.freeze({
    VERSION, PROJECT_ID, CONFIG, PERMISSIONS, normalizeRole, text, escapeHTML, number, money,
    dateKeyCO, dateTimeCO, safeParse, readStorage, writeStorage, removeStorage, cleanupStorage,
    cachedQuery, invalidateQueryCache, queryCacheStats, classifyError, validateConfig, ensureFirebase, services, waitForUser, BOOTSTRAP_USERS, normalizeEmail, bootstrapProfileFor, ensureProfile, getProfile, can,
    guardPage, renderBlocked, audit, diagnose, injectVersionBadge
  });

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const allowed = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!allowed) return;
    try {
      const registration = await navigator.serviceWorker.register('sw-c2.js', { updateViaCache: 'none' });
      await registration.update().catch(() => {});
    } catch (error) {
      console.warn('[La Parepa] No se pudo registrar el service worker:', error);
    }
  }

  global.LP_CORE = api;
  global.diagnosticarLaParepaC2 = diagnose;
  document.addEventListener('DOMContentLoaded', () => {
    injectVersionBadge();
    registerServiceWorker();
  }, { once: true });
})(window);
