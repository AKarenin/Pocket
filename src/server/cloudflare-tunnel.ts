import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TunnelConfig {
  tunnelId: string;
  domain: string;
  proxyPort: number;
}

export interface TunnelStatus {
  isRunning: boolean;
  tunnelId: string;
  error?: string;
  startTime?: Date;
}

export class CloudflareTunnel extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: TunnelConfig;
  private status: TunnelStatus;

  constructor(config: TunnelConfig) {
    super();
    this.config = config;
    this.status = {
      isRunning: false,
      tunnelId: config.tunnelId
    };
  }

  public async start(): Promise<void> {
    if (this.status.isRunning) {
      console.log('🌐 Tunnel already running');
      return;
    }

    try {
      console.log('🚀 Starting Cloudflare tunnel...');
      
      // Check if cloudflared is installed
      if (!await this.checkCloudflaredInstalled()) {
        throw new Error('cloudflared not installed');
      }

      // Check credentials
      if (!await this.checkCredentials()) {
        throw new Error('Tunnel credentials not found');
      }

      // Create config
      await this.createConfig();
      
      // Start tunnel process
      await this.startProcess();
      
      this.status.isRunning = true;
      this.status.startTime = new Date();
      this.status.error = undefined;
      
      console.log('✅ Cloudflare tunnel started');
      console.log(`🔗 Public access: https://*.${this.config.domain}`);
      
      this.emit('started', this.status);
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Failed to start tunnel:', this.status.error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.status.isRunning) {
      return;
    }

    console.log('🛑 Stopping Cloudflare tunnel...');

    if (this.process) {
      this.process.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process!.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }

    this.status.isRunning = false;
    console.log('✅ Tunnel stopped');
    this.emit('stopped');
  }

  public getStatus(): TunnelStatus {
    return { ...this.status };
  }

  private async checkCloudflaredInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('cloudflared', ['--version'], { stdio: 'ignore' });
      process.on('error', () => resolve(false));
      process.on('exit', (code) => resolve(code === 0));
      setTimeout(() => {
        process.kill();
        resolve(false);
      }, 3000);
    });
  }

  private async checkCredentials(): Promise<boolean> {
    const credentialsPath = path.join(os.homedir(), '.cloudflared', `${this.config.tunnelId}.json`);
    return fs.existsSync(credentialsPath);
  }

  private async createConfig(): Promise<void> {
    const configDir = path.join(os.homedir(), '.cloudflared');
    const configPath = path.join(configDir, 'config.yml');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const config = `tunnel: ${this.config.tunnelId}
credentials-file: ${path.join(configDir, `${this.config.tunnelId}.json`)}

ingress:
  - hostname: "*.${this.config.domain}"
    service: http://localhost:${this.config.proxyPort}
  - service: http_status:404
`;

    fs.writeFileSync(configPath, config);
    console.log('✅ Tunnel config created');
  }

  private async startProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['tunnel', 'run', this.config.tunnelId];
      
      this.process = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let connectionCount = 0;
      let hasStarted = false;

      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        console.log(`[cloudflared] ${output.trim()}`);
        
        // Count registered connections
        if (output.includes('Registered tunnel connection')) {
          connectionCount++;
          console.log(`🔗 Connection ${connectionCount} established`);
          
          // Consider tunnel started after first connection
          if (!hasStarted) {
            hasStarted = true;
            resolve();
          }
        }
      };

      this.process.stdout?.on('data', handleOutput);
      this.process.stderr?.on('data', handleOutput);

      this.process.on('error', (error) => {
        console.error('Cloudflared process error:', error);
        if (!hasStarted) {
          reject(error);
        }
      });

      this.process.on('exit', (code, signal) => {
        console.log(`Cloudflared exited: code=${code}, signal=${signal}`);
        this.process = null;
        
        if (!hasStarted && code !== 0) {
          reject(new Error(`Cloudflared exited with code ${code}`));
        }
        
        // If tunnel was running and exited unexpectedly, mark as stopped
        if (this.status.isRunning && code !== 0) {
          this.status.isRunning = false;
          this.emit('stopped');
        }
      });

      // Simple timeout - if no connection in 45 seconds, fail
      setTimeout(() => {
        if (!hasStarted) {
          console.error('❌ Tunnel startup timeout - no connections established');
          reject(new Error('Tunnel startup timeout'));
        }
      }, 45000);
    });
  }
} 