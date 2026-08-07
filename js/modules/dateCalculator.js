/**
 * Módulo DateCalculator
 * Encargado de realizar el cálculo de fechas de inicio y término según quincena, mes y año.
 */

/**
 * Formatea un objeto Date a cadena DD/MM/YYYY
 * @param {Date} dateObj 
 * @returns {string} Fecha formateada
 */
export function formatDate(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Calcula la fecha real de término o inicio según las reglas institucionales.
 * 
 * REGLAS:
 * FECHA TERMINO:
 * - Quincena 1 (días 1 al 15): Base = día 15 del mes/año. Restar 15 días.
 * - Quincena 2 (días 16 al fin de mes): Base = último día del mes/año. Restar 15 días.
 * 
 * FECHA INICIO:
 * - Quincena 1: Base = día 01 del mes/año. Restar 15 días.
 * - Quincena 2: Base = día 16 del mes/año. Restar 15 días.
 * 
 * @param {number|string} year - Año (ej. 2013)
 * @param {number|string} month - Mes (1-12)
 * @param {number|string} quincena - Quincena (1 o 2)
 * @param {'termino'|'inicio'} type - Tipo de cálculo
 * @returns {string} Fecha calculada en formato DD/MM/YYYY o cadena vacía si los datos no son válidos.
 */
export function calculateDate(year, month, quincena, type) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const q = parseInt(quincena, 10);

    if (isNaN(y) || isNaN(m) || isNaN(q) || m < 1 || m > 12 || (q !== 1 && q !== 2)) {
        return '';
    }

    let baseDate;

    if (type === 'termino') {
        if (q === 1) {
            // Día 15 del mes (mes en JS es 0-indexed: m - 1)
            baseDate = new Date(y, m - 1, 15);
        } else {
            // Último día del mes actual: new Date(y, m, 0) da el último día del mes m
            baseDate = new Date(y, m, 0);
        }
    } else if (type === 'inicio') {
        if (q === 1) {
            // Día 1 del mes
            baseDate = new Date(y, m - 1, 1);
        } else {
            // Día 16 del mes
            baseDate = new Date(y, m - 1, 16);
        }
    } else {
        return '';
    }

    // Restar 15 días a la fecha base
    baseDate.setDate(baseDate.getDate() - 15);

    return formatDate(baseDate);
}

/**
 * Calcula la fecha sugerida (quincenal o fin de mes) a partir de una fecha DD/MM/YYYY.
 * - Día 1 al 5: día 01 del mismo mes/año.
 * - Día 6 al 20: día 16 del mismo mes/año.
 * - Día >= 21: último día del mes (31, 30, 28 o 29 según el mes/año).
 * 
 * @param {string} dateStr - Fecha en formato DD/MM/YYYY
 * @returns {string} Fecha sugerida en formato DD/MM/YYYY
 */
export function calculateSuggestedDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return '';

    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);

    if (isNaN(d) || isNaN(m) || isNaN(y) || m < 1 || m > 12) return '';

    let suggestedDay = 1;
    if (d >= 1 && d <= 5) {
        suggestedDay = 1;
    } else if (d >= 6 && d <= 20) {
        suggestedDay = 16;
    } else if (d >= 21) {
        suggestedDay = new Date(y, m, 0).getDate();
    }

    const sDayStr = String(suggestedDay).padStart(2, '0');
    const sMonthStr = String(m).padStart(2, '0');
    return `${sDayStr}/${sMonthStr}/${y}`;
}
