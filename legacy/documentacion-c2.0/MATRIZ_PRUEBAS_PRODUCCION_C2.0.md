# Matriz de pruebas de producción C2.0

| Área | Caso | Resultado esperado |
|---|---|---|
| Firebase | Ejecutar `diagnosticarLaParepaC2()` | projectActive `laparepa`, Auth y perfil verdaderos |
| Roles | Iniciar como cajero | POS, ventas, caja e inventario visibles; Finanzas/Nómina bloqueados |
| Roles | Iniciar como Contabilidad | Finanzas, Nómina e históricos; sin fuentes automáticas editables |
| Venta | Efectivo sin bebidas | Venta guardada una sola vez |
| Venta | Bebida con stock | Venta + descuento + movimiento atómicos |
| Venta | Bebida sin registro | Venta rechazada, pedido conservado |
| Venta | Stock insuficiente | Venta rechazada, sin stock negativo |
| Venta | Doble clic | Solo una venta y una numeración |
| Offline | Venta sin conexión | Pendiente local visible y sincronizada al reconectar |
| Caja | Apertura y cierre | Resumen correcto y documento auditado |
| Finanzas | Sincronizar cierre dos veces | Segunda ejecución sin escrituras si no cambió |
| Finanzas | Anular automático | No reaparece después de sincronizar |
| Inventario | Dos salidas simultáneas | Transacción conserva stock no negativo |
| Nómina | Repetir mismo pago | Segundo intento rechazado |
| Nómina | Anular pago | Pago y movimiento financiero anulados y excluidos |
| Paginación | 0, 9, 10 y 11 registros | Botones y páginas correctos |
| Catálogo | Documento cercano a 850 KB | Publicación bloqueada con mensaje claro |
| Impresión | Recibo y comanda | Formato correcto; cocina no abre cajón |
| Seguridad | Escritura directa no autorizada | Firestore responde permission-denied |
