const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  googleSignIn: () => ipcRenderer.invoke('auth:googleSignIn'),
  pickAttachmentFile: () => ipcRenderer.invoke('dialog:pickAttachment'),
});