const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
    console.log('electron-updater no disponible o en entorno sin empaquetar:', e.message);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 600,
        title: "Extractor y Procesador de Datos RUSP",
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile(path.join(__dirname, 'index.html'));

    if (autoUpdater) {
        autoUpdater.on('update-available', (info) => {
            win.webContents.send('auto-update-status', { status: 'available', version: info.version });
        });

        autoUpdater.on('update-not-available', (info) => {
            win.webContents.send('auto-update-status', { status: 'not-available' });
        });

        autoUpdater.on('download-progress', (progressObj) => {
            win.webContents.send('auto-update-status', { 
                status: 'downloading', 
                percent: Math.round(progressObj.percent) 
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            win.webContents.send('auto-update-status', { status: 'downloaded', version: info.version });
        });

        autoUpdater.on('error', (err) => {
            win.webContents.send('auto-update-status', { status: 'error', error: err ? err.message : 'Unknown' });
        });
    }
}

ipcMain.on('open-external-url', (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('trigger-auto-update-check', async () => {
    if (autoUpdater && app.isPackaged) {
        try {
            const result = await autoUpdater.checkForUpdates();
            return { supported: true, result };
        } catch (e) {
            return { supported: true, error: e.message };
        }
    }
    return { supported: false };
});

ipcMain.on('restart-and-install-update', () => {
    if (autoUpdater) {
        autoUpdater.quitAndInstall(false, true);
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

