/**
 * Extractor Excel Institucional - Controlador Principal (App)
 * Arquitectura Modular JavaScript ES Modules.
 */

import { processExcelData, downloadFilteredExcel, getFilteredData, homologateSimplifiedData, getSimplifiedColumns, SIMPLIFIED_RUSP_COLUMNS } from './modules/excelProcessor.js';
import { toggleLoading, renderStats, renderPreviewTable, showAlert, clearAlert } from './modules/uiManager.js';

let processedData = null;
let activeDataset = 'original'; // 'original' | 'edited'
let isEditMode = false;
let draftHeaders = null;
let draftRows = null;

document.addEventListener('DOMContentLoaded', () => {
    // Referencias al DOM
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const btnSelectFile = document.getElementById('btn-select-file');
    const resultsSection = document.getElementById('results-section');
    const searchInput = document.getElementById('table-search');
    const chkShowUR = document.getElementById('chk-show-ur');
    const chkHomologateUR = document.getElementById('chk-homologate-ur');
    const wrapperHomologateUR = document.getElementById('wrapper-homologate-ur');

    // Botones de Acción
    const btnDownloadSimplificado = document.getElementById('btn-download-simplificado');
    const downloadBtnText = document.getElementById('download-btn-text');
    const btnEditSimplificado = document.getElementById('btn-edit-simplificado');
    const btnSaveEdit = document.getElementById('btn-save-edit');
    const btnCancelEdit = document.getElementById('btn-cancel-edit');
    const btnToggleVersion = document.getElementById('btn-toggle-version');
    const editModeBanner = document.getElementById('edit-mode-banner');
    const activeVersionBadge = document.getElementById('active-version-badge');
    const versionLabel = document.getElementById('version-label');

    const btnCheckUpdate = document.getElementById('btn-check-update');
    const appVersionBadge = document.getElementById('app-version-badge');

    // Inicializar versión en UI y eventos de auto-actualización desde Electron
    if (window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            if (ipcRenderer) {
                ipcRenderer.invoke('get-app-version').then(ver => {
                    if (ver && appVersionBadge) appVersionBadge.textContent = `v${ver}`;
                }).catch(() => {});

                // Escuchar estado de actualización automática desde electron-updater
                ipcRenderer.on('auto-update-status', (event, data) => {
                    if (!data) return;
                    if (data.status === 'downloading') {
                        if (btnCheckUpdate) {
                            btnCheckUpdate.disabled = true;
                            btnCheckUpdate.innerHTML = `⏳ Descargando ${data.percent}%...`;
                        }
                    } else if (data.status === 'downloaded') {
                        if (btnCheckUpdate) {
                            btnCheckUpdate.disabled = false;
                            btnCheckUpdate.innerHTML = `🔄 Reiniciar para actualizar`;
                        }
                        showAlert(`🎉 <strong>¡Actualización descargada!</strong> La versión v${data.version} está lista. <a href="#" id="link-restart-app" style="color:#38bdf8;text-decoration:underline;margin-left:8px;font-weight:600;">Haz clic aquí para reiniciar e instalar</a>`, 'success');
                        
                        const linkRestart = document.getElementById('link-restart-app');
                        if (linkRestart) {
                            linkRestart.addEventListener('click', (e) => {
                                e.preventDefault();
                                ipcRenderer.send('restart-and-install-update');
                            });
                        }

                        if (confirm(`🎉 ¡ACTUALIZACIÓN LISTA!\n\nSe ha descargado la versión v${data.version}.\n\n¿Deseas reiniciar la aplicación ahora para instalar la actualización?`)) {
                            ipcRenderer.send('restart-and-install-update');
                        }
                    } else if (data.status === 'not-available') {
                        if (btnCheckUpdate) {
                            btnCheckUpdate.disabled = false;
                            btnCheckUpdate.innerHTML = '🔄 Buscar actualización';
                        }
                        showAlert(`✅ Tienes instalada la versión más reciente.`, 'success');
                    } else if (data.status === 'error') {
                        if (btnCheckUpdate) {
                            btnCheckUpdate.disabled = false;
                            btnCheckUpdate.innerHTML = '🔄 Buscar actualización';
                        }
                    }
                });
            }
        } catch (e) {}
    }

    if (btnCheckUpdate) {
        btnCheckUpdate.addEventListener('click', () => {
            checkForUpdates();
        });
    }

    /**
     * Consulta actualizaciones automáticas vía electron-updater o consulta la API de GitHub
     */
    async function checkForUpdates() {
        const GITHUB_REPO_URL = 'https://github.com/JoMagistelo/Extractor-RUSP';
        const GITHUB_API_URL = 'https://api.github.com/repos/JoMagistelo/Extractor-RUSP/releases/latest';
        
        let originalHTML = '🔄 Buscar actualización';
        if (btnCheckUpdate) {
            originalHTML = btnCheckUpdate.innerHTML;
            btnCheckUpdate.disabled = true;
            btnCheckUpdate.innerHTML = '⏳ Buscando...';
        }

        // Intento 1: electron-updater (si la app está empaquetada como ejecutable)
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                if (ipcRenderer) {
                    const res = await ipcRenderer.invoke('trigger-auto-update-check');
                    if (res && res.supported && !res.error) {
                        // El proceso de auto-updater tomará el control vía eventos 'auto-update-status'
                        return;
                    }
                }
            } catch (e) {}
        }

        // Intento 2 / Fallback: Consulta directa a GitHub Releases API
        try {
            const response = await fetch(GITHUB_API_URL, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    showAlert(`No se encontraron lanzamientos ("releases") en GitHub aún. Puedes consultar el repositorio oficial en <a href="#" id="link-repo-direct" style="color:#38bdf8;text-decoration:underline;font-weight:600;">JoMagistelo/Extractor-RUSP</a>.`, 'info');
                    const linkRepo = document.getElementById('link-repo-direct');
                    if (linkRepo) {
                        linkRepo.addEventListener('click', (e) => {
                            e.preventDefault();
                            openExternalLink(GITHUB_REPO_URL);
                        });
                    }
                } else {
                    showAlert(`No se pudo consultar actualizaciones. Código HTTP: ${response.status}.`, 'info');
                }
                return;
            }

            const data = await response.json();
            const latestVersionTag = (data.tag_name || '').replace(/^v/i, '').trim();
            const releaseUrl = data.html_url || `${GITHUB_REPO_URL}/releases`;

            let currentVersion = '1.0.0';
            if (window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    if (ipcRenderer) {
                        const ver = await ipcRenderer.invoke('get-app-version');
                        if (ver) currentVersion = ver;
                    }
                } catch (e) {}
            }

            const isNewer = compareSemVer(latestVersionTag, currentVersion) > 0;

            if (isNewer) {
                showAlert(`🎉 <strong>¡Nueva versión v${latestVersionTag} disponible!</strong> <a href="#" id="link-open-release" style="color:#38bdf8;text-decoration:underline;margin-left:8px;font-weight:600;">Haz clic aquí para descargar la última versión</a>`, 'success');
                
                const linkRelease = document.getElementById('link-open-release');
                if (linkRelease) {
                    linkRelease.addEventListener('click', (e) => {
                        e.preventDefault();
                        openExternalLink(releaseUrl);
                    });
                }

                if (confirm(`🎉 ¡NUEVA VERSIÓN DISPONIBLE!\n\nVersión instalada: v${currentVersion}\nVersión más reciente: v${latestVersionTag}\n\n¿Deseas abrir la página de descargas en GitHub?`)) {
                    openExternalLink(releaseUrl);
                }
            } else {
                showAlert(`✅ Tienes instalada la versión más reciente (v${currentVersion}).`, 'success');
            }

        } catch (err) {
            console.error('Error al consultar actualizaciones:', err);
            showAlert(`No se pudo conectar con GitHub. Verifica tu conexión o entra directamente a <a href="#" id="link-repo-err" style="color:#38bdf8;text-decoration:underline;font-weight:600;">https://github.com/JoMagistelo/Extractor-RUSP</a>.`, 'info');
            const linkErr = document.getElementById('link-repo-err');
            if (linkErr) {
                linkErr.addEventListener('click', (e) => {
                    e.preventDefault();
                    openExternalLink(GITHUB_REPO_URL);
                });
            }
        } finally {
            if (btnCheckUpdate && (!window.require || btnCheckUpdate.innerHTML === '⏳ Buscando...')) {
                btnCheckUpdate.disabled = false;
                btnCheckUpdate.innerHTML = originalHTML;
            }
        }
    }

    function compareSemVer(v1, v2) {
        const p1 = (v1 || '').split('.').map(n => parseInt(n, 10) || 0);
        const p2 = (v2 || '').split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(p1.length, p2.length);
        for (let i = 0; i < len; i++) {
            const num1 = p1[i] || 0;
            const num2 = p2[i] || 0;
            if (num1 > num2) return 1;
            if (num1 < num2) return -1;
        }
        return 0;
    }

    function openExternalLink(url) {
        if (window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                if (ipcRenderer) {
                    ipcRenderer.send('open-external-url', url);
                    return;
                }
            } catch (e) {}
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Obtiene la lista de columnas activas considerando la opción "Ver UR".
     */
    function getActiveColumns() {
        return getSimplifiedColumns(chkShowUR && chkShowUR.checked);
    }

    // Eventos para alternar opciones de UR
    if (chkShowUR) {
        chkShowUR.addEventListener('change', () => {
            updateTableDisplay();
        });
    }

    if (chkHomologateUR) {
        chkHomologateUR.addEventListener('change', () => {
            // Si está en modo edición o vista normal, refrescar visualización si es necesario
            updateTableDisplay();
        });
    }

    // Configuración Drag & Drop
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
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                handleFile(files[0]);
            }
        });
    }

    // Botón Seleccionar Archivo
    if (btnSelectFile && fileInput) {
        btnSelectFile.addEventListener('click', () => fileInput.click());
    }

    // Input Tradicional
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });
    }

    // Búsqueda en Vivo en la Tabla
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            updateTableDisplay();
        });
    }

    // --- MANEJO DE EDICIÓN Y HOMOLOGACIÓN ---

    // Entrar en Modo Edición
    if (btnEditSimplificado) {
        btnEditSimplificado.addEventListener('click', () => {
            if (!processedData) return;

            isEditMode = true;
            const fullCols = getSimplifiedColumns(true);
            draftHeaders = [...fullCols];

            // Crear borrador de trabajo según el conjunto activo actual (conservando todas las columnas)
            const sourceHeaders = (activeDataset === 'edited' && processedData.editedSimplificado)
                ? processedData.editedSimplificado.headers
                : processedData.simplificado.headers;

            const sourceRows = (activeDataset === 'edited' && processedData.editedSimplificado)
                ? processedData.editedSimplificado.rows
                : processedData.simplificado.rows;

            const filtered = getFilteredData(sourceHeaders, sourceRows, fullCols);
            draftRows = filtered.rows.map(r => [...r]);

            // Actualizar interfaz para Modo Edición
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

    // Cancelar Edición
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

            if (processedData && processedData.editedSimplificado && btnToggleVersion) {
                btnToggleVersion.classList.remove('hidden');
            }

            updateTableDisplay();
            showAlert('Edición cancelada. Los cambios no guardados fueron descartados.', 'info');
        });
    }

    // Guardar y Homologar Edición
    if (btnSaveEdit) {
        btnSaveEdit.addEventListener('click', () => {
            if (!processedData || !draftRows || !draftHeaders) return;

            try {
                // Ejecutar homologación sobre las filas editadas
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

                // Actualizar interfaz tras guardar
                if (editModeBanner) editModeBanner.classList.add('hidden');
                if (btnSaveEdit) btnSaveEdit.classList.add('hidden');
                if (btnCancelEdit) btnCancelEdit.classList.add('hidden');
                if (wrapperHomologateUR) wrapperHomologateUR.classList.add('hidden');

                if (btnEditSimplificado) btnEditSimplificado.classList.remove('hidden');
                if (btnDownloadSimplificado) btnDownloadSimplificado.classList.remove('hidden');
                if (btnToggleVersion) {
                    btnToggleVersion.classList.remove('hidden');
                    btnToggleVersion.textContent = '🔄 Ver Versión Original';
                }

                updateUIState();
                renderStats(processedData.stats);
                updateTableDisplay();

                showAlert(`RUSP Simplificado editado y homologado con éxito. Se consolidaron ${homologatedRows.length} registros.`, 'success');
            } catch (err) {
                console.error(err);
                showAlert('Error al homologar los registros editados: ' + err.message, 'error');
            }
        });
    }

    // Alternar entre Versión Original y Versión Ajustada
    if (btnToggleVersion) {
        btnToggleVersion.addEventListener('click', () => {
            if (!processedData || !processedData.editedSimplificado) return;

            if (activeDataset === 'original') {
                activeDataset = 'edited';
                btnToggleVersion.textContent = '🔄 Ver Versión Original';
            } else {
                activeDataset = 'original';
                btnToggleVersion.textContent = '🔄 Ver Versión Ajustada';
            }

            updateUIState();
            updateTableDisplay();
        });
    }

    // Botón de Descarga RUSP Simplificado
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

    /**
     * Procesa un archivo subido por el usuario.
     * @param {File} file 
     */
    function handleFile(file) {
        clearAlert();

        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
            showAlert('Por favor, selecciona un archivo de hoja de cálculo válido (.xlsx o .xls).', 'error');
            return;
        }

        toggleLoading(true);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const arrayBuffer = e.target.result;
                processArrayBuffer(arrayBuffer, file.name);
            } catch (err) {
                console.error(err);
                showAlert('Ocurrió un error al procesar el archivo Excel: ' + err.message, 'error');
                if (resultsSection) resultsSection.classList.add('hidden');
            } finally {
                toggleLoading(false);
            }
        };

        reader.onerror = () => {
            showAlert('No se pudo leer el archivo seleccionado.', 'error');
            toggleLoading(false);
        };

        reader.readAsArrayBuffer(file);
    }

    /**
     * Ejecuta el procesamiento sobre el ArrayBuffer cargado.
     * @param {ArrayBuffer} arrayBuffer 
     * @param {string} fileName 
     */
    function processArrayBuffer(arrayBuffer, fileName) {
        processedData = processExcelData(arrayBuffer);

        activeDataset = 'original';
        isEditMode = false;
        draftRows = null;
        processedData.editedSimplificado = null;

        if (btnToggleVersion) btnToggleVersion.classList.add('hidden');
        if (editModeBanner) editModeBanner.classList.add('hidden');
        if (btnSaveEdit) btnSaveEdit.classList.add('hidden');
        if (btnCancelEdit) btnCancelEdit.classList.add('hidden');
        if (wrapperHomologateUR) wrapperHomologateUR.classList.add('hidden');
        if (btnEditSimplificado) btnEditSimplificado.classList.remove('hidden');
        if (btnDownloadSimplificado) btnDownloadSimplificado.classList.remove('hidden');

        updateUIState();
        renderStats(processedData.stats);
        updateTableDisplay();

        if (resultsSection) {
            resultsSection.classList.remove('hidden');
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        }

        showAlert(`Archivo <strong>${fileName}</strong> procesado exitosamente. Se eliminaron ${processedData.stats.eliminated} filas redundantes.`, 'success');
    }

    /**
     * Actualiza textos, etiquetas y badges según la versión activa.
     */
    function updateUIState() {
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

    /**
     * Actualiza la tabla mostrada según el modo de edición y dataset activo.
     */
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
            renderPreviewTable(simpData.headers, simpData.rows, 1, {
                isEditMode: false
            });
            return;
        }

        const simpData = getFilteredData(
            processedData.simplificado.headers,
            processedData.simplificado.rows,
            targetCols
        );
        renderPreviewTable(simpData.headers, simpData.rows, 1, {
            isEditMode: false
        });
    }
});

