import { calculateSuggestedDate } from './dateCalculator.js';
import { smartInstitutionalCase } from './textFormat.js';

export const INSTITUTIONAL_HEADERS = [
    'Sector',
    'Emp-Inst',
    'Puesto',
    'F-Ini',
    'F-Fin',
    'Sueldo',
    'Fuente(s)',
    'Observaciones'
];

function normalizeHeader(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_-]+/g, '')
        .trim();
}

function findColumn(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    const normalizedAliases = aliases.map(normalizeHeader);
    return normalized.findIndex(h => normalizedAliases.includes(h));
}

function parseDate(value) {
    if (!value || value === 'A la fecha') return null;
    const match = String(value).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function normalizeStartBoundary(value) {
    return calculateSuggestedDate(String(value || ''), 'inicio');
}

function normalizeEndBoundary(value) {
    return calculateSuggestedDate(String(value || ''), 'termino');
}

function dayBefore(value) {
    const date = parseDate(value);
    if (!date) return '';
    date.setDate(date.getDate() - 1);
    return formatDate(date);
}

function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number(value.toFixed(2));
    }
    if (value === null || value === undefined || value === '') return '';

    let raw = String(value).trim().replace(/\s/g, '').replace(/\$/g, '');
    if (!raw) return '';

    if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(raw)) {
        raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
        raw = raw.replace(/,/g, '');
    }

    const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : value;
}

function valueAt(row, index) {
    return index >= 0 && row && row[index] !== undefined && row[index] !== null
        ? row[index]
        : '';
}

function chooseLaterEnd(currentValue, candidateValue) {
    if (!candidateValue) return currentValue || '';
    if (!currentValue) return candidateValue;

    const current = parseDate(normalizeEndBoundary(currentValue));
    const candidate = parseDate(normalizeEndBoundary(candidateValue));
    if (!candidate) return currentValue;
    if (!current || candidate.getTime() > current.getTime()) return candidateValue;
    return currentValue;
}

function calendarDayDiff(startDate, endDate) {
    const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    return Math.max(0, Math.floor((endUtc - startUtc) / 86400000));
}

function calculateInactivityDuration(previousEnd, currentStart) {
    const endDate = parseDate(previousEnd);
    const startDate = parseDate(currentStart);
    if (!endDate || !startDate || startDate.getTime() <= endDate.getTime()) return null;

    // La inactividad comienza al día siguiente de la baja anterior y termina
    // justo antes de la fecha de inicio del empleo posterior.
    const inactivityStart = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() + 1
    );
    if (inactivityStart.getTime() >= startDate.getTime()) return null;

    let totalMonths =
        (startDate.getFullYear() - inactivityStart.getFullYear()) * 12 +
        (startDate.getMonth() - inactivityStart.getMonth());

    let anchor = new Date(
        inactivityStart.getFullYear(),
        inactivityStart.getMonth() + totalMonths,
        inactivityStart.getDate()
    );

    if (anchor.getTime() > startDate.getTime()) {
        totalMonths -= 1;
        anchor = new Date(
            inactivityStart.getFullYear(),
            inactivityStart.getMonth() + totalMonths,
            inactivityStart.getDate()
        );
    }

    totalMonths = Math.max(0, totalMonths);
    const days = calendarDayDiff(anchor, startDate);

    // Solo se informa cuando la inactividad supera un mes completo.
    if (totalMonths < 1 || (totalMonths === 1 && days === 0)) return null;

    return {
        years: Math.floor(totalMonths / 12),
        months: totalMonths % 12,
        days
    };
}

function detectSourceDirection(items) {
    let ascending = 0;
    let descending = 0;
    let previous = null;

    [...items]
        .sort((a, b) => a.sourceIndex - b.sourceIndex)
        .forEach(item => {
            if (!Number.isFinite(item.sortTime) || item.sortTime === Number.MAX_SAFE_INTEGER) return;
            if (previous !== null && item.sortTime !== previous) {
                if (item.sortTime > previous) ascending += 1;
                if (item.sortTime < previous) descending += 1;
            }
            previous = item.sortTime;
        });

    // RUSP suele venir del periodo más reciente al más antiguo. En empate
    // conservamos esa orientación para corregir solo anomalías puntuales.
    return ascending > descending ? 'asc' : 'desc';
}

function formatInactivityPeriod(duration) {
    if (!duration) return '';

    const parts = [];
    if (duration.years) {
        parts.push(`${duration.years === 1 ? 'un' : duration.years} ${duration.years === 1 ? 'año' : 'años'}`);
    }
    if (duration.months) {
        parts.push(`${duration.months === 1 ? 'un' : duration.months} ${duration.months === 1 ? 'mes' : 'meses'}`);
    }

    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} y ${parts[1]}`;
}

function inactivityObservation(duration) {
    const period = formatInactivityPeriod(duration);
    if (!period) return '';

    const qualifier = duration.days > 0 ? 'mayor a ' : 'de ';
    return `Se detectó un periodo de inactividad laboral ${qualifier}${period} respecto del empleo anterior.`;
}

export function buildInstitutionalOutput(headers = [], rows = []) {
    const idx = {
        rfc: findColumn(headers, ['rfc']),
        curp: findColumn(headers, ['curp']),
        employee: findColumn(headers, ['num_empleado', 'numero_empleado', 'numeroempleado']),
        personName: findColumn(headers, ['nombre_persona', 'nombre_completo', 'nombre_empleado', 'nombreempleado', 'nombre']),
        institution: findColumn(headers, ['institucion', 'nombre_institucion', 'entidad', 'inst']),
        position: findColumn(headers, ['nombre_puesto', 'nombrepuesto', 'puesto']),
        salary: findColumn(headers, ['Sueldo + Compensación', 'sueldo_compensacion', 'sueldo total']),
        suggestedStart: findColumn(headers, ['Fecha Sugerida Inicio']),
        suggestedEnd: findColumn(headers, ['Fecha Sugerida Termino', 'Fecha Sugerida Término']),
        realStart: findColumn(headers, ['Fecha Real Inicio']),
        realEnd: findColumn(headers, ['Fecha Real Termino', 'Fecha Real Término'])
    };

    const prepared = rows.map((row, sourceIndex) => {
        const person = String(
            valueAt(row, idx.rfc) ||
            valueAt(row, idx.curp) ||
            valueAt(row, idx.employee) ||
            valueAt(row, idx.personName) ||
            '__persona_unica__'
        ).trim().toLowerCase();

        const institution = smartInstitutionalCase(valueAt(row, idx.institution));
        const position = smartInstitutionalCase(valueAt(row, idx.position));
        const rawStart = valueAt(row, idx.suggestedStart) || valueAt(row, idx.realStart);
        const rawEnd = valueAt(row, idx.suggestedEnd) || valueAt(row, idx.realEnd);
        const start = normalizeStartBoundary(rawStart);

        return {
            sourceIndex,
            person,
            institution,
            position,
            salary: parseMoney(valueAt(row, idx.salary)),
            rawEnd,
            start,
            sortTime: parseDate(start)?.getTime() ?? Number.MAX_SAFE_INTEGER
        };
    });

    const byPerson = new Map();
    prepared.forEach(item => {
        if (!byPerson.has(item.person)) byPerson.set(item.person, []);
        byPerson.get(item.person).push(item);
    });

    const outputRows = [];

    byPerson.forEach(items => {
        const sourceDirection = detectSourceDirection(items);
        items.sort((a, b) => (a.sortTime - b.sortTime) || (a.sourceIndex - b.sourceIndex));

        const consolidated = [];
        items.forEach(item => {
            const last = consolidated[consolidated.length - 1];
            const sameEmployment = last &&
                last.institution.toLocaleLowerCase('es-MX') === item.institution.toLocaleLowerCase('es-MX') &&
                last.position.toLocaleLowerCase('es-MX') === item.position.toLocaleLowerCase('es-MX');

            if (sameEmployment) {
                const itemStartTs = parseDate(item.start)?.getTime() ?? Infinity;
                const lastStartTs = parseDate(last.start)?.getTime() ?? Infinity;
                if (!last.start || (item.start && itemStartTs < lastStartTs)) {
                    last.start = item.start;
                    last.sortTime = itemStartTs;
                }

                if (
                    typeof item.salary === 'number' &&
                    (typeof last.salary !== 'number' || item.salary > last.salary)
                ) {
                    last.salary = item.salary;
                }

                last.rawEnd = chooseLaterEnd(last.rawEnd, item.rawEnd);
            } else {
                consolidated.push({ ...item });
            }
        });

        const periods = consolidated.map((item, index) => {
            const next = consolidated[index + 1];
            let end = '';

            if (item.rawEnd) {
                end = normalizeEndBoundary(item.rawEnd);
            } else if (next && next.start) {
                // Fallback conservador para fuentes sin baja explícita.
                end = dayBefore(next.start);
            } else {
                end = 'A la fecha';
            }

            return {
                start: item.start,
                end,
                row: [
                    item.institution || item.position ? 'Público' : '',
                    item.institution,
                    item.position,
                    item.start,
                    end,
                    item.salary,
                    'RUSP',
                    ''
                ]
            };
        });

        // El universo de esta herramienta corresponde a personas actualmente
        // activas en la institución. El periodo cronológicamente más reciente
        // se presenta como vigente, aunque el corte RUSP traiga una fecha fin.
        if (periods.length) {
            const latest = periods[periods.length - 1];
            latest.end = 'A la fecha';
            latest.row[4] = 'A la fecha';
        }

        // Las observaciones se colocan en el empleo posterior y siempre se
        // comparan contra el empleo inmediatamente anterior. El primer empleo
        // cronológico no lleva comentario de inactividad.
        periods.forEach((period, index) => {
            if (index === 0) return;
            const previous = periods[index - 1];
            const inactivity = calculateInactivityDuration(previous.end, period.start);
            period.row[7] = inactivityObservation(inactivity);
        });

        const orderedPeriods = sourceDirection === 'desc' ? [...periods].reverse() : periods;
        orderedPeriods.forEach(period => outputRows.push(period.row));
    });

    return {
        headers: INSTITUTIONAL_HEADERS,
        rows: outputRows
    };
}

function sanitizeClipboardCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/[\t\r\n]+/g, ' ').trim();

    if (
        /^[=+@]/.test(text) ||
        (/^-/.test(text) && !/^-?\d+(\.\d+)?$/.test(text))
    ) {
        return `'${text}`;
    }
    return text;
}

export function toExcelTsv(rows = []) {
    return rows
        .map(row => row.map(sanitizeClipboardCell).join('\t'))
        .join('\r\n');
}

export function formatInstitutionalSalary(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return value ?? '';
    }

    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
