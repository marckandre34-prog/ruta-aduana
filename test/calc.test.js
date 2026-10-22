'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../calc.js');

const TASAS = Calc.TASAS_DEFECTO;
const r2 = Calc.round2;

// Entrada base válida; cada test ajusta lo que necesita.
function base(extra) {
  return Object.assign({
    cantidad: 1,
    precioFob: 0,
    monedaFob: 'PEN',
    flete: 0,
    monedaFlete: 'PEN',
    seguroModo: 'manual',
    seguro: 0,
    monedaSeguro: 'PEN',
    adValoremPct: 0,
    iscPct: 0,
    percepcionPct: 0,
    percepcionFija: 0,
    gastosLocales: {},
    recuperaIgv: true,
    margenPct: 30,
    fx: { USD: 4, EUR: 4, CNY: 1, PEN: 1 }
  }, extra);
}

test('A) CIF S/ 18,750 con ad valorem 0%: IGV 3,000, IPM 375, tributos 3,375', () => {
  // FOB 18,750 con seguro manual 0 -> CIF = 18,750
  const r = Calc.calcular(base({ precioFob: 18750 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.cif), 18750.00);
  assert.equal(r2(r.adValorem), 0.00);
  assert.equal(r2(r.baseIgv), 18750.00);
  assert.equal(r2(r.igv), 3000.00);
  assert.equal(r2(r.ipm), 375.00);
  assert.equal(r2(r.tributos), 3375.00);
});

test('B) CIF S/ 1,000 con ad valorem 6% y percepción 3.5%', () => {
  const r = Calc.calcular(base({ precioFob: 1000, adValoremPct: 6, percepcionPct: 3.5 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.cif), 1000.00);
  assert.equal(r2(r.adValorem), 60.00);
  assert.equal(r2(r.baseIgv), 1060.00);
  assert.equal(r2(r.igv), 169.60);
  assert.equal(r2(r.ipm), 21.20);
  assert.equal(r2(r.tributos), 250.80);
  assert.equal(r2(r.percepcion), 43.78);
  assert.equal(r.percepcionMetodo, 'porcentaje');
});

test('C1) ISC mayor que 0 se suma a la base del IGV', () => {
  const r = Calc.calcular(base({ precioFob: 1000, adValoremPct: 6, iscPct: 10 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.isc), 106.00);           // (1000 + 60) x 10%
  assert.equal(r2(r.baseIgv), 1166.00);
  assert.equal(r2(r.igv), 186.56);
  assert.equal(r2(r.ipm), 23.32);
  assert.equal(r2(r.tributos), 375.88);
});

test('C2) Percepción por monto fijo cuando supera al porcentaje', () => {
  // Porcentaje: (1000 + 250.8) x 3.5% = 43.78 ; fijo: 10 x 100 unid = 1000 -> gana fijo
  const r = Calc.calcular(base({
    cantidad: 100, precioFob: 10, adValoremPct: 6,
    percepcionPct: 3.5, percepcionFija: 10
  }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.percepcionPorcentaje), 43.78);
  assert.equal(r2(r.percepcionFija), 1000.00);
  assert.equal(r2(r.percepcion), 1000.00);
  assert.equal(r.percepcionMetodo, 'fijo');
});

test('C3) Percepción por porcentaje cuando supera al monto fijo', () => {
  // fijo: 0.30 x 100 = 30 < 43.78 -> gana el porcentaje
  const r = Calc.calcular(base({
    cantidad: 100, precioFob: 10, adValoremPct: 6,
    percepcionPct: 3.5, percepcionFija: 0.30
  }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.percepcionFija), 30.00);
  assert.equal(r2(r.percepcion), 43.78);
  assert.equal(r.percepcionMetodo, 'porcentaje');
});

test('D1) Conversión de monedas a soles', () => {
  const r = Calc.calcular(base({
    cantidad: 100, precioFob: 5, monedaFob: 'USD',
    flete: 150, monedaFlete: 'USD',
    seguroModo: 'auto', fx: { USD: 4, PEN: 1 }
  }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.fob), 2000.00);          // 100 x 5 USD x 4
  assert.equal(r2(r.flete), 600.00);         // 150 USD x 4
  assert.equal(r2(r.seguro), 20.00);         // 1% del FOB en soles
  assert.equal(r2(r.cif), 2620.00);
});

test('D2) Escenarios de tipo de cambio escalan solo lo importado', () => {
  const entrada = base({
    cantidad: 100, precioFob: 5, monedaFob: 'USD',
    flete: 0, monedaFlete: 'PEN', seguroModo: 'manual', seguro: 0,
    gastosLocales: { otros: 100 },
    fx: { USD: 4, PEN: 1 }
  });
  const esc = Calc.escenarios(entrada, TASAS);
  assert.deepEqual(esc.map(s => s.delta), [-0.03, 0, 0.03, 0.05, 0.10]);
  // -3%: FOB 2000*0.97 = 1940 + 100 local = 2040 -> 20.40 por unidad
  assert.equal(r2(esc[0].costoUnitario), 20.40);
  assert.equal(r2(esc[1].costoUnitario), 21.00);
  // +3%: FOB 2000*1.03 = 2060 + 100 local = 2160 -> 21.60
  assert.equal(r2(esc[2].costoUnitario), 21.60);
  // +10%: 2200 + 100 = 2300 -> 23.00
  assert.equal(r2(esc[4].costoUnitario), 23.00);
  assert.ok(esc[4].precioSinIgv > esc[0].precioSinIgv);
});

test('E) Validaciones de entradas inválidas', () => {
  // Cantidad menor a 1
  let r = Calc.calcular(base({ cantidad: 0 }), TASAS);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.campo === 'cantidad' && e.codigo === 'min_uno'));

  // Precio negativo
  r = Calc.calcular(base({ precioFob: -5 }), TASAS);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.campo === 'precioFob' && e.codigo === 'no_negativo'));

  // Margen 100% o más
  r = Calc.calcular(base({ margenPct: 100 }), TASAS);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.campo === 'margen' && e.codigo === 'menor_cien'));

  // Número no ingresado
  r = Calc.calcular(base({ precioFob: NaN }), TASAS);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.codigo === 'falta_numero'));

  // Tipo de cambio inválido para moneda usada
  r = Calc.calcular(base({ monedaFob: 'USD', precioFob: 10, fx: { USD: 0 } }), TASAS);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.campo === 'tc_USD'));
});

test('IGV recuperable cambia el costo puesto en almacén', () => {
  const entrada = base({ precioFob: 1000, adValoremPct: 0 });
  const conRuc = Calc.calcular(entrada, TASAS);
  const sinRuc = Calc.calcular(Object.assign({}, entrada, { recuperaIgv: false }), TASAS);
  assert.equal(r2(conRuc.costoPuesto), 1000.00);        // IGV+IPM no son costo
  assert.equal(r2(conRuc.creditoFiscal), 180.00);       // 160 + 20
  assert.equal(r2(sinRuc.costoPuesto), 1180.00);        // IGV+IPM sí son costo
});

test('Precio sugerido desde margen sobre el precio', () => {
  // Costo 1000, margen 20% -> precio = 1000 / 0.8 = 1250 ; markup 25%
  const r = Calc.calcular(base({ precioFob: 1000, margenPct: 20 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.precioSinIgv), 1250.00);
  assert.equal(r2(r.markupEquiv), 0.25);
  assert.equal(r2(r.precioConIgv), 1475.00);            // +18% (IGV+IPM)
});

test('F) Antidumping: entra a la base del IGV y a la base de la percepción', () => {
  // CIF 1000, adv 0, antidumping 20% -> AD=200; base IGV=1200; IGV=192; IPM=24
  // tributos = 200+192+24 = 416; percepción 3.5% sobre 1416 = 49.56
  const r = Calc.calcular(base({ precioFob: 1000, antidumpingPct: 20, percepcionPct: 3.5 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.antidumping), 200.00);
  assert.equal(r2(r.baseIgv), 1200.00);
  assert.equal(r2(r.igv), 192.00);
  assert.equal(r2(r.ipm), 24.00);
  assert.equal(r2(r.tributos), 416.00);
  assert.equal(r2(r.percepcion), 49.56);
  // El antidumping es costo real (no se recupera)
  assert.equal(r2(r.costoPuesto), 1200.00);
});

test('G) La percepción incluye el ISC en su base (R.S. 203-2003)', () => {
  // CIF 1000, adv 6% -> 60; ISC 10% sobre 1060 -> 106; base IGV 1166
  // IGV 186.56, IPM 23.32, tributos 375.88
  // percepción 3.5% sobre (1000 + 375.88) = 1375.88 -> 48.1558 -> 48.16
  const r = Calc.calcular(base({ precioFob: 1000, adValoremPct: 6, iscPct: 10, percepcionPct: 3.5 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r2(r.tributos), 375.88);
  assert.equal(r2(r.percepcion), 48.16);
  // Desembolso = tributos + percepción (lo que se paga en aduana)
  assert.equal(r2(r.desembolsoAduana), 424.04);
  // Costo real con RUC: no incluye IGV/IPM ni percepción
  assert.equal(r2(r.costoPuesto), 1166.00);
});

test('H) Redondeo: precisión interna completa, 2 decimales solo al mostrar', () => {
  // CIF 31.80 + adv 6% (1.908) -> base 33.708 -> IGV = 33.708 * 0.16 = 5.39328
  // (valor crudo sin redondear; la vista muestra 5.39)
  const r = Calc.calcular(base({ cantidad: 3, precioFob: 10.60, adValoremPct: 6 }), TASAS);
  assert.equal(r.ok, true);
  assert.equal(r.igv, 5.39328);
  assert.equal(r2(r.igv), 5.39);
  assert.equal(r2(r.costoUnitario), 11.24);   // 33.708 / 3
});

test('I) normalizarTasas acepta el formato rates.json ({valor, fuente})', () => {
  const crudo = {
    igv: { valor: 0.16, fuente: 'x' },
    ipm: { valor: 0.02 },
    ad_valorem: { opciones: [0, 0.06, 0.11] },
    percepcion: { opciones: [0.035, 0.10], defecto: 0.10 },
    tipo_cambio: { USD: 3.90 },
    gastos_locales_default: { agente: 500 }
  };
  const t = Calc.normalizarTasas(crudo);
  assert.equal(t.igv, 0.16);
  assert.deepEqual(t.ad_valorem_opciones, [0, 0.06, 0.11]);
  assert.deepEqual(t.percepcion_opciones, [0.035, 0.10]);
  assert.equal(t.percepcion_default, 0.10);
  assert.equal(t.tipo_cambio_referencial.USD, 3.90);
  assert.equal(t.gastos_locales_default.agente, 500);
  // Lo no enviado conserva el defecto
  assert.equal(t.tipo_cambio_referencial.PEN, 1);
});

test('J) Gastos locales por defecto se pueden leer desde la configuración', () => {
  const t = Calc.normalizarTasas(null);
  assert.equal(t.gastos_locales_default.agente > 0, true);
  assert.equal(t.gastos_locales_default.transporte > 0, true);
});
