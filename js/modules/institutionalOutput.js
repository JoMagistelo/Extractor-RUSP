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
    const date = parseDate(value);
    if (!date) return '';

    const day = date.getDate();
    const year = date.getFullYear();
    const month = date.getMonth();

    if (day <= 16) {
        return formatDate(new Date(year, month, 16));
    }
    return formatDate(new Date(year, month + 1, 16));
}

function normalizeEndBoundary(value) {
    const date = parseDate(value);
    if (!date) return '';

    const day = date.getDate();
    const year = date.getFullYear();
    const month = date.getMonth();

    if (day <= 15) {
        return formatDate(new Date(year, month, 15));
    }
    return formatDate(new Date(year, month + 1, 15));
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

export function buildInstitutionalOutput(headers = [], rows = []) {
    const idx = {
        rfc: findColumn(headers, ['rfc']),
        curp: findColumn(headers, ['curp']),
        employee: findColumn(headers, ['num_empleado', 'numero_empleado', 'numeroempleado']),
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
            '__persona_unica__'
        ).trim().toLowerCase();

        const institution = String(valueAt(row, idx.institution) || '').trim();
        const position = String(valueAt(row, idx.position) || '').trim();
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

    const outputBySourceIndex = new Map();

    byPerson.forEach(items => {
        items.sort((a, b) => (a.sortTime - b.sortTime) || (a.sourceIndex - b.sourceIndex));

        const consolidated = [];
        items.forEach(item => {
            const last = consolidated[consolidated.length - 1];
            const sameEmployment = last &&
                last.institution.toLowerCase() === item.institution.toLowerCase() &&
                last.position.toLowerCase() === item.position.toLowerCase();

            if (sameEmployment) {
                const itemStartTs = parseDate(item.start)?.getTime() ?? Infinity;
                const lastStartTs = parseDate(last.start)?.getTime() ?? Infinity;
                if (!last.start || (item.start && itemStartTs < lastStartTs)) {
                    last.start = item.start;
                }

                if (
                    typeof item.salary === 'number' &&
                    (typeof last.salary !== 'number' || item.salary > last.salary)
                ) {
                    last.salary = item.salary;
                }

                if (item.rawEnd) last.rawEnd = item.rawEnd;
                last.sourceIndexes.push(item.sourceIndex);
            } else {
                consolidated.push({ ...item, sourceIndexes: [item.sourceIndex] });
            }
        });

        consolidated.forEach((item, index) => {
            const next = consolidated[index + 1];
            let end = '';

            if (next && next.start) {
                end = dayBefore(next.start);
            } else if (item.rawEnd) {
                end = normalizeEndBoundary(item.rawEnd);
            } else {
                end = 'A la fecha';
            }

            const institutionalRow = [
                item.institution || item.position ? 'Público' : '',
                item.institution,
                item.position,
                item.start,
                end,
                item.salary,
                'RUSP',
                ''
            ];

            item.sourceIndexes.forEach(sourceIndex => {
                outputBySourceIndex.set(sourceIndex, institutionalRow);
            });
        });
    });

    const seen = new Set();
    const outputRows = [];

    prepared
        .sort((a, b) => a.sourceIndex - b.sourceIndex)
        .forEach(item => {
            const row = outputBySourceIndex.get(item.sourceIndex);
            if (!row) return;
            const signature = JSON.stringify(row);
            if (seen.has(signature)) return;
            seen.add(signature);
            outputRows.push(row);
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
