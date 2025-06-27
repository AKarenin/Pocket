import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import * as path from 'path';
import * as os from 'os';
import { ShareManager, ShareManagerConfig } from './server/share-manager';
import { TunnelConfig } from './server/cloudflare-tunnel';
import { execSync } from 'child_process';

let mainWindow: BrowserWindow;
let shareManager: ShareManager | null = null;

// Configuration
const TUNNEL_ID = '442abcac-4aab-409f-854a-1c879870b60d';
const DOMAIN = 'pocketfileshare.com';
const PROXY_PORT = 8080;
const SHARE_PORT_START = 50000;
const SHARE_PORT_END = 65000;
const DATA_PATH = path.join(os.homedir(), '.pocket-file-sharing');

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    height: 800,
    width: 1200,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:8080');
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

async function initializeShareManager(): Promise<void> {
  try {
    const tunnelConfig: TunnelConfig = {
      tunnelId: TUNNEL_ID,
      domain: DOMAIN,
      proxyPort: PROXY_PORT
    };

    const config: ShareManagerConfig = {
      proxyPort: PROXY_PORT,
      sharePortStart: SHARE_PORT_START,
      sharePortEnd: SHARE_PORT_END,
      dataPath: DATA_PATH,
      tunnel: tunnelConfig
    };

    shareManager = new ShareManager(config);
    
    // Setup event listeners
    shareManager.on('started', () => {
      console.log('📁 Share Manager started successfully');
    });

    shareManager.on('tunnel-started', () => {
      console.log('🌐 Tunnel is now online');
      mainWindow?.webContents.send('tunnel-status-changed', { isRunning: true });
    });

    shareManager.on('tunnel-stopped', () => {
      console.log('🌐 Tunnel is now offline');
      mainWindow?.webContents.send('tunnel-status-changed', { isRunning: false });
    });

    shareManager.on('tunnel-error', (error) => {
      console.log('🌐 Tunnel error:', error.message);
      mainWindow?.webContents.send('tunnel-status-changed', { isRunning: false, error: error.message });
    });

    await shareManager.start();
  } catch (error) {
    console.error('Failed to initialize Share Manager:', error);
  }
}

// App event handlers
app.whenReady().then(async () => {
  await createWindow();
  await initializeShareManager();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  console.log('🧹 Cleaning up...');
  
  if (shareManager) {
    await shareManager.stop();
    console.log('✅ Cleanup complete');
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-shares', async () => {
  if (!shareManager) return [];
  const raw = shareManager.getShares();
  // Attach UI-friendly fields (url, name, active)
  return raw.map(s => ({
    ...s,
    url: s.url || `https://${s.id}.${DOMAIN}`,
    name: s.name || path.basename(s.path),
    active: s.status === 'active'
  }));
});

ipcMain.handle('get-tunnel-status', async () => {
  if (!shareManager) return { isRunning: false, error: 'Share manager not initialized' };
  return shareManager.getTunnelStatus();
});

ipcMain.handle('create-share', async (event, folderPath: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  
  // Generate a random passcode
  const passcode = Math.floor(100000 + Math.random() * 900000).toString();
  
  const shareId = await shareManager.createShare(folderPath, passcode);
  return { shareId, passcode };
});

ipcMain.handle('start-share', async (event, shareId: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  await shareManager.startShare(shareId);
});

ipcMain.handle('stop-share', async (event, shareId: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  await shareManager.stopShare(shareId);
});

ipcMain.handle('delete-share', async (event, shareId: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  await shareManager.deleteShare(shareId);
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder to share'
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});

// Additional IPC handlers for HTML interface
ipcMain.handle('add-folder', async () => {
  try {
    // Select folder
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder to share'
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    const folderPath = result.filePaths[0];
    
    if (!shareManager) throw new Error('Share manager not initialized');
    
    // Generate a random passcode
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Create share
    const shareId = await shareManager.createShare(folderPath, passcode);
    
    // Auto-start the share
    await shareManager.startShare(shareId);
    
    // Get the created share details
    const shares = shareManager.getShares();
    const share = shares.find(s => s.id === shareId);
    
    if (share) {
      return {
        ...share,
        active: true,
        url: `https://${shareId}.${DOMAIN}`,
        passcode: passcode,
        name: path.basename(folderPath)
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error in add-folder:', error);
    throw error;
  }
});

ipcMain.handle('check-prerequisites', async () => {
  const errors: string[] = [];
  let cloudflaredInstalled = false;
  
  try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    cloudflaredInstalled = true;
  } catch {
    errors.push('Cloudflared is not installed. Please install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  }
  
  return { cloudflaredInstalled, errors };
});

ipcMain.handle('toggle-share', async (event, shareId: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  
  try {
    const shares = shareManager.getShares();
    const share = shares.find(s => s.id === shareId);
    
    if (!share) {
      throw new Error(`Share ${shareId} not found`);
    }
    
    if (share.status === 'active') {
      await shareManager.stopShare(shareId);
    } else {
      await shareManager.startShare(shareId);
    }
    
    return true;
  } catch (error) {
    console.error('Error toggling share:', error);
    return false;
  }
});

ipcMain.handle('open-share', async (event, share: any) => {
  try {
    const url = share?.url || `https://${share?.id}.${DOMAIN}`;
    await shell.openExternal(url);
  } catch (error) {
    console.error('Error opening share:', error);
    throw error;
  }
});

ipcMain.handle('copy-share-url', async (event, share: any) => {
  try {
    const url = share?.url || `https://${share?.id}.${DOMAIN}`;
    clipboard.writeText(url);
  } catch (error) {
    console.error('Error copying share URL:', error);
    throw error;
  }
});

ipcMain.handle('remove-share', async (event, shareId: string) => {
  if (!shareManager) throw new Error('Share manager not initialized');
  
  try {
    await shareManager.deleteShare(shareId);
    return true;
  } catch (error) {
    console.error('Error removing share:', error);
    return false;
  }
});

ipcMain.handle('setup-dns', async () => {
  try {
    // This would implement DNS setup functionality
    // For now, just return true as a placeholder
    console.log('DNS setup not yet implemented');
    return true;
  } catch (error) {
    console.error('Error setting up DNS:', error);
    return false;
  }
});

ipcMain.handle('restart-tunnel', async () => {
  if (!shareManager) throw new Error('Share manager not initialized');
  
  try {
    // Stop and restart the tunnel
    await shareManager.stop();
    await shareManager.start();
    return true;
  } catch (error) {
    console.error('Error restarting tunnel:', error);
    return false;
  }
}); 