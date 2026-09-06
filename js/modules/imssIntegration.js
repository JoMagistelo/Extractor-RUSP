import { INSTITUTIONAL_HEADERS } from './institutionalOutput.js';
import { smartInstitutionalCase } from './textFormat.js';

const FEDERAL_ENTITIES = [
    'AGUASCALIENTES', 'BAJA CALIFORNIA SUR', 'BAJA CALIFORNIA', 'CAMPECHE',
    'COAHUILA', 'COLIMA', 'CHIAPAS', 'CHIHUAHUA', 'CIUDAD DE MÉXICO', 'DURANGO',
    'GUANAJUATO', 'GUERRERO', 'HIDALGO', 'JALISCO', 'MÉXICO', 'MICHOACÁN',
    'MORELOS', 'NAYARIT', 'NUEVO LEÓN', 'OAXACA', 'PUEBLA', 'QUERÉTARO',
    'QUINTANA ROO', 'SAN LUIS POTOSÍ', 'SINALOA', 'SONORA', 'TABASCO',
    'TAMAULIPAS', 'TLAXCALA', 'VERACRUZ', 'YUCATÁN', 'ZACATECAS'
];

let currentImssResult = null;

function parseDate(value) {
    const match = String(value || '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (
        date.getFullYear() !== Number(match[3]) ||
        date.getMonth() !== Number(match[2]) - 1 ||
        date.getDate() !== Number(match[1])
    ) return null;
    return date;
}

function normalizeDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(vigente|a la fecha)$/i.test(text)) return 'A la fecha';
    const date = parseDate(text);
    if (!date) return text;
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
    if (value === null || value === undefined || value === '') return '';
    const parsed = Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : '';
}

function extractPersonalSummary(text) {
    const summary = {
        name: '',
        nss: '',
        curp: '',
        reportDate: '',
        totalWeeks: null
    };

    const nssMatch = text.match(/NSS:\s*(\d{11})/i);
    if (nssMatch) summary.nss = nssMatch[1];

    const curpMatch = text.match(/CURP:\s*([A-Z0-9]{18})/i);
    if (curpMatch) summary.curp = curpMatch[1].toUpperCase();

    const reportMatch = text.match(/Fecha de emisión del reporte[\s\n]*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/i);
    if (reportMatch) summary.reportDate = `${reportMatch[1]}/${reportMatch[2]}/${reportMatch[3]}`;

    const totalMatch = text.match(/Total de semanas cotizadas[\s\S]{0,180}?(\d{1,5})/i);
    if (totalMatch) summary.totalWeeks = Number(totalMatch[1]);

    const nameMatch = text.match(/Estimado\(a\),[\s\S]*?(?:\d{4})\s*([A-ZÑÁÉÍÓÚÜ\s]+?)\s*(?:NSS:|DD\s*MM\s*YYYY)/i);
    if (nameMatch?.[1]) summary.name = smartInstitutionalCase(nameMatch[1].replace(/\n/g, ' ').trim());

    return summary;
}

export function isImssWeeksReport(text) {
    const value = String(text || '');
    const markers = [
        /Tu historia laboral/i,
        /Nombre del patr[oó]n/i,
        /Fecha de alta/i,
        /Salario Base de Cotizaci[oó]n/i,
        /(?:NSS:|CURP:)/i
    ];
    return markers.filter(pattern => pattern.test(value)).length >= 3;
}

export async function extractTextFromImssPdf(file) {
    const pdfjs = globalThis.pdfjsLib;
    if (!pdfjs?.getDocument) {
        throw new Error('PDF.js no está disponible para leer la constancia IMSS.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = [...content.items].sort((a, b) => {
            const yDiff = Math.abs(a.transform[5] - b.transform[5]);
            if (yDiff > 2) return b.transform[5] - a.transform[5];
            return a.transform[4] - b.transform[4];
        });
        fullText += `${items.map(item => item.str).join('\n')}\n`;
    }

    return fullText;
}

export function parseImssWeeksText(text) {
    const source = String(text || '');
    if (!isImssWeeksReport(source)) {
        throw new Error('El PDF no fue reconocido como Constancia de Semanas Cotizadas del IMSS.');
    }

    const history = [];
    const startIndex = source.search(/Tu historia laboral/i);
    const historyText = startIndex >= 0 ? source.slice(startIndex) : source;
    const blockRegex = /Nombre del patr[oó]n[\s\S]*?(?=(?:Nombre del patr[oó]n|Importante|$))/gi;
    const blocks = historyText.match(blockRegex) || [];

    blocks.forEach(block => {
        const employerMatch = block.match(/Nombre del patr[oó]n\s*([\s\S]*?)(?:Registro Patronal|Entidad federativa)/i);
        const registrationMatch = block.match(/Registro Patronal\s*([A-Z0-9-]+)/i);
        const startMatch = block.match(/Fecha de alta\s*(\d{2}\/\d{2}\/\d{4})/i);
        const endMatch = block.match(/Fecha de baja\s*(\d{2}\/\d{2}\/\d{4})/i);
        const salaryMatch = block.match(/Salario Base de Cotizaci[oó]n[\s\S]*?\$\s*([\d,.]+)/i);

        let entity = '';
        const upperBlock = block.toLocaleUpperCase('es-MX');
        for (const candidate of FEDERAL_ENTITIES) {
            if (upperBlock.includes(candidate)) {
                entity = candidate;
                break;
            }
        }

        const employer = employerMatch ? employerMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
        const startDate = startMatch ? normalizeDate(startMatch[1]) : '';
        const endDate = endMatch ? normalizeDate(endMatch[1]) : (startDate ? 'A la fecha' : '');

        if (employer || startDate || registrationMatch) {
            history.push({
                employer,
                registration: registrationMatch ? registrationMatch[1] : '',
                entity,
                startDate,
                endDate,
                contributionBaseSalary: salaryMatch ? parseMoney(salaryMatch[1]) : ''
            });
        }
    });

    return {
        personal: extractPersonalSummary(source),
        history
    };
}

export async function processImssPdf(file) {
    const text = await extractTextFromImssPdf(file);
    const parsed = parseImssWeeksText(text);
    return {
        ...parsed,
        fileName: file.name,
        rawText: text
    };
}

function buildObservation(item) {
    const parts = [];
    if (item.registration) parts.push(`Registro patronal: ${item.registration}`);
    if (item.entity) parts.push(`Entidad: ${smartInstitutionalCase(item.entity)}`);
    parts.push('Puesto y sector no reportados por la constancia IMSS');
    if (item.contributionBaseSalary !== '' && item.contributionBaseSalary !== null && item.contributionBaseSalary !== undefined) {
        parts.push('el importe corresponde al SBC reportado por IMSS, no a un sueldo mensual homologado');
    }
    return `${parts.join(' · ')}.`;
}

export function mapImssHistoryToInstitutional(history = []) {
    const rows = history.map(item => [
        '',
        smartInstitutionalCase(item.employer || ''),
        '',
        normalizeDate(item.startDate),
        normalizeDate(item.endDate),
        parseMoney(item.contributionBaseSalary),
        'IMSS',
        buildObservation(item)
    ]);

    return {
        headers: [...INSTITUTIONAL_HEADERS],
        rows
    };
}

export function setCurrentImssResult(result) {
    currentImssResult = result || null;
}

export function clearCurrentImssResult() {
    currentImssResult = null;
}

export function getCurrentImssResult() {
    if (!currentImssResult) return null;
    return {
        ...currentImssResult,
        personal: currentImssResult.personal ? { ...currentImssResult.personal } : null,
        history: Array.isArray(currentImssResult.history)
            ? currentImssResult.history.map(item => ({ ...item }))
            : []
    };
}

export function getCurrentImssInstitutionalOutput() {
    return mapImssHistoryToInstitutional(currentImssResult?.history || []);
}

function startTimestamp(row) {
    const date = parseDate(row?.[3]);
    return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

export function combineInstitutionalOutputs(outputs = []) {
    const active = outputs.filter(output => output?.rows?.length);
    if (!active.length) return { headers: [...INSTITUTIONAL_HEADERS], rows: [] };
    if (active.length === 1) {
        return {
            headers: [...INSTITUTIONAL_HEADERS],
            rows: active[0].rows.map(row => [...row])
        };
    }

    const rows = [];
    active.forEach((output, sourceIndex) => {
        output.rows.forEach((row, rowIndex) => {
            rows.push({ row: [...row], sourceIndex, rowIndex });
        });
    });

    rows.sort((a, b) => {
        const dateDiff = startTimestamp(b.row) - startTimestamp(a.row);
        if (dateDiff !== 0) return dateDiff;
        if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
        return a.rowIndex - b.rowIndex;
    });

    return {
        headers: [...INSTITUTIONAL_HEADERS],
        rows: rows.map(item => item.row)
    };
}
