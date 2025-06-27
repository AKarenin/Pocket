import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Server } from 'http';
import { EventEmitter } from 'events';

export interface ProxyRoute {
  shareId: string;
  subdomain: string;
  targetPort: number;
  passcode: string;
  active: boolean;
}

export class DynamicProxy extends EventEmitter {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private routes: Map<string, ProxyRoute> = new Map();
  private proxies: Map<string, any> = new Map(); // Store proxy middleware instances

  constructor(port: number = 8080) {
    super();
    this.port = port;
    this.app = express();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    // Trust proxy headers from Cloudflare
    this.app.set('trust proxy', true);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        activeRoutes: this.routes.size,
        routes: Array.from(this.routes.values()).map(route => ({
          shareId: route.shareId,
          subdomain: route.subdomain,
          active: route.active
        }))
      });
    });

    // Proxy middleware - handles all other requests
    this.app.use((req, res, next) => {
      const host = req.get('host') || '';
      const subdomain = this.extractSubdomain(host);
      
      console.log(`📡 Proxy request: ${req.method} ${host}${req.originalUrl} -> subdomain: ${subdomain}`);
      
      if (!subdomain) {
        return res.status(404).json({ 
          error: 'Share not found', 
          message: 'No subdomain specified' 
        });
      }

      const route = this.routes.get(subdomain);
      
      if (!route || !route.active) {
        return res.status(404).json({ 
          error: 'Share not found',
          message: `Share '${subdomain}' not found or inactive`
        });
      }

      console.log(`📡 Forwarding to: http://localhost:${route.targetPort}${req.originalUrl}`);

      // Get the persistent proxy middleware for this route
      const proxy = this.proxies.get(subdomain);
      if (!proxy) {
        return res.status(500).json({
          error: 'Proxy configuration error',
          message: 'No proxy middleware found for this route'
        });
      }

      // Apply the proxy
      proxy(req, res, next);
    });

    // Error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Proxy error:', error);
      res.status(500).json({ 
        error: 'Proxy error',
        message: 'Internal proxy error occurred'
      });
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let currentPort = this.port;
      const maxRetries = 10;
      let retries = 0;

      const tryPort = (port: number) => {
        if (retries >= maxRetries) {
          reject(new Error(`Could not find available port after ${maxRetries} attempts`));
          return;
        }

        this.app = express();
        this.setupMiddleware();
        
        this.server = this.app.listen(port, () => {
          this.port = port;
          console.log(`🔀 Dynamic proxy started on port ${port}`);
          console.log(`📋 Routes: ${this.routes.size} active`);
          this.emit('started', { port });
          resolve();
        });

        this.server.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            retries++;
            const nextPort = port + 1;
            if (retries === 1) {
              console.log(`Port ${port} in use, trying ${nextPort}...`);
            }
            setImmediate(() => tryPort(nextPort));
          } else {
            reject(error);
          }
        });
      };

      tryPort(currentPort);
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('🔀 Dynamic proxy stopped');
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  public addRoute(route: ProxyRoute): void {
    const existing = this.routes.get(route.subdomain);
    
    if (existing && existing.shareId !== route.shareId) {
      console.log(`⚠️ Replacing existing route for subdomain: ${route.subdomain}`);
    }

    this.routes.set(route.subdomain, route);

    // Create persistent proxy middleware for this route
    const proxy = createProxyMiddleware({
      target: `http://localhost:${route.targetPort}`,
      changeOrigin: true,
      ws: true
    });

    this.proxies.set(route.subdomain, proxy);
    console.log(`✅ Added proxy route: ${route.subdomain} -> localhost:${route.targetPort}`);
    this.emit('routeAdded', route);
  }

  public removeRoute(subdomain: string): boolean {
    const removed = this.routes.delete(subdomain);
    if (removed) {
      // Clean up the proxy middleware
      this.proxies.delete(subdomain);
      console.log(`🗑️ Removed proxy route: ${subdomain}`);
      this.emit('routeRemoved', { subdomain });
    }
    return removed;
  }

  public updateRouteStatus(subdomain: string, active: boolean): boolean {
    const route = this.routes.get(subdomain);
    if (route) {
      route.active = active;
      console.log(`🔄 Updated route status: ${subdomain} -> ${active ? 'active' : 'inactive'}`);
      this.emit('routeUpdated', route);
      return true;
    }
    return false;
  }

  public getRoute(subdomain: string): ProxyRoute | undefined {
    return this.routes.get(subdomain);
  }

  public getAllRoutes(): ProxyRoute[] {
    return Array.from(this.routes.values());
  }

  public getActiveRoutes(): ProxyRoute[] {
    return Array.from(this.routes.values()).filter(route => route.active);
  }

  public getRouteCount(): number {
    return this.routes.size;
  }

  public clearAllRoutes(): void {
    const count = this.routes.size;
    this.routes.clear();
    this.proxies.clear(); // Also clear proxy middleware instances
    console.log(`🧹 Cleared ${count} proxy routes`);
    this.emit('routesCleared');
  }

  public getPort(): number {
    return this.port;
  }

  private extractSubdomain(host: string): string | null {
    // Remove port if present
    const hostname = host.split(':')[0];
    
    // Extract subdomain from hostname
    // Example: "abc123.pocketfileshare.com" -> "abc123"
    const parts = hostname.split('.');
    
    if (parts.length >= 3) {
      return parts[0];
    }
    
    return null;
  }

  // Generate unique share ID
  public static generateShareId(): string {
    const prefix = 'mcc';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = prefix;
    
    for (let i = 0; i < 19; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }

  // Generate 6-digit passcode
  public static generatePasscode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Health check method
  public async healthCheck(): Promise<{
    healthy: boolean;
    routes: number;
    activeRoutes: number;
    port: number;
  }> {
    const activeRoutes = this.getActiveRoutes();
    
    return {
      healthy: true,
      routes: this.routes.size,
      activeRoutes: activeRoutes.length,
      port: this.port
    };
  }
} 