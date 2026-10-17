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

Los tests cubren los casos de ad valorem, IGV+IPM, ISC, percepción
(porcentaje y monto fijo), conversión de monedas, escenarios de tipo de
cambio y validaciones de entrada.

## Actualizar tasas y tipos de cambio

Edite `config/tasas.json` (texto plano, sin tocar código):

- `igv`, `ipm`: tasas del IGV e IPM (fracciones: 0.16 = 16%).
- `ad_valorem_opciones` / `ad_valorem_opciones_simple`: niveles del arancel.
- `percepcion_opciones` y `percepcion_default`.
- `seguro_default`: porcentaje del FOB usado como seguro automático.
- `tipo_cambio_referencial`: valores que precargan los campos de tipo de
  cambio (el usuario siempre puede editarlos en la página).
- `vigente_a_fecha` y `fuente`: fecha y origen que se muestran en el aviso.
- `sunat_arancel_url`: enlace al buscador arancelario.

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
config/tasas.json tasas y tipos de cambio editables
test/calc.test.js pruebas con el runner nativo de Node
```

## Aviso

Herramienta de estimación. No constituye asesoría aduanera, contable ni
tributaria. Los resultados dependen de las tasas y datos ingresados.
