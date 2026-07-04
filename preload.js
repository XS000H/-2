const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window Controls ────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.send('window:toggleFullscreen'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggleAlwaysOnTop'),

  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:isAlwaysOnTop'),

  // ── Settings ───────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.send('settings:set', { key, value }),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),

  // ── Notifications ──────────────────────────────────────────────
  showNotification: (title, body) =>
    ipcRenderer.send('notification:show', { title, body }),

  // ── Theme toggle from tray ─────────────────────────────────────
  onThemeToggle: (callback) => {
    ipcRenderer.on('theme:toggle', () => callback());
  },

  // ── Listeners ──────────────────────────────────────────────────
  onFullscreenChange: (callback) => {
    ipcRenderer.on('fullscreen:changed', (event, isFullscreen) => callback(isFullscreen));
  },
});
