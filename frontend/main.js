const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Ctrl+Shift+I or F12 toggles DevTools
  win.webContents.on('before-input-event', (event, input) => {
    const isDevToolsKey =
      input.type === 'keyDown' &&
      ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12');
    if (isDevToolsKey) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.loadURL('http://localhost:5173');
}

ipcMain.handle('dialog:openFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (event, defaultPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, { defaultPath });
  return result.canceled ? null : result.filePath;
});

app.whenReady().then(createWindow);