import test from 'node:test';
import assert from 'node:assert/strict';

import {
    combineInstitutionalOutputs,
    extractTextFromImssPdf,
    isImssWeeksReport,
    mapImssHistoryToInstitutional,
    parseImssWeeksText
} from '../js/modules/imssIntegration.js';

const SAMPLE_IMSS_TEXT = `
Constancia de Semanas Cotizadas
NSS: 12345678901
CURP: GORJ900101HDFXXX01
Fecha de emisión del reporte
06 / 09 / 2026
Tu historia laboral
Nombre del patrón
EMPRESA DE SERVICIOS DEL CENTRO SA DE CV
Registro Patronal
Y1234567890
Entidad federativa
CIUDAD DE MÉXICO
Fecha de alta
01/02/2020
Fecha de baja
15/03/2022
Salario Base de Cotización
$ 500.25
Nombre del patrón
INSTITUTO DE PRUEBA
Registro Patronal
A9876543210
Entidad federativa
MÉXICO
Fecha de alta
16/04/2022
Salario Base de Cotización
$ 725.00
Importante
`;

const OCR_IMSS_TEXT = `
gob.mx
Instituto Mexicano del Seguro Social
Constancia de Semanas Cotizadas en el IMSS e
historial de registros afiliatorios de la persona asegurada
Estimado(a), Fecha de emisión del reporte
PERSONA DE PRUEBA 05 / 08 / 2025
DD_ MM vYYYY
NSS: 12345678901 Total de semanas cotizadas
CURP: GORJ900101HDFXXX01 353
Tu detalle de semanas cotizadas
Semanas cotizadas IMSS 353
Tu historia laboral
Nombre del patrón EMPRESA DEMO SA DE CV
Registro Patronal (602756110
Entidad federativa MÉXICO
Fecha de alta 01/11/2019 Fecha de baja 29/02/2020 Salario Base de Cotización * $ 154.33
Importante
`;

function makeFile() {
    return {
        name: 'constancia.pdf',
        async arrayBuffer() {
            return new ArrayBuffer(8);
        }
    };
}

function makePdfjs(nativeText, { pages = 1 } = {}) {
    return {
        getDocument() {
            return {
                promise: Promise.resolve({
                    numPages: pages,
                    async getPage() {
                        return {
                            async getTextContent() {
                                return {
                                    items: nativeText
                                        ? [{ str: nativeText, transform: [1, 0, 0, 1, 0, 0] }]
                                        : []
                                };
                            },
                            getViewport({ scale }) {
                                return { width: 100 * scale, height: 120 * scale };
                            },
                            render() {
                                return { promise: Promise.resolve() };
                            }
                        };
                    }
                })
            };
        }
    };
}

test('reconoce una constancia de semanas cotizadas IMSS por contenido', () => {
    assert.equal(isImssWeeksReport(SAMPLE_IMSS_TEXT), true);
    assert.equal(isImssWeeksReport('documento PDF sin historia laboral'), false);
});

test('extrae historial IMSS con altas, bajas, patrón y SBC', () => {
    const parsed = parseImssWeeksText(SAMPLE_IMSS_TEXT);

    assert.equal(parsed.personal.nss, '12345678901');
    assert.equal(parsed.personal.curp, 'GORJ900101HDFXXX01');
    assert.equal(parsed.history.length, 2);

    assert.deepEqual(parsed.history[0], {
        employer: 'EMPRESA DE SERVICIOS DEL CENTRO SA DE CV',
        registration: 'Y1234567890',
        entity: 'CIUDAD DE MÉXICO',
        startDate: '01/02/2020',
        endDate: '15/03/2022',
        contributionBaseSalary: 500.25
    });

    assert.equal(parsed.history[1].endDate, 'A la fecha');
    assert.equal(parsed.history[1].contributionBaseSalary, 725);
});

test('tolera el orden de texto que produce OCR en una constancia impresa', () => {
    const parsed = parseImssWeeksText(OCR_IMSS_TEXT);

    assert.equal(parsed.personal.name, 'Persona de Prueba');
    assert.equal(parsed.personal.reportDate, '05/08/2025');
    assert.equal(parsed.personal.totalWeeks, 353);
    assert.equal(parsed.history.length, 1);
    assert.equal(parsed.history[0].registration, 'C602756110');
    assert.equal(parsed.history[0].startDate, '01/11/2019');
    assert.equal(parsed.history[0].endDate, '29/02/2020');
    assert.equal(parsed.history[0].contributionBaseSalary, 154.33);
});

test('mantiene la ruta PDF.js existente y no invoca OCR cuando el PDF ya tiene texto válido', async () => {
    let ocrCalls = 0;

    const text = await extractTextFromImssPdf(makeFile(), {
        pdfjsLib: makePdfjs(SAMPLE_IMSS_TEXT),
        createOcrWorker: async () => {
            ocrCalls += 1;
            throw new Error('OCR no debe ejecutarse');
        }
    });

    assert.equal(isImssWeeksReport(text), true);
    assert.equal(ocrCalls, 0);
});

test('usa OCR solo como fallback cuando el PDF no contiene capa de texto', async () => {
    let recognizeCalls = 0;
    let terminated = false;

    const text = await extractTextFromImssPdf(makeFile(), {
        pdfjsLib: makePdfjs(''),
        createCanvas: () => ({
            getContext: () => ({})
        }),
        createOcrWorker: async () => ({
            async recognize() {
                recognizeCalls += 1;
                return { data: { text: OCR_IMSS_TEXT } };
            },
            async terminate() {
                terminated = true;
            }
        })
    });

    assert.equal(isImssWeeksReport(text), true);
    assert.equal(recognizeCalls, 1);
    assert.equal(terminated, true);

    const parsed = parseImssWeeksText(text);
    assert.equal(parsed.personal.totalWeeks, 353);
    assert.equal(parsed.history[0].employer, 'EMPRESA DEMO SA DE CV');
});

test('mapea IMSS directamente a las ocho columnas institucionales sin inventar puesto ni sector', () => {
    const parsed = parseImssWeeksText(SAMPLE_IMSS_TEXT);
    const output = mapImssHistoryToInstitutional(parsed.history);

    assert.deepEqual(output.headers, [
        'Sector', 'Emp-Inst', 'Puesto', 'F-Ini', 'F-Fin', 'Sueldo', 'Fuente(s)', 'Observaciones'
    ]);

    assert.equal(output.rows[0][0], '');
    assert.equal(output.rows[0][1], 'Empresa de Servicios del Centro Sa de Cv');
    assert.equal(output.rows[0][2], '');
    assert.equal(output.rows[0][3], '01/02/2020');
    assert.equal(output.rows[0][4], '15/03/2022');
    assert.equal(output.rows[0][5], 500.25);
    assert.equal(output.rows[0][6], 'IMSS');
    assert.match(output.rows[0][7], /Puesto y sector no reportados/i);
    assert.match(output.rows[0][7], /SBC reportado por IMSS/i);
});

test('al combinar RUSP e IMSS ordena la trayectoria por fecha de inicio sin alterar el formato', () => {
    const ruspOutput = {
        headers: ['Sector', 'Emp-Inst', 'Puesto', 'F-Ini', 'F-Fin', 'Sueldo', 'Fuente(s)', 'Observaciones'],
        rows: [
            ['Público', 'Institución RUSP', 'Analista', '16/01/2024', '15/01/2025', 20000, 'RUSP', '']
        ]
    };

    const imssOutput = {
        headers: ruspOutput.headers,
        rows: [
            ['', 'Empresa IMSS', '', '01/02/2025', 'A la fecha', 700, 'IMSS', 'SBC IMSS']
        ]
    };

    const combined = combineInstitutionalOutputs([ruspOutput, imssOutput]);
    assert.equal(combined.rows.length, 2);
    assert.equal(combined.rows[0][6], 'IMSS');
    assert.equal(combined.rows[1][6], 'RUSP');
    assert.equal(combined.rows[0].length, 8);
    assert.equal(combined.rows[1].length, 8);
});

test('con una sola fuente conserva su orden original', () => {
    const onlyImss = {
        headers: ['Sector', 'Emp-Inst', 'Puesto', 'F-Ini', 'F-Fin', 'Sueldo', 'Fuente(s)', 'Observaciones'],
        rows: [
            ['', 'Primero', '', '01/01/2020', '01/01/2021', 1, 'IMSS', ''],
            ['', 'Segundo', '', '01/01/2025', 'A la fecha', 2, 'IMSS', '']
        ]
    };

    const combined = combineInstitutionalOutputs([null, onlyImss]);
    assert.equal(combined.rows[0][1], 'Primero');
    assert.equal(combined.rows[1][1], 'Segundo');
});
