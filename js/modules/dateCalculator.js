/**
 * Módulo DateCalculator
 * Encargado de realizar el cálculo de fechas de inicio y término según quincena, mes y año.
 */

/**
 * Formatea un objeto Date a cadena DD/MM/YYYY.
 * @param {Date} dateObj
 * @returns {string}
 */
export function formatDate(dateObj) {
    if (!dateObj || Number.isNaN(dateObj.getTime())) return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Calcula la fecha real de término o inicio según las reglas existentes del RUSP.
 *
 * @param {number|string} year
 * @param {number|string} month
 * @param {number|string} quincena
 * @param {'termino'|'inicio'} type
 * @returns {string}
 */
export function calculateDate(year, month, quincena, type) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const q = parseInt(quincena, 10);

    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(q) || m < 1 || m > 12 || (q !== 1 && q !== 2)) {
        return '';
    }

    let baseDate;

    if (type === 'termino') {
        baseDate = q === 1
            ? new Date(y, m - 1, 15)
            : new Date(y, m, 0);
    } else if (type === 'inicio') {
        baseDate = q === 1
            ? new Date(y, m - 1, 1)
            : new Date(y, m - 1, 16);
    } else {
        return '';
    }

    baseDate.setDate(baseDate.getDate() - 15);
    return formatDate(baseDate);
}

function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const match = dateStr.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        Number.isNaN(date.getTime()) ||
        date.getDate() !== day ||
        date.getMonth() !== month - 1 ||
        date.getFullYear() !== year
    ) {
        return null;
    }

    return date;
}

/**
 * Calcula la fecha sugerida a partir de una fecha real.
 *
 * Reglas institucionales:
 * - inicio: se elige la frontera de inicio de quincena más cercana del mismo mes
 *   (día 1 o día 16). Así, por ejemplo, 01 se conserva como 01, mientras que
 *   fechas como 14 o 17 se normalizan al 16;
 * - término: se elige la frontera de cierre de quincena más cercana del mismo mes
 *   (día 15 o último día real del mes). El último día se calcula dinámicamente,
 *   por lo que respeta meses de 28, 29, 30 o 31 días.
 *
 * Si no se indica type, se conserva el redondeo histórico para compatibilidad
 * con cualquier consumidor externo del módulo.
 *
 * @param {string} dateStr
 * @param {'termino'|'inicio'} [type]
 * @returns {string}
 */
export function calculateSuggestedDate(dateStr, type) {
    const date = parseDate(dateStr);
    if (!date) return '';

    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();

    if (type === 'inicio') {
        const firstFortnightStart = 1;
        const secondFortnightStart = 16;
        const distanceToFirst = Math.abs(day - firstFortnightStart);
        const distanceToSecond = Math.abs(day - secondFortnightStart);
        const suggestedDay = distanceToFirst <= distanceToSecond
            ? firstFortnightStart
            : secondFortnightStart;

        return formatDate(new Date(year, month, suggestedDay));
    }

    if (type === 'termino') {
        const firstFortnightEnd = 15;
        const monthEnd = new Date(year, month + 1, 0).getDate();
        const distanceToFirst = Math.abs(day - firstFortnightEnd);
        const distanceToMonthEnd = Math.abs(day - monthEnd);
        const suggestedDay = distanceToMonthEnd <= distanceToFirst
            ? monthEnd
            : firstFortnightEnd;

        return formatDate(new Date(year, month, suggestedDay));
    }

    let suggestedDay = 1;
    if (day >= 1 && day <= 5) {
        suggestedDay = 1;
    } else if (day >= 6 && day <= 20) {
        suggestedDay = 16;
    } else if (day >= 21) {
        suggestedDay = new Date(year, month + 1, 0).getDate();
    }

    return formatDate(new Date(year, month, suggestedDay));
}
