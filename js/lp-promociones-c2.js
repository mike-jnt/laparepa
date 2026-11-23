/* La Parepa C2.13.12 — Selector POS promociones L/M/X.
   Día promocional NO altera el día contable ni diaClave de caja. */
(function () {
  'use strict';
  const reglas = window.LP_PromoReglas;
  if (!reglas) return console.error('[La Parepa] Faltan las reglas de promociones.');
  const selector = document.getElementById('lpPromoDia');
  const selectorBebida = document.getElementById('lpPromoBebida');
  const selectorArepa = document.getElementById('lpPromoArepa');
  const grupoBebida = document.getElementById('lpPromoGrupoBebida');
  const grupoArepa = document.getElementById('lpPromoGrupoArepa');
  const estado = document.getElementById('lpPromoEstado');
  const resumen = document.getElementById('lpPromoResumen');
  if (!selector || !selectorBebida || !selectorArepa) return;

  const leerPedido = () => (typeof pedido !== 'undefined' && Array.isArray(pedido) ? pedido : []);
  const numero = n => Number(n || 0);
  const format = n => '$' + numero(n).toLocaleString('es-CO');
  let procesando = false;
  let ultimo = reglas.calcular([], {});

  function catalogo(id) {
    try { return Array.isArray(catalogoProductos?.[id]) ? catalogoProductos[id] : []; }
    catch (_) { return []; }
  }
  function refrescarSelectores() {
    const anteriorBebida = selectorBebida.value;
    const bebidas = catalogo('bebidas').filter(reglas.esBebida250);
    selectorBebida.innerHTML = '<option value="">Selecciona la gaseosa de 250 ml</option>' + bebidas.map(b =>
      `<option value="${esc(b.nombre)}">${esc(b.nombre)} · ${format(b.precio)}</option>`).join('');
    if (bebidas.some(b => b.nombre === anteriorBebida)) selectorBebida.value = anteriorBebida;
    else if (bebidas.length === 1) selectorBebida.value = bebidas[0].nombre;

    const anteriorArepa = selectorArepa.value;
    const opciones = [...new Set(reglas.calcular(leerPedido(), {}).pedido.filter(p => reglas.esArepa(p) && Number(p.precio) > 0 && Number(p.precio) <= 16000).map(p => p.nombre))];
    selectorArepa.innerHTML = '<option value="">Automático: menor precio elegible</option>' + opciones.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (opciones.includes(anteriorArepa)) selectorArepa.value = anteriorArepa;
  }
  function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function refrescar() {
    if (procesando) return ultimo;
    procesando = true;
    try {
      refrescarSelectores();
      const dia = selector.value;
      grupoBebida.classList.toggle('hidden', dia !== 'martes');
      grupoArepa.classList.toggle('hidden', dia !== 'miercoles');
      const bebida = catalogo('bebidas').find(p => p.nombre === selectorBebida.value);
      const miniProducto = catalogo('comida').find(p => reglas.normalizar(p.nombre) === 'MINI PARADA');
      ultimo = reglas.calcular(leerPedido(), { dia, bebida, miniProducto, arepaGratis: selectorArepa.value });
      if (typeof pedido !== 'undefined') pedido = ultimo.pedido;
      // El 20% general no puede acumularse a ninguna promoción.
      if (dia && typeof window.resetDescuento20 === 'function') window.resetDescuento20();
      if (typeof window.actualizarTotal === 'function') window.actualizarTotal();
      if (estado) estado.textContent = dia ? `${ultimo.nombre}: ${ultimo.avisos.join(' ') || `${ultimo.unidadesGratis} producto(s) gratis registrado(s).`}` : 'Sin promoción: todos los productos se cobran normalmente.';
      if (resumen) resumen.textContent = ultimo.unidadesGratis ? `🎁 ${ultimo.unidadesGratis} gratis · Valor de regalos: ${format(ultimo.descuentoPromocionalValor)}` : 'Los regalos se incorporan al pedido cuando se cumplen las condiciones.';
      document.querySelectorAll('[data-descuento20-btn]').forEach(btn => {
        btn.disabled = Boolean(dia);
        btn.title = dia ? 'No se puede acumular 20% con una promoción de día.' : 'Aplicar descuento general';
        btn.style.opacity = dia ? '0.45' : '';
      });
      return ultimo;
    } finally { procesando = false; }
  }
  function refrescarUI() {
    refrescar();
    if (typeof window.actualizarVistaPedido === 'function') window.actualizarVistaPedido();
  }
  selector.addEventListener('change', () => { selectorArepa.value = ''; refrescarUI(); });
  selectorBebida.addEventListener('change', refrescarUI);
  selectorArepa.addEventListener('change', refrescarUI);

  // Un único punto de entrada al render: respeta cantidad manual, botones premium y edición.
  const renderAnterior = window.actualizarVistaPedido;
  if (typeof renderAnterior === 'function') {
    const renderPromo = function () { refrescar(); return renderAnterior.apply(this, arguments); };
    window.actualizarVistaPedido = renderPromo;
    try { actualizarVistaPedido = renderPromo; } catch (_) {}
  }
  const toggleAnterior = window.toggleDescuento20;
  if (typeof toggleAnterior === 'function') {
    const togglePromo = function () {
      if (selector.value) return alert('Para aplicar el 20%, selecciona "Sin promoción". No se acumulan descuentos.');
      return toggleAnterior.apply(this, arguments);
    };
    window.toggleDescuento20 = togglePromo;
    try { toggleDescuento20 = togglePromo; } catch (_) {}
  }
  const editarAnterior = window.editarVenta;
  if (typeof editarAnterior === 'function') {
    const editarPromo = function (index) {
      const venta = window.obtenerVentasStorage?.()[index];
      selector.value = reglas.DIAS[venta?.promocionDia] ? venta.promocionDia : '';
      selectorBebida.value = venta?.promocionBebida || '';
      selectorArepa.value = venta?.promocionArepaGratis || '';
      return editarAnterior.apply(this, arguments);
    };
    window.editarVenta = editarPromo;
    try { editarVenta = editarPromo; } catch (_) {}
  }
  // El pedido de catálogo y la edición pueden reemplazar 'pedido' sin disparar un render original.
  window.LP_PROMO = Object.freeze({
    recalcular: refrescar,
    resumenVenta: function () {
      const info = refrescar();
      return {
        promocionDia: info.unidadesGratis ? info.dia : '',
        promocionNombre: info.unidadesGratis && info.nombre ? `Promoción ${info.nombre}` : '',
        promocionSeleccionada: info.dia,
        promocionBebida: info.dia === 'martes' ? selectorBebida.value : '',
        promocionArepaGratis: info.dia === 'miercoles' ? selectorArepa.value : '',
        descuentoPromocionalValor: info.descuentoPromocionalValor,
        movimientosPromocionales: info.regalos,
        unidadesPromocionalesGratis: info.unidadesGratis
      };
    },
    validar: function () {
      const info = refrescar();
      if (info.dia === 'martes' && reglas.calcular(leerPedido(), {}).pedido.some(reglas.esArepaMartes) && !info.unidadesGratis) {
        alert('Selecciona una bebida de 250 ml válida para la promoción del martes.');
        return false;
      }
      if (info.dia === 'miercoles' && info.avisos.some(a => a.includes('deben costar'))) {
        alert(info.avisos.join('\n'));
        return false;
      }
      return true;
    },
    cambiarDia: function (dia) { selector.value = reglas.DIAS[dia] ? dia : ''; refrescarUI(); },
    get dia() { return selector.value; }
  });
  refrescarUI();
})();
