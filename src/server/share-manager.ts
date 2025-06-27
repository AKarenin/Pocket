import { FileServer } from './file-server';
import { DynamicProxy, ProxyRoute } from './dynamic-proxy';
import { CloudflareTunnel, TunnelConfig } from './cloudflare-tunnel';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface Share {
  id: string;
  path: string;
  passcode: string;
  port: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  lastAccessed?: Date;
  url?: string;
  name?: string;
}

export interface ShareManagerConfig {
  proxyPort: number;
  sharePortStart: number;
  sharePortEnd: number;
  dataPath: string;
  tunnel?: TunnelConfig;
}

export class ShareManager extends EventEmitter {
  private config: ShareManagerConfig;
  private shares: Map<string, Share> = new Map();
  private fileServers: Map<string, FileServer> = new Map();
  private proxy: DynamicProxy;
  private tunnel: CloudflareTunnel | null = null;
  private isRunning = false;

  constructor(config: ShareManagerConfig) {
    super();
    this.config = config;
    this.proxy = new DynamicProxy(config.proxyPort);
    
    if (config.tunnel) {
      this.tunnel = new CloudflareTunnel(config.tunnel);
      this.setupTunnelEvents();
    }
  }

  private setupTunnelEvents(): void {
    if (!this.tunnel) return;

    this.tunnel.on('started', () => {
      console.log('🌐 Tunnel connected - shares now accessible globally');
      this.emit('tunnel-started');
    });

    this.tunnel.on('stopped', () => {
      console.log('🌐 Tunnel disconnected - shares only accessible locally');
      this.emit('tunnel-stopped');
    });

    this.tunnel.on('error', (error) => {
      console.log('🌐 Tunnel error:', error.message);
      this.emit('tunnel-error', error);
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Share Manager already running');
      return;
    }

    try {
      console.log('🚀 Starting Share Manager...');

      // Clear all existing caches and shares on startup
      await this.clearAllCaches();

      // Start proxy and tunnel in parallel for faster startup
      const startTasks: Promise<void>[] = [this.proxy.start()];
      
      if (this.tunnel) {
        startTasks.push(this.tunnel.start().catch(error => {
          console.log('⚠️ Failed to start tunnel - running in local-only mode');
          console.log('Error:', error instanceof Error ? error.message : 'Unknown error');
          console.log('📋 Shares will only be accessible locally');
        }));
      }

      await Promise.all(startTasks);
      console.log(`🔀 Proxy started on port ${this.config.proxyPort}`);

      // Load existing shares and auto-start active ones (should be none after clearing)
      await this.loadShares();

      this.isRunning = true;
      console.log('✅ Share Manager started successfully');
      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start Share Manager:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async clearAllCaches(): Promise<void> {
    console.log('🧹 Clearing all caches and existing shares...');
    
    // Stop all running file servers
    for (const [shareId, server] of this.fileServers) {
      try {
        await server.stop();
        console.log(`📁 File server stopped for share: ${shareId}`);
      } catch (error) {
        console.error(`Error stopping file server for ${shareId}:`, error);
      }
    }
    this.fileServers.clear();

    // Clear all proxy routes
    this.proxy.clearAllRoutes();

    // Clear in-memory shares
    this.shares.clear();

    // Remove the shares.json file to start fresh
    const sharesFile = path.join(this.config.dataPath, 'shares.json');
    if (fs.existsSync(sharesFile)) {
      try {
        fs.unlinkSync(sharesFile);
        console.log('🗑️ Cleared shares.json file');
      } catch (error) {
        console.error('Error removing shares.json:', error);
      }
    }

    console.log('✅ All caches cleared - starting fresh');
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Share Manager...');

    // Stop all file servers
    for (const [shareId, server] of this.fileServers) {
      try {
        await server.stop();
        console.log(`📁 File server stopped for share: ${shareId}`);
      } catch (error) {
        console.error(`Error stopping file server for ${shareId}:`, error);
      }
    }
    this.fileServers.clear();

    // Stop proxy
    await this.proxy.stop();
    console.log('🔀 Dynamic proxy stopped');

    // Stop tunnel
    if (this.tunnel) {
      await this.tunnel.stop();
    }

    this.isRunning = false;
    console.log('✅ Share Manager stopped');
    this.emit('stopped');
  }

  public getShares(): Share[] {
    return Array.from(this.shares.values());
  }

  public getTunnelStatus(): { isRunning: boolean; error?: string } {
    if (!this.tunnel) {
      return { isRunning: false, error: 'No tunnel configured' };
    }
    
    const status = this.tunnel.getStatus();
    return {
      isRunning: status.isRunning,
      error: status.error
    };
  }

  public async createShare(sharePath: string, passcode: string): Promise<string> {
    // Generate unique share ID
    const shareId = this.generateShareId();
    
    // Find available port
    const port = await this.findAvailablePort();
    
    const share: Share = {
      id: shareId,
      path: sharePath,
      passcode,
      port,
      status: 'inactive',
      createdAt: new Date()
    };

    this.shares.set(shareId, share);
    await this.saveShares();

    // Add proxy route
    const proxyRoute: ProxyRoute = {
      shareId: shareId,
      subdomain: shareId,
      targetPort: port,
      passcode: passcode,
      active: false
    };
    this.proxy.addRoute(proxyRoute);
    console.log(`📍 Route added: ${shareId}`);

    this.emit('share-created', share);
    return shareId;
  }

  public async startShare(shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (!share) {
      throw new Error(`Share ${shareId} not found`);
    }

    if (share.status === 'active') {
      console.log(`Share ${shareId} already active`);
      return;
    }

    // Create and start file server
    const fileServer = new FileServer(share.path, share.passcode, share.port);
    await fileServer.start();

    // Get the actual port the file server is running on (may have changed due to conflicts)
    const actualPort = fileServer.getPort();
    
    // Update share port if it changed
    if (actualPort !== share.port) {
      console.log(`🔧 Port updated for share ${shareId}: ${share.port} -> ${actualPort}`);
      share.port = actualPort;
      
      // Update the proxy route with the new port
      const proxyRoute: ProxyRoute = {
        shareId: shareId,
        subdomain: shareId,
        targetPort: actualPort,
        passcode: share.passcode,
        active: true
      };
      this.proxy.addRoute(proxyRoute); // This will replace the existing route
    } else {
      // Just update the existing route to active
      this.proxy.updateRouteStatus(shareId, true);
    }

    this.fileServers.set(shareId, fileServer);
    share.status = 'active';
    share.lastAccessed = new Date();

    await this.saveShares();
    console.log(`🔄 Share started: ${shareId}`);
    this.emit('share-started', share);
  }

  public async stopShare(shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (!share) {
      throw new Error(`Share ${shareId} not found`);
    }

    if (share.status === 'inactive') {
      console.log(`Share ${shareId} already inactive`);
      return;
    }

    const fileServer = this.fileServers.get(shareId);
    if (fileServer) {
      await fileServer.stop();
      this.fileServers.delete(shareId);
    }

    share.status = 'inactive';
    
    // Update proxy route to inactive
    this.proxy.updateRouteStatus(shareId, false);

    await this.saveShares();
    console.log(`🔄 Share stopped: ${shareId}`);
    this.emit('share-stopped', share);
  }

  public async deleteShare(shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (!share) {
      throw new Error(`Share ${shareId} not found`);
    }

    // Stop if active
    if (share.status === 'active') {
      await this.stopShare(shareId);
    }

    // Remove proxy route
    this.proxy.removeRoute(shareId);

    this.shares.delete(shareId);
    await this.saveShares();

    console.log(`🗑️ Share deleted: ${shareId}`);
    this.emit('share-deleted', shareId);
  }

  private async loadShares(): Promise<void> {
    const sharesFile = path.join(this.config.dataPath, 'shares.json');
    
    if (!fs.existsSync(this.config.dataPath)) {
      fs.mkdirSync(this.config.dataPath, { recursive: true });
    }

    if (fs.existsSync(sharesFile)) {
      try {
        const data = fs.readFileSync(sharesFile, 'utf8');
        const sharesData = JSON.parse(data);
        
        console.log(`📂 Loading ${sharesData.length} shares...`);
        
        for (const shareData of sharesData) {
          const share: Share = {
            ...shareData,
            createdAt: new Date(shareData.createdAt),
            lastAccessed: shareData.lastAccessed ? new Date(shareData.lastAccessed) : undefined
          };
          
          this.shares.set(share.id, share);
          
          // Add proxy route - active if share was active
          const proxyRoute: ProxyRoute = {
            shareId: share.id,
            subdomain: share.id,
            targetPort: share.port,
            passcode: share.passcode,
            active: share.status === 'active'
          };
          this.proxy.addRoute(proxyRoute);
          console.log(`📍 Route added: ${share.id}`);
          
          // Auto-start shares that were active
          if (share.status === 'active') {
            try {
              const fileServer = new FileServer(share.path, share.passcode, share.port);
              await fileServer.start();
              
              // Get the actual port the file server is running on (may have changed due to conflicts)
              const actualPort = fileServer.getPort();
              
              // Update share port and proxy route if it changed
              if (actualPort !== share.port) {
                console.log(`🔧 Port updated for auto-started share ${share.id}: ${share.port} -> ${actualPort}`);
                share.port = actualPort;
                
                // Update the proxy route with the new port
                const updatedProxyRoute: ProxyRoute = {
                  shareId: share.id,
                  subdomain: share.id,
                  targetPort: actualPort,
                  passcode: share.passcode,
                  active: true
                };
                this.proxy.addRoute(updatedProxyRoute); // This will replace the existing route
              }
              
              this.fileServers.set(share.id, fileServer);
              console.log(`🔄 Auto-started share: ${share.id}`);
            } catch (error) {
              console.error(`Failed to auto-start share ${share.id}:`, error);
              // Mark as inactive if we can't start it
              share.status = 'inactive';
              this.proxy.updateRouteStatus(share.id, false);
            }
          }
        }
      } catch (error) {
        console.error('Error loading shares:', error);
      }
    }
  }

  private async saveShares(): Promise<void> {
    const sharesFile = path.join(this.config.dataPath, 'shares.json');
    const sharesData = Array.from(this.shares.values());
    
    try {
      fs.writeFileSync(sharesFile, JSON.stringify(sharesData, null, 2));
    } catch (error) {
      console.error('Error saving shares:', error);
    }
  }

  private generateShareId(): string {
    // Delegate to DynamicProxy's generator to ensure consistent format (prefixed with "mcc")
    return DynamicProxy.generateShareId();
  }

  private async findAvailablePort(): Promise<number> {
    for (let port = this.config.sharePortStart; port <= this.config.sharePortEnd; port++) {
      if (!Array.from(this.shares.values()).some(share => share.port === port)) {
        return port;
      }
    }
    throw new Error('No available ports in the specified range');
  }
}