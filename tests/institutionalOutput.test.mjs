import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateSuggestedDate } from '../js/modules/dateCalculator.js';
import {
    buildInstitutionalOutput,
    INSTITUTIONAL_HEADERS,
    toExcelTsv
} from '../js/modules/institutionalOutput.js';
import { smartInstitutionalCase } from '../js/modules/textFormat.js';

test('genera columnas institucionales en el orden solicitado', () => {
    assert.deepEqual(INSTITUTIONAL_HEADERS, [
        'Sector',
        'Emp-Inst',
        'Puesto',
        'F-Ini',
        'F-Fin',
        'Sueldo',
        'Fuente(s)',
        'Observaciones'
    ]);
});

test('aplica capitalización institucional inteligente', () => {
    assert.equal(
        smartInstitutionalCase('SECRETARÍA ANTICORRUPCIÓN Y BUEN GOBIERNO'),
        'Secretaría Anticorrupción y Buen Gobierno'
    );
    assert.equal(
        smartInstitutionalCase('JEFE(A) DE DEPARTAMENTO DEL ÁREA DE CONTRATACIONES PÚBLICAS'),
        'Jefe(a) de Departamento del Área de Contrataciones Públicas'
    );
    assert.equal(
        smartInstitutionalCase('ÓRGANO INTERNO DE CONTROL OIC'),
        'Órgano Interno de Control OIC'
    );
});

test('normaliza sugerencias de inicio a la frontera quincenal más cercana', () => {
    assert.equal(calculateSuggestedDate('01/12/2024', 'inicio'), '01/12/2024');
    assert.equal(calculateSuggestedDate('14/02/2025', 'inicio'), '16/02/2025');
    assert.equal(calculateSuggestedDate('17/05/2024', 'inicio'), '16/05/2024');
});

test('normaliza sugerencias de término al 15 o al último día real del mes', () => {
    assert.equal(calculateSuggestedDate('13/02/2025', 'termino'), '15/02/2025');
    assert.equal(calculateSuggestedDate('15/01/2025', 'termino'), '15/01/2025');
    assert.equal(calculateSuggestedDate('16/05/2024', 'termino'), '15/05/2024');
    assert.equal(calculateSuggestedDate('30/07/2026', 'termino'), '31/07/2026');
    assert.equal(calculateSuggestedDate('28/06/2025', 'termino'), '30/06/2025');
    assert.equal(calculateSuggestedDate('28/02/2025', 'termino'), '28/02/2025');
    assert.equal(calculateSuggestedDate('28/02/2024', 'termino'), '29/02/2024');
});

test('usa el día anterior al siguiente inicio cuando no existe una baja explícita', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA010101AAA', 'INSTITUCIÓN A', 'ANALISTA', 20000, '01/01/2024', ''],
        ['AAA010101AAA', 'INSTITUCIÓN A', 'JEFATURA', 28000, '01/01/2025', '']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    const chronological = [...output.rows].sort((a, b) => a[3].localeCompare(b[3]));

    assert.equal(chronological[0][3], '01/01/2024');
    assert.equal(chronological[0][4], '31/12/2024');
    assert.equal(chronological[1][3], '01/01/2025');
    assert.equal(chronological[1][4], 'A la fecha');
});

test('respeta la baja anterior y coloca la inactividad en el empleo posterior', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA', 'SECRETARÍA DE LA FUNCIÓN PÚBLICA', 'ANALISTA DE CONTROL', 20000, '16/01/2024', '15/03/2024'],
        ['AAA', 'SECRETARÍA ANTICORRUPCIÓN Y BUEN GOBIERNO', 'JEFE DE DEPARTAMENTO', 28000, '16/07/2024', '']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    const older = output.rows.find(row => row[2] === 'Analista de Control');
    const newer = output.rows.find(row => row[2] === 'Jefe de Departamento');

    assert.equal(older[4], '15/03/2024');
    assert.equal(older[7], '');
    assert.equal(newer[3], '16/07/2024');
    assert.equal(newer[4], 'A la fecha');
    assert.equal(
        newer[7],
        'Se detectó un periodo de inactividad laboral de 4 meses respecto del empleo anterior.'
    );
    assert.equal(older[1], 'Secretaría de la Función Pública');
});

test('describe periodos largos con años y meses y marca vigente el empleo más reciente', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA', 'INSTITUCIÓN ANTERIOR', 'PUESTO ANTERIOR', 20000, '01/01/2017', '31/12/2018'],
        ['AAA', 'INSTITUCIÓN ACTUAL', 'PUESTO ACTUAL', 30000, '16/04/2020', '31/12/2021']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    const older = output.rows.find(row => row[2] === 'Puesto Anterior');
    const newer = output.rows.find(row => row[2] === 'Puesto Actual');

    assert.equal(older[7], '');
    assert.equal(newer[4], 'A la fecha');
    assert.equal(
        newer[7],
        'Se detectó un periodo de inactividad laboral mayor a un año y 3 meses respecto del empleo anterior.'
    );
});

test('no agrega observación cuando la inactividad no supera un mes', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA', 'INSTITUCIÓN A', 'PUESTO UNO', 20000, '01/01/2024', '15/03/2024'],
        ['AAA', 'INSTITUCIÓN B', 'PUESTO DOS', 25000, '01/04/2024', '15/06/2024']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    const newer = output.rows.find(row => row[2] === 'Puesto Dos');
    assert.equal(newer[7], '');
    assert.equal(newer[4], 'A la fecha');
});

test('corrige una anomalía de orden conservando la orientación dominante del RUSP', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA', 'INSTITUCIÓN C', 'PUESTO TRES', 3, '16/07/2024', ''],
        ['AAA', 'INSTITUCIÓN A', 'PUESTO UNO', 1, '16/01/2024', '15/03/2024'],
        ['AAA', 'INSTITUCIÓN B', 'PUESTO DOS', 2, '16/04/2024', '15/06/2024']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    assert.equal(output.rows[0][2], 'Puesto Tres');
    assert.equal(output.rows[0][4], 'A la fecha');
    assert.equal(output.rows[1][2], 'Puesto Dos');
    assert.equal(output.rows[2][2], 'Puesto Uno');
});

test('no mezcla ni elimina periodos idénticos de personas diferentes', () => {
    const headers = [
        'rfc',
        'institucion',
        'nombre_puesto',
        'Sueldo + Compensación',
        'Fecha Sugerida Inicio',
        'Fecha Sugerida Termino'
    ];

    const rows = [
        ['AAA010101AAA', 'Institución A', 'Analista', 20000, '01/01/2024', ''],
        ['BBB010101BBB', 'Institución A', 'Analista', 20000, '01/01/2024', '']
    ];

    const output = buildInstitutionalOutput(headers, rows);
    assert.equal(output.rows.length, 2);
    assert.deepEqual(output.rows[0], output.rows[1]);
});

test('TSV conserva columnas y neutraliza fórmulas de Excel', () => {
    const tsv = toExcelTsv([
        ['Público', '=HYPERLINK("x")', 'Analista', '16/01/2025', 'A la fecha', 27795, 'RUSP', '']
    ]);

    const cells = tsv.split('\t');
    assert.equal(cells.length, 8);
    assert.equal(cells[1], "'=HYPERLINK(\"x\")");
    assert.equal(cells[5], '27795');
});
