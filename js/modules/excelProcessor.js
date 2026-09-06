/**
 * Módulo ExcelProcessor
 * Lectura, depuración, homologación y exportación de archivos RUSP con SheetJS.
 */

import { calculateDate, calculateSuggestedDate } from './dateCalculator.js';

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

function normalizeHeader(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function formatExcelDate(val) {
    if (val === null || val === undefined || val === '') return '';

    if (val instanceof Date) {
        if (Number.isNaN(val.getTime())) return '';
        return `${String(val.getDate()).padStart(2, '0')}/${String(val.getMonth() + 1).padStart(2, '0')}/${val.getFullYear()}`;
    }

    const strVal = String(val).trim();

    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(strVal)) {
        const [year, month, day] = strVal.split(/[-/]/);
        return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }

    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(strVal)) {
        const [day, month, year] = strVal.split(/[-/]/);
        return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }

    const num = Number(strVal);
    if (!Number.isNaN(num) && num > 1000 && num < 100000) {
        let XLSXLib = null;
        try {
            XLSXLib = getXLSX();
        } catch (error) {
            XLSXLib = null;
        }

        if (XLSXLib?.SSF?.parse_date_code) {
            try {
                const parsed = XLSXLib.SSF.parse_date_code(num);
                if (parsed?.y && parsed?.m && parsed?.d) {
                    return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
                }
            } catch (error) {
                // Continúa con el fallback matemático.
            }
        }

        const dateObj = new Date(Math.round((num - 25569) * 86400 * 1000));
        if (!Number.isNaN(dateObj.getTime())) {
            return `${String(dateObj.getUTCDate()).padStart(2, '0')}/${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}/${dateObj.getUTCFullYear()}`;
        }
    }

    return strVal;
}

function findIndexByAliases(normalizedHeaders, aliases) {
    return normalizedHeaders.findIndex(header => aliases.includes(header));
}

function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value || '0').replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildPersonIdentifier(row, indexes) {
    const candidates = [indexes.rfc, indexes.curp, indexes.employee, indexes.personName];
    for (const index of candidates) {
        if (index !== -1) {
            const value = String(row[index] || '').trim().toLowerCase();
            if (value) return value;
        }
    }
    return '__persona_unica__';
}

function buildEmploymentKey(row, indexes, { includeUR = false } = {}) {
    const person = buildPersonIdentifier(row, indexes);
    const institution = indexes.institution !== -1 ? String(row[indexes.institution] || '').trim().toLowerCase() : '';
    const position = indexes.position !== -1 ? String(row[indexes.position] || '').trim().toLowerCase() : '';
    const ur = includeUR && indexes.ur !== -1 ? String(row[indexes.ur] || '').trim().toLowerCase() : '';
    return includeUR
        ? `${person}___${institution}___${ur}___${position}`
        : `${person}___${institution}___${position}`;
}

function splitConsecutiveBlocks(rows, keyFactory) {
    const blocks = [];
    let current = [];
    let lastKey = null;

    rows.forEach(row => {
        const key = keyFactory(row);
        if (current.length && key !== lastKey) {
            blocks.push(current);
            current = [];
        }
        current.push(row);
        lastKey = key;
    });

    if (current.length) blocks.push(current);
    return blocks;
}

function parseDateStr(value) {
    if (!value || typeof value !== 'string') return null;
    const parts = value.trim().split('/');
    if (parts.length !== 3) return null;

    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = Number(parts[2]);
    const date = new Date(year, month - 1, day);

    if (
        Number.isNaN(date.getTime()) ||
        date.getDate() !== day ||
        date.getMonth() !== month - 1 ||
        date.getFullYear() !== year
    ) {
        return null;
    }
    return date.getTime();
}

export function processExcelData(arrayBuffer) {
    const XLSX = getXLSX();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (!rawMatrix?.length) {
        throw new Error('El archivo Excel está completamente vacío.');
    }

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
        if (!Array.isArray(row)) continue;
        const normalizedCells = row.map(cell => normalizeHeader(cell));
        const matchCount = targetGroups.reduce(
            (count, group) => count + (normalizedCells.some(cell => group.includes(cell)) ? 1 : 0),
            0
        );
        if (matchCount > maxMatches && matchCount > 0) {
            maxMatches = matchCount;
            headerRowIndex = i;
        }
    }

    if (headerRowIndex === -1) {
        headerRowIndex = rawMatrix.findIndex(row =>
            Array.isArray(row) &&
            row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
        );
    }

    if (headerRowIndex === -1) {
        throw new Error('No se encontraron filas con datos válidos en la hoja de cálculo.');
    }

    const headers = rawMatrix[headerRowIndex].map(value => String(value || '').trim());
    const dataRows = rawMatrix.slice(headerRowIndex + 1).filter(row =>
        Array.isArray(row) &&
        row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '')
    );

    if (!dataRows.length) {
        throw new Error('No se encontraron filas de registro debajo del encabezado.');
    }

    const normalizedHeaders = headers.map(normalizeHeader);
    const indexes = {
        salary: findIndexByAliases(normalizedHeaders, ['sueldo_base_tab', 'sueldobasetab', 'sueldo_base', 'sueldo']),
        compensation: findIndexByAliases(normalizedHeaders, ['compensacion_garantizada', 'compensaciongarantizada', 'compensacion']),
        institution: findIndexByAliases(normalizedHeaders, ['institucion', 'nombre_institucion', 'entidad', 'inst']),
        position: findIndexByAliases(normalizedHeaders, ['nombre_puesto', 'nombrepuesto', 'puesto']),
        year: findIndexByAliases(normalizedHeaders, ['anio', 'ano', 'year']),
        month: findIndexByAliases(normalizedHeaders, ['mes', 'month']),
        fortnight: findIndexByAliases(normalizedHeaders, ['quincena', 'fortnight']),
        rfc: findIndexByAliases(normalizedHeaders, ['rfc']),
        curp: findIndexByAliases(normalizedHeaders, ['curp']),
        employee: findIndexByAliases(normalizedHeaders, ['num_empleado', 'numero_empleado']),
        personName: findIndexByAliases(normalizedHeaders, ['nombre_persona', 'nombre_completo', 'nombreempleado', 'nombre_empleado', 'nombre']),
        ur: findIndexByAliases(normalizedHeaders, ['ur_reportada', 'urreportada', 'ur', 'ur reportada', 'unidad_responsable', 'unidadresponsable'])
    };

    const missing = [];
    if (indexes.salary === -1) missing.push('sueldo_base_tab');
    if (indexes.compensation === -1) missing.push('compensacion_garantizada');
    if (indexes.institution === -1) missing.push('Institucion');
    if (indexes.position === -1) missing.push('nombre_puesto');
    if (indexes.year === -1) missing.push('anio');
    if (indexes.month === -1) missing.push('mes');
    if (indexes.fortnight === -1) missing.push('quincena');

    if (missing.length) {
        throw new Error(`Faltan las siguientes columnas obligatorias en el archivo Excel: ${missing.join(', ')}`);
    }

    const dateColIndices = normalizedHeaders
        .map((header, index) => header.includes('fecha') ? index : -1)
        .filter(index => index !== -1);

    if (dateColIndices.length) {
        dataRows.forEach(row => {
            dateColIndices.forEach(index => {
                if (row[index] !== undefined && row[index] !== null && row[index] !== '') {
                    row[index] = formatExcelDate(row[index]);
                }
            });
        });
    }

    const depuratedHeaders = [...headers];
    let colSueldoCompIdx = 38;

    if (depuratedHeaders[38] && depuratedHeaders[38].trim() !== '') {
        colSueldoCompIdx = depuratedHeaders.length;
        depuratedHeaders.push('Sueldo + Compensación');
    } else {
        while (depuratedHeaders.length < 38) depuratedHeaders.push('');
        depuratedHeaders[38] = 'Sueldo + Compensación';
    }

    const rowsWithSueldoComp = dataRows.map(row => {
        const newRow = [...row];
        while (newRow.length < depuratedHeaders.length) newRow.push('');
        const total = parseMoney(row[indexes.salary]) + parseMoney(row[indexes.compensation]);
        newRow[colSueldoCompIdx] = Number(total.toFixed(2));
        return newRow;
    });

    const blocks = splitConsecutiveBlocks(
        rowsWithSueldoComp,
        row => buildEmploymentKey(row, indexes)
    );

    const depuratedRows = [];
    blocks.forEach(block => {
        depuratedRows.push(block[0]);
        if (block.length > 1) depuratedRows.push(block[block.length - 1]);
    });

    const totalOriginal = dataRows.length;
    const preserved = depuratedRows.length;
    const eliminated = totalOriginal - preserved;

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

    const depuratedBlocks = splitConsecutiveBlocks(
        depuratedRows,
        row => buildEmploymentKey(row, indexes)
    );

    const finalRows = [];
    const simplificadoRows = [];

    depuratedBlocks.forEach(block => {
        if (block.length >= 2) {
            const rowUpper = [...block[0]];
            const rowLower = [...block[block.length - 1]];
            while (rowUpper.length < finalHeaders.length) rowUpper.push('');
            while (rowLower.length < finalHeaders.length) rowLower.push('');

            const dateTermino = calculateDate(
                rowUpper[indexes.year],
                rowUpper[indexes.month],
                rowUpper[indexes.fortnight],
                'termino'
            );
            const dateInicio = calculateDate(
                rowLower[indexes.year],
                rowLower[indexes.month],
                rowLower[indexes.fortnight],
                'inicio'
            );

            rowUpper[idxTerminoCol] = dateTermino;
            rowUpper[idxInicioCol] = '';
            rowUpper[idxSugTerminoCol] = calculateSuggestedDate(dateTermino, 'termino');
            rowUpper[idxSugInicioCol] = '';

            rowLower[idxTerminoCol] = '';
            rowLower[idxInicioCol] = dateInicio;
            rowLower[idxSugTerminoCol] = '';
            rowLower[idxSugInicioCol] = calculateSuggestedDate(dateInicio, 'inicio');

            finalRows.push(rowUpper, rowLower);

            const sueldoUpper = parseMoney(block[0][colSueldoCompIdx]);
            const sueldoLower = parseMoney(block[block.length - 1][colSueldoCompIdx]);
            const chosenBase = sueldoLower > sueldoUpper ? block[block.length - 1] : block[0];
            const simplified = [...chosenBase];
            while (simplified.length < finalHeaders.length) simplified.push('');
            simplified[idxTerminoCol] = dateTermino;
            simplified[idxInicioCol] = dateInicio;
            simplified[idxSugTerminoCol] = calculateSuggestedDate(dateTermino, 'termino');
            simplified[idxSugInicioCol] = calculateSuggestedDate(dateInicio, 'inicio');
            simplificadoRows.push(simplified);
            return;
        }

        const single = [...block[0]];
        while (single.length < finalHeaders.length) single.push('');
        const dateInicio = calculateDate(
            single[indexes.year],
            single[indexes.month],
            single[indexes.fortnight],
            'inicio'
        );
        single[idxTerminoCol] = '';
        single[idxInicioCol] = dateInicio;
        single[idxSugTerminoCol] = '';
        single[idxSugInicioCol] = calculateSuggestedDate(dateInicio, 'inicio');
        finalRows.push(single);
        simplificadoRows.push([...single]);
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

export const SIMPLIFIED_RUSP_COLUMNS = [...SPECIFIC_COLUMNS];

export function getSimplifiedColumns(showUR = false) {
    if (!showUR) return [...SIMPLIFIED_RUSP_COLUMNS];
    const columns = [...SIMPLIFIED_RUSP_COLUMNS];
    columns.splice(3, 0, 'ur_reportada');
    return columns;
}

export function getFilteredData(headers, rows, targetColumns) {
    const normalizedHeaders = headers.map(normalizeHeader);
    const colIndices = targetColumns.map(targetColumn => {
        const normalizedTarget = normalizeHeader(targetColumn);
        let foundIdx = normalizedHeaders.findIndex(header => header === normalizedTarget);
        if (foundIdx === -1 && ['ur_reportada', 'urreportada'].includes(normalizedTarget)) {
            foundIdx = normalizedHeaders.findIndex(header =>
                ['ur_reportada', 'urreportada', 'ur', 'ur reportada', 'unidad_responsable', 'unidadresponsable'].includes(header)
            );
        }
        return foundIdx;
    });

    const filteredRows = rows.map((row, rowIndex) =>
        colIndices.map((index, columnIndex) => {
            if (
                targetColumns[columnIndex] === '#' &&
                (index === -1 || row[index] === '' || row[index] === undefined || row[index] === null)
            ) {
                return rowIndex + 1;
            }
            return index !== -1 && row[index] !== undefined && row[index] !== null ? row[index] : '';
        })
    );

    return {
        headers: [...targetColumns],
        rows: filteredRows
    };
}

export function homologateSimplifiedData(headers, rows, options = {}) {
    const { homologateUR = false } = options;
    const normalizedHeaders = headers.map(normalizeHeader);
    const indexes = {
        institution: findIndexByAliases(normalizedHeaders, ['institucion', 'nombre_institucion', 'entidad', 'inst']),
        ur: findIndexByAliases(normalizedHeaders, ['ur_reportada', 'urreportada', 'ur', 'ur reportada', 'unidad_responsable', 'unidadresponsable']),
        position: findIndexByAliases(normalizedHeaders, ['nombre_puesto', 'nombrepuesto', 'puesto']),
        rfc: findIndexByAliases(normalizedHeaders, ['rfc']),
        curp: findIndexByAliases(normalizedHeaders, ['curp']),
        employee: findIndexByAliases(normalizedHeaders, ['num_empleado', 'numero_empleado']),
        personName: findIndexByAliases(normalizedHeaders, ['nombre_persona', 'nombre_completo', 'nombreempleado', 'nombre_empleado', 'nombre'])
    };

    const idxRealInicio = normalizedHeaders.findIndex(header => header === 'fecha real inicio');
    const idxRealTermino = normalizedHeaders.findIndex(header => header === 'fecha real termino');
    const idxSugInicio = normalizedHeaders.findIndex(header => header === 'fecha sugerida inicio');
    const idxSugTermino = normalizedHeaders.findIndex(header => header === 'fecha sugerida termino');

    if (indexes.institution === -1 || indexes.position === -1) {
        return rows.map(row => [...row]);
    }

    const blocks = splitConsecutiveBlocks(
        rows,
        row => buildEmploymentKey(
            row,
            indexes,
            { includeUR: homologateUR && indexes.ur !== -1 }
        )
    );

    return blocks.map(block => {
        if (block.length === 1) return [...block[0]];

        const representative = [...block[0]];
        let minInicioTs = null;
        let minInicioStr = '';
        let maxTerminoTs = null;
        let maxTerminoStr = '';

        block.forEach(row => {
            const startVal = idxRealInicio !== -1 ? String(row[idxRealInicio] || '').trim() : '';
            const endVal = idxRealTermino !== -1 ? String(row[idxRealTermino] || '').trim() : '';
            const startTs = parseDateStr(startVal);
            const endTs = parseDateStr(endVal);

            if (startTs !== null && (minInicioTs === null || startTs < minInicioTs)) {
                minInicioTs = startTs;
                minInicioStr = startVal;
            }
            if (endTs !== null && (maxTerminoTs === null || endTs > maxTerminoTs)) {
                maxTerminoTs = endTs;
                maxTerminoStr = endVal;
            }
        });

        if (idxRealInicio !== -1 && minInicioStr) representative[idxRealInicio] = minInicioStr;
        if (idxRealTermino !== -1 && maxTerminoStr) representative[idxRealTermino] = maxTerminoStr;
        if (idxSugInicio !== -1 && minInicioStr) representative[idxSugInicio] = calculateSuggestedDate(minInicioStr, 'inicio');
        if (idxSugTermino !== -1 && maxTerminoStr) representative[idxSugTermino] = calculateSuggestedDate(maxTerminoStr, 'termino');

        return representative;
    });
}

export function downloadFilteredExcel(headers, rows, targetColumns, filename) {
    const filtered = getFilteredData(headers, rows, targetColumns);
    downloadExcel(filtered.headers, filtered.rows, filename);
}

export function downloadExcel(headers, rows, filename) {
    const XLSX = getXLSX();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    worksheet['!cols'] = headers.map((header, columnIndex) => {
        let maxLen = String(header || '').length;
        rows.slice(0, 50).forEach(row => {
            const cellLen = String(row[columnIndex] || '').length;
            if (cellLen > maxLen) maxLen = cellLen;
        });
        return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos Procesados');
    XLSX.writeFile(workbook, filename);
}
