const { app, BrowserWindow, Menu } = require('electron');

function createWindow() {
  Menu.setApplicationMenu(null); // remove the default File/Edit/View/Window menu

  const win = new BrowserWindow({ width: 1200, height: 800 });
  win.loadURL('http://localhost:5173');
}

app.whenReady().then(createWindow);