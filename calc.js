/*
 * calc.js — Lógica pura de cálculo de costos de importación (Perú).
 * No toca el DOM. Funciona en el navegador (global `Calc`) y en Node
 * (module.exports) para las pruebas con `node --test`.
 *
 * Todas las tasas se reciben como fracciones (0.16 = 16%) salvo las
 * entradas del usuario, que se declaran en porcentaje y se convierten aquí.
 * Se calcula con precisión completa; el redondeo a 2 decimales se aplica
 * solo al mostrar (helper `round2`).
 *
 * REGLA DE REDONDEO (única y documentada): ningún resultado intermedio se
 * redondea. Todos los montos se calculan en coma flotante y solo se
 * redondean a céntimos (2 decimales) en la capa de presentación.
 *
 * Fuentes de las reglas de cálculo (ver config/rates.json):
 * - Base IGV importación = valor en aduana + derechos e impuestos de la
 *   importación (incluye ISC y derechos antidumping/compensatorios), menos
 *   el propio IGV/IPM — TUO Ley del IGV, D.S. 055-99-EF, art. 13° inc. e.
 * - Percepción = tasa × (valor en aduana + TODOS los tributos que gravan la
 *   importación + derechos antidumping/compensatorios) — R.S. 203-2003/SUNAT.
 */
(function (global) {
  'use strict';

  // Copia de respaldo normalizada de config/rates.json (se usa si el fetch
  // falla, por ejemplo al abrir index.html con doble clic en file://).
  const TASAS_DEFECTO = {
    igv: 0.16,
    ipm: 0.02,
    ad_valorem_opciones: [0, 0.04, 0.06, 0.11],
    percepcion_opciones: [0.035, 0.05, 0.10],
    percepcion_default: 0.035,
    seguro_default: 0.01,
    isc_default: 0,
    gastos_locales_default: { agente: 400, desaduanaje: 0, almacenaje: 100, transporte: 150, otros: 0 },
    tipo_cambio_referencial: { USD: 3.75, EUR: 4.10, CNY: 0.52, PEN: 1 },
    escenarios_tipo_cambio: [-0.03, 0, 0.03, 0.05, 0.10]
  };

  /*
   * Convierte el JSON enriquecido de config/rates.json (cada tasa puede ser
   * {valor, fuente} u objeto con "opciones"/"defecto") a la forma plana que
   * usan las fórmulas. Acepta también objetos ya planos (p. ej. TASAS_DEFECTO).
   */
  function normalizarTasas(raw) {
    const t = JSON.parse(JSON.stringify(TASAS_DEFECTO));
    if (!raw || typeof raw !== 'object') return t;
    const v = (x) => (x && typeof x === 'object' && !Array.isArray(x) && 'valor' in x ? x.valor : x);
    if (raw.igv != null) t.igv = v(raw.igv);
    if (raw.ipm != null) t.ipm = v(raw.ipm);
    if (raw.seguro_default != null) t.seguro_default = v(raw.seguro_default);
    if (raw.isc_default != null) t.isc_default = v(raw.isc_default);
    if (raw.ad_valorem && raw.ad_valorem.opciones) t.ad_valorem_opciones = raw.ad_valorem.opciones;
    else if (raw.ad_valorem_opciones) t.ad_valorem_opciones = raw.ad_valorem_opciones;
    if (raw.percepcion && raw.percepcion.opciones) t.percepcion_opciones = raw.percepcion.opciones;
    else if (raw.percepcion_opciones) t.percepcion_opciones = raw.percepcion_opciones;
    if (raw.percepcion && raw.percepcion.defecto != null) t.percepcion_default = raw.percepcion.defecto;
    else if (raw.percepcion_default != null) t.percepcion_default = v(raw.percepcion_default);
    if (raw.gastos_locales_default) {
      const g = v(raw.gastos_locales_default) || {};
      ['agente', 'desaduanaje', 'almacenaje', 'transporte', 'otros'].forEach(k => {
        if (typeof g[k] === 'number') t.gastos_locales_default[k] = g[k];
      });
    }
    if (raw.tipo_cambio_referencial) t.tipo_cambio_referencial = Object.assign({}, t.tipo_cambio_referencial, v(raw.tipo_cambio_referencial));
    if (raw.tipo_cambio && typeof raw.tipo_cambio === 'object') {
      ['USD', 'EUR', 'CNY'].forEach(m => {
        if (typeof raw.tipo_cambio[m] === 'number') t.tipo_cambio_referencial[m] = raw.tipo_cambio[m];
      });
    }
    if (Array.isArray(raw.escenarios_tipo_cambio)) t.escenarios_tipo_cambio = raw.escenarios_tipo_cambio;
    return t;
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /*
   * Convierte lo que escribe el usuario a número. Acepta separador de
   * miles y decimal en ambos órdenes ("1,234.56" / "1.234,56"), decimal
   * con coma ("1234,56") y espacios como miles ("1 234,5").
   * Reglas: si hay punto y coma, el ÚLTIMO separador es el decimal; si
   * solo hay comas con patrón de miles (1,234 / 12,345,678) se quitan;
   * si solo hay puntos se tratan como decimales (1.2.3 → NaN).
   * Devuelve NaN si no es interpretable.
   */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    let s = v.trim().replace(/\s/g, '');
    if (s === '') return NaN;
    const hasC = s.includes(','), hasP = s.includes('.');
    if (hasC && hasP) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (hasC) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    const n = Number(s);
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
    if (Number.isFinite(e.antidumpingPct) && e.antidumpingPct < 0) {
      errores.push({ campo: 'antidumping', codigo: 'no_negativo' });
    }
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
    const t = normalizarTasas(tasas);
    const f = factorFx == null ? 1 : factorFx;
    const e = Object.assign({ seguroModo: 'auto', iscPct: 0, antidumpingPct: 0, flete: 0, seguro: 0,
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

    // 6) ISC sobre CIF + ad valorem (sistema al valor, importaciones)
    const isc = (cif + adValorem) * ((e.iscPct || 0) / 100);

    // 6b) Derechos antidumping/compensatorios sobre CIF (opcional)
    const antidumping = cif * ((e.antidumpingPct || 0) / 100);

    // 7) y 8) Base IGV: CIF + derechos e impuestos de la importación,
    //        incluidos el ISC y los derechos antidumping (art. 13° inc. e, TUO IGV)
    const baseIgv = cif + adValorem + isc + antidumping;
    const igv = baseIgv * t.igv;
    const ipm = baseIgv * t.ipm;

    // 9) Tributos en aduana (todo lo que se paga para nacionalizar)
    const tributos = adValorem + isc + antidumping + igv + ipm;

    // 10) Percepción: tasa × (valor en aduana + todos los tributos +
    //     derechos antidumping), R.S. 203-2003/SUNAT. O monto fijo por
    //     unidad si resulta mayor (mercancías sensibles al fraude).
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

    // 12) y 13) Costo puesto en almacén ("costo real": lo que no se recupera).
    // IGV + IPM solo suman al costo si NO se recuperan como crédito fiscal.
    const igvEsCosto = !e.recuperaIgv;
    const costoPuesto = fob + flete + seguro + adValorem + isc + antidumping + totalLocales +
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
      impuestos: adValorem + isc + antidumping + (igvEsCosto ? igv + ipm : 0),
      locales: totalLocales
    };

    return {
      ok: true,
      errores: [],
      fob, flete, seguro, cif,
      adValorem, isc, antidumping, baseIgv, igv, ipm, tributos,
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
    const t = normalizarTasas(tasas);
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
    TASAS_DEFECTO, normalizarTasas, round2, num, toPEN, validar, calcular, escenarios
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else global.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
