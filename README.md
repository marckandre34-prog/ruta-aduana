# Ruta Aduana

Calculadora de costos de importación para Perú, pensada para pequeños
importadores y emprendedores. Sitio 100% estático: sin frameworks, sin
build, sin backend y sin claves.

## Abrir la página

- **Doble clic**: abra `index.html` en su navegador (funciona sin servidor;
  si `config/tasas.json` no se puede leer se usan valores por defecto).
- **Con servidor** (recomendado):
  ```bash
  npx serve .
  # o
  py -m http.server 8000
  ```
  y abra http://localhost:8000

## Ejecutar los tests

Requiere Node.js 18+:

```bash
node --test
```

Los tests cubren: ad valorem, IGV+IPM, ISC, derechos antidumping,
percepción (porcentaje y monto fijo), conversión de monedas, escenarios
de tipo de cambio (±3 % y más), separación costo real vs. desembolso en
aduana, validaciones de entrada y la regla de redondeo.

## Regla de redondeo

Única y documentada: **se calcula con precisión completa y se redondea a
2 decimales (céntimos) solo al mostrar**. Ningún resultado intermedio se
redondea. `Calc.round2` es el único helper de redondeo y solo lo usa la
capa de interfaz (y los tests para comparar).

## Reglas de cálculo y fuentes oficiales

- **CIF** = FOB + flete + seguro (valor en aduana, Acuerdo del Valor OMC).
- **Ad valorem** = CIF × tasa de la subpartida (0 %, 4 %, 6 % u 11 % —
  Arancel de Aduanas SUNAT, aduanet.gob.pe/aduanas/informag/tribadua.htm).
- **ISC** = (CIF + ad valorem) × tasa, solo para bienes del Apéndice IV.
- **Base IGV/IPM** = CIF + ad valorem + ISC + derechos antidumping
  (TUO Ley del IGV, D.S. 055-99-EF, art. 13° inc. e).
- **IGV** 16 % + **IPM** 2 % sobre esa base.
- **Percepción** = tasa × (valor en aduana + **todos** los tributos +
  derechos antidumping/compensatorios) — R.S. N° 203-2003/SUNAT.
  Tasas: 3.5 % general, 5 % bienes usados, 10 % sin RUC/no domiciliado.
- **Costo real** = FOB + flete + seguro + aranceles + gastos locales
  (+ IGV/IPM solo si NO se recuperan con RUC). La percepción nunca entra
  al costo; se muestra aparte.
- **Desembolso en aduana** = tributos + percepción (lo que se paga para
  nacionalizar; incluye lo recuperable con RUC).

## Actualizar tasas y tipos de cambio

Edite `config/rates.json` (texto plano, sin tocar código). Cada tasa
lleva su `valor`, `vigente_desde` y `fuente` oficial citada:

- `igv`, `ipm`: fracciones (0.16 = 16 %).
- `ad_valorem.opciones`, `percepcion.opciones` y `percepcion.defecto`.
- `seguro_default`, `isc_default`.
- `gastos_locales_default`: montos estimados en soles (referenciales).
- `tipo_cambio`: valores que precargan los campos (editables en la página).
- `escenarios_tipo_cambio`: sensibilidad que se muestra (±3 %, +5 %, +10 %).
- `vigente_a_fecha`, `fuente_general`, `sunat_arancel_url`.

**Tipo de cambio automático**: al cargar, la página intenta obtener el
TC USD del día (primero `api.apis.net.pe`, que refleja el valor SUNAT;
luego `open.er-api.com` como referencial). Muestra valor, fuente y fecha,
y siempre se puede editar a mano. Nota: SUNAT no habilita CORS, así que
la fuente 100 % oficial requeriría un pequeño proxy — previsto cuando el
producto tenga backend.

**Importante**: las tasas son referenciales. Verifique la subpartida del
producto y las tasas vigentes en SUNAT antes de decidir.

## Publicar gratis

**GitHub Pages**

```bash
git remote add origin https://github.com/<usuario>/ruta-aduana.git
git push -u origin main
```

Luego en el repo: *Settings → Pages → Deploy from branch → main / (root)*.

**Netlify**: arrastre la carpeta del proyecto a https://app.netlify.com/drop
y quedará publicada al instante.

## Estructura

```
index.html        estructura de la página
styles.css        estilos (estética Japandi, modo oscuro, impresión)
app.js            interfaz: lee el formulario y pinta resultados
calc.js           lógica pura de cálculo (sin DOM, testeable en Node)
i18n.js           textos en español e inglés
config/rates.json tasas con valor, vigencia y fuente oficial
test/calc.test.js pruebas con el runner nativo de Node
test/smoke.js     prueba de humo de la interfaz (DOM simulado)
```

## Aviso

Herramienta de estimación. No constituye asesoría aduanera, contable ni
tributaria. Los resultados dependen de las tasas y datos ingresados.
