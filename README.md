# RUSP Extractor Institucional

Aplicación de escritorio para integrar y revisar trayectoria laboral a partir de exportaciones RUSP y Constancias de Semanas Cotizadas del IMSS, y preparar una salida institucional de altas y bajas lista para copiar a Excel.

## Fuentes admitidas

La aplicación reconoce automáticamente dos tipos de archivo:

- **RUSP:** Excel `.xlsx` o `.xls` con la estructura institucional esperada.
- **IMSS:** Constancia de Semanas Cotizadas en PDF, validada por contenido antes de procesarse.

Puede trabajarse con:

- solo un RUSP;
- solo una constancia IMSS;
- un RUSP y una constancia IMSS al mismo tiempo.

Se admite como máximo una fuente de cada tipo por carga. Si se seleccionan ambas, la salida institucional integra las dos trayectorias en una sola tabla.

## Salida institucional

La salida final conserva exactamente este orden:

`Sector | Emp-Inst | Puesto | F-Ini | F-Fin | Sueldo | Fuente(s) | Observaciones`

Puede copiarse al portapapeles en formato tabulado para pegarse directamente en Excel desde la celda seleccionada, sin encabezados.

### Mapeo RUSP

- `Sector`: Público cuando existe empleo institucional.
- `Emp-Inst`: institución.
- `Puesto`: puesto homologado.
- `F-Ini`: fecha sugerida de inicio.
- `F-Fin`: fecha sugerida de término o `A la fecha`.
- `Sueldo`: Sueldo + Compensación.
- `Fuente(s)`: RUSP.
- `Observaciones`: periodos de inactividad detectables y otras notas aplicables.

Las altas RUSP se normalizan al día 16 y las bajas al día 15. La lógica conserva la separación por persona, revisa el orden temporal y evita mezclar trayectorias de personas distintas.

### Mapeo IMSS

La Constancia de Semanas Cotizadas reporta patrón, registro patronal, entidad, fecha de alta, fecha de baja y Salario Base de Cotización (SBC), pero **no reporta puesto ni permite determinar de forma segura el sector**.

Por ello, el mapeo IMSS es deliberadamente directo y conservador:

- `Sector`: vacío; no se infiere.
- `Emp-Inst`: Nombre del patrón.
- `Puesto`: vacío; la constancia no lo reporta.
- `F-Ini`: Fecha de alta IMSS, sin redondeo.
- `F-Fin`: Fecha de baja IMSS o `A la fecha` cuando está vigente.
- `Sueldo`: SBC reportado, conservado como valor numérico y sin convertirlo a sueldo mensual.
- `Fuente(s)`: IMSS.
- `Observaciones`: registro patronal, entidad y aclaración sobre puesto/sector/SBC.

Cuando RUSP e IMSS están cargados, sus filas se combinan cronológicamente por fecha de inicio en la tabla institucional. No se deduplican ni se fusionan empleos entre fuentes de manera automática, para no crear equivalencias no demostradas.

## Flujo de uso

1. Abrir la aplicación.
2. Seleccionar o arrastrar un Excel RUSP, una constancia IMSS PDF o ambos.
3. La aplicación reconoce automáticamente cada fuente.
4. Si existe RUSP, revisar la vista RUSP y, si es necesario, editar Institución, Puesto y UR.
5. Si existe IMSS, revisar la tarjeta **Trayectoria IMSS · Altas y bajas**.
6. Revisar la tarjeta **Salida institucional · Altas y bajas**.
7. Usar **Copiar tabla para Excel** y pegar con `Ctrl+V` en la primera celda de la tabla destino.

## Empaquetado

El proyecto mantiene su empaquetado Electron. Los comandos de referencia son:

```powershell
npm test
npm run electron:start
npm run electron:build
```

Antes de una liberación institucional debe validarse el instalador en un equipo limpio y comprobarse, como mínimo:

- apertura y cierre de la aplicación;
- lectura de `.xlsx` y `.xls` RUSP autorizados;
- lectura de Constancias IMSS PDF autorizadas;
- reconocimiento automático de fuente;
- carga individual y carga conjunta RUSP + IMSS;
- edición y homologación RUSP;
- salida institucional combinada y copiado a Excel;
- icono, nombre de producto y rutas de instalación;
- ausencia de datos reales en el artefacto distribuido.

## Seguridad y datos personales

Los archivos RUSP y las constancias IMSS pueden contener datos personales, identificadores, historial laboral y remuneraciones o bases de cotización. El repositorio y sus artefactos no deben incluir archivos reales, RFC, CURP, NSS, remuneraciones asociadas a personas identificables, credenciales ni configuraciones productivas.

El procesamiento de los archivos se realiza en la aplicación cliente. La autorización para instalación, operación o integración con otros sistemas corresponde a las áreas institucionales competentes.

La interfaz actual conserva dependencias web heredadas para SheetJS y PDF.js. Antes de una liberación completamente offline conviene vendorizarlas dentro del instalador y eliminar la dependencia de CDN.

## Estructura principal

- `index.html`: interfaz de escritorio y carga de fuentes.
- `css/`: estilos base, identidad institucional e integración IMSS.
- `js/app.js`: orquestación RUSP/IMSS y reconocimiento por tipo/contenido.
- `js/modules/excelProcessor.js`: lectura, depuración, homologación y exportación RUSP.
- `js/modules/imssIntegration.js`: lectura PDF, validación, parser IMSS y mapeo a salida institucional.
- `js/modules/institutionalOutput.js`: construcción de altas/bajas RUSP y TSV para Excel.
- `js/institutionalActions.js`: combinación de fuentes, vista previa y copiado al portapapeles.
- `main.cjs`: proceso principal de Electron.
- `tests/`: pruebas de reglas RUSP e integración IMSS.

## Principio de cambios

La integración de nuevas fuentes no debe alterar innecesariamente la extracción ya validada. Los datos ausentes en una fuente no se inventan: se dejan vacíos y se explican en observaciones cuando sea necesario.
