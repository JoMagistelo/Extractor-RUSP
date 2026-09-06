# Política de seguridad

## Alcance

RUSP Extractor Institucional procesa hojas de cálculo que pueden contener datos personales, identificadores, historial laboral y remuneraciones. El código del repositorio es solo una parte del control de seguridad y no sustituye los controles institucionales de identidad, equipos, redes, almacenamiento, monitoreo, respaldo, continuidad ni respuesta a incidentes.

## Datos que no deben versionarse

No deben incorporarse al repositorio, issues, revisiones, commits o artefactos públicos:

- archivos RUSP reales;
- RFC, CURP, nombres, números de empleado u otros identificadores asociados a personas reales;
- historiales laborales o remuneraciones identificables;
- credenciales, tokens, certificados, llaves privadas o secretos;
- configuraciones productivas, rutas internas o direcciones de infraestructura;
- capturas o logs que revelen datos personales.

Las pruebas con datos reales deben realizarse únicamente en entornos y equipos autorizados por la institución.

## Tratamiento local

La lógica de lectura, depuración, homologación, salida institucional y copiado a Excel trabaja sobre los datos cargados en la aplicación. Ninguna mejora funcional debe introducir transmisión de datos a servicios externos sin revisión técnica, jurídica y de seguridad previa.

## Dependencias

Toda dependencia nueva debe justificarse por necesidad funcional, mantenimiento, licencia y riesgo. Debe evitarse incorporar librerías o servicios que no tengan uso efectivo en el producto.

Antes de producción, TIC deberá validar el mecanismo de obtención y actualización de dependencias, así como la operación del instalador en el entorno institucional autorizado.

## Portapapeles y Excel

La función **Copiar tabla para Excel** copia únicamente las ocho columnas institucionales solicitadas. Los valores se serializan como texto tabulado y se neutralizan prefijos que podrían interpretarse como fórmulas de Excel, reduciendo el riesgo de inyección de fórmulas al pegar datos derivados de una fuente no confiable.

El portapapeles del sistema operativo debe considerarse un canal temporal con datos potencialmente personales. El usuario debe pegar la información únicamente en documentos institucionales autorizados y evitar conservarla innecesariamente.

## Reporte de vulnerabilidades

No publicar detalles explotables ni información real. Ante un posible incidente:

1. limitar la difusión de detalles;
2. conservar evidencia mínima necesaria;
3. notificar mediante el canal institucional definido por TIC/SABG;
4. identificar datos y activos potencialmente afectados;
5. corregir mediante un cambio trazable y revisado;
6. validar la corrección antes de liberar una nueva versión;
7. evaluar si corresponde activar el procedimiento institucional de vulneración de datos personales.

## Producción

La aprobación de un pull request o la generación exitosa de un ejecutable no constituyen por sí mismas autorización de producción. Cualquier despliegue, integración con otros sistemas o distribución institucional requiere la revisión y controles que determinen las áreas competentes.
