// smoke.js — DOM mínimo para ejecutar app.js en Node y verificar
// que init() + recalc() producen los resultados esperados.
'use strict';
const fs = require('fs');

const VOID = new Set(['input', 'meta', 'link', 'br', 'path', 'img', 'hr', 'option']);

class El {
  constructor(tag, attrs) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs || {};
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.style = {};
    this._classes = new Set((this.attrs.class || '').split(/\s+/).filter(Boolean));
    this.dataset = {};
    for (const k of Object.keys(this.attrs)) {
      if (k.startsWith('data-')) {
        const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = this.attrs[k];
      }
    }
    this._textContent = '';
    this._innerHTML = '';
    this._value = this.attrs.value || '';
    this.placeholder = '';
    this.hidden = 'hidden' in this.attrs;
    this.offsetParent = this.hidden ? null : this;
  }
  get id() { return this.attrs.id || ''; }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._classes;
    return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
      toggle: (c, f) => { (f === undefined ? !s.has(c) : f) ? s.add(c) : s.delete(c); }, contains: c => s.has(c) };
  }
  get value() { return this._value; }
  set value(v) { this._value = v; }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  remove() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent(e) { e.target = e.target || this; (this.listeners[e.type] || []).forEach(fn => fn(e)); }
  _fire(t) { this.dispatchEvent({ type: t, bubbles: true, target: this }); }
  matches(sel) { return matchSel(this, sel); }
  closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parent; } return null; }
  querySelector(sel) { return walk(this).find(el => matchSel(el, sel)) || null; }
  querySelectorAll(sel) { return walk(this).filter(el => matchSel(el, sel)); }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
}

function walk(root) {
  const out = [];
  (function rec(el) { for (const c of el.children) { out.push(c); rec(c); } })(root);
  return out;
}

function matchSel(el, sel) {
  if (sel === '[data-i18n]') return 'data-i18n' in el.attrs;
  if (sel === '[data-i18n-ph]') return 'data-i18n-ph' in el.attrs;
  if (sel === 'input.invalido') return el.tagName === 'INPUT' && el._classes.has('invalido');
  if (sel === '.ayuda[aria-expanded="true"]') return el._classes.has('ayuda') && el.attrs['aria-expanded'] === 'true';
  if (sel === '.ayuda') return el._classes.has('ayuda');
  if (sel === '.tooltip') return el._classes.has('tooltip');
  if (sel === '.detalle') return el._classes.has('detalle');
  if (sel === '.tc-label') return el._classes.has('tc-label');
  if (sel === '.tc-nota') return el._classes.has('tc-nota');
  if (sel === '#form input, #form select') {
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return false;
    let n = el.parent; while (n) { if (n.attrs.id === 'form') return true; n = n.parent; }
    return false;
  }
  return false;
}

// Parsear index.html en un árbol de El
function parseHtml(src) {
  const root = new El('document', {});
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z0-9]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[2]) continue;
    if (m[1]) { // cierre
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === m[2].toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([\w-]+)(?:\s*=\s*"([^"]*)")?/g;
    let am;
    while ((am = attrRe.exec(m[3]))) attrs[am[1].toLowerCase()] = am[2] != null ? am[2] : '';
    const el = new El(m[2], attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(m[2].toLowerCase())) stack.push(el);
  }
  return root;
}

const root = parseHtml(fs.readFileSync('index.html', 'utf8'));
const byId = {};
walk(root).forEach(el => { if (el.id) byId[el.id] = el; });
const body = walk(root).find(el => el.tagName === 'BODY');
const htmlEl = walk(root).find(el => el.tagName === 'HTML');

const domListeners = {};
global.document = {
  documentElement: htmlEl, body, title: '',
  getElementById: id => byId[id] || null,
  createElement: tag => new El(tag, {}),
  createTextNode: txt => { const e = new El('#text', {}); e._textContent = String(txt); return e; },
  querySelectorAll: sel => walk(root).filter(el => matchSel(el, sel)),
  addEventListener: (t, fn) => (domListeners[t] = domListeners[t] || []).push(fn),
  execCommand: () => {}
};
const lsMap = new Map();
global.localStorage = {
  getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: k => lsMap.delete(k)
};
global.window = { addEventListener: () => {}, innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0, print: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
global.confirm = () => true;
// fetch falso: las APIs externas devuelven datos controlados; lo demás lee disco.
// apis.net.pe trae fecha; er-api NO trae time_last_update_utc a propósito
// para verificar el caso "fecha no informada".
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('apis.net.pe')) {
    return { ok: true, json: async () => ({ compra: 3.44, venta: 3.45, fecha: '2026-10-22' }) };
  }
  if (u.includes('er-api')) {
    return { ok: true, json: async () => ({ rates: { PEN: 3.45, EUR: 0.85, CNY: 7.1 } }) };
  }
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) };
};
global.getComputedStyle = () => ({ backgroundColor: 'rgb(0,0,0)' });

global.Calc = require('../calc.js');
global.I18N = require('../i18n.js');
require('../app.js');

(async () => {
  (domListeners['DOMContentLoaded'] || []).forEach(fn => fn());
  await new Promise(r => setTimeout(r, 50)); // dejar correr init() con fetch

  const $ = id => byId[id];
  const set = (id, v) => { $(id).value = v; $(id)._fire('input'); };
  const check = (cond, msg) => { if (!cond) throw new Error('SMOKE FALLÓ: ' + msg); console.log('  ✓', msg); };

  // — Tipo de cambio automático: fecha de la API (no del navegador) —
  const tcInfo = $('tc-auto-info').textContent;
  check(tcInfo.includes('2026-10-22'), 'USD muestra la fecha que devolvió la API (2026-10-22)');
  check(tcInfo.includes('EUR') && tcInfo.includes('CNY'), 'EUR y CNY se cargan desde la misma fuente');
  check(tcInfo.includes('open.er-api.com'), 'EUR/CNY indican su fuente (open.er-api.com)');
  check(tcInfo.includes('fecha no informada'), 'er-api sin fecha → "fecha no informada" (nunca la del navegador)');
  $('f_moneda').value = 'USD'; $('f_moneda')._fire('change'); // el stub no elige la 1.ª opción
  const notaFob = $('tc-row-fob').querySelector('.tc-nota').textContent;
  check(notaFob.includes('apis.net.pe') && notaFob.includes('2026-10-22'),
    'la fila del TC muestra fuente y fecha por campo');
  check(!$('tc-row-fob').classList.contains('pendiente'), 'USD cargado → fila sin marca "pendiente"');

  // — Estado vacío —
  console.log('vacio visible:', !$('estado-vacio').hidden, '| marca:', $('resultados') && $('estado-vacio').hidden === false);
  console.log('aviso:', $('aviso-texto').textContent.slice(0, 60));

  // — Cargar ejemplo (100 audífonos USD 5, flete USD 150, adv 0%, margen 30%) —
  byId['btn-ejemplo']._fire('click');
  console.log('costo/unidad:', $('r_costo').textContent, '| esperado ~S/ 24.56');
  console.log('precio sug.:', $('r_precio').textContent, '| esperado ~S/ 35.09');
  console.log('desembolso:', $('r_desembolso').textContent);
  console.log('pasos:', $('lista-pasos').children.length, '| leyenda:', $('leyenda').children.length);

  // — Caso B: CIF S/ 1,000, adv 6% —
  set('f_cantidad', '1'); set('f_precio', '1000'); set('f_moneda', 'PEN');
  set('f_flete', '0'); $('f_adv').value = '6'; $('f_adv')._fire('change');
  console.log('caso B → costo:', $('r_costo').textContent, '(IGV/IPM recuperables, costo = CIF+adv = S/ 1,060.00)');

  // — Modo avanzado —
  byId['modo-avanzado']._fire('click');
  console.log('modo avanzado:', document.body.classList.contains('modo-avanzado'),
    '| escenarios filas:', $('tabla-esc').children.length, '| adv opciones:', $('f_adv').options.length);

  // — Inglés —
  byId['lang-en']._fire('click');
  console.log('EN costo label segue?:', $('r_costo').textContent);

  // — Errores: cantidad 0 —
  set('f_cantidad', '0');
  console.log('errores visibles:', !$('estado-errores').hidden, '| n°:', $('lista-errores').children.length);
  console.log('SMOKE OK');
})().catch(e => { console.error('FALLO:', e); process.exit(1); });
