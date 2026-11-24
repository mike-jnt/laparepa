/* La Parepa C2.13.15 — reglas puras para promociones del POS.
 * Cada entrada de pedido corresponde a una unidad entregada.
 * Ninguna promoción se ejecuta si no se seleccionó expresamente su día.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LP_PromoReglas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIAS = Object.freeze({ lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles' });
  const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const numero = valor => Number.isFinite(Number(valor)) ? Math.max(0, Number(valor)) : 0;

  // El catálogo puede denominar el mismo regalo MINI PARADA, MINIPARADA o MINI PAREPA.
  const nombreMini = item => /\bMINI\s*(?:PARADA|PAREPA|AREPA)\b/.test(normalizar(item?.nombre)) || /\bMINIPARADA\b/.test(normalizar(item?.nombre));
  const esQuesoLunes = item => /\bQUESO\b|\bQUESILLO\b/.test(normalizar(item?.nombre));
  const noEsArepa = name => /\b(?:ADICION|BEBIDA|REFRESCO|GASEOSA|AGUA|JUGO|PERRO|HAMBURGUESA|TACO|GRANIZADO|PAPAS|SALSA)\b/.test(name);
  function esArepa(item, nombresArepas = []) {
    const nombre = normalizar(item?.nombre);
    if (!nombre || nombreMini(item) || noEsArepa(nombre)) return false;
    if (/\bAREPA\b|\bPAREPA\b/.test(nombre)) return true;
    // La Parepa usa nombres comerciales (PARE OBLIGATORIO, PASO DE POLLO, etc.)
    return Array.isArray(nombresArepas) && nombresArepas.some(n => normalizar(n) === nombre);
  }
  function esArepaLunes(item, nombresArepas) {
    return esArepa(item, nombresArepas) && !esQuesoLunes(item) && numero(item?.precio) > 0;
  }
  function esArepaMartes(item, nombresArepas) {
    return esArepa(item, nombresArepas) && numero(item?.precio) >= 16000;
  }
  function esBebida250(item) {
    return /\b250\s*(?:ML|M L)\b/.test(normalizar(item?.nombre)) && numero(item?.precio) > 0;
  }
  // El selector del miércoles es EXCLUSIVO de estas tres referencias.
  function tipoGratisMiercoles(item) {
    const n = normalizar(item?.nombre);
    if (nombreMini(item)) return 'mini';
    if (/\bPARADA\s+CHORI(?:C|S|Z)ERA\b/.test(n)) return 'choricera';
    if (/\bQUESO\s+SIN\s+FRENOS\b/.test(n)) return 'queso';
    return '';
  }
  const esRegaloMiercoles = item => Boolean(tipoGratisMiercoles(item)) && numero(item?.precio) > 0 && numero(item?.precio) <= 16000;

  // Los regalos que insertó el sistema se eliminan en cada recálculo: no se duplican.
  // Las unidades agregadas manualmente recuperan el precio de catálogo si se retira la promo.
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
    const nombresArepas = Array.isArray(opciones.nombresArepas) ? opciones.nombresArepas : [];

    if (dia === 'lunes') {
      const unidades = Math.floor(items.filter(item => esArepaLunes(item, nombresArepas)).length / 2);
      const mini = opciones.miniProducto || items.find(nombreMini) || { nombre: 'MINI PARADA', precio: 0 };
      let restantes = unidades;
      // Si la mini se agregó manualmente, hacer GRATIS esa unidad: nunca cobrarla ni duplicarla.
      for (const item of items) {
        if (!restantes) break;
        if (!nombreMini(item) || numero(item.precio) <= 0) continue;
        regalo(item, dia);
        restantes -= 1;
      }
      for (let i = 0; i < restantes; i++) {
        const extra = { nombre: String(mini.nombre || 'MINI PARADA'), precio: numero(mini.precio), categoria: 'comida' };
        regalo(extra, dia, true);
        items.push(extra);
      }
      if (!unidades) avisos.push('Agrega 2 arepas participantes; no cuentan las mini ni las arepas de queso.');
    }

    if (dia === 'martes') {
      const unidades = items.filter(item => esArepaMartes(item, nombresArepas)).length;
      if (unidades) {
        const bebida = opciones.bebida;
        if (!bebida || !esBebida250(bebida)) {
          avisos.push('Elige una bebida de 250 ml para poder aplicar la cortesía.');
        } else {
          let restantes = unidades;
          for (const item of items) {
            if (!restantes) break;
            if (normalizar(item.nombre) !== normalizar(bebida.nombre) || numero(item.precio) <= 0) continue;
            regalo(item, dia);
            restantes--;
          }
          for (let i = 0; i < restantes; i++) {
            const extra = { nombre: String(bebida.nombre), precio: numero(bebida.precio), categoria: 'bebidas' };
            regalo(extra, dia, true);
            items.push(extra);
          }
        }
      } else avisos.push('Aplica por cada arepa con precio de $16.000 o más.');
    }

    if (dia === 'miercoles') {
      const pagadas = items.filter(item => esArepa(item, nombresArepas) && numero(item.precio) > 0);
      const gruposDeCuatro = Math.floor(pagadas.length / 4);
      const grupoDeTres = pagadas.length % 4 === 3 ? 1 : 0;
      const totalRegalos = gruposDeCuatro + grupoDeTres;
      const elegido = opciones.arepaProducto;
      if (totalRegalos && !esRegaloMiercoles(elegido)) {
        avisos.push('Selecciona en la lista Mini Parada, Parada Choricera o Queso sin Frenos (máximo $16.000) como arepa gratis.');
      } else if (totalRegalos) {
        const tipo = tipoGratisMiercoles(elegido);
        let faltantes = totalRegalos;
        // Si hay cuatro arepas en la canasta, convertir una de la referencia escogida.
        // Con solo tres compradas NO convertir ninguna de ellas: la cuarta se regala aparte.
        let convertidasDeCuatro = 0;
        for (const item of pagadas) {
          if (convertidasDeCuatro >= gruposDeCuatro) break;
          if (tipoGratisMiercoles(item) !== tipo || numero(item.precio) > 16000) continue;
          regalo(item, dia);
          convertidasDeCuatro++;
          faltantes--;
        }
        // También se admite si el cajero agregó manualmente la MINI (que no cuenta como compra).
        for (const item of items) {
          if (!faltantes) break;
          if (!nombreMini(item) || tipo !== 'mini' || numero(item.precio) <= 0) continue;
          regalo(item, dia);
          faltantes--;
        }
        for (let i = 0; i < faltantes; i++) {
          const extra = { nombre: String(elegido.nombre), precio: numero(elegido.precio), categoria: 'comida' };
          regalo(extra, dia, true);
          items.push(extra);
        }
      }
      if (pagadas.length < 3) avisos.push('Agrega al menos 3 arepas para activar el regalo del miércoles.');
    }

    const regalos = items.filter(p => p.lpPromoGratis).map(p => ({
      nombre: p.nombre, cantidad: 1, precioOriginal: numero(p.lpPromoPrecioOriginal),
      precioCobrado: 0, tipo: 'PROMOCION', diaPromocion: dia
    }));
    return {
      pedido: items, dia, nombre: DIAS[dia] || '', regalos, unidadesGratis: regalos.length,
      descuentoPromocionalValor: regalos.reduce((acc, p) => acc + p.precioOriginal, 0),
      totalProductos: items.reduce((acc, p) => acc + numero(p.precio), 0),
      subtotalOriginal: items.reduce((acc, p) => acc + numero(p.lpPromoGratis ? p.lpPromoPrecioOriginal : p.precio), 0),
      avisos
    };
  }
  return { DIAS, calcular, normalizar, nombreMini, esArepa, esArepaLunes, esArepaMartes, esBebida250,
    tipoGratisMiercoles, esRegaloMiercoles };
});
