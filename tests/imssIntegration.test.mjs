import test from 'node:test';
import assert from 'node:assert/strict';

import {
    combineInstitutionalOutputs,
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
