/* La Parepa C2.13.12 — Reglas de promociones, independientes de DOM y Firebase.
 * Cada elemento de pedido equivale a una unidad física. Nunca descuenta inventario aquí.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LP_PromoReglas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIAS = Object.freeze({ lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles' });
  function normalizar(nombre) {
    return String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function numero(valor) { return Number.isFinite(Number(valor)) ? Math.max(0, Number(valor)) : 0; }
  function esArepa(item) { return /\bAREPA\b|\bPAREPA\b/.test(normalizar(item?.nombre)) && !/\bMINI\b/.test(normalizar(item?.nombre)); }
  function esArepaLunes(item) {
    const n = normalizar(item?.nombre);
    return esArepa(item) && !/QUESO|QUESILLO|MINI/.test(n) && numero(item?.precio) > 0;
  }
  function esArepaMartes(item) { return esArepa(item) && numero(item?.precio) >= 16000; }
  function esBebida250(item) { return /\b250\s*M[L]?\b/i.test(normalizar(item?.nombre)) && numero(item?.precio) > 0; }
  function base(pedido) {
    return (Array.isArray(pedido) ? pedido : []).filter(p => !p?.lpPromoGenerado).map(p => {
      const nuevo = { ...p };
      if (nuevo.lpPromoGratis) {
        nuevo.precio = numero(nuevo.lpPromoPrecioOriginal);
        delete nuevo.lpPromoGratis;
        delete nuevo.lpPromoOrigen;
        delete nuevo.lpPromoPrecioOriginal;
      }
      return nuevo;
    });
  }
  function gift(item, dia, generado = false) {
    item.lpPromoPrecioOriginal = numero(item.precio);
    item.precio = 0;
    item.lpPromoGratis = true;
    item.lpPromoOrigen = dia;
    if (generado) item.lpPromoGenerado = true;
  }
  function calcular(pedido, opciones = {}) {
    const dia = DIAS[opciones.dia] ? opciones.dia : '';
    const items = base(pedido);
    const avisos = [];
    let unidades = 0;
    if (dia === 'lunes') {
      const participantes = items.filter(esArepaLunes);
      unidades = Math.floor(participantes.length / 2);
      const mini = opciones.miniProducto || { nombre: 'MINI PARADA', precio: 0 };
      for (let i = 0; i < unidades; i++) {
        const extra = { nombre: String(mini.nombre || 'MINI PARADA'), precio: numero(mini.precio), categoria: 'comida' };
        gift(extra, dia, true);
        items.push(extra);
      }
      if (!unidades) avisos.push('Agrega 2 arepas participantes (no cuentan mini parada ni arepas de queso).');
    }
    if (dia === 'martes') {
      const participantes = items.filter(esArepaMartes);
      unidades = participantes.length;
      if (unidades) {
        const bebida = opciones.bebida;
        if (!bebida || !esBebida250(bebida)) {
          avisos.push('Selecciona la bebida de 250 ml que se entregará gratis.');
          unidades = 0;
        } else {
          let faltantes = unidades;
          // Si el cajero ya agregó esta bebida, convierte la unidad existente en gratis.
          for (const item of items) {
            if (!faltantes) break;
            if (normalizar(item.nombre) !== normalizar(bebida.nombre) || numero(item.precio) <= 0) continue;
            gift(item, dia);
            faltantes--;
          }
          for (let i = 0; i < faltantes; i++) {
            const extra = { nombre: String(bebida.nombre), precio: numero(bebida.precio), categoria: 'bebidas' };
            gift(extra, dia, true);
            items.push(extra);
          }
        }
      } else avisos.push('Aplica por cada arepa de $16.000 o más.');
    }
    if (dia === 'miercoles') {
      const participantes = items.filter(p => esArepa(p) && numero(p.precio) > 0);
      const posibles = participantes.filter(p => numero(p.precio) <= 16000);
      const disponibles = Math.floor(participantes.length / 4);
      unidades = Math.min(disponibles, posibles.length);
      const objetivo = normalizar(opciones.arepaGratis || '');
      const ordenados = posibles.slice().sort((a, b) => {
        const elegidoA = objetivo && normalizar(a.nombre) === objetivo ? 0 : 1;
        const elegidoB = objetivo && normalizar(b.nombre) === objetivo ? 0 : 1;
        return elegidoA - elegidoB || numero(a.precio) - numero(b.precio);
      });
      for (let i = 0; i < unidades; i++) gift(ordenados[i], dia);
      if (!disponibles) avisos.push('Agrega 4 arepas: por cada 3, una gratis (máximo $16.000).');
      else if (disponibles > unidades) avisos.push('La(s) arepa(s) gratis deben costar máximo $16.000.');
    }
    const regalos = items.filter(p => p.lpPromoGratis).map(p => ({
      nombre: p.nombre,
      cantidad: 1,
      precioOriginal: numero(p.lpPromoPrecioOriginal),
      precioCobrado: 0,
      tipo: 'PROMOCION',
      diaPromocion: dia
    }));
    const descuento = regalos.reduce((acc, p) => acc + p.precioOriginal, 0);
    return {
      pedido: items,
      dia,
      nombre: DIAS[dia] || '',
      regalos,
      unidadesGratis: regalos.length,
      descuentoPromocionalValor: descuento,
      totalProductos: items.reduce((acc, p) => acc + numero(p.precio), 0),
      subtotalOriginal: items.reduce((acc, p) => acc + numero(p.lpPromoGratis ? p.lpPromoPrecioOriginal : p.precio), 0),
      avisos
    };
  }
  return { DIAS, calcular, normalizar, esArepa, esArepaLunes, esArepaMartes, esBebida250 };
});
