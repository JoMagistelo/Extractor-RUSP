import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateSuggestedDate } from '../js/modules/dateCalculator.js';
import {
    buildInstitutionalOutput,
    INSTITUTIONAL_HEADERS,
    toExcelTsv
} from '../js/modules/institutionalOutput.js';

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

test('normaliza sugerencias de inicio al 16 y término al 15', () => {
    assert.equal(calculateSuggestedDate('01/01/2025', 'inicio'), '16/01/2025');
    assert.equal(calculateSuggestedDate('20/01/2025', 'inicio'), '16/02/2025');
    assert.equal(calculateSuggestedDate('15/01/2025', 'termino'), '15/01/2025');
    assert.equal(calculateSuggestedDate('16/01/2025', 'termino'), '15/02/2025');
    assert.equal(calculateSuggestedDate('31/12/2025', 'termino'), '15/01/2026');
});

test('cierra una baja el 15 y abre la siguiente alta el 16', () => {
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
        ['AAA010101AAA', 'Institución A', 'Jefatura', 28000, '01/01/2025', '']
    ];

    const output = buildInstitutionalOutput(headers, rows);

    assert.equal(output.rows[0][3], '16/01/2024');
    assert.equal(output.rows[0][4], '15/01/2025');
    assert.equal(output.rows[1][3], '16/01/2025');
    assert.equal(output.rows[1][4], 'A la fecha');
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
    assert.equal(output.rows[0][4], 'A la fecha');
    assert.equal(output.rows[1][4], 'A la fecha');
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
