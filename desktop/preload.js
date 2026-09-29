/* ==========================================================================
   Preload — the only bridge between the setup window and the main process.

   contextIsolation is on and nodeIntegration is off, so the settings window
   gets exactly the calls listed here and nothing else.
   ========================================================================== */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sf', {
  getSettings:   () => ipcRenderer.invoke('sf:get-settings'),
  saveSettings:  (patch) => ipcRenderer.invoke('sf:save-settings', patch),
  startHost:     () => ipcRenderer.invoke('sf:start-host'),
  stopHost:      () => ipcRenderer.invoke('sf:stop-host'),
  restartHost:   () => ipcRenderer.invoke('sf:restart-host'),
  status:        () => ipcRenderer.invoke('sf:status'),
  diagnose:      () => ipcRenderer.invoke('sf:diagnose'),
  scanDevices:   () => ipcRenderer.invoke('sf:scan-devices'),
  openExternal:  (url) => ipcRenderer.invoke('sf:open-external', url),
  copy:          (text) => ipcRenderer.invoke('sf:copy', text),
  startTunnel:   (kind) => ipcRenderer.invoke('sf:start-tunnel', kind),
  startHost:     () => ipcRenderer.invoke('sf:start-host'),
  stopHost:      () => ipcRenderer.invoke('sf:stop-host'),
  revealData:    () => ipcRenderer.invoke('sf:reveal-data'),
  completeSetup: () => ipcRenderer.invoke('sf:complete-setup'),
  appInfo:       () => ipcRenderer.invoke('sf:app-info'),
  close:         () => ipcRenderer.invoke('sf:close')
});
