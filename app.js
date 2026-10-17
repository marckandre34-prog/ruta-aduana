/*
 * app.js — Capa de interfaz. Lee el formulario, llama a Calc.calcular()
 * y pinta los resultados en vivo. La lógica de cálculo vive en calc.js.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'rutaAduana.calculos';
  const LS_PREF = 'rutaAduana.prefs';

  /* ── Estado ── */
  let tasas = Calc.TASAS_DEFECTO;
  let lang = 'es';
  let modo = 'simple';
  let tema = 'claro';
  let seguroModo = 'auto';
  let recuperaIgv = true;
  const fxUsuario = {}; // tipos de cambio editados por el usuario

  const SIMBOLO = { USD: 'US$', EUR: '€', CNY: '¥', PEN: 'S/' };
  // Campos que se formatean con separador de miles al salir (blur)
  const CAMPOS_DINERO = {
    f_cantidad: 0, f_precio: 2, f_flete: 2, f_seguro: 2,
    f_agente: 2, f_desaduanaje: 2, f_almacenaje: 2,
    f_transporte: 2, f_otros: 2, f_percepcion_fija: 2
  };

  // Parseo tolerante: acepta "1,234.56", "1234,56" y "3,75"
  function parseNumero(v) {
    let s = String(v).trim().replace(/\s/g, '');
    if (!s) return NaN;
    const hasC = s.includes(','), hasP = s.includes('.');
    if (hasC && hasP) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (hasC) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    return Number(s);
  }

  function updatePrefijos() {
    $('prefijo-precio').textContent = SIMBOLO[$('f_moneda').value];
    $('prefijo-flete').textContent = SIMBOLO[$('f_moneda_flete').value];
    $('prefijo-seguro').textContent = SIMBOLO[$('f_moneda_seguro').value];
  }

  function aplicarTema() {
    document.documentElement.dataset.tema = tema;
    $('icono-sol').hidden = tema === 'oscuro';
    $('icono-luna').hidden = tema !== 'oscuro';
  }

  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.es[k] || k;
  const tpl = (s, m) => String(s).replace(/\{(\w+)\}/g, (_, k) => (m[k] != null ? m[k] : '{' + k + '}'));

  const fmtMoney = (n) => 'S/ ' + new Intl.NumberFormat(lang === 'es' ? 'es-PE' : 'en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const fmtNum = (n, d = 2) => new Intl.NumberFormat(lang === 'es' ? 'es-PE' : 'en-US',
    { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

  function store(op, val) {
    try {
      if (op === 'get') return JSON.parse(localStorage.getItem(LS_KEY)) || [];
      if (op === 'set') localStorage.setItem(LS_KEY, JSON.stringify(val));
      if (op === 'getPrefs') return JSON.parse(localStorage.getItem(LS_PREF)) || {};
      if (op === 'setPrefs') localStorage.setItem(LS_PREF, JSON.stringify(val));
    } catch (e) { return op === 'get' ? [] : op === 'getPrefs' ? {} : undefined; }
  }

  /* ── Inicialización ── */
  async function init() {
    const prefs = store('getPrefs');
    if (prefs.lang) lang = prefs.lang;
    if (prefs.modo) modo = prefs.modo;
    if (prefs.tema) tema = prefs.tema;

    try {
      const r = await fetch('config/tasas.json');
      if (r.ok) tasas = Object.assign({}, Calc.TASAS_DEFECTO, await r.json());
    } catch (e) { /* file:// sin servidor: se usan TASAS_DEFECTO */ }

    poblarSelects();
    aplicarModo();
    aplicarTema();
    aplicarIdioma();
    enlazarEventos();
    sincronizarToggleSeguro();
    sincronizarToggleRecupera();
    actualizarTcRows();
    recalc();
  }

  /* ── Selects dinámicos desde tasas.json ── */
  function poblarSelects() {
    const adv = $('f_adv');
    const prev = adv.value;
    adv.innerHTML = '';
    const niveles = modo === 'avanzado' ? tasas.ad_valorem_opciones : tasas.ad_valorem_opciones_simple;
    niveles.forEach((v) => {
      const op = document.createElement('option');
      op.value = String(v * 100);
      op.textContent = fmtNum(v * 100, v * 100 % 1 ? 1 : 0) + ' %';
      adv.appendChild(op);
    });
    if (modo === 'avanzado') {
      const op = document.createElement('option');
      op.value = 'custom';
      op.textContent = t('advOtro');
      adv.appendChild(op);
    }
    if ([...adv.options].some(o => o.value === prev)) adv.value = prev;

    const per = $('f_percepcion');
    const prevP = per.value;
    per.innerHTML = '';
    tasas.percepcion_opciones.forEach((v) => {
      const op = document.createElement('option');
      op.value = String(v * 100);
      op.textContent = fmtNum(v * 100, v * 100 % 1 ? 1 : 0) + ' %';
      per.appendChild(op);
    });
    per.value = [...per.options].some(o => o.value === prevP) ? prevP : String(tasas.percepcion_default * 100);
  }

  /* ── Idioma ── */
  function aplicarIdioma() {
    document.documentElement.lang = lang;
    document.title = t('brand') + ' — ' + t('tagline');
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $('lang-es').setAttribute('aria-pressed', String(lang === 'es'));
    $('lang-en').setAttribute('aria-pressed', String(lang === 'en'));
    $('aviso-texto').textContent = tpl(t('avisoTasas'), { fecha: tasas.vigente_a_fecha || '—' }) + ' ';
    $('aviso-link').textContent = t('avisoSunatLink');
    $('aviso-link').href = tasas.sunat_arancel_url || '#';
    $('adv-ayuda').href = tasas.sunat_arancel_url || '#';
    $('btn-tema').setAttribute('aria-label', t('btnTema'));
    actualizarTcLabels();
    poblarSelects();
    recalc();
    renderGuardados();
  }

  /* ── Modo simple / avanzado ── */
  function aplicarModo() {
    document.body.classList.toggle('modo-avanzado', modo === 'avanzado');
    $('modo-simple').setAttribute('aria-pressed', String(modo === 'simple'));
    $('modo-avanzado').setAttribute('aria-pressed', String(modo === 'avanzado'));
    poblarSelects();
    recalc();
  }

  /* ── Tipos de cambio ── */
  const tcRows = [
    { select: 'f_moneda', row: 'tc-row-fob', input: 'tc_fob' },
    { select: 'f_moneda_flete', row: 'tc-row-flete', input: 'tc_flete' },
    { select: 'f_moneda_seguro', row: 'tc-row-seguro', input: 'tc_seguro' }
  ];

  function tcDe(moneda) {
    return fxUsuario[moneda] != null ? fxUsuario[moneda]
      : (tasas.tipo_cambio_referencial && tasas.tipo_cambio_referencial[moneda]) || '';
  }

  function actualizarTcRows() {
    tcRows.forEach(({ select, row, input }) => {
      const m = $(select).value;
      const el = $(row);
      el.hidden = (m === 'PEN');
      if (!el.hidden) $(input).value = tcDe(m);
    });
    actualizarTcLabels();
    updatePrefijos();
  }

  function actualizarTcLabels() {
    tcRows.forEach(({ select, row }) => {
      const m = $(select).value;
      const lbl = $(row).querySelector('.tc-label');
      if (lbl) lbl.textContent = tpl(t('lTc'), { moneda: m });
    });
  }

  /* ── Lectura del formulario ── */
  function num(id) {
    const v = $(id).value.trim();
    return v === '' ? NaN : parseNumero(v);
  }

  function leerEntrada() {
    const advSel = $('f_adv').value;
    const adValoremPct = advSel === 'custom' ? num('f_adv_custom') : parseFloat(advSel);
    const fx = {};
    tcRows.forEach(({ select, input }) => {
      const m = $(select).value;
      fx[m] = m === 'PEN' ? 1 : (parseNumero($(input).value) || NaN);
    });
    return {
      cantidad: num('f_cantidad'),
      precioFob: num('f_precio'),
      monedaFob: $('f_moneda').value,
      flete: Number.isFinite(num('f_flete')) ? num('f_flete') : 0,
      monedaFlete: $('f_moneda_flete').value,
      seguroModo,
      seguro: Number.isFinite(num('f_seguro')) ? num('f_seguro') : 0,
      monedaSeguro: $('f_moneda_seguro').value,
      adValoremPct,
      iscPct: modo === 'avanzado' && Number.isFinite(num('f_isc')) ? num('f_isc') : 0,
      percepcionPct: parseFloat($('f_percepcion').value) || 0,
      percepcionFija: Number.isFinite(num('f_percepcion_fija')) ? num('f_percepcion_fija') : 0,
      gastosLocales: modo === 'avanzado' ? {
        agente: num('f_agente') || 0, desaduanaje: num('f_desaduanaje') || 0,
        almacenaje: num('f_almacenaje') || 0, transporte: num('f_transporte') || 0,
        otros: num('f_otros') || 0
      } : {},
      recuperaIgv: modo === 'avanzado' ? recuperaIgv : true,
      margenPct: num('f_margen'),
      fx
    };
  }

  const campoDeError = {
    cantidad: 'f_cantidad', precioFob: 'f_precio', flete: 'f_flete', seguro: 'f_seguro',
    adValorem: 'f_adv_custom', isc: 'f_isc', percepcion: 'f_percepcion',
    percepcionFija: 'f_percepcion_fija', margen: 'f_margen',
    tc_USD: 'tc_fob', tc_EUR: 'tc_fob', tc_CNY: 'tc_fob',
    local_agente: 'f_agente', local_desaduanaje: 'f_desaduanaje',
    local_almacenaje: 'f_almacenaje', local_transporte: 'f_transporte', local_otros: 'f_otros'
  };
  const nombreCampo = {
    cantidad: 'lCantidad', precioFob: 'lPrecioFob', flete: 'lFlete', seguro: 'lMontoSeguro',
    adValorem: 'lAdValorem', isc: 'lIsc', percepcion: 'lPercepcion',
    percepcionFija: 'lPercepcionFija', margen: 'lMargen',
    tc_USD: 'lPrecioFob', tc_EUR: 'lPrecioFob', tc_CNY: 'lPrecioFob',
    local_agente: 'lAgente', local_desaduanaje: 'lDesaduanaje',
    local_almacenaje: 'lAlmacenaje', local_transporte: 'lTransporte', local_otros: 'lOtros'
  };

  /* ── Render principal ── */
  function recalc() {
    const entrada = leerEntrada();
    const r = Calc.calcular(entrada, tasas);

    document.querySelectorAll('input.invalido').forEach(i => i.classList.remove('invalido'));

    const vacio = $('estado-vacio'), errores = $('estado-errores'), contenido = $('resultados-contenido');
    const formVacio = $('f_cantidad').value.trim() === '' && $('f_precio').value.trim() === '';

    if (formVacio) {
      vacio.hidden = false; errores.hidden = true; contenido.hidden = true;
      return;
    }
    if (!r.ok) {
      vacio.hidden = true; contenido.hidden = true; errores.hidden = false;
      const ul = $('lista-errores');
      ul.innerHTML = '';
      r.errores.forEach((e) => {
        const li = document.createElement('li');
        li.textContent = t(nombreCampo[e.campo] || 'lProducto') + ': ' + (t('err')[e.codigo] || e.codigo);
        ul.appendChild(li);
        const inp = $(campoDeError[e.campo]);
        if (inp && inp.offsetParent) inp.classList.add('invalido');
        else if (inp && !inp.offsetParent && e.campo.startsWith('tc_')) {
          // el tipo de cambio inválido puede estar en otra fila: marcar todas visibles
          tcRows.forEach(({ select, input }) => {
            if ($(select).value === e.campo.slice(3)) $(input).classList.add('invalido');
          });
        }
      });
      return;
    }

    vacio.hidden = true; errores.hidden = true; contenido.hidden = false;
    renderResultados(r, entrada);
  }

  function renderResultados(r, entrada) {
    $('r_costo').textContent = fmtMoney(r.costoUnitario);
    $('r_precio').textContent = fmtMoney(r.precioSinIgv);
    $('r_precio_igv').textContent = fmtMoney(r.precioConIgv);
    $('r_markup').textContent = tpl(t('resMarkup'), { markup: fmtNum(r.markupEquiv * 100, 1) });
    $('r_desembolso').textContent = fmtMoney(r.desembolsoAduana);
    $('r_recupera').textContent = r.recuperaIgv
      ? tpl(t('resRecupera'), { monto: fmtMoney(r.recuperaDespues) })
      : tpl(t('resNoRecupera'), { monto: fmtMoney(r.percepcion) });

    // Barra de desglose
    const d = r.desglose, total = r.costoPuesto || 1;
    const segs = [
      { id: 'bar-producto', val: d.producto, cls: 'seg-producto', nombre: t('segProducto') },
      { id: 'bar-flete', val: d.fleteSeguro, cls: 'seg-flete', nombre: t('segFlete') },
      { id: 'bar-impuestos', val: d.impuestos, cls: 'seg-impuestos', nombre: t('segImpuestos') },
      { id: 'bar-locales', val: d.locales, cls: 'seg-locales', nombre: t('segLocales') }
    ];
    segs.forEach(s => { $(s.id).style.width = (s.val / total * 100) + '%'; });
    $('barra').setAttribute('aria-label',
      segs.map(s => s.nombre + ' ' + fmtNum(s.val / total * 100, 0) + '%').join(', '));
    const ley = $('leyenda');
    ley.innerHTML = '';
    segs.forEach(s => {
      const li = document.createElement('li');
      const punto = document.createElement('span');
      punto.className = 'punto';
      punto.style.background = getComputedStyle($(s.id)).backgroundColor;
      li.appendChild(punto);
      li.appendChild(document.createTextNode(s.nombre));
      const monto = document.createElement('span');
      monto.className = 'monto';
      monto.textContent = fmtMoney(s.val);
      li.appendChild(monto);
      ley.appendChild(li);
    });

    // Escenarios (modo avanzado)
    if (modo === 'avanzado') {
      $('escenarios-box').hidden = false;
      const esc = Calc.escenarios(entrada, tasas);
      const tb = $('tabla-esc');
      tb.innerHTML = '';
      esc.forEach(s => {
        const tr = document.createElement('tr');
        if (s.delta === 0) tr.className = 'actual';
        const nombre = s.delta === 0 ? t('escIgual')
          : s.delta < 0 ? tpl(t('escBaja'), { pct: fmtNum(-s.delta * 100, 0) })
          : tpl(t('escSube'), { pct: fmtNum(s.delta * 100, 0) });
        [nombre, fmtMoney(s.costoUnitario), fmtMoney(s.precioSinIgv)].forEach((v, i) => {
          const td = document.createElement(i === 0 ? 'th' : 'td');
          td.scope = 'row';
          td.textContent = v;
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
    } else {
      $('escenarios-box').hidden = true;
    }

    renderPasos(r, entrada);
    renderDetalle(r, entrada);
  }

  function renderPasos(r, entrada) {
    const ol = $('lista-pasos');
    ol.innerHTML = '';
    const m = {
      fob: fmtMoney(r.fob), cantidad: fmtNum(entrada.cantidad, 0),
      precioUnit: fmtNum(entrada.precioFob), moneda: entrada.monedaFob,
      flete: fmtMoney(r.flete), seguro: fmtMoney(r.seguro), cif: fmtMoney(r.cif),
      advPct: fmtNum(entrada.adValoremPct, entrada.adValoremPct % 1 ? 1 : 0), adv: fmtMoney(r.adValorem),
      baseIgv: fmtMoney(r.baseIgv), igv: fmtMoney(r.igv), ipm: fmtMoney(r.ipm),
      tributos: fmtMoney(r.tributos), percepcion: fmtMoney(r.percepcion),
      locales: fmtMoney(r.totalLocales), costo: fmtMoney(r.costoPuesto),
      porUnidad: fmtMoney(r.costoUnitario), margen: fmtNum(entrada.margenPct, 0),
      precio: fmtMoney(r.precioSinIgv), precioIgv: fmtMoney(r.precioConIgv)
    };
    const frases = t('pasos').map(s => tpl(s, m));
    const finales = [];
    if (r.isc > 0) finales.push({ idx: 3, txt: tpl(t('pasoIsc'), { pct: fmtNum(entrada.iscPct, 1), monto: fmtMoney(r.isc) }) });
    finales.push({ idx: 7, txt: tpl(r.recuperaIgv ? t('pasoRecupera') : t('pasoNoRecupera'), { monto: fmtMoney(r.igv + r.ipm) }) });
    finales.sort((a, b) => a.idx - b.idx).reverse().forEach(f => frases.splice(f.idx, 0, f.txt));
    frases.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      ol.appendChild(li);
    });
  }

  function renderDetalle(r, entrada) {
    const dl = $('detalle-numeros');
    dl.innerHTML = '';
    const filas = [
      ['FOB (' + entrada.monedaFob + ')', r.fob],
      [t('lFlete'), r.flete],
      [t('lSeguro'), r.seguro],
      ['CIF — ' + (lang === 'es' ? 'valor en aduana' : 'customs value'), r.cif],
      ['Ad valorem (' + fmtNum(entrada.adValoremPct, 1) + '%)', r.adValorem],
      ['ISC (' + fmtNum(entrada.iscPct || 0, 1) + '%)', r.isc],
      ['IGV (16%)', r.igv],
      ['IPM (2%)', r.ipm],
      [t('lPercepcion') + ' (' + fmtNum(entrada.percepcionPct, 1) + '%' +
        (r.percepcionMetodo === 'fijo' ? ', ' + (lang === 'es' ? 'fijo/unid.' : 'fixed/unit') : '') + ')', r.percepcion],
      [t('lGastosLocales'), r.totalLocales]
    ];
    filas.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = fmtMoney(v);
      dl.append(dt, dd);
    });
    const dt = document.createElement('dt'); dt.textContent = lang === 'es' ? 'Costo puesto en almacén' : 'Landed cost';
    dt.className = 'total';
    const dd = document.createElement('dd'); dd.textContent = fmtMoney(r.costoPuesto);
    dd.className = 'total';
    dl.append(dt, dd);
  }

  /* ── Guardados (localStorage) ── */
  function capturarFormulario() {
    const fields = {};
    document.querySelectorAll('#form input, #form select').forEach(el => { fields[el.id] = el.value; });
    return { fields, seguroModo, recuperaIgv, modo, fx: Object.assign({}, fxUsuario) };
  }

  function restaurarFormulario(data) {
    if (!data || !data.fields) return;
    Object.entries(data.fields).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
    seguroModo = data.seguroModo || 'auto';
    recuperaIgv = data.recuperaIgv !== false;
    Object.assign(fxUsuario, data.fx || {});
    if (data.modo && data.modo !== modo) { modo = data.modo; aplicarModo(); }
    sincronizarToggleSeguro();
    sincronizarToggleRecupera();
    actualizarTcRows();
    recalc();
  }

  function guardarCalculo() {
    const r = Calc.calcular(leerEntrada(), tasas);
    if (!r.ok) return;
    const lista = store('get');
    lista.unshift({
      ts: Date.now(),
      nombre: $('f_producto').value.trim() || (lang === 'es' ? 'Cálculo sin nombre' : 'Untitled'),
      datos: capturarFormulario(),
      resumen: { costoUnitario: r.costoUnitario, precioSinIgv: r.precioSinIgv }
    });
    store('set', lista.slice(0, 30));
    renderGuardados();
    flashBoton('btn-guardar', t('btnGuardado'));
  }

  function renderGuardados() {
    const lista = store('get');
    const ul = $('lista-guardados');
    ul.innerHTML = '';
    if (!lista.length) {
      const li = document.createElement('li');
      li.textContent = t('guardadosVacio');
      ul.appendChild(li);
      return;
    }
    lista.forEach((item, i) => {
      const li = document.createElement('li');
      const nombre = document.createElement('span');
      nombre.className = 'nombre';
      nombre.textContent = item.nombre +
        (item.resumen ? ' — ' + fmtMoney(item.resumen.costoUnitario) + '/u.' : '');
      const fecha = document.createElement('span');
      fecha.className = 'fecha';
      fecha.textContent = new Date(item.ts).toLocaleDateString(lang === 'es' ? 'es-PE' : 'en-US');
      const bCargar = document.createElement('button');
      bCargar.className = 'btn btn-sec'; bCargar.type = 'button'; bCargar.textContent = t('btnCargar');
      bCargar.addEventListener('click', () => restaurarFormulario(item.datos));
      const bBorrar = document.createElement('button');
      bBorrar.className = 'btn btn-sec'; bBorrar.type = 'button'; bBorrar.textContent = t('btnEliminar');
      bBorrar.addEventListener('click', () => {
        if (confirm(t('confirmarEliminar'))) {
          const l = store('get'); l.splice(i, 1); store('set', l); renderGuardados();
        }
      });
      li.append(nombre, fecha, bCargar, bBorrar);
      ul.appendChild(li);
    });
  }

  /* ── Resumen para copiar ── */
  function resumenTexto() {
    const entrada = leerEntrada();
    const r = Calc.calcular(entrada, tasas);
    if (!r.ok) return '';
    const m = {
      brand: t('brand'),
      producto: $('f_producto').value.trim() || '—',
      pais: $('f_pais').value.trim() || '—',
      cantidad: fmtNum(entrada.cantidad, 0),
      costo: fmtMoney(r.costoUnitario),
      precio: fmtMoney(r.precioSinIgv),
      precioIgv: fmtMoney(r.precioConIgv),
      desembolso: fmtMoney(r.desembolsoAduana),
      cif: fmtMoney(r.cif), tributos: fmtMoney(r.tributos),
      percepcion: fmtMoney(r.percepcion), locales: fmtMoney(r.totalLocales)
    };
    return t('resumenCopia').map(s => tpl(s, m)).join('\n');
  }

  /* ── Helpers de UI ── */
  function flashBoton(id, msg) {
    const b = $(id);
    const orig = b.textContent;
    b.textContent = msg;
    setTimeout(() => { b.textContent = orig; }, 1600);
  }

  function sincronizarToggleSeguro() {
    $('seguro-auto').setAttribute('aria-pressed', String(seguroModo === 'auto'));
    $('seguro-manual').setAttribute('aria-pressed', String(seguroModo === 'manual'));
    $('seguro-manual-box').hidden = seguroModo !== 'manual';
    actualizarTcRows();
  }

  function sincronizarToggleRecupera() {
    $('recupera-si').setAttribute('aria-pressed', String(recuperaIgv));
    $('recupera-no').setAttribute('aria-pressed', String(!recuperaIgv));
  }

  function cargarEjemplo() {
    $('f_producto').value = lang === 'es' ? 'Audífonos inalámbricos' : 'Wireless earbuds';
    $('f_pais').value = 'China';
    $('f_cantidad').value = '100';
    $('f_precio').value = '5';
    $('f_moneda').value = 'USD';
    $('f_flete').value = '150';
    $('f_moneda_flete').value = 'USD';
    $('f_adv').value = '0';
    $('f_adv_custom').value = '';
    $('f_adv_custom').hidden = true;
    $('f_isc').value = '0';
    $('f_margen').value = '30';
    actualizarTcRows();
    recalc();
  }

  function borrarTodo() {
    if (!confirm(t('confirmarBorrar'))) return;
    $('form').reset();
    $('f_margen').value = '30';
    $('f_isc').value = '0';
    $('f_moneda').value = $('f_moneda_flete').value = $('f_moneda_seguro').value = 'USD';
    $('f_adv_custom').hidden = true;
    seguroModo = 'auto'; recuperaIgv = true;
    Object.keys(fxUsuario).forEach(k => delete fxUsuario[k]);
    sincronizarToggleSeguro(); sincronizarToggleRecupera();
    actualizarTcRows(); recalc();
  }

  /* ── Tooltips «?» ── */
  const pop = () => $('tooltip-pop');
  function cerrarTooltip() {
    pop().hidden = true;
    document.querySelectorAll('.ayuda[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function abrirTooltip(btn) {
    const key = btn.dataset.help;
    const p = pop();
    if (!btn.matches('[aria-expanded="true"]')) {
      cerrarTooltip();
      p.textContent = t('help')[key] || '';
      p.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const rc = btn.getBoundingClientRect();
      const pw = Math.min(300, window.innerWidth - 32);
      p.style.maxWidth = pw + 'px';
      let x = rc.left + rc.width / 2 - p.offsetWidth / 2;
      x = Math.max(16, Math.min(x, window.innerWidth - p.offsetWidth - 16));
      let y = rc.bottom + 8;
      if (y + p.offsetHeight > window.innerHeight - 16) y = rc.top - p.offsetHeight - 8;
      p.style.left = (x + window.scrollX) + 'px';
      p.style.top = (y + window.scrollY) + 'px';
    } else cerrarTooltip();
  }

  /* ── Eventos ── */
  function enlazarEventos() {
    // Recalcular al escribir
    document.querySelectorAll('#form input, #form select').forEach(el => {
      el.addEventListener('input', recalc);
      el.addEventListener('change', recalc);
    });

    // Monedas → mostrar/ocultar tipo de cambio y prefijo
    tcRows.forEach(({ select }) => {
      $(select).addEventListener('change', actualizarTcRows);
    });

    // Tipos de cambio editados se recuerdan por moneda
    tcRows.forEach(({ select, input }) => {
      $(input).addEventListener('input', () => {
        fxUsuario[$(select).value] = parseNumero($(input).value);
      });
    });

    // Separador de miles al salir del campo
    Object.entries(CAMPOS_DINERO).forEach(([id, dec]) => {
      $(id).addEventListener('blur', () => {
        const n = parseNumero($(id).value);
        if (Number.isFinite(n)) $(id).value = fmtNum(n, dec);
      });
    });

    // Tema claro/oscuro (manual, persistente)
    $('btn-tema').addEventListener('click', () => {
      tema = tema === 'oscuro' ? 'claro' : 'oscuro';
      store('setPrefs', Object.assign(store('getPrefs'), { lang, modo, tema }));
      aplicarTema();
    });

    // Ad valorem personalizado
    $('f_adv').addEventListener('change', () => {
      $('f_adv_custom').hidden = $('f_adv').value !== 'custom';
      recalc();
    });

    // Toggles
    $('seguro-auto').addEventListener('click', () => { seguroModo = 'auto'; sincronizarToggleSeguro(); recalc(); });
    $('seguro-manual').addEventListener('click', () => { seguroModo = 'manual'; sincronizarToggleSeguro(); recalc(); });
    $('recupera-si').addEventListener('click', () => { recuperaIgv = true; sincronizarToggleRecupera(); recalc(); });
    $('recupera-no').addEventListener('click', () => { recuperaIgv = false; sincronizarToggleRecupera(); recalc(); });

    $('lang-es').addEventListener('click', () => { lang = 'es'; store('setPrefs', Object.assign(store('getPrefs'), { lang, modo })); aplicarIdioma(); });
    $('lang-en').addEventListener('click', () => { lang = 'en'; store('setPrefs', Object.assign(store('getPrefs'), { lang, modo })); aplicarIdioma(); });
    $('modo-simple').addEventListener('click', () => { modo = 'simple'; store('setPrefs', Object.assign(store('getPrefs'), { lang, modo })); aplicarModo(); });
    $('modo-avanzado').addEventListener('click', () => { modo = 'avanzado'; store('setPrefs', Object.assign(store('getPrefs'), { lang, modo })); aplicarModo(); });

    // Ayudas
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ayuda');
      if (btn) { abrirTooltip(btn); return; }
      if (!e.target.closest('.tooltip')) cerrarTooltip();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarTooltip(); });

    // Acciones
    $('btn-ejemplo').addEventListener('click', cargarEjemplo);
    $('btn-ejemplo-2').addEventListener('click', cargarEjemplo);
    $('btn-borrar').addEventListener('click', borrarTodo);
    $('btn-copiar').addEventListener('click', async () => {
      const texto = resumenTexto();
      try {
        await navigator.clipboard.writeText(texto);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = texto; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      flashBoton('btn-copiar', t('btnCopiado'));
    });
    $('btn-imprimir').addEventListener('click', () => window.print());
    $('btn-guardar').addEventListener('click', guardarCalculo);
    $('btn-miscalculos').addEventListener('click', () => {
      const card = $('guardados-card');
      card.hidden = !card.hidden;
      $('btn-miscalculos').setAttribute('aria-expanded', String(!card.hidden));
      renderGuardados();
    });
    $('btn-ver-resultado').addEventListener('click', () => {
      $('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Abrir los <details> al imprimir
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('.detalle').forEach(d => d.setAttribute('open', ''));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
