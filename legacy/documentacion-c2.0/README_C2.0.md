# La Parepa — Sistema integral C2.0

Proyecto Firebase autorizado: `laparepa`.

## Módulos

- `index.html`: POS, ventas, caja, históricos, domicilios, catálogo y usuarios.
- `inventario.html`: inventario oficial, movimientos, cola sin conexión y bebidas del catálogo.
- `finanzas.html`: ingresos, gastos, cierres, nómina, filtros, gráficas y exportación.
- `nomina.html`: empleados, liquidaciones, pagos, anulaciones y recibos.

## Publicación completa

1. Instala Firebase CLI e inicia sesión.
2. Abre una terminal en esta carpeta.
3. Ejecuta `PUBLICAR_COMPLETO_C2.0.bat`.
4. Espera a que terminen de construirse los índices.
5. Abre el hosting, presiona `Ctrl + F5` y confirma en consola:

```text
[La Parepa C2.0-INTEGRAL] Firebase activo y autorizado: laparepa
```

6. Ejecuta en consola:

```javascript
diagnosticarLaParepaC2()
```

## Publicación solo web

Ejecuta `PUBLICAR_HOSTING_C2.0.bat` únicamente cuando las reglas e índices C2.0 ya estén publicados.

## Prueba local

Ejecuta `INICIAR_LOCAL_C2.0.bat` y abre la dirección indicada. No abras los HTML con doble clic porque Firebase y el service worker requieren un servidor web.

## Primera validación en producción

1. Iniciar sesión como administrador.
2. Confirmar acceso a POS, Inventario, Finanzas y Nómina.
3. Abrir caja.
4. Registrar una venta en efectivo con una bebida existente.
5. Verificar descuento de inventario y movimiento idempotente.
6. Registrar una venta por transferencia y una con domicilio.
7. Cerrar caja y sincronizar fuentes desde Finanzas.
8. Crear un empleado y un pago de prueba.
9. Confirmar el gasto automático en Finanzas.
10. Probar el cajero: no debe acceder a Finanzas/Nómina ni editar ventas sincronizadas.
11. Probar Contabilidad: consulta y movimientos manuales, sin alterar fuentes automáticas.
12. Probar desconexión/reconexión del POS e Inventario.

## Datos protegidos

Las eliminaciones físicas de ventas, caja, inventario, movimientos financieros, nómina y auditoría están bloqueadas en las reglas. Las anulaciones conservan motivo, usuario y fecha.
