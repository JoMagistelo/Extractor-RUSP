/**
 * RUSP Extractor Institucional - Controlador principal.
 * Admite una fuente RUSP (Excel), una Constancia de Semanas Cotizadas IMSS (PDF) o ambas.
 */

import {
    processExcelData,
    downloadFilteredExcel,
    getFilteredData,
    homologateSimplifiedData,
    getSimplifiedColumns
} from './modules/excelProcessor.js';
import {
    toggleLoading,
    renderStats,
    renderPreviewTable,
    showAlert,
    clearAlert
} from './modules/uiManager.js';
import {
    processImssPdf,
    setCurrentImssResult
} from './modules/imssIntegration.js';
import { smartInstitutionalCase } from './modules/textFormat.js';

let processedData = null;
let imssData = null;
let activeDataset = 'original'; // 'original' | 'edited'
let isEditMode = false;
let draftHeaders = null;
let draftRows = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMoney(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? '';
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const btnSelectFile = document.getElementById('btn-select-file');
    const resultsSection = document.getElementById('results-section');
    const ruspStatsCard = document.getElementById('rusp-stats-card');
    const ruspWorkCard = document.getElementById('rusp-work-card');
    const ruspActionBar = document.getElementById('rusp-action-bar');
    const imssHistoryCard = document.getElementById('imss-history-card');
    const imssHistoryBody = document.querySelector('#imss-history-table tbody');
    const imssSummary = document.getElementById('imss-summary');
    const ruspSourceStatus = document.getElementById('source-rusp-status');
    const imssSourceStatus = document.getElementById('source-imss-status');

    const searchInput = document.getElementById('table-search');
    const chkShowUR = document.getElementById('chk-show-ur');
    const chkHomologateUR = document.getElementById('chk-homologate-ur');
    const wrapperHomologateUR = document.getElementById('wrapper-homologate-ur');

    const btnDownloadSimplificado = document.getElementById('btn-download-simplificado');
    const downloadBtnText = document.getElementById('download-btn-text');
    const btnEditSimplificado = document.getElementById('btn-edit-simplificado');
    const btnSaveEdit = document.getElementById('btn-save-edit');
    const btnCancelEdit = document.getElementById('btn-cancel-edit');
    const btnToggleVersion = document.getElementById('btn-toggle-version');
    const editModeBanner = document.getElementById('edit-mode-banner');
    const activeVersionBadge = document.getElementById('active-version-badge');
    const versionLabel = document.getElementById('version-label');
    const appVersionBadge = document.getElementById('app-version-badge');

    if (globalThis.pdfjsLib?.GlobalWorkerOptions) {
        globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    }

    // La versión se muestra de forma discreta; no hay controles de actualización en la interfaz.
    if (window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            if (ipcRenderer) {
                ipcRenderer.invoke('get-app-version').then(ver => {
                    if (ver && appVersionBadge) appVersionBadge.textContent = `v${ver}`;
                }).catch(() => {});
            }
        } catch (e) {}
    }

    function setSourceStatus(element, fileName) {
        if (!element) return;
        const value = element.querySelector('strong');
        if (fileName) {
            element.classList.add('loaded');
            if (value) value.textContent = fileName;
        } else {
            element.classList.remove('loaded');
            if (value) value.textContent = 'No cargado';
        }
    }

    function getActiveColumns() {
        return getSimplifiedColumns(chkShowUR && chkShowUR.checked);
    }

    function renderImssHistory() {
        if (!imssData || !imssHistoryBody) return;

        imssHistoryBody.innerHTML = imssData.history.map(item => {
            const employer = smartInstitutionalCase(item.employer || '');
            const entity = smartInstitutionalCase(item.entity || '');
            const endClass = item.endDate === 'A la fecha' ? 'imss-current-date' : 'imss-end-date';
            return `
                <tr>
                    <td>${escapeHtml(employer)}</td>
                    <td>${escapeHtml(item.registration)}</td>
                    <td>${escapeHtml(entity)}</td>
                    <td class="imss-start-date">${escapeHtml(item.startDate)}</td>
                    <td class="${endClass}">${escapeHtml(item.endDate)}</td>
                    <td>${escapeHtml(formatMoney(item.contributionBaseSalary))}</td>
                </tr>
            `;
        }).join('');

        if (imssSummary) {
            const count = imssData.history.length;
            const weeks = Number.isFinite(imssData.personal?.totalWeeks)
                ? ` · ${imssData.personal.totalWeeks.toLocaleString('es-MX')} semanas cotizadas reportadas`
                : '';
            imssSummary.textContent = `${count} periodo${count === 1 ? '' : 's'} laboral${count === 1 ? '' : 'es'} IMSS${weeks}.`;
        }
    }

    function refreshResults({ scroll = false } = {}) {
        const hasRusp = !!processedData;
        const hasImss = !!imssData;
        const hasAny = hasRusp || hasImss;

        if (resultsSection) resultsSection.classList.toggle('hidden', !hasAny);
        if (ruspStatsCard) ruspStatsCard.classList.toggle('hidden', !hasRusp);
        if (ruspWorkCard) ruspWorkCard.classList.toggle('hidden', !hasRusp);
        if (ruspActionBar) ruspActionBar.classList.toggle('hidden', !hasRusp);
        if (imssHistoryCard) imssHistoryCard.classList.toggle('hidden', !hasImss);

        if (hasRusp) {
            updateUIState();
            renderStats(processedData.stats);
            updateTableDisplay();
        }

        if (hasImss) renderImssHistory();

        document.dispatchEvent(new CustomEvent('institutional-source-updated'));

        if (hasAny && scroll && resultsSection) {
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    if (chkShowUR) {
        chkShowUR.checked = false;
        chkShowUR.addEventListener('change', updateTableDisplay);
    }

    if (chkHomologateUR) {
        chkHomologateUR.addEventListener('change', updateTableDisplay);
    }

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-active');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-active');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files;
            if (files?.length) handleFiles(files);
        });
    }

    if (btnSelectFile && fileInput) {
        btnSelectFile.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = '';
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', updateTableDisplay);
    }

    if (btnEditSimplificado) {
        btnEditSimplificado.addEventListener('click', () => {
            if (!processedData) return;

            isEditMode = true;
            const fullCols = getSimplifiedColumns(true);
            draftHeaders = [...fullCols];

            const sourceHeaders = (activeDataset === 'edited' && processedData.editedSimplificado)
                ? processedData.editedSimplificado.headers
                : processedData.simplificado.headers;

            const sourceRows = (activeDataset === 'edited' && processedData.editedSimplificado)
                ? processedData.editedSimplificado.rows
                : processedData.simplificado.rows;

            const filtered = getFilteredData(sourceHeaders, sourceRows, fullCols);
            draftRows = filtered.rows.map(r => [...r]);

            if (editModeBanner) editModeBanner.classList.remove('hidden');
            if (btnSaveEdit) btnSaveEdit.classList.remove('hidden');
            if (btnCancelEdit) btnCancelEdit.classList.remove('hidden');
            if (wrapperHomologateUR) wrapperHomologateUR.classList.remove('hidden');

            if (btnEditSimplificado) btnEditSimplificado.classList.add('hidden');
            if (btnDownloadSimplificado) btnDownloadSimplificado.classList.add('hidden');
            if (btnToggleVersion) btnToggleVersion.classList.add('hidden');

            updateTableDisplay();
        });
    }

    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            isEditMode = false;
            draftRows = null;

            if (editModeBanner) editModeBanner.classList.add('hidden');
            if (btnSaveEdit) btnSaveEdit.classList.add('hidden');
            if (btnCancelEdit) btnCancelEdit.classList.add('hidden');
            if (wrapperHomologateUR) wrapperHomologateUR.classList.add('hidden');

            if (btnEditSimplificado) btnEditSimplificado.classList.remove('hidden');
            if (btnDownloadSimplificado) btnDownloadSimplificado.classList.remove('hidden');

            if (processedData?.editedSimplificado && btnToggleVersion) {
                btnToggleVersion.classList.remove('hidden');
            }

            updateTableDisplay();
            showAlert('Edición cancelada. Los cambios no guardados fueron descartados.', 'info');
        });
    }

    if (btnSaveEdit) {
        btnSaveEdit.addEventListener('click', () => {
            if (!processedData || !draftRows || !draftHeaders) return;

            try {
                const homologateUR = chkHomologateUR ? chkHomologateUR.checked : false;
                const homologatedRows = homologateSimplifiedData(draftHeaders, draftRows, { homologateUR });

                processedData.editedSimplificado = {
                    headers: draftHeaders,
                    rows: homologatedRows
                };
                processedData.stats.editedCount = homologatedRows.length;

                isEditMode = false;
                activeDataset = 'edited';
                draftRows = null;

                if (editModeBanner) editModeBanner.classList.add('hidden');
                if (btnSaveEdit) btnSaveEdit.classList.add('hidden');
                if (btnCancelEdit) btnCancelEdit.classList.add('hidden');
                if (wrapperHomologateUR) wrapperHomologateUR.classList.add('hidden');
                if (btnEditSimplificado) btnEditSimplificado.classList.remove('hidden');
                if (btnDownloadSimplificado) btnDownloadSimplificado.classList.remove('hidden');
                if (btnToggleVersion) {
                    btnToggleVersion.classList.remove('hidden');
                    btnToggleVersion.textContent = 'Ver versión original';
                }

                updateUIState();
                renderStats(processedData.stats);
                updateTableDisplay();
                document.dispatchEvent(new CustomEvent('institutional-source-updated'));
                showAlert(`RUSP Simplificado editado y homologado con éxito. Se consolidaron ${homologatedRows.length} registros.`, 'success');
            } catch (err) {
                console.error(err);
                showAlert('Error al homologar los registros editados: ' + err.message, 'error');
            }
        });
    }

    if (btnToggleVersion) {
        btnToggleVersion.addEventListener('click', () => {
            if (!processedData?.editedSimplificado) return;

            if (activeDataset === 'original') {
                activeDataset = 'edited';
                btnToggleVersion.textContent = 'Ver versión original';
            } else {
                activeDataset = 'original';
                btnToggleVersion.textContent = 'Ver versión ajustada';
            }

            updateUIState();
            updateTableDisplay();
            document.dispatchEvent(new CustomEvent('institutional-source-updated'));
        });
    }

    if (btnDownloadSimplificado) {
        btnDownloadSimplificado.addEventListener('click', () => {
            if (!processedData) return;
            const targetCols = getActiveColumns();

            if (activeDataset === 'edited' && processedData.editedSimplificado) {
                downloadFilteredExcel(
                    processedData.editedSimplificado.headers,
                    processedData.editedSimplificado.rows,
                    targetCols,
                    'Reporte_RUSP_Simplificado_Ajustado.xlsx'
                );
            } else {
                downloadFilteredExcel(
                    processedData.simplificado.headers,
                    processedData.simplificado.rows,
                    targetCols,
                    'Reporte_RUSP_Simplificado.xlsx'
                );
            }
        });
    }

    async function processRuspFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const parsed = processExcelData(arrayBuffer);

        processedData = parsed;
        activeDataset = 'original';
        isEditMode = false;
        draftRows = null;
        draftHeaders = null;
        processedData.editedSimplificado = null;

        if (btnToggleVersion) btnToggleVersion.classList.add('hidden');
        if (editModeBanner) editModeBanner.classList.add('hidden');
        if (btnSaveEdit) btnSaveEdit.classList.add('hidden');
        if (btnCancelEdit) btnCancelEdit.classList.add('hidden');
        if (wrapperHomologateUR) wrapperHomologateUR.classList.add('hidden');
        if (btnEditSimplificado) btnEditSimplificado.classList.remove('hidden');
        if (btnDownloadSimplificado) btnDownloadSimplificado.classList.remove('hidden');

        setSourceStatus(ruspSourceStatus, file.name);
        return `RUSP: ${file.name}`;
    }

    async function processImssFile(file) {
        const parsed = await processImssPdf(file);
        if (!parsed.history.length) {
            throw new Error('La constancia IMSS fue reconocida, pero no se encontraron periodos de historia laboral.');
        }

        imssData = parsed;
        setCurrentImssResult(parsed);
        setSourceStatus(imssSourceStatus, file.name);
        return `IMSS: ${file.name}`;
    }

    async function handleFiles(fileList) {
        clearAlert();
        const files = Array.from(fileList || []);
        if (!files.length) return;

        const ruspFiles = files.filter(file => /\.(xlsx|xls)$/i.test(file.name));
        const imssFiles = files.filter(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
        const supported = new Set([...ruspFiles, ...imssFiles]);
        const unsupported = files.filter(file => !supported.has(file));

        if (unsupported.length) {
            showAlert('Solo se admiten archivos Excel RUSP (.xlsx/.xls) y Constancias IMSS en PDF.', 'error');
            return;
        }
        if (ruspFiles.length > 1 || imssFiles.length > 1) {
            showAlert('Se admite como máximo un archivo RUSP y una constancia IMSS por carga.', 'error');
            return;
        }

        toggleLoading(true);
        const loaded = [];
        try {
            if (ruspFiles[0]) loaded.push(await processRuspFile(ruspFiles[0]));
            if (imssFiles[0]) loaded.push(await processImssFile(imssFiles[0]));

            refreshResults({ scroll: true });
            showAlert(
                `${loaded.map(value => `<strong>${escapeHtml(value)}</strong>`).join(' · ')} procesado${loaded.length === 1 ? '' : 's'} correctamente. La salida institucional ya integra las fuentes disponibles.`,
                'success'
            );
        } catch (err) {
            console.error(err);
            refreshResults({ scroll: false });
            showAlert('No fue posible procesar uno de los archivos: ' + escapeHtml(err.message), 'error');
        } finally {
            toggleLoading(false);
        }
    }

    function updateUIState() {
        if (!processedData) return;

        if (activeDataset === 'edited') {
            if (activeVersionBadge) {
                activeVersionBadge.textContent = 'Ajustado / Homologado';
                activeVersionBadge.className = 'badge-version badge-edited';
            }
            if (versionLabel) versionLabel.textContent = 'RUSP Simplificado Ajustado';
            if (downloadBtnText) downloadBtnText.textContent = 'DESCARGAR RUSP AJUSTADO';
        } else {
            if (activeVersionBadge) {
                activeVersionBadge.textContent = 'Original';
                activeVersionBadge.className = 'badge-version badge-original';
            }
            if (versionLabel) versionLabel.textContent = 'RUSP Simplificado';
            if (downloadBtnText) downloadBtnText.textContent = 'DESCARGAR RUSP SIMPLIFICADO';
        }
    }

    function updateTableDisplay() {
        if (!processedData) return;

        if (isEditMode && draftRows && draftHeaders) {
            const activeCols = getActiveColumns();
            const displayData = getFilteredData(draftHeaders, draftRows, activeCols);

            const normDraftHeaders = draftHeaders.map(h => h.toLowerCase().trim());
            const displayColToDraftColMap = displayData.headers.map(dh => {
                const normDh = dh.toLowerCase().trim();
                return normDraftHeaders.findIndex(nh => nh === normDh);
            });

            renderPreviewTable(displayData.headers, displayData.rows, 1, {
                isEditMode: true,
                onCellChange: (rIdxInDisplay, cIdxInDisplay, val) => {
                    const draftColIdx = displayColToDraftColMap[cIdxInDisplay];
                    if (draftColIdx !== undefined && draftColIdx !== -1 && draftRows[rIdxInDisplay]) {
                        draftRows[rIdxInDisplay][draftColIdx] = val;
                    }
                }
            });
            return;
        }

        const targetCols = getActiveColumns();

        if (activeDataset === 'edited' && processedData.editedSimplificado) {
            const simpData = getFilteredData(
                processedData.editedSimplificado.headers,
                processedData.editedSimplificado.rows,
                targetCols
            );
            renderPreviewTable(simpData.headers, simpData.rows, 1, { isEditMode: false });
            return;
        }

        const simpData = getFilteredData(
            processedData.simplificado.headers,
            processedData.simplificado.rows,
            targetCols
        );
        renderPreviewTable(simpData.headers, simpData.rows, 1, { isEditMode: false });
    }

    setSourceStatus(ruspSourceStatus, null);
    setSourceStatus(imssSourceStatus, null);
    refreshResults();
});
