import { contextBridge, ipcRenderer } from 'electron';
import { Share, TunnelStatus, CreateShareResult } from './types';

export interface ElectronAPI {
  getShares: () => Promise<Share[]>;
  getTunnelStatus: () => Promise<TunnelStatus>;
  createShare: (folderPath: string) => Promise<CreateShareResult>;
  startShare: (shareId: string) => Promise<void>;
  stopShare: (shareId: string) => Promise<void>;
  deleteShare: (shareId: string) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  // Additional functions for HTML interface
  addFolder: () => Promise<Share | null>;
  checkPrerequisites: () => Promise<{ cloudflaredInstalled: boolean; errors: string[] }>;
  toggleShare: (shareId: string) => Promise<boolean>;
  openShare: (share: Share) => Promise<void>;
  copyShareUrl: (share: Share) => Promise<void>;
  removeShare: (shareId: string) => Promise<boolean>;
  setupDns: () => Promise<boolean>;
  restartTunnel: () => Promise<boolean>;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getShares: () => ipcRenderer.invoke('get-shares'),
  getTunnelStatus: () => ipcRenderer.invoke('get-tunnel-status'),
  createShare: (folderPath: string) => ipcRenderer.invoke('create-share', folderPath),
  startShare: (shareId: string) => ipcRenderer.invoke('start-share', shareId),
  stopShare: (shareId: string) => ipcRenderer.invoke('stop-share', shareId),
  deleteShare: (shareId: string) => ipcRenderer.invoke('delete-share', shareId),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  // Additional functions for HTML interface
  addFolder: () => ipcRenderer.invoke('add-folder'),
  checkPrerequisites: () => ipcRenderer.invoke('check-prerequisites'),
  toggleShare: (shareId: string) => ipcRenderer.invoke('toggle-share', shareId),
  openShare: (share: Share) => ipcRenderer.invoke('open-share', share),
  copyShareUrl: (share: Share) => ipcRenderer.invoke('copy-share-url', share),
  removeShare: (shareId: string) => ipcRenderer.invoke('remove-share', shareId),
  setupDns: () => ipcRenderer.invoke('setup-dns'),
  restartTunnel: () => ipcRenderer.invoke('restart-tunnel'),
} as ElectronAPI);

// Type definitions for TypeScript
declare global {
  interface Window {
    electronAPI: {
      getShares: () => Promise<Share[]>;
      getTunnelStatus: () => Promise<TunnelStatus>;
      createShare: (folderPath: string) => Promise<CreateShareResult>;
      startShare: (shareId: string) => Promise<void>;
      stopShare: (shareId: string) => Promise<void>;
      deleteShare: (shareId: string) => Promise<void>;
      selectFolder: () => Promise<string | null>;
      // Additional functions for HTML interface
      addFolder: () => Promise<Share | null>;
      checkPrerequisites: () => Promise<{ cloudflaredInstalled: boolean; errors: string[] }>;
      toggleShare: (shareId: string) => Promise<boolean>;
      openShare: (share: Share) => Promise<void>;
      copyShareUrl: (share: Share) => Promise<void>;
      removeShare: (shareId: string) => Promise<boolean>;
      setupDns: () => Promise<boolean>;
      restartTunnel: () => Promise<boolean>;
    };
  }
} 