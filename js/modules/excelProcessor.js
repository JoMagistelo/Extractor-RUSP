/**
 * Módulo ExcelProcessor
 * Encargado de leer, depurar, procesar y exportar archivos Excel utilizando SheetJS (XLSX).
 */

import { calculateDate, calculateSuggestedDate } from './dateCalculator.js';

/**
 * Obtiene la referencia a la librería SheetJS (XLSX).
 * Compatible tanto con navegadores web tradicionales como con entornos Electron (Node.js).
 */
function getXLSX() {
    if (typeof window !== 'undefined' && window.XLSX && typeof window.XLSX.read === 'function') {
        return window.XLSX;
    }
    if (typeof globalThis !== 'undefined' && globalThis.XLSX && typeof globalThis.XLSX.read === 'function') {
        return globalThis.XLSX;
    }
    if (typeof module !== 'undefined' && module.exports && typeof module.exports.read === 'function') {
        return module.exports;
    }
    if (typeof window !== 'undefined' && window.module && window.module.exports && typeof window.module.exports.read === 'function') {
        return window.module.exports;
    }
    throw new Error('La librería SheetJS (XLSX) no está disponible. Verifica la carga del script.');
}

/**
 * Convierte un valor de fecha (que puede ser un número serial de Excel ej. 42370,
 * un objeto Date, o una cadena de texto) a formato DD/MM/YYYY.
 * @param {any} val 
 * @returns {string} Fecha formateada o cadena vacía/original si no es fecha.
 */
function formatExcelDate(val) {
    if (val === null || val === undefined || val === '') return '';
    
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        const day = String(val.getDate()).padStart(2, '0');
        const month = String(val.getMonth() + 1).padStart(2, '0');
        const year = val.getFullYear();
        return `${day}/${month}/${year}`;
    }

    const strVal = String(val).trim();

    // Si ya tiene formato de fecha con guiones o diagonales (ej. 2020-05-15 o 15/05/2020)
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(strVal)) {
        const parts = strVal.split(/[-/]/);
        const year = parts[0];
        const month = parts[1].padStart(2, '0');
        const day = parts[2].padStart(2, '0');
        return `${day}/${month}/${year}`;
    }

    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(strVal)) {
        const parts = strVal.split(/[-/]/);
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${day}/${month}/${year}`;
    }

    // Si es un número o cadena numérica (serial de Excel ej. 42370)
    const num = Number(strVal);
    if (!isNaN(num) && num > 1000 && num < 100000) {
        let XLSXLib = null;
        try { XLSXLib = getXLSX(); } catch (e) {}
        if (XLSXLib && XLSXLib.SSF && XLSXLib.SSF.parse_date_code) {
            try {
                const parsed = XLSXLib.SSF.parse_date_code(num);
                if (parsed && parsed.y && parsed.m && parsed.d) {
                    const day = String(parsed.d).padStart(2, '0');
                    const month = String(parsed.m).padStart(2, '0');
                    const year = parsed.y;
                    return `${day}/${month}/${year}`;
                }
            } catch (e) {
                // Ignore error, fallback
            }
        }
        // Fallback matemático para fechas de Excel
        const dateObj = new Date(Math.round((num - 25569) * 86400 * 1000));
        if (!isNaN(dateObj.getTime())) {
            const day = String(dateObj.getUTCDate()).padStart(2, '0');
            const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
            const year = dateObj.getUTCFullYear();
            return `${day}/${month}/${year}`;
        }
    }

    return strVal;
}

/**
 * Normaliza nombres de encabezados para búsquedas flexibles sin distinguir mayúsculas, acentos o espacios.
 * @param {string} str 
 * @returns {string}
 */

function normalizeHeader(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * Procesa el buffer del archivo Excel.
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {Object} Resultado con datos depurados, finales, estadísticas y errores.
 */
export function processExcelData(arrayBuffer) {
    const XLSX = getXLSX();
    // 1. Leer libro Excel
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convertir a Arreglo de Arreglos (AOA)
    const rawMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (!rawMatrix || rawMatrix.length === 0) {
        throw new Error('El archivo Excel está completamente vacío.');
    }

    // PASO 1: Encontrar la fila del encabezado real buscando coincidencia de nombres de columna requeridos
    const targetGroups = [
        ['sueldo_base_tab', 'sueldobasetab', 'sueldo_base', 'sueldo'],
        ['compensacion_garantizada', 'compensaciongarantizada', 'compensacion'],
        ['institucion', 'nombre_institucion', 'entidad', 'inst'],
        ['nombre_puesto', 'nombrepuesto', 'puesto'],
        ['anio', 'ano', 'year'],
        ['mes', 'month'],
        ['quincena', 'fortnight'],
        ['curp'],
        ['rfc'],
        ['num_empleado', 'numero_empleado']
    ];

    let headerRowIndex = -1;
    let maxMatches = -1;

    for (let i = 0; i < Math.min(rawMatrix.length, 50); i++) {
        const row = rawMatrix[i];
        if (!row || !Array.isArray(row)) continue;
        const normalizedCells = row.map(cell => normalizeHeader(cell));

        let matchCount = 0;
        for (const group of targetGroups) {
            if (normalizedCells.some(cell => group.includes(cell))) {
                matchCount++;
            }
        }

        if (matchCount > maxMatches && matchCount > 0) {
            maxMatches = matchCount;
            headerRowIndex = i;
        }
    }

    // Fallback: Si no se detectó por nombres clave, tomar la primera fila no vacía
    if (headerRowIndex === -1) {
        for (let i = 0; i < rawMatrix.length; i++) {
            const row = rawMatrix[i];
            const isNonEmpty = row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
            if (isNonEmpty) {
                headerRowIndex = i;
                break;
            }
        }
    }

    if (headerRowIndex === -1) {
        throw new Error('No se encontraron filas con datos válidos en la hoja de cálculo.');
    }

    const headers = rawMatrix[headerRowIndex].map(h => String(h || '').trim());
    const dataRows = rawMatrix.slice(headerRowIndex + 1).filter(row => {
        // Filtrar filas completamente vacías en el cuerpo de datos
        return row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    });

    if (dataRows.length === 0) {
        throw new Error('No se encontraron filas de registro debajo del encabezado.');
    }

    // Mapear encabezados para encontrar las columnas requeridas
    const normalizedHeaders = headers.map(normalizeHeader);

    const findColIndex = (possibleNames) => {
        return normalizedHeaders.findIndex(h => possibleNames.includes(h));
    };

    const idxSueldo = findColIndex(['sueldo_base_tab', 'sueldobasetab', 'sueldo_base', 'sueldo']);
    const idxComp = findColIndex(['compensacion_garantizada', 'compensaciongarantizada', 'compensacion']);
    const idxInstitucion = findColIndex(['institucion', 'nombre_institucion', 'entidad', 'inst']);
    const idxNombrePuesto = findColIndex(['nombre_puesto', 'nombrepuesto', 'puesto']);
    const idxAnio = findColIndex(['anio', 'ano', 'year']);
    const idxMes = findColIndex(['mes', 'month']);
    const idxQuincena = findColIndex(['quincena', 'fortnight']);

    // Validar columnas faltantes
    const missing = [];
    if (idxSueldo === -1) missing.push('sueldo_base_tab');
    if (idxComp === -1) missing.push('compensacion_garantizada');
    if (idxInstitucion === -1) missing.push('Institucion');
    if (idxNombrePuesto === -1) missing.push('nombre_puesto');
    if (idxAnio === -1) missing.push('anio');
    if (idxMes === -1) missing.push('mes');
    if (idxQuincena === -1) missing.push('quincena');

    if (missing.length > 0) {
        throw new Error(`Faltan las siguientes columnas obligatorias en el archivo Excel: ${missing.join(', ')}`);
    }

    // Identificar y formatear automáticamente las columnas de fecha (fecha_ingreso_apf, fecha_ingreso_institucion, fecha_alta_ultimo_puesto, etc.)
    const dateColIndices = [];
    normalizedHeaders.forEach((nh, idx) => {
        if (nh.includes('fecha')) {
            dateColIndices.push(idx);
        }
    });

    if (dateColIndices.length > 0) {
        dataRows.forEach(row => {
            dateColIndices.forEach(idx => {
                if (row[idx] !== undefined && row[idx] !== null && row[idx] !== '') {
                    row[idx] = formatExcelDate(row[idx]);
                }
            });
        });
    }

    // PASO 2: Crear columna "Sueldo + Compensación"
    // Intentar columna AM (índice 38)
    const depuratedHeaders = [...headers];
    let colSueldoCompIdx = 38;

    if (depuratedHeaders[38] && depuratedHeaders[38].trim() !== '') {
        // Si la columna AM ya contiene información, agregar al final
        colSueldoCompIdx = depuratedHeaders.length;
        depuratedHeaders.push('Sueldo + Compensación');
    } else {
        // Rellenar espacios hasta la columna 38 si es necesario
        while (depuratedHeaders.length < 38) {
            depuratedHeaders.push('');
        }
        depuratedHeaders[38] = 'Sueldo + Compensación';
    }

    // Calcular "Sueldo + Compensación" para cada fila
    const rowsWithSueldoComp = dataRows.map(row => {
        const newRow = [...row];
        // Asegurar longitud suficiente de la fila
        while (newRow.length < depuratedHeaders.length) {
            newRow.push('');
        }

        const sueldoVal = parseFloat(String(row[idxSueldo] || '0').replace(/[^0-9.-]+/g, '')) || 0;
        const compVal = parseFloat(String(row[idxComp] || '0').replace(/[^0-9.-]+/g, '')) || 0;
        const total = sueldoVal + compVal;

        newRow[colSueldoCompIdx] = Number(total.toFixed(2));
        return newRow;
    });

    // PASO 3: Agrupación y depuración por clave única (Institucion + nombre_puesto)
    // El Excel viene ordenado por grupos consecutivos.
    // Conservar ÚNICAMENTE el primer y el último registro de cada bloque consecutivo.
    const blocks = [];
    let currentBlock = [];
    let lastKey = null;

    rowsWithSueldoComp.forEach(row => {
        const inst = String(row[idxInstitucion] || '').trim();
        const puesto = String(row[idxNombrePuesto] || '').trim();
        const key = `${inst}_${puesto}`;

        if (key !== lastKey && currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
        }
        currentBlock.push(row);
        lastKey = key;
    });

    if (currentBlock.length > 0) {
        blocks.push(currentBlock);
    }

    const depuratedRows = [];
    blocks.forEach(block => {
        if (block.length === 1) {
            depuratedRows.push(block[0]);
        } else if (block.length > 1) {
            depuratedRows.push(block[0]); // Primer registro del grupo
            depuratedRows.push(block[block.length - 1]); // Último registro del grupo
        }
    });

    const totalOriginal = dataRows.length;
    const preserved = depuratedRows.length;
    const eliminated = totalOriginal - preserved;

    // PASO 4: Agregar columnas de fecha ("Fecha Real Termino", "Fecha Real Inicio", "Fecha Sugerida Termino", "Fecha Sugerida Inicio")
    const finalHeaders = [
        ...depuratedHeaders,
        'Fecha Real Termino',
        'Fecha Real Inicio',
        'Fecha Sugerida Termino',
        'Fecha Sugerida Inicio'
    ];
    const idxTerminoCol = finalHeaders.length - 4;
    const idxInicioCol = finalHeaders.length - 3;
    const idxSugTerminoCol = finalHeaders.length - 2;
    const idxSugInicioCol = finalHeaders.length - 1;

    // Agrupar filas depuradas consecutivas por la misma clave para aplicar la Regla de Fechas
    const depuratedBlocks = [];
    let currDepBlock = [];
    let lastDepKey = null;

    depuratedRows.forEach(row => {
        const inst = String(row[idxInstitucion] || '').trim();
        const puesto = String(row[idxNombrePuesto] || '').trim();
        const key = `${inst}_${puesto}`;

        if (key !== lastDepKey && currDepBlock.length > 0) {
            depuratedBlocks.push(currDepBlock);
            currDepBlock = [];
        }
        currDepBlock.push(row);
        lastDepKey = key;
    });
    if (currDepBlock.length > 0) {
        depuratedBlocks.push(currDepBlock);
    }

    const finalRows = [];

    depuratedBlocks.forEach(block => {
        if (block.length === 2) {
            // El bloque depurado tiene 2 filas (primera = termino, segunda = inicio)
            const rowUpper = [...block[0]]; // actual = termino
            const rowLower = [...block[1]]; // siguiente = inicio

            while (rowUpper.length < finalHeaders.length) rowUpper.push('');
            while (rowLower.length < finalHeaders.length) rowLower.push('');

            const dateTermino = calculateDate(
                rowUpper[idxAnio],
                rowUpper[idxMes],
                rowUpper[idxQuincena],
                'termino'
            );

            const dateInicio = calculateDate(
                rowLower[idxAnio],
                rowLower[idxMes],
                rowLower[idxQuincena],
                'inicio'
            );

            rowUpper[idxTerminoCol] = dateTermino;
            rowUpper[idxInicioCol] = '';
            rowUpper[idxSugTerminoCol] = calculateSuggestedDate(dateTermino);
            rowUpper[idxSugInicioCol] = '';

            rowLower[idxTerminoCol] = '';
            rowLower[idxInicioCol] = dateInicio;
            rowLower[idxSugTerminoCol] = '';
            rowLower[idxSugInicioCol] = calculateSuggestedDate(dateInicio);

            finalRows.push(rowUpper);
            finalRows.push(rowLower);
        } else {
            // Un solo registro en el bloque: actual = inicio
            block.forEach(row => {
                const newRow = [...row];
                while (newRow.length < finalHeaders.length) newRow.push('');

                const dateInicio = calculateDate(
                    newRow[idxAnio],
                    newRow[idxMes],
                    newRow[idxQuincena],
                    'inicio'
                );

                newRow[idxTerminoCol] = '';
                newRow[idxInicioCol] = dateInicio;
                newRow[idxSugTerminoCol] = '';
                newRow[idxSugInicioCol] = calculateSuggestedDate(dateInicio);
                finalRows.push(newRow);
            });
        }
    });

    // PASO 5: Generar filas simplificadas para RUSP SIMPLIFICADO (1 solo registro por pareja)
    const simplificadoRows = [];

    depuratedBlocks.forEach(block => {
        if (block.length >= 2) {
            const rowUpper = block[0];
            const rowLower = block[block.length - 1];

            const dateTermino = calculateDate(
                rowUpper[idxAnio],
                rowUpper[idxMes],
                rowUpper[idxQuincena],
                'termino'
            );

            const dateInicio = calculateDate(
                rowLower[idxAnio],
                rowLower[idxMes],
                rowLower[idxQuincena],
                'inicio'
            );

            const getSueldoComp = (r) => {
                const val = r[colSueldoCompIdx];
                if (typeof val === 'number') return val;
                return parseFloat(String(val || '0').replace(/[^0-9.-]+/g, '')) || 0;
            };

            const sueldoUpper = getSueldoComp(rowUpper);
            const sueldoLower = getSueldoComp(rowLower);

            // Seleccionar el registro con mayor Sueldo + Compensación (o el primero si son iguales)
            const chosenBase = (sueldoLower > sueldoUpper) ? rowLower : rowUpper;

            const newRow = [...chosenBase];
            while (newRow.length < finalHeaders.length) newRow.push('');

            newRow[idxTerminoCol] = dateTermino;
            newRow[idxInicioCol] = dateInicio;
            newRow[idxSugTerminoCol] = calculateSuggestedDate(dateTermino);
            newRow[idxSugInicioCol] = calculateSuggestedDate(dateInicio);

            simplificadoRows.push(newRow);
        } else if (block.length === 1) {
            const singleRow = [...block[0]];
            while (singleRow.length < finalHeaders.length) singleRow.push('');

            const dateInicio = calculateDate(
                singleRow[idxAnio],
                singleRow[idxMes],
                singleRow[idxQuincena],
                'inicio'
            );

            singleRow[idxTerminoCol] = '';
            singleRow[idxInicioCol] = dateInicio;
            singleRow[idxSugTerminoCol] = '';
            singleRow[idxSugInicioCol] = calculateSuggestedDate(dateInicio);

            simplificadoRows.push(singleRow);
        }
    });

    return {
        sheetName: firstSheetName,
        stats: {
            totalOriginal,
            eliminated,
            preserved,
            simplificadoCount: simplificadoRows.length
        },
        depurated: {
            headers: depuratedHeaders,
            rows: depuratedRows
        },
        final: {
            headers: finalHeaders,
            rows: finalRows
        },
        simplificado: {
            headers: finalHeaders,
            rows: simplificadoRows
        }
    };
}

export const SPECIFIC_COLUMNS = [
    '#',
    'rfc',
    'institucion',
    'nombre_puesto',
    'nivel_tab_pagado',
    'fecha_ingreso_apf',
    'fecha_ingreso_institucion',
    'fecha_alta_ultimo_puesto',
    'sueldo_base_tab',
    'compensacion_garantizada',
    'Sueldo + Compensación',
    'anio',
    'mes',
    'quincena',
    'Fecha Real Inicio',
    'Fecha Real Termino',
    'Fecha Sugerida Inicio',
    'Fecha Sugerida Termino'
];

export const SIMPLIFIED_RUSP_COLUMNS = [
    '#',
    'rfc',
    'institucion',
    'nombre_puesto',
    'nivel_tab_pagado',
    'fecha_ingreso_apf',
    'fecha_ingreso_institucion',
    'fecha_alta_ultimo_puesto',
    'sueldo_base_tab',
    'compensacion_garantizada',
    'Sueldo + Compensación',
    'anio',
    'mes',
    'quincena',
    'Fecha Real Inicio',
    'Fecha Real Termino',
    'Fecha Sugerida Inicio',
    'Fecha Sugerida Termino'
];

/**
 * Retorna la lista de columnas para el RUSP Simplificado, incluyendo opcionalmente ur_reportada.
 * @param {boolean} showUR 
 * @returns {Array<string>}
 */
export function getSimplifiedColumns(showUR = false) {
    if (showUR) {
        return [
            '#',
            'rfc',
            'institucion',
            'ur_reportada',
            'nombre_puesto',
            'nivel_tab_pagado',
            'fecha_ingreso_apf',
            'fecha_ingreso_institucion',
            'fecha_alta_ultimo_puesto',
            'sueldo_base_tab',
            'compensacion_garantizada',
            'Sueldo + Compensación',
            'anio',
            'mes',
            'quincena',
            'Fecha Real Inicio',
            'Fecha Real Termino',
            'Fecha Sugerida Inicio',
            'Fecha Sugerida Termino'
        ];
    }
    return SIMPLIFIED_RUSP_COLUMNS;
}

/**
 * Filtra una matriz de datos conservando solo las columnas especificadas en targetColumns.
 * @param {Array<string>} headers 
 * @param {Array<Array>} rows 
 * @param {Array<string>} targetColumns 
 * @returns {{ headers: Array<string>, rows: Array<Array> }}
 */
export function getFilteredData(headers, rows, targetColumns) {
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    const colIndices = targetColumns.map(targetCol => {
        const normTarget = normalizeHeader(targetCol);
        let foundIdx = normalizedHeaders.findIndex(nh => nh === normTarget);
        if (foundIdx === -1 && (normTarget === 'ur_reportada' || normTarget === 'urreportada')) {
            foundIdx = normalizedHeaders.findIndex(nh => ['ur_reportada', 'urreportada', 'ur', 'ur reportada', 'unidad_responsable', 'unidadresponsable'].includes(nh));
        }
        return foundIdx;
    });

    const filteredRows = rows.map((row, rIdx) => {
        return colIndices.map((idx, cIdx) => {
            if (targetColumns[cIdx] === '#' && (idx === -1 || row[idx] === '' || row[idx] === undefined || row[idx] === null)) {
                return rIdx + 1;
            }
            return (idx !== -1 && row[idx] !== undefined && row[idx] !== null) ? row[idx] : '';
        });
    });

    return {
        headers: targetColumns,
        rows: filteredRows
    };
}

/**
 * Homologa y combina filas consecutivas que tengan la misma Institución, Nombre de Puesto (y opcionalmente UR).
 * Toma la Fecha Real de Inicio más antigua y la Fecha Real de Término más reciente.
 * @param {Array<string>} headers 
 * @param {Array<Array>} rows 
 * @param {Object} options - { homologateUR: boolean }
 * @returns {Array<Array>} Filas homologadas
 */
export function homologateSimplifiedData(headers, rows, options = {}) {
    const { homologateUR = false } = options;
    const normHeaders = headers.map(h => normalizeHeader(h));

    const idxInst = normHeaders.findIndex(h => ['institucion', 'nombre_institucion', 'entidad', 'inst'].includes(h));
    const idxUR = normHeaders.findIndex(h => ['ur_reportada', 'urreportada', 'ur', 'ur reportada', 'unidad_responsable', 'unidadresponsable'].includes(h));
    const idxPuesto = normHeaders.findIndex(h => ['nombre_puesto', 'nombrepuesto', 'puesto'].includes(h));
    const idxRealInicio = normHeaders.findIndex(h => h === 'fecha real inicio');
    const idxRealTermino = normHeaders.findIndex(h => h === 'fecha real termino');
    const idxSugInicio = normHeaders.findIndex(h => h === 'fecha sugerida inicio');
    const idxSugTermino = normHeaders.findIndex(h => h === 'fecha sugerida termino');

    if (idxInst === -1 || idxPuesto === -1) {
        return rows;
    }

    const parseDateStr = (dStr) => {
        if (!dStr || typeof dStr !== 'string') return null;
        const parts = dStr.trim().split('/');
        if (parts.length !== 3) return null;
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12) return null;
        return new Date(y, m - 1, d).getTime();
    };

    // Agrupar filas consecutivas con la misma combinación (Institución [+ UR si homologateUR es true] + Nombre Puesto)
    const blocks = [];
    let currentBlock = [];
    let lastKey = null;

    const useURInKey = homologateUR && idxUR !== -1;

    rows.forEach(row => {
        const inst = String(row[idxInst] || '').trim().toLowerCase();
        const ur = useURInKey ? String(row[idxUR] || '').trim().toLowerCase() : '';
        const puesto = String(row[idxPuesto] || '').trim().toLowerCase();
        const key = useURInKey ? `${inst}___${ur}___${puesto}` : `${inst}___${puesto}`;

        if (key !== lastKey && currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
        }
        currentBlock.push(row);
        lastKey = key;
    });

    if (currentBlock.length > 0) {
        blocks.push(currentBlock);
    }

    const homologatedRows = [];

    blocks.forEach(block => {
        if (block.length === 1) {
            homologatedRows.push([...block[0]]);
        } else {
            // Combinar bloque (> 1 filas)
            // Tomar la primera o la última fila como representante según la información
            const representativeRow = [...block[0]];

            let minInicioTs = null;
            let minInicioStr = '';
            let maxTerminoTs = null;
            let maxTerminoStr = '';

            block.forEach(r => {
                const startVal = idxRealInicio !== -1 ? String(r[idxRealInicio] || '').trim() : '';
                const endVal = idxRealTermino !== -1 ? String(r[idxRealTermino] || '').trim() : '';

                if (startVal) {
                    const ts = parseDateStr(startVal);
                    if (ts !== null) {
                        if (minInicioTs === null || ts < minInicioTs) {
                            minInicioTs = ts;
                            minInicioStr = startVal;
                        }
                    }
                }

                if (endVal) {
                    const ts = parseDateStr(endVal);
                    if (ts !== null) {
                        if (maxTerminoTs === null || ts > maxTerminoTs) {
                            maxTerminoTs = ts;
                            maxTerminoStr = endVal;
                        }
                    }
                }
            });

            if (idxRealInicio !== -1 && minInicioStr) {
                representativeRow[idxRealInicio] = minInicioStr;
            }
            if (idxRealTermino !== -1 && maxTerminoStr) {
                representativeRow[idxRealTermino] = maxTerminoStr;
            }

            if (idxSugInicio !== -1 && minInicioStr) {
                representativeRow[idxSugInicio] = calculateSuggestedDate(minInicioStr);
            }
            if (idxSugTermino !== -1 && maxTerminoStr) {
                representativeRow[idxSugTermino] = calculateSuggestedDate(maxTerminoStr);
            }

            homologatedRows.push(representativeRow);
        }
    });

    return homologatedRows;
}

/**
 * Descarga una matriz de datos filtrando solo columnas específicas
 * @param {Array<string>} headers 
 * @param {Array<Array>} rows 
 * @param {Array<string>} targetColumns 
 * @param {string} filename 
 */
export function downloadFilteredExcel(headers, rows, targetColumns, filename) {
    const filtered = getFilteredData(headers, rows, targetColumns);
    downloadExcel(filtered.headers, filtered.rows, filename);
}

/**
 * Descarga una matriz de datos como archivo Excel (.xlsx)
 * @param {Array<string>} headers 
 * @param {Array<Array>} rows 
 * @param {string} filename 
 */
export function downloadExcel(headers, rows, filename) {
    const XLSX = getXLSX();
    const wb = XLSX.utils.book_new();
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Auto-ajustar anchos de columnas para mejor presentación
    const colWidths = headers.map((h, i) => {
        let maxLen = String(h || '').length;
        rows.slice(0, 50).forEach(r => {
            const cellVal = String(r[i] || '');
            if (cellVal.length > maxLen) maxLen = cellVal.length;
        });
        return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Datos Procesados');
    XLSX.writeFile(wb, filename);
}
