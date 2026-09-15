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

const OCR_RENDER_SCALE = 2.5;
const MAX_SPARSE_NATIVE_TEXT = 80;
const TESSERACT_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';

let tesseractLoadPromise = null;

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

function normalizeReportDate(value) {
    const match = String(value || '').match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
    if (!match) return '';
    return `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}/${match[3]}`;
}

function extractNameAfterGreeting(text) {
    const regionMatch = String(text || '').match(/Estimado\(a\),([\s\S]{0,320}?)(?=NSS\s*:)/i);
    if (!regionMatch) return '';

    const candidates = regionMatch[1]
        .split(/\r?\n/)
        .map(line => line
            .replace(/Fecha de emisión del reporte/gi, ' ')
            .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}\b/g, ' ')
            .replace(/\bD{2}\W*M{2}\W*[VY]?Y{3,4}\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(line =>
            line.length >= 5 &&
            /^[A-ZÁÉÍÓÚÜÑ' .-]+$/u.test(line) &&
            /[A-ZÁÉÍÓÚÜÑ]{2}/u.test(line)
        );

    if (!candidates.length) return '';
    candidates.sort((a, b) => b.length - a.length);
    return smartInstitutionalCase(candidates[0]);
}

function extractTotalWeeks(text) {
    const sectionMatch = String(text || '').match(
        /Total de semanas cotizadas([\s\S]{0,260}?)(?=Tu detalle de semanas cotizadas|Tu historia laboral|$)/i
    );
    if (!sectionMatch) return null;

    const numberMatch = sectionMatch[1].match(/(?:^|[^A-Z0-9])(\d{1,5})(?=$|[^A-Z0-9])/im);
    return numberMatch ? Number(numberMatch[1]) : null;
}

function extractRegistration(block) {
    const match = String(block || '').match(/Registro Patronal\s*([^\r\n]+)/i);
    if (!match) return '';

    let token = match[1].trim().split(/\s+/)[0].toUpperCase();
    token = token.replace(/^[^A-Z0-9(]+/, '').replace(/[^A-Z0-9)-]+$/, '');

    // En impresiones convertidas a trazos, OCR puede confundir una C inicial con "(".
    // Solo corregimos la forma inequívoca: "(" + nueve dígitos.
    if (/^\(\d{9}$/.test(token)) {
        token = `C${token.slice(1)}`;
    }

    token = token.replace(/[^A-Z0-9-]/g, '');
    return /^[A-Z0-9-]{8,14}$/.test(token) ? token : '';
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
    if (reportMatch) {
        summary.reportDate = `${reportMatch[1]}/${reportMatch[2]}/${reportMatch[3]}`;
    } else {
        const reportRegion = text.match(/Fecha de emisión del reporte([\s\S]{0,220})/i);
        if (reportRegion) summary.reportDate = normalizeReportDate(reportRegion[1]);
    }

    summary.totalWeeks = extractTotalWeeks(text);
    if (summary.totalWeeks === null) {
        const totalMatch = text.match(/Total de semanas cotizadas[\s\S]{0,180}?(\d{1,5})/i);
        if (totalMatch) summary.totalWeeks = Number(totalMatch[1]);
    }

    const nameMatch = text.match(/Estimado\(a\),[\s\S]*?(?:\d{4})\s*([A-ZÑÁÉÍÓÚÜ\s]+?)\s*(?:NSS:|DD\s*MM\s*YYYY)/i);
    if (nameMatch?.[1]) {
        summary.name = smartInstitutionalCase(nameMatch[1].replace(/\n/g, ' ').trim());
    } else {
        summary.name = extractNameAfterGreeting(text);
    }

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

async function extractNativeText(pdf) {
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

function defaultCreateCanvas(width, height) {
    if (!globalThis.document?.createElement) {
        throw new Error('No hay un lienzo disponible para ejecutar OCR sobre la constancia IMSS.');
    }

    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
}

async function loadTesseract() {
    if (globalThis.Tesseract?.createWorker) return globalThis.Tesseract;
    if (tesseractLoadPromise) return tesseractLoadPromise;

    if (!globalThis.document?.createElement || !globalThis.document?.head) {
        throw new Error(
            'La constancia IMSS no contiene texto seleccionable y el motor OCR no está disponible.'
        );
    }

    tesseractLoadPromise = new Promise((resolve, reject) => {
        const script = globalThis.document.createElement('script');
        script.src = TESSERACT_CDN_URL;
        script.async = true;
        script.dataset.imssOcr = 'tesseract';

        script.onload = () => {
            if (globalThis.Tesseract?.createWorker) {
                resolve(globalThis.Tesseract);
            } else {
                reject(new Error('El motor OCR se cargó, pero no pudo inicializarse.'));
            }
        };

        script.onerror = () => {
            tesseractLoadPromise = null;
            reject(new Error(
                'La constancia IMSS no contiene texto seleccionable y no fue posible cargar el motor OCR.'
            ));
        };

        globalThis.document.head.appendChild(script);
    });

    return tesseractLoadPromise;
}

async function defaultCreateOcrWorker() {
    const tesseract = await loadTesseract();
    return tesseract.createWorker('spa');
}

async function extractOcrText(
    pdf,
    {
        createOcrWorker = defaultCreateOcrWorker,
        createCanvas = defaultCreateCanvas,
        ocrScale = OCR_RENDER_SCALE
    } = {}
) {
    const worker = await createOcrWorker();
    let fullText = '';

    try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: ocrScale });
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext?.('2d', { willReadFrequently: true });

            if (!context) {
                throw new Error('No fue posible preparar la página del PDF para OCR.');
            }

            await page.render({
                canvasContext: context,
                viewport,
                background: 'white'
            }).promise;

            const result = await worker.recognize(canvas);
            const pageText = String(result?.data?.text || '').trim();
            if (pageText) fullText += `${pageText}\n`;

            // "Importante" marca el fin de la historia laboral en el formato IMSS.
            // Evita OCR innecesario sobre páginas legales/firma, sin depender de ello.
            if (/Tu historia laboral/i.test(fullText) && /(?:^|\n)\s*Importante\s*(?:\n|$)/i.test(fullText)) {
                break;
            }
        }
    } finally {
        if (typeof worker?.terminate === 'function') {
            await worker.terminate();
        }
    }

    return fullText;
}

export async function extractTextFromImssPdf(file, options = {}) {
    const pdfjs = options.pdfjsLib || globalThis.pdfjsLib;
    if (!pdfjs?.getDocument) {
        throw new Error('PDF.js no está disponible para leer la constancia IMSS.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const nativeText = await extractNativeText(pdf);

    // Ruta de compatibilidad: si PDF.js ya reconoce la constancia, no cambia nada.
    if (isImssWeeksReport(nativeText)) return nativeText;

    // OCR únicamente para PDFs sin capa de texto o con una capa residual muy pequeña.
    // Un PDF digital con texto real conserva el comportamiento histórico.
    if (nativeText.trim().length > MAX_SPARSE_NATIVE_TEXT) return nativeText;

    const ocrText = await extractOcrText(pdf, options);
    return ocrText || nativeText;
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
        const registration = extractRegistration(block);
        const startMatch = block.match(/Fecha de alta\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        const endMatch = block.match(/Fecha de baja\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
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

        if (employer || startDate || registration) {
            history.push({
                employer,
                registration,
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
