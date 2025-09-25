import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import { FileServer } from '../server/file-server';
import { CloudflareTunnel } from '../server/cloudflare-tunnel';

export type PocketItemType = 'file' | 'folder';

export interface PocketItem {
  name: string;
  type: PocketItemType;
  size: number;
  modified: Date;
  path: string;
}

export interface PocketShareOptions {
  /**
   * The absolute path to the directory you want to expose through the share.
   */
  rootPath: string;
  /**
   * Passcode required to authenticate a session. Defaults to `123456` to match
   * the legacy Pocket file server behaviour.
   */
  passcode?: string;
}

export interface PocketShareTunnelOptions {
  tunnelId: string;
  domain: string;
  subdomain?: string;
  hostname?: string;
  credentialsFile?: string;
  configPath?: string;
  binaryPath?: string;
}

export interface PocketShareHostOptions {
  port?: number;
  tunnel?: PocketShareTunnelOptions;
}

export interface PocketShareHost {
  localUrl: string;
  publicUrl?: string;
  hostname?: string;
  passcode: string;
  port: number;
  stop(): Promise<void>;
}

export interface PocketShareSession {
  /**
   * Session token that must be provided when calling low-level helpers
   * directly. Consumers usually don't need to access it manually because each
   * helper on the session proxy automatically forwards it.
   */
  readonly token: string;

  list(relativePath?: string): Promise<PocketItem[]>;
  info(relativePath?: string): Promise<PocketItem>;
  readFile(relativePath: string, encoding?: BufferEncoding): Promise<Buffer | string>;
  createReadStream(relativePath: string): fs.ReadStream;
  writeFile(relativePath: string, data: Buffer | string | Readable): Promise<void>;
  createDirectory(relativePath: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  zip(relativePath?: string): Promise<Buffer>;
  /**
   * Invalidates the current session token, requiring a fresh authentication to
   * continue interacting with the share.
   */
  close(): void;
}

class PocketShareSessionImpl implements PocketShareSession {
  constructor(private readonly share: PocketShare, public readonly token: string) {}

  list(relativePath = ''): Promise<PocketItem[]> {
    return this.share.list(this.token, relativePath);
  }

  info(relativePath = ''): Promise<PocketItem> {
    return this.share.info(this.token, relativePath);
  }

  readFile(relativePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
    return this.share.readFile(this.token, relativePath, encoding);
  }

  createReadStream(relativePath: string): fs.ReadStream {
    return this.share.createReadStream(this.token, relativePath);
  }

  writeFile(relativePath: string, data: Buffer | string | Readable): Promise<void> {
    return this.share.writeFile(this.token, relativePath, data);
  }

  createDirectory(relativePath: string): Promise<void> {
    return this.share.createDirectory(this.token, relativePath);
  }

  remove(relativePath: string): Promise<void> {
    return this.share.remove(this.token, relativePath);
  }

  zip(relativePath = ''): Promise<Buffer> {
    return this.share.zip(this.token, relativePath);
  }

  close(): void {
    this.share.invalidate(this.token);
  }
}

function isReadableStream(value: unknown): value is Readable {
  return value instanceof Readable || (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readable).pipe === 'function'
  );
}

function ensureDirectory(rootPath: string): void {
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Root path \"${rootPath}\" does not exist`);
  }

  const stats = fs.statSync(rootPath);
  if (!stats.isDirectory()) {
    throw new Error(`Root path \"${rootPath}\" is not a directory`);
  }
}

/**
 * PocketShare is a lightweight filesystem helper that powers the rest of the
 * Pocket stack. Instead of exposing an HTTP API, it offers a type-safe API that
 * applications can call directly to explore a directory, stream files, zip
 * folders and create new content. All paths are sandboxed to the configured
 * root directory to avoid accidental escapes.
 */
export class PocketShare {
  private readonly rootPath: string;
  private readonly passcode: string;
  private readonly sessions = new Map<string, PocketShareSessionImpl>();
  private remoteShare?: {
    server: FileServer;
    tunnel?: CloudflareTunnel;
    configPath?: string;
    localUrl: string;
    publicUrl?: string;
    port: number;
    hostname?: string;
    stop: () => Promise<void>;
  };

  constructor(options: PocketShareOptions) {
    const resolvedRoot = path.resolve(options.rootPath);
    ensureDirectory(resolvedRoot);
    this.rootPath = resolvedRoot;
    this.passcode = options.passcode ?? '123456';
  }

  /**
   * Authenticates a caller using the configured passcode. Successful requests
   * return a session proxy that retains the token internally so that every
   * subsequent filesystem helper automatically enforces the same access
   * control policy used by the Pocket file server.
   */
  authenticate(passcode: string): PocketShareSession {
    if (passcode !== this.passcode) {
      throw new Error('Invalid passcode');
    }

    const token = randomBytes(32).toString('hex');
    const session = new PocketShareSessionImpl(this, token);
    this.sessions.set(token, session);
    return session;
  }

  /**
   * Invalidates the provided session token.
   */
  invalidate(token: string): void {
    this.sessions.delete(token);
  }

  private assertValidSession(token: string): void {
    if (!this.sessions.has(token)) {
      throw new Error('Invalid or expired session token');
    }
  }

  /**
   * Returns the absolute path for a requested item. The resolved path is
   * guaranteed to live inside the share root.
   */
  private resolve(relativePath = ''): string {
    const normalised = relativePath.replace(/\\/g, '/');
    const target = path.resolve(this.rootPath, normalised);

    if (target !== this.rootPath && !target.startsWith(`${this.rootPath}${path.sep}`)) {
      throw new Error('Access outside of the share root is not permitted');
    }

    return target;
  }

  /**
   * Returns metadata for every item in a directory. Folders are returned
   * first followed by files.
   */
  async list(token: string, relativePath = ''): Promise<PocketItem[]> {
    this.assertValidSession(token);
    const targetPath = this.resolve(relativePath);
    const stats = await fs.promises.stat(targetPath);

    if (!stats.isDirectory()) {
      throw new Error('Cannot list contents of a file');
    }

    const entries = await fs.promises.readdir(targetPath);
    const items = await Promise.all(entries.map(async (name) => {
      const itemPath = path.join(targetPath, name);
      const itemStats = await fs.promises.stat(itemPath);
      const type: PocketItemType = itemStats.isDirectory() ? 'folder' : 'file';

      return {
        name,
        type,
        size: itemStats.size,
        modified: itemStats.mtime,
        path: path.join(relativePath, name).replace(/\\/g, '/'),
      } satisfies PocketItem;
    }));

    items.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }

      return a.type === 'folder' ? -1 : 1;
    });

    return items;
  }

  /**
   * Provides metadata for a single file or directory.
   */
  async info(token: string, relativePath = ''): Promise<PocketItem> {
    this.assertValidSession(token);
    const targetPath = this.resolve(relativePath);
    const stats = await fs.promises.stat(targetPath);
    const type: PocketItemType = stats.isDirectory() ? 'folder' : 'file';

    return {
      name: relativePath ? path.basename(targetPath) : path.basename(this.rootPath),
      type,
      size: stats.size,
      modified: stats.mtime,
      path: relativePath.replace(/\\/g, '/'),
    };
  }

  /**
   * Reads a file either as a Buffer or a string when an encoding is supplied.
   */
  async readFile(token: string, relativePath: string, encoding?: BufferEncoding): Promise<Buffer | string> {
    this.assertValidSession(token);
    const filePath = this.resolve(relativePath);
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      throw new Error('Requested path is a directory');
    }

    if (encoding) {
      return fs.promises.readFile(filePath, encoding);
    }

    return fs.promises.readFile(filePath);
  }

  /**
   * Creates a readable stream for a file. Useful for piping directly to HTTP
   * responses or other writable streams.
   */
  createReadStream(token: string, relativePath: string): fs.ReadStream {
    this.assertValidSession(token);
    const filePath = this.resolve(relativePath);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      throw new Error('Requested path is a directory');
    }

    return fs.createReadStream(filePath);
  }

  /**
   * Writes data to a file, automatically creating parent directories. Buffers,
   * strings and readable streams are supported.
   */
  async writeFile(token: string, relativePath: string, data: Buffer | string | Readable): Promise<void> {
    this.assertValidSession(token);
    const filePath = this.resolve(relativePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    if (isReadableStream(data)) {
      const writeStream = fs.createWriteStream(filePath);
      await pipeline(data, writeStream);
    } else {
      await fs.promises.writeFile(filePath, data);
    }
  }

  /**
   * Creates a directory (and any missing parents) relative to the share root.
   */
  async createDirectory(token: string, relativePath: string): Promise<void> {
    this.assertValidSession(token);
    const directoryPath = this.resolve(relativePath);
    await fs.promises.mkdir(directoryPath, { recursive: true });
  }

  /**
   * Deletes a file or directory. Directories are removed recursively.
   */
  async remove(token: string, relativePath: string): Promise<void> {
    this.assertValidSession(token);
    const targetPath = this.resolve(relativePath);
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  }

  /**
   * Packages a file or directory into a zip archive and resolves with the
   * archive contents as a Buffer.
   */
  async zip(token: string, relativePath = ''): Promise<Buffer> {
    this.assertValidSession(token);
    const targetPath = this.resolve(relativePath);
    const stats = await fs.promises.stat(targetPath);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    const completion = new Promise<Buffer>((resolve, reject) => {
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(stream);

    if (stats.isDirectory()) {
      archive.directory(targetPath, false);
    } else {
      archive.file(targetPath, { name: path.basename(targetPath) });
    }

    await archive.finalize();
    return completion;
  }

  async startSharing(options: PocketShareHostOptions = {}): Promise<PocketShareHost> {
    if (this.remoteShare) {
      throw new Error('A remote share is already active for this PocketShare instance');
    }

    const server = new FileServer(this.rootPath, this.passcode, options.port ?? 0);
    await server.start();

    const port = server.getPort();
    const localUrl = `http://localhost:${port}`;

    let tunnel: CloudflareTunnel | undefined;
    let publicUrl: string | undefined;
    let hostname: string | undefined;
    let configPath: string | undefined;
    const shouldCleanupConfig = Boolean(options.tunnel && !options.tunnel.configPath);

    try {
      if (options.tunnel) {
        const { tunnelId, domain, subdomain, hostname: explicitHostname, credentialsFile, configPath: providedConfigPath, binaryPath } = options.tunnel;

        if (!tunnelId) {
          throw new Error('Tunnel ID is required to start Cloudflare connectivity');
        }

        const baseDomain = domain.replace(/^\.+|\.+$/g, '').toLowerCase();
        if (!baseDomain) {
          throw new Error('Tunnel domain cannot be empty');
        }

        const shareLabel = explicitHostname
          ? explicitHostname.toLowerCase()
          : `${this.sanitiseSubdomain(subdomain ?? this.generateShareSubdomain())}.${baseDomain}`;

        hostname = shareLabel.replace(/\.+$/, '');
        configPath = providedConfigPath ?? path.join(os.tmpdir(), `pocket-share-${Date.now()}-${randomBytes(4).toString('hex')}.yml`);

        tunnel = new CloudflareTunnel({
          tunnelId,
          domain: baseDomain,
          proxyPort: port,
          hostname,
          credentialsFile,
          configPath,
          binaryPath,
        });

        await tunnel.start();
        publicUrl = `https://${hostname}`;
      }
    } catch (error) {
      await server.stop();
      await this.cleanupConfigFile(configPath, shouldCleanupConfig);
      throw error;
    }

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;

      if (tunnel) {
        try {
          await tunnel.stop();
        } catch (tunnelError) {
          console.warn('Failed to stop Cloudflare tunnel cleanly:', tunnelError);
        }
      }

      await server.stop();
      await this.cleanupConfigFile(configPath, shouldCleanupConfig);

      if (this.remoteShare?.server === server) {
        this.remoteShare = undefined;
      }
    };

    const remoteShare = {
      server,
      tunnel,
      configPath,
      localUrl,
      publicUrl,
      port,
      hostname,
      stop,
    };

    this.remoteShare = remoteShare;

    return {
      localUrl,
      publicUrl,
      hostname,
      passcode: this.passcode,
      port,
      stop,
    };
  }

  async stopSharing(): Promise<void> {
    if (!this.remoteShare) {
      return;
    }

    await this.remoteShare.stop();
  }

  private sanitiseSubdomain(input: string): string {
    const cleaned = input.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').replace(/-+$/, '');
    return cleaned || this.generateShareSubdomain();
  }

  private generateShareSubdomain(): string {
    return randomBytes(4).toString('hex');
  }

  private async cleanupConfigFile(configPath?: string, shouldCleanup = false): Promise<void> {
    if (!configPath || !shouldCleanup) {
      return;
    }

    try {
      await fs.promises.unlink(configPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.warn(`Failed to remove temporary tunnel config at ${configPath}:`, error);
      }
    }
  }
}

export function createPocketShare(options: PocketShareOptions): PocketShare {
  return new PocketShare(options);
}
