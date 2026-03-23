/**
 * electron/main.js
 * Electron main process - creates the browser window and starts the backend
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let backendProcess = null;

// ─── Start the Node.js backend as a child process ────────────────────────────
function startBackend() {
  const isDev = !app.isPackaged;

  const backendPath = isDev
    ? path.join(__dirname, "../backend/server.js")
    : path.join(process.resourcesPath, "backend/server.js");

  if (!fs.existsSync(backendPath)) {
    console.error('Backend server.js not found at:', backendPath);
    return;
  }

  backendProcess = spawn("node", [backendPath]);

  backendProcess.stdout.on("data", (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
  });

  console.log('[Electron] Backend process started (PID:', backendProcess.pid, ')');
}

// ─── Create the Main Window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'SecureTransfer',
    backgroundColor: '#0d0d14',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.js')
    },
    icon: path.join(__dirname, '../frontend/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../frontend/index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.on('shell:openFolder', (event, folderPath) => {
  shell.openPath(folderPath);
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    console.log('[Electron] Backend process killed');
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});