const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  nativeImage,
  screen,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ── Settings Persistence ───────────────────────────────────────────
const settingsPath = path.join(app.getPath('userData'), 'clock-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return { theme: 'light', alwaysOnTop: false, bgOpacity: 0.88 };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// ── Globals ────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let currentSettings = loadSettings();
let isQuitting = false;

// ── Tray Icon Generator ────────────────────────────────────────────
function createTrayIcon() {
  // Generate a 16x16 simple clock icon programmatically (RGBA raw buffer)
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = 8, cy = 8, r = 7;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r && dist >= r - 1.5) {
        // Circle outline
        buffer[i] = 255;     // R
        buffer[i + 1] = 255; // G
        buffer[i + 2] = 255; // B
        buffer[i + 3] = 255; // A
      } else if (
        (x >= cx - 0.5 && x <= cx + 0.5 && y >= cy - 5 && y <= cy) ||
        (y >= cy - 0.5 && y <= cy + 0.5 && x >= cx && x <= cx + 3)
      ) {
        // Clock hands
        buffer[i] = 255;
        buffer[i + 1] = 255;
        buffer[i + 2] = 255;
        buffer[i + 3] = 255;
      } else {
        buffer[i] = 0;
        buffer[i + 1] = 0;
        buffer[i + 2] = 0;
        buffer[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

// ── Window Creation ────────────────────────────────────────────────
function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    x: Math.round(screenWidth - 440),
    y: Math.round((screenHeight - 680) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: currentSettings.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: createTrayIcon(),
  });

  mainWindow.loadFile('index.html');

  // Persist alwaysOnTop changes
  mainWindow.on('always-on-top-changed', (event, isAlwaysOnTop) => {
    currentSettings.alwaysOnTop = isAlwaysOnTop;
    saveSettings(currentSettings);
  });

  // Sync maximize state to renderer
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false);
  });

  // Prevent closing to tray unless explicitly quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System Tray ────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('桌面时钟');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '切换主题',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('theme:toggle');
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────

// Window Controls
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    // Force-sync state to renderer immediately after toggle
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
      }
    }, 50);
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.on('window:toggleFullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('window:isFullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.on('window:toggleAlwaysOnTop', () => {
  if (mainWindow) {
    const newState = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(newState);
    currentSettings.alwaysOnTop = newState;
    saveSettings(currentSettings);
  }
});

ipcMain.handle('window:isAlwaysOnTop', () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false;
});

// Settings
ipcMain.handle('settings:get', () => {
  return loadSettings();
});

ipcMain.on('settings:set', (event, { key, value }) => {
  currentSettings[key] = value;
  saveSettings(currentSettings);
});

ipcMain.handle('settings:getAll', () => {
  return currentSettings;
});

// Notifications (for alarms)
ipcMain.on('notification:show', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || '⏰ 闹钟',
      body: body || '时间到了！',
      silent: false,
      urgency: 'critical',
    });
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
  }
});

// ── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  // macOS: re-create window on activate
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows close
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
