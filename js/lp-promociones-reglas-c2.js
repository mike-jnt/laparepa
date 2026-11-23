/* La Parepa C2.13.13 — promociones. Una entrada de pedido es una unidad.
   Puro: no escribe inventario, Firestore ni DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LP_PromoReglas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIAS = Object.freeze({ lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles' });
  const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const numero = valor => Number.isFinite(Number(valor)) ? Math.max(0, Number(valor)) : 0;
  const nombreMini = item => /\bMINI\b/.test(normalizar(item?.nombre)) && /PARADA|PAREPA|AREPA/.test(normalizar(item?.nombre));
  function esArepa(item, nombresArepas) {
    const nombre = normalizar(item?.nombre);
    if (!nombre || nombreMini(item)) return false;
    if (/\bAREPA\b|\bPAREPA\b/.test(nombre)) return true;
    return Array.isArray(nombresArepas) && nombresArepas.some(n => normalizar(n) === nombre);
  }
  function esArepaLunes(item, nombresArepas) {
    const nombre = normalizar(item?.nombre);
    return esArepa(item, nombresArepas) && !/QUESO|QUESILLO|\bMINI\b/.test(nombre) && numero(item?.precio) > 0;
  }
  function esArepaMartes(item, nombresArepas) {
    return esArepa(item, nombresArepas) && numero(item?.precio) >= 16000;
  }
  function esBebida250(item) {
    return /\b250\s*M[L]?\b/.test(normalizar(item?.nombre)) && numero(item?.precio) > 0;
  }
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
  function regalo(item, dia, generado = false) {
    item.lpPromoPrecioOriginal = numero(item.precio);
    item.precio = 0;
    item.lpPromoGratis = true;
    item.lpPromoOrigen = dia;
    if (generado) item.lpPromoGenerado = true;
  }
  function calcular(pedido, opciones = {}) {
    const dia = Object.prototype.hasOwnProperty.call(DIAS, opciones.dia) ? opciones.dia : '';
    const items = base(pedido);
    const avisos = [];
    const listaArepas = Array.isArray(opciones.nombresArepas) ? opciones.nombresArepas : [];
    if (dia === 'lunes') {
      const unidades = Math.floor(items.filter(item => esArepaLunes(item, listaArepas)).length / 2);
      const mini = opciones.miniProducto || { nombre: 'MINI PARADA', precio: 0 };
      for (let i = 0; i < unidades; i++) {
        const extra = { nombre: String(mini.nombre || 'MINI PARADA'), precio: numero(mini.precio), categoria: 'comida' };
        regalo(extra, dia, true);
        items.push(extra);
      }
      if (!unidades) avisos.push('Agrega 2 arepas participantes; no cuentan las mini ni las arepas de queso.');
    }
    if (dia === 'martes') {
      const unidades = items.filter(item => esArepaMartes(item, listaArepas)).length;
      if (unidades) {
        const bebida = opciones.bebida;
        if (!bebida || !esBebida250(bebida)) {
          avisos.push('Elige una bebida de 250 ml para poder aplicar la cortesía.');
        } else {
          let faltantes = unidades;
          // Aprovechar primero las unidades ya añadidas por el cajero.
          for (const item of items) {
            if (!faltantes) break;
            if (normalizar(item.nombre) !== normalizar(bebida.nombre) || numero(item.precio) <= 0) continue;
            regalo(item, dia);
            faltantes--;
          }
          for (let i = 0; i < faltantes; i++) {
            const extra = { nombre: String(bebida.nombre), precio: numero(bebida.precio), categoria: 'bebidas' };
            regalo(extra, dia, true);
            items.push(extra);
          }
        }
      } else avisos.push('Aplica por cada arepa con precio de $16.000 o más.');
    }
    if (dia === 'miercoles') {
      const arepas = items.filter(item => esArepa(item, listaArepas) && numero(item.precio) > 0);
      const completas = Math.floor(arepas.length / 4);
      const faltanUna = arepas.length >= 3 && (arepas.length % 4 === 3);
      const elegido = normalizar(opciones.arepaGratis || '');
      const aptas = arepas.filter(item => numero(item.precio) <= 16000);
      const ordenadas = aptas.slice().sort((a, b) => {
        const preferenciaA = elegido && normalizar(a.nombre) === elegido ? 0 : 1;
        const preferenciaB = elegido && normalizar(b.nombre) === elegido ? 0 : 1;
        return preferenciaA - preferenciaB || numero(a.precio) - numero(b.precio);
      });
      let convertidas = 0;
      for (const item of ordenadas.slice(0, completas)) {
        regalo(item, dia);
        convertidas++;
      }
      if (completas > convertidas) avisos.push('No hay suficientes arepas elegibles en el pedido para regalar (máximo $16.000 cada una).');
      if (faltanUna) {
        const producto = opciones.arepaProducto;
        if (producto && esArepa(producto, listaArepas) && numero(producto.precio) > 0 && numero(producto.precio) <= 16000) {
          const extra = { nombre: String(producto.nombre), precio: numero(producto.precio), categoria: 'comida' };
          regalo(extra, dia, true);
          items.push(extra);
        } else {
          avisos.push('Selecciona en la lista la arepa gratis de máximo $16.000 para completar la promoción.');
        }
      }
      if (arepas.length < 3) avisos.push('Agrega al menos 3 arepas para activar el regalo del miércoles.');
    }
    const regalos = items.filter(p => p.lpPromoGratis).map(p => ({
      nombre: p.nombre, cantidad: 1, precioOriginal: numero(p.lpPromoPrecioOriginal),
      precioCobrado: 0, tipo: 'PROMOCION', diaPromocion: dia
    }));
    return {
      pedido: items,
      dia,
      nombre: DIAS[dia] || '',
      regalos,
      unidadesGratis: regalos.length,
      descuentoPromocionalValor: regalos.reduce((acc, p) => acc + p.precioOriginal, 0),
      totalProductos: items.reduce((acc, p) => acc + numero(p.precio), 0),
      subtotalOriginal: items.reduce((acc, p) => acc + numero(p.lpPromoGratis ? p.lpPromoPrecioOriginal : p.precio), 0),
      avisos
    };
  }
  return { DIAS, calcular, normalizar, nombreMini, esArepa, esArepaLunes, esArepaMartes, esBebida250 };
});
