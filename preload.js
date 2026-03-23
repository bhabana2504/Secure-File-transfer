/**
 * electron/preload.js
 * Exposes safe Electron APIs to the renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe "electronAPI" object to the frontend JavaScript
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // File system operations
  openFileDialog: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (folderPath) => ipcRenderer.send('shell:openFolder', folderPath),

  // Detect if running inside Electron
  isElectron: true
});
