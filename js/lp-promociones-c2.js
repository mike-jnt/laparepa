/* La Parepa C2.13.15 — integración de promociones al POS. No cambia diaClave. */
(function () {
  'use strict';
  const reglas = window.LP_PromoReglas;
  if (!reglas) return console.error('[La Parepa] Falta js/lp-promociones-reglas-c2.js.');
  const selector = document.getElementById('lpPromoDia');
  const selectorBebida = document.getElementById('lpPromoBebida');
  const selectorArepa = document.getElementById('lpPromoArepa');
  const grupoBebida = document.getElementById('lpPromoGrupoBebida');
  const grupoArepa = document.getElementById('lpPromoGrupoArepa');
  const estado = document.getElementById('lpPromoEstado');
  const resumen = document.getElementById('lpPromoResumen');
  if (!selector || !selectorBebida || !selectorArepa) return console.error('[La Parepa] Falta el panel de promociones.');

  const leerPedido = () => typeof pedido !== 'undefined' && Array.isArray(pedido) ? pedido : [];
  const numero = valor => Number(valor || 0);
  const formato = valor => '$' + numero(valor).toLocaleString('es-CO');
  const esc = texto => String(texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const catalogo = id => { try { return Array.isArray(catalogoProductos?.[id]) ? catalogoProductos[id] : []; } catch (_) { return []; } };
  const nombresArepas = () => catalogo('comida').filter(p => p.activo !== false).map(p => p.nombre);
  let procesando = false;
  let ultimo = reglas.calcular([], {});
  let ultimoDiaEditado = '';

  function refrescarSelectores() {
    const anteriorBebida = selectorBebida.value;
    const bebidas = catalogo('bebidas').filter(reglas.esBebida250);
    selectorBebida.innerHTML = '<option value="">Selecciona la bebida de 250 ml</option>' + bebidas.map(b =>
      `<option value="${esc(b.nombre)}">${esc(b.nombre)} · ${formato(b.precio)}</option>`).join('');
    if (bebidas.some(b => b.nombre === anteriorBebida)) selectorBebida.value = anteriorBebida;
    else if (bebidas.length === 1) selectorBebida.value = bebidas[0].nombre;

    const anteriorArepa = selectorArepa.value;
    const listaArepas = nombresArepas();
    const opciones = catalogo('comida').filter(p => p.activo !== false && reglas.esRegaloMiercoles(p))
      .sort((a, b) => ['mini','choricera','queso'].indexOf(reglas.tipoGratisMiercoles(a)) - ['mini','choricera','queso'].indexOf(reglas.tipoGratisMiercoles(b)));
    selectorArepa.innerHTML = '<option value="">Selecciona una arepa gratis (máx. $16.000)</option>' + opciones.map(p =>
      `<option value="${esc(p.nombre)}">${esc(p.nombre)} · ${formato(p.precio)}</option>`).join('');
    if (opciones.some(p => p.nombre === anteriorArepa)) selectorArepa.value = anteriorArepa;
    if (grupoArepa) grupoArepa.querySelector('label').textContent = 'Arepa gratis obligatoria: Mini Parada, Parada Choricera o Queso sin Frenos (hasta $16.000)';
  }

  function refrescar() {
    if (procesando) return ultimo;
    procesando = true;
    try {
      refrescarSelectores();
      const dia = selector.value;
      grupoBebida.classList.toggle('hidden', dia !== 'martes');
      grupoArepa.classList.toggle('hidden', dia !== 'miercoles');
      const listaArepas = nombresArepas();
      const bebida = catalogo('bebidas').find(p => p.nombre === selectorBebida.value);
      const miniProducto = catalogo('comida').find(p => p.activo !== false && reglas.nombreMini(p));
      const arepaProducto = catalogo('comida').find(p => p.nombre === selectorArepa.value);
      ultimo = reglas.calcular(leerPedido(), { dia, bebida, miniProducto, arepaProducto, arepaGratis: selectorArepa.value, nombresArepas: listaArepas });
      if (typeof pedido !== 'undefined') pedido = ultimo.pedido;
      if (dia && typeof window.resetDescuento20 === 'function') window.resetDescuento20();
      if (typeof window.actualizarTotal === 'function') window.actualizarTotal();
      if (estado) estado.textContent = dia ? `${ultimo.nombre}: ${ultimo.avisos.join(' ') || `${ultimo.unidadesGratis} cortesía(s) registradas correctamente.`}` : 'Sin promoción: cobro normal.';
      if (resumen) resumen.textContent = ultimo.unidadesGratis
        ? `🎁 ${ultimo.unidadesGratis} gratis · Valor de las cortesías: ${formato(ultimo.descuentoPromocionalValor)}`
        : 'Los productos gratis se incorporan al pedido cuando se cumplen las condiciones.';
      document.querySelectorAll('[data-descuento20-btn]').forEach(btn => {
        btn.disabled = Boolean(dia);
        btn.title = dia ? 'El 20 % no se combina con promociones.' : 'Aplicar descuento general';
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

  const renderAnterior = window.actualizarVistaPedido;
  if (typeof renderAnterior === 'function') {
    const renderPromo = function () { refrescar(); return renderAnterior.apply(this, arguments); };
    renderPromo.__lpPromociones = true;
    window.actualizarVistaPedido = renderPromo;
    try { actualizarVistaPedido = renderPromo; } catch (_) {}
  }
  const toggleAnterior = window.toggleDescuento20;
  if (typeof toggleAnterior === 'function') {
    const togglePromo = function () {
      if (selector.value) return alert('Quita la promoción antes de aplicar el 20 %.');
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
      ultimoDiaEditado = selector.value;
      // Se restablecen los selectores al crear la vista de edición.
      const resultado = editarAnterior.apply(this, arguments);
      refrescarSelectores();
      selectorBebida.value = venta?.promocionBebida || '';
      selectorArepa.value = venta?.promocionArepaGratis || '';
      refrescarUI();
      return resultado;
    };
    window.editarVenta = editarPromo;
    try { editarVenta = editarPromo; } catch (_) {}
  }
  const limpiarAnterior = window.limpiarPedido;
  if (typeof limpiarAnterior === 'function') {
    const limpiarPromo = function () {
      const resultado = limpiarAnterior.apply(this, arguments);
      // Cada nueva venta requiere decisión explícita: no heredar el día de una venta anterior.
      selector.value = '';
      selectorBebida.value = '';
      selectorArepa.value = '';
      ultimoDiaEditado = '';
      refrescarUI();
      return resultado;
    };
    window.limpiarPedido = limpiarPromo;
    try { limpiarPedido = limpiarPromo; } catch (_) {}
  }

  window.LP_PROMO = Object.freeze({
    recalcular: refrescar,
    resumenVenta() {
      const info = refrescar();
      return {
        promocionDia: info.dia && info.unidadesGratis ? info.dia : '',
        promocionNombre: info.dia && info.unidadesGratis ? `Promoción ${info.nombre}` : '',
        promocionSeleccionada: info.dia,
        promocionBebida: info.dia === 'martes' ? selectorBebida.value : '',
        promocionArepaGratis: info.dia === 'miercoles' ? selectorArepa.value : '',
        descuentoPromocionalValor: info.descuentoPromocionalValor,
        movimientosPromocionales: info.regalos,
        unidadesPromocionalesGratis: info.unidadesGratis
      };
    },
    validar() {
      const info = refrescar();
      const avisos = info.avisos.filter(texto =>
        texto.includes('Elige una bebida') || texto.includes('Selecciona en la lista') || texto.includes('No hay suficientes'));
      if (avisos.length) {
        alert('No se puede guardar esta promoción:\n' + avisos.join('\n'));
        return false;
      }
      if (info.dia === 'martes' && !catalogo('bebidas').some(b => b.nombre === selectorBebida.value && reglas.esBebida250(b)) && leerPedido().some(p => reglas.esArepaMartes(p, nombresArepas()))) {
        alert('Selecciona una bebida de 250 ml válida.');
        return false;
      }
      return true;
    },
    diagnostico() {
      return { version:'C2.13.15', dia: selector.value, cargado:true,
        productos: leerPedido().length, cortesias: ultimo.unidadesGratis,
        bebidas250Catalogo:catalogo('bebidas').filter(reglas.esBebida250).length,
        arepasGratisCatalogo:catalogo('comida').filter(p=>reglas.esRegaloMiercoles(p)).length };
    },
    cambiarDia(dia) {
      const nuevo = reglas.DIAS[dia] ? dia : '';
      if (selector.value !== nuevo) selectorArepa.value = '';
      selector.value = nuevo;
      refrescarUI();
    },
    get dia() { return selector.value; }
  });
  refrescarUI();
})();
