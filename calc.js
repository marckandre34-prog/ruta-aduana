/*
 * calc.js — Lógica pura de cálculo de costos de importación (Perú).
 * No toca el DOM. Funciona en el navegador (global `Calc`) y en Node
 * (module.exports) para las pruebas con `node --test`.
 *
 * Todas las tasas se reciben como fracciones (0.16 = 16%) salvo las
 * entradas del usuario, que se declaran en porcentaje y se convierten aquí.
 * Se calcula con precisión completa; el redondeo a 2 decimales se aplica
 * solo al mostrar (helper `round2`).
 */
(function (global) {
  'use strict';

  // Copia de respaldo de config/tasas.json (se usa si el fetch falla,
  // por ejemplo al abrir index.html con doble clic en file://).
  const TASAS_DEFECTO = {
    igv: 0.16,
    ipm: 0.02,
    ad_valorem_opciones: [0, 0.04, 0.06, 0.11],
    percepcion_opciones: [0, 0.035, 0.05, 0.10],
    percepcion_default: 0.035,
    seguro_default: 0.01,
    isc_default: 0,
    tipo_cambio_referencial: { USD: 3.75, EUR: 4.10, CNY: 0.52, PEN: 1 },
    escenarios_tipo_cambio: [-0.03, 0, 0.05, 0.10]
  };

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Convierte lo que escribe el usuario ("1.234,56" o "1234.56") a número.
  // Devuelve NaN si no es interpretable.
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    const limpio = v.trim().replace(/\s/g, '').replace(/,/g, '.');
    if (limpio === '') return NaN;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : NaN;
  }

  function toPEN(monto, moneda, fx) {
    const tasa = fx && fx[moneda];
    if (!Number.isFinite(tasa)) return NaN;
    return monto * tasa;
  }

  /*
   * Valida las entradas ya convertidas a números.
   * Devuelve una lista de { campo, codigo } — la capa de interfaz traduce
   * cada código a un mensaje amable en el idioma activo.
   */
  function validar(e) {
    const errores = [];
    const falta = (v) => !Number.isFinite(v);

    if (falta(e.cantidad)) errores.push({ campo: 'cantidad', codigo: 'falta_numero' });
    else if (e.cantidad < 1) errores.push({ campo: 'cantidad', codigo: 'min_uno' });

    if (falta(e.precioFob)) errores.push({ campo: 'precioFob', codigo: 'falta_numero' });
    else if (e.precioFob < 0) errores.push({ campo: 'precioFob', codigo: 'no_negativo' });

    if (!falta(e.flete) && e.flete < 0) errores.push({ campo: 'flete', codigo: 'no_negativo' });

    if (e.seguroModo === 'manual' && !falta(e.seguro) && e.seguro < 0) {
      errores.push({ campo: 'seguro', codigo: 'no_negativo' });
    }

    const tasaValida = (v, campo) => {
      if (falta(v)) { errores.push({ campo, codigo: 'falta_numero' }); return; }
      if (v < 0) { errores.push({ campo, codigo: 'no_negativo' }); return; }
      if (v >= 100) errores.push({ campo, codigo: 'menor_cien' });
    };
    tasaValida(e.adValoremPct, 'adValorem');
    if (Number.isFinite(e.iscPct) && e.iscPct < 0) errores.push({ campo: 'isc', codigo: 'no_negativo' });
    if (Number.isFinite(e.iscPct) && e.iscPct >= 100) errores.push({ campo: 'isc', codigo: 'menor_cien' });
    if (Number.isFinite(e.percepcionPct) && e.percepcionPct < 0) {
      errores.push({ campo: 'percepcion', codigo: 'no_negativo' });
    }
    if (!falta(e.percepcionFija) && e.percepcionFija < 0) {
      errores.push({ campo: 'percepcionFija', codigo: 'no_negativo' });
    }

    if (falta(e.margenPct)) errores.push({ campo: 'margen', codigo: 'falta_numero' });
    else if (e.margenPct < 0) errores.push({ campo: 'margen', codigo: 'no_negativo' });
    else if (e.margenPct >= 100) errores.push({ campo: 'margen', codigo: 'menor_cien' });

    // Tipos de cambio de las monedas efectivamente usadas
    const monedas = new Set([e.monedaFob, e.monedaFlete]);
    if (e.seguroModo === 'manual') monedas.add(e.monedaSeguro);
    for (const m of monedas) {
      if (!m || m === 'PEN') continue;
      const tc = e.fx && e.fx[m];
      if (!Number.isFinite(tc) || tc <= 0) {
        errores.push({ campo: 'tc_' + m, codigo: 'tc_invalido' });
      }
    }

    const locales = e.gastosLocales || {};
    for (const k of Object.keys(locales)) {
      if (Number.isFinite(locales[k]) && locales[k] < 0) {
        errores.push({ campo: 'local_' + k, codigo: 'no_negativo' });
      }
    }
    return errores;
  }

  /*
   * Núcleo del cálculo.
   * entrada (números ya parseados):
   *   cantidad, precioFob, monedaFob, flete, monedaFlete,
   *   seguroModo ('auto'|'manual'), seguro, monedaSeguro,
   *   adValoremPct, iscPct, percepcionPct, percepcionFija,
   *   gastosLocales {agente, desaduanaje, almacenaje, transporte, otros},
   *   recuperaIgv (bool), margenPct, fx {USD,EUR,CNY,PEN}
   * tasas: contenido de config/tasas.json (o TASAS_DEFECTO)
   * factorFx: multiplicador de tipo de cambio (1 = escenario base)
   */
  function calcular(entrada, tasas, factorFx) {
    const t = Object.assign({}, TASAS_DEFECTO, tasas || {});
    const f = factorFx == null ? 1 : factorFx;
    const e = Object.assign({ seguroModo: 'auto', iscPct: 0, flete: 0, seguro: 0,
      percepcionFija: 0, gastosLocales: {}, recuperaIgv: true, fx: {} }, entrada);

    const errores = validar(e);
    if (errores.length) return { ok: false, errores };

    const fx = Object.assign({}, t.tipo_cambio_referencial, e.fx, { PEN: 1 });
    const fxEsc = {};
    for (const m of Object.keys(fx)) fxEsc[m] = m === 'PEN' ? 1 : fx[m] * f;

    // 1) FOB total en soles
    const fob = toPEN(e.precioFob * e.cantidad, e.monedaFob, fxEsc);

    // 2) Flete internacional en soles
    const flete = toPEN(e.flete || 0, e.monedaFlete || 'PEN', fxEsc);

    // 3) Seguro: 1% del FOB por defecto o monto manual
    const seguro = e.seguroModo === 'manual'
      ? toPEN(e.seguro || 0, e.monedaSeguro || 'PEN', fxEsc)
      : fob * t.seguro_default;

    // 4) Valor en aduana
    const cif = fob + flete + seguro;

    // 5) Ad valorem
    const adValorem = cif * (e.adValoremPct / 100);

    // 6) ISC sobre CIF + ad valorem
    const isc = (cif + adValorem) * ((e.iscPct || 0) / 100);

    // 7) y 8) Base IGV, IGV e IPM
    const baseIgv = cif + adValorem + isc;
    const igv = baseIgv * t.igv;
    const ipm = baseIgv * t.ipm;

    // 9) Tributos en aduana
    const tributos = adValorem + isc + igv + ipm;

    // 10) Percepción: porcentaje o monto fijo por unidad (lo que resulte mayor)
    const percepcionPorcentaje = (cif + tributos) * ((e.percepcionPct || 0) / 100);
    const percepcionFija = (e.percepcionFija || 0) * e.cantidad;
    const percepcion = Math.max(percepcionPorcentaje, percepcionFija);
    const percepcionMetodo = percepcionFija > percepcionPorcentaje ? 'fijo' : 'porcentaje';

    // 11) Gastos locales en soles
    const g = e.gastosLocales;
    const gastosLocales = {
      agente: g.agente || 0,
      desaduanaje: g.desaduanaje || 0,
      almacenaje: g.almacenaje || 0,
      transporte: g.transporte || 0,
      otros: g.otros || 0
    };
    const totalLocales = Object.values(gastosLocales).reduce((a, b) => a + b, 0);

    // 12) y 13) Costo puesto en almacén.
    // IGV + IPM solo suman al costo si NO se recuperan como crédito fiscal.
    const igvEsCosto = !e.recuperaIgv;
    const costoPuesto = fob + flete + seguro + adValorem + isc + totalLocales +
      (igvEsCosto ? igv + ipm : 0);

    // 14) Costo unitario
    const costoUnitario = costoPuesto / e.cantidad;

    // 15) Precio sugerido desde margen sobre el precio
    const m = e.margenPct / 100;
    const precioSinIgv = costoUnitario / (1 - m);
    const precioConIgv = precioSinIgv * (1 + t.igv + t.ipm);
    const markupEquiv = costoUnitario > 0 ? (precioSinIgv - costoUnitario) / costoUnitario : 0;

    // 16) Desembolso en aduana (dinero a tener listo para retirar la carga)
    const desembolsoAduana = tributos + percepcion;

    // Desglose para la barra (suma exactamente el costo puesto en almacén)
    const desglose = {
      producto: fob,
      fleteSeguro: flete + seguro,
      impuestos: adValorem + isc + (igvEsCosto ? igv + ipm : 0),
      locales: totalLocales
    };

    return {
      ok: true,
      errores: [],
      fob, flete, seguro, cif,
      adValorem, isc, baseIgv, igv, ipm, tributos,
      percepcion, percepcionPorcentaje, percepcionFija, percepcionMetodo,
      gastosLocales, totalLocales,
      recuperaIgv: e.recuperaIgv,
      creditoFiscal: e.recuperaIgv ? igv + ipm : 0,
      recuperaDespues: e.recuperaIgv ? igv + ipm + percepcion : percepcion,
      costoPuesto, costoUnitario,
      precioSinIgv, precioConIgv, markupEquiv,
      desembolsoAduana,
      desglose
    };
  }

  // 17) Escenarios de tipo de cambio: costo unitario y precio sugerido
  function escenarios(entrada, tasas) {
    const t = Object.assign({}, TASAS_DEFECTO, tasas || {});
    return t.escenarios_tipo_cambio.map((delta) => {
      const r = calcular(entrada, t, 1 + delta);
      return {
        delta,
        ok: r.ok,
        costoUnitario: r.ok ? r.costoUnitario : NaN,
        precioSinIgv: r.ok ? r.precioSinIgv : NaN,
        precioConIgv: r.ok ? r.precioConIgv : NaN
      };
    });
  }

  const Calc = {
    TASAS_DEFECTO, round2, num, toPEN, validar, calcular, escenarios
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else global.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
