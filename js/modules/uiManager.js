/**
 * Módulo UIManager
 * Encargado de gestionar la representación gráfica, alertas, animaciones y tablas interactivas en el DOM.
 */

import { smartInstitutionalCase } from './textFormat.js';

let currentTableData = {
    headers: [],
    rows: []
};
let currentPage = 1;
const rowsPerPage = 15;

const HIDDEN_MAIN_HEADERS = new Set([
    'rfc', 'anio', 'ano', 'year', 'mes', 'month', 'quincena', 'fortnight'
]);

const SMART_TEXT_HEADERS = new Set([
    'institucion', 'nombreinstitucion', 'entidad', 'inst', 'nombrepuesto', 'puesto'
]);

function normalizeHeader(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_-]+/g, '')
        .trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function displayValue(header, value) {
    return SMART_TEXT_HEADERS.has(normalizeHeader(header))
        ? smartInstitutionalCase(value)
        : value;
}

/**
 * Muestra u oculta el indicador de carga (Spinner).
 * @param {boolean} show
 */
export function toggleLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        if (show) {
            loadingEl.classList.remove('hidden');
        } else {
            loadingEl.classList.add('hidden');
        }
    }
}

/**
 * Muestra un mensaje de alerta (éxito o error) al usuario.
 * @param {string} message
 * @param {'error'|'success'|'info'} type
 */
export function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('alert-box');
    if (!alertBox) return;

    alertBox.className = `alert-container alert-${type}`;
    alertBox.innerHTML = `
        <div class="alert-content">
            <span class="alert-icon">${type === 'error' ? '⚠️' : '✅'}</span>
            <span class="alert-message">${message}</span>
        </div>
        <button class="alert-close" onclick="document.getElementById('alert-box').classList.add('hidden')">&times;</button>
    `;
    alertBox.classList.remove('hidden');

    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Oculta la caja de alertas.
 */
export function clearAlert() {
    const alertBox = document.getElementById('alert-box');
    if (alertBox) {
        alertBox.classList.add('hidden');
    }
}

/**
 * Renderiza las tarjetas de estadísticas del procesamiento.
 * @param {{ totalOriginal: number, eliminated: number, preserved: number }} stats
 */
export function renderStats(stats) {
    const statsContainer = document.getElementById('stats-container');
    if (!statsContainer) return;

    const simpCardHtml = stats.simplificadoCount !== undefined ? `
        <div class="stat-card stat-simplificado">
            <div class="stat-value">${stats.simplificadoCount.toLocaleString()}</div>
            <div class="stat-label">Registros RUSP Simplificado</div>
        </div>
    ` : '';

    const editedCardHtml = (stats.editedCount !== undefined && stats.editedCount !== null) ? `
        <div class="stat-card stat-edited">
            <div class="stat-value">${stats.editedCount.toLocaleString()}</div>
            <div class="stat-label">Registros RUSP Ajustado</div>
        </div>
    ` : '';

    statsContainer.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${stats.totalOriginal.toLocaleString()}</div>
            <div class="stat-label">Filas Originales</div>
        </div>
        <div class="stat-card stat-eliminated">
            <div class="stat-value">-${stats.eliminated.toLocaleString()}</div>
            <div class="stat-label">Filas Eliminadas</div>
        </div>
        <div class="stat-card stat-preserved">
            <div class="stat-value">${stats.preserved.toLocaleString()}</div>
            <div class="stat-label">Filas Conservadas</div>
        </div>
        ${simpCardHtml}
        ${editedCardHtml}
    `;
}

/**
 * Renderiza la vista previa de la tabla con paginación, búsqueda u opción de edición interactiva.
 * RFC, año, mes y quincena se mantienen internamente para cálculos/exportaciones,
 * pero no se muestran en la tabla principal.
 * @param {Array<string>} headers
 * @param {Array<Array>} rows
 * @param {number} page
 * @param {Object} options - { isEditMode: boolean, onCellChange: Function }
 */
export function renderPreviewTable(headers, rows, page = 1, options = {}) {
    currentTableData = { headers, rows };
    currentPage = page;

    const isEditMode = !!options.isEditMode;
    const onCellChange = options.onCellChange || null;

    const tableHead = document.querySelector('#preview-table thead');
    const tableBody = document.querySelector('#preview-table tbody');
    const paginationEl = document.getElementById('table-pagination');

    if (!tableHead || !tableBody) return;

    const normHeaders = headers.map(normalizeHeader);
    const instColIdx = normHeaders.findIndex(h => ['institucion', 'nombreinstitucion', 'entidad', 'inst'].includes(h));
    const urColIdx = normHeaders.findIndex(h => ['urreportada', 'ur', 'unidadresponsable'].includes(h));
    const puestoColIdx = normHeaders.findIndex(h => ['nombrepuesto', 'puesto'].includes(h));

    const displayHeaderIndices = headers
        .map((h, i) => (h && h.trim() !== '' && !HIDDEN_MAIN_HEADERS.has(normHeaders[i]) ? i : -1))
        .filter(i => i !== -1);

    const searchInput = document.getElementById('table-search');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const indexedRows = rows.map((r, idx) => ({ row: r, globalIdx: idx }));

    let filteredIndexedRows = indexedRows;
    if (searchTerm) {
        filteredIndexedRows = indexedRows.filter(({ row }) =>
            displayHeaderIndices.some(cIdx => String(row[cIdx] || '').toLowerCase().includes(searchTerm))
        );
    }

    tableHead.innerHTML = `
        <tr>
            ${displayHeaderIndices.map(idx => `<th>${escapeHtml(headers[idx])}</th>`).join('')}
        </tr>
    `;

    const totalRows = filteredIndexedRows.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * rowsPerPage;
    const endIdx = Math.min(startIdx + rowsPerPage, totalRows);
    const pageIndexedRows = filteredIndexedRows.slice(startIdx, endIdx);

    if (pageIndexedRows.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="${displayHeaderIndices.length}" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    No se encontraron registros en esta vista.
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = pageIndexedRows.map(({ row, globalIdx }, rIdx) => `
            <tr class="${rIdx % 2 === 0 ? 'even-row' : 'odd-row'}">
                ${displayHeaderIndices.map(cIdx => {
                    const rawVal = row[cIdx] !== undefined && row[cIdx] !== null ? row[cIdx] : '';
                    const val = displayValue(headers[cIdx], rawVal);
                    const isEditableCol = isEditMode && (cIdx === instColIdx || cIdx === urColIdx || cIdx === puestoColIdx);

                    if (isEditableCol) {
                        return `<td class="editable-td">
                            <input type="text"
                                   class="table-edit-input"
                                   data-global-idx="${globalIdx}"
                                   data-col-idx="${cIdx}"
                                   value="${escapeHtml(val)}"
                                   placeholder="Ingresa valor..." />
                        </td>`;
                    }

                    const normalized = normHeaders[cIdx];
                    const isDate = normalized.includes('fechareal');
                    const isSuggested = normalized.includes('fechasugerida');
                    const isTotal = normalizeHeader(headers[cIdx]) === normalizeHeader('Sueldo + Compensación');
                    let cellClass = '';
                    if (isDate && val) cellClass = 'date-badge';
                    if (isSuggested && val) cellClass = 'suggested-date-badge';
                    if (isTotal) cellClass = 'total-badge';
                    return `<td class="${cellClass}">${escapeHtml(val)}</td>`;
                }).join('')}
            </tr>
        `).join('');

        if (isEditMode && onCellChange) {
            tableBody.oninput = (e) => {
                if (e.target && e.target.classList.contains('table-edit-input')) {
                    const gIdx = parseInt(e.target.dataset.globalIdx, 10);
                    const cIdx = parseInt(e.target.dataset.colIdx, 10);
                    const newVal = e.target.value;
                    onCellChange(gIdx, cIdx, newVal);
                }
            };
        } else {
            tableBody.oninput = null;
        }
    }

    if (paginationEl) {
        paginationEl.innerHTML = `
            <div class="pagination-info">
                Mostrando ${totalRows === 0 ? 0 : startIdx + 1} - ${endIdx} de ${totalRows} registros
            </div>
            <div class="pagination-controls">
                <button class="btn-page" ${currentPage === 1 ? 'disabled' : ''} id="btn-prev-page">&laquo; Anterior</button>
                <span class="page-number">Página ${currentPage} de ${totalPages}</span>
                <button class="btn-page" ${currentPage >= totalPages ? 'disabled' : ''} id="btn-next-page">Siguiente &raquo;</button>
            </div>
        `;

        const prevBtn = document.getElementById('btn-prev-page');
        const nextBtn = document.getElementById('btn-next-page');

        if (prevBtn) prevBtn.onclick = () => renderPreviewTable(headers, rows, currentPage - 1, options);
        if (nextBtn) nextBtn.onclick = () => renderPreviewTable(headers, rows, currentPage + 1, options);
    }
}

/**
 * Devuelve una copia del conjunto completo que alimenta la tabla activa.
 * No se limita a la página visible, por lo que puede utilizarse para exportaciones
 * y acciones de portapapeles sin perder registros por paginación.
 */
export function getCurrentTableData() {
    return {
        headers: [...currentTableData.headers],
        rows: currentTableData.rows.map(row => [...row])
    };
}
