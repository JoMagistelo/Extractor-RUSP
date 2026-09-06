# RUSP Extractor Institucional

Aplicación de escritorio para depurar exportaciones RUSP, homologar periodos laborales y preparar una salida institucional de altas y bajas para revisión y uso en hojas de cálculo.

## Alcance funcional

La aplicación conserva el flujo actual de carga, depuración, edición, homologación y descarga del RUSP simplificado. Sobre ese flujo agrega una salida institucional independiente con las columnas:

`Sector | Emp-Inst | Puesto | F-Ini | F-Fin | Sueldo | Fuente(s) | Observaciones`

La salida se construye a partir del conjunto activo (original o ajustado) y puede copiarse directamente al portapapeles en formato tabulado para pegarse en Excel desde la celda seleccionada.

## Reglas de altas y bajas

- La identificación de un periodo considera a la persona y su combinación de institución/puesto.
- La persona se identifica, cuando está disponible, por RFC, CURP, número de empleado o nombre.
- La homologación por UR sigue siendo opcional.
- Las altas de la salida institucional se normalizan a día 16.
- Cuando existe un periodo siguiente de la misma persona, la baja anterior se fija al día inmediatamente previo; por diseño queda en día 15.
- Si no existe una baja posterior, la salida muestra `A la fecha`.
- El sueldo utilizado corresponde a `Sueldo + Compensación` y se conserva como valor numérico para facilitar el pegado en Excel.

## Uso

1. Abrir la aplicación.
2. Seleccionar o arrastrar el archivo Excel exportado desde RUSP.
3. Revisar el RUSP simplificado.
4. Si es necesario, editar Institución, Puesto y UR y guardar la homologación.
5. Revisar la tarjeta **Salida institucional · Altas y bajas**.
6. Usar **Copiar tabla para Excel** y pegar con `Ctrl+V` en la primera celda de la tabla destino.

El copiado incluye únicamente las ocho columnas institucionales y no incluye encabezados.

## Empaquetado

El proyecto mantiene su empaquetado Electron actual. Los comandos definidos en `package.json` siguen siendo la fuente de referencia para desarrollo y construcción del instalador.

Antes de una liberación institucional debe validarse el instalador en un equipo limpio y comprobarse, como mínimo:

- apertura y cierre de la aplicación;
- lectura de `.xlsx` y `.xls` autorizados;
- edición y homologación;
- descarga del RUSP simplificado;
- salida institucional y copiado a Excel;
- icono, nombre de producto y rutas de instalación;
- ausencia de datos reales en el artefacto distribuido.

## Seguridad y datos personales

Los archivos RUSP pueden contener datos personales, laborales y patrimoniales. El repositorio y sus artefactos no deben incluir archivos reales, RFC, CURP, remuneraciones asociadas a personas identificables, credenciales ni configuraciones productivas.

La aplicación está diseñada para procesar el archivo localmente. La autorización para su instalación, operación o eventual integración con otros sistemas corresponde a las áreas institucionales competentes.

Este proyecto se alinea, como criterio de diseño y gestión, con las obligaciones aplicables de protección de datos personales de sujetos obligados y con las políticas de ciberseguridad de la Administración Pública Federal. Esa alineación técnica no sustituye la revisión jurídica, de seguridad, arquitectura, infraestructura y liberación que corresponda a TIC.

## Estructura principal

- `index.html`: interfaz de escritorio.
- `css/`: estilos base e identidad institucional.
- `js/app.js`: flujo principal de la aplicación.
- `js/modules/excelProcessor.js`: lectura, depuración, homologación y exportación.
- `js/modules/institutionalOutput.js`: construcción de la salida de altas/bajas y TSV para Excel.
- `js/institutionalActions.js`: vista previa y copiado al portapapeles.
- `main.cjs`: proceso principal de Electron.
- `tests/`: pruebas de reglas institucionales nuevas.

## Principio de cambios

Las mejoras de presentación y salida institucional no deben alterar de forma innecesaria la extracción o las reglas existentes. Cualquier cambio futuro a la lógica de periodos debe acompañarse de pruebas de regresión y validación con datos de prueba autorizados.
