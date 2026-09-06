import { getCurrentTableData, showAlert } from './modules/uiManager.js';
import {
    buildInstitutionalOutput,
    formatInstitutionalSalary,
    toExcelTsv
} from './modules/institutionalOutput.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isEditModeActive() {
    const banner = document.getElementById('edit-mode-banner');
    return banner && !banner.classList.contains('hidden');
}

function getOutput() {
    const current = getCurrentTableData();
    if (!current.headers.length || !current.rows.length) {
        return { headers: [], rows: [] };
    }
    return buildInstitutionalOutput(current.headers, current.rows);
}

function getInstitutionalCellClass(columnIndex, value) {
    if (columnIndex === 3 && value) return 'institutional-start-date';
    if (columnIndex === 4 && value === 'A la fecha') return 'institutional-current-date';
    if (columnIndex === 4 && value) return 'institutional-end-date';
    if (columnIndex === 7 && value) return 'institutional-observation';
    return '';
}

function renderInstitutionalOutput() {
    const card = document.getElementById('institutional-output-card');
    const tableHead = document.querySelector('#institutional-table thead');
    const tableBody = document.querySelector('#institutional-table tbody');
    const summary = document.getElementById('institutional-output-summary');

    if (!card || !tableHead || !tableBody) return;

    const output = getOutput();
    if (!output.rows.length) {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');
    tableHead.innerHTML = `<tr>${output.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;

    const previewRows = output.rows.slice(0, 25);
    tableBody.innerHTML = previewRows.map((row, rowIndex) => `
        <tr class="${rowIndex % 2 === 0 ? 'even-row' : 'odd-row'}">
            ${row.map((value, columnIndex) => {
                const rendered = columnIndex === 5
                    ? formatInstitutionalSalary(value)
                    : value;
                const cellClass = getInstitutionalCellClass(columnIndex, value);
                return `<td class="${cellClass}">${escapeHtml(rendered)}</td>`;
            }).join('')}
        </tr>
    `).join('');

    if (summary) {
        const inactivityCount = output.rows.filter(row => String(row[7] || '').trim() !== '').length;
        const baseSummary = output.rows.length > previewRows.length
            ? `Vista previa de ${previewRows.length} de ${output.rows.length} registros. El copiado incluye todos.`
            : `${output.rows.length} registro${output.rows.length === 1 ? '' : 's'} listo${output.rows.length === 1 ? '' : 's'} para Excel.`;
        summary.textContent = inactivityCount
            ? `${baseSummary} ${inactivityCount} periodo${inactivityCount === 1 ? '' : 's'} de inactividad detectado${inactivityCount === 1 ? '' : 's'}.`
            : baseSummary;
    }
}

async function writeClipboard(text) {
    if (window.require) {
        try {
            const { clipboard } = window.require('electron');
            if (clipboard && typeof clipboard.writeText === 'function') {
                clipboard.writeText(text);
                return;
            }
        } catch (error) {
            console.warn('No se pudo usar el portapapeles de Electron:', error);
        }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();

    if (!copied) {
        throw new Error('El sistema no permitió escribir en el portapapeles.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const copyButton = document.getElementById('btn-copy-excel');
    const previewTable = document.getElementById('preview-table');

    if (copyButton) {
        copyButton.addEventListener('click', async () => {
            if (isEditModeActive()) {
                showAlert('Guarda y homologa los cambios antes de copiar la salida institucional a Excel.', 'info');
                return;
            }

            const output = getOutput();
            if (!output.rows.length) {
                showAlert('No hay registros disponibles para copiar.', 'info');
                return;
            }

            try {
                await writeClipboard(toExcelTsv(output.rows));
                showAlert(
                    `Se copiaron ${output.rows.length} registro${output.rows.length === 1 ? '' : 's'} con las 8 columnas institucionales. Ve a Excel, selecciona la primera celda de tu tabla y pega con Ctrl+V.`,
                    'success'
                );
            } catch (error) {
                console.error(error);
                showAlert('No fue posible copiar la tabla al portapapeles: ' + error.message, 'error');
            }
        });
    }

    if (previewTable) {
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                renderInstitutionalOutput();
            });
        });

        observer.observe(previewTable, {
            childList: true,
            subtree: true
        });
    }

    renderInstitutionalOutput();
});
