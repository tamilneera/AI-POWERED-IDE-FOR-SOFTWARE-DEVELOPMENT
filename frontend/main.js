const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// Google Client ID is not secret (it's meant to be public) — safe to keep here.
// The Client Secret stays only in backend/.env, never in frontend code.
const GOOGLE_CLIENT_ID = '68515030575-lvhp1t4t7eklumt8goblh17qoheaismu.apps.googleusercontent.com';
const REDIRECT_PORT = 42813;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;

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

ipcMain.handle('dialog:pickAttachment', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (event, defaultPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, { defaultPath });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('auth:googleSignIn', async () => {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>Signed in — you can close this window.</h2></body></html>');
      server.close();

      if (!code || returnedState !== state) {
        reject(new Error('Sign-in failed or was cancelled'));
        return;
      }
      resolve({ code, redirectUri: REDIRECT_URI });
    });

    server.on('error', (err) => reject(err));

    server.listen(REDIRECT_PORT, () => {
      shell.openExternal(authUrl);
    });
  });
});

app.whenReady().then(createWindow);