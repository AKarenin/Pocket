import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { Server } from 'http';
import archiver from 'archiver';
import multer from 'multer';
import { EventEmitter } from 'events';

export interface FileItem {
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: Date;
  path: string;
}

export class FileServer extends EventEmitter {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  private sharedPath: string;
  private passcode: string;
  private upload!: multer.Multer;

  constructor(sharedPath: string, passcode: string = '123456', port: number = 3000) {
    super();
    this.sharedPath = sharedPath;
    this.passcode = passcode;
    this.port = port;
    this.app = express();
    
    this.setupMulter();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMulter(): void {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = req.body.path ? 
          path.join(this.sharedPath, req.body.path) : 
          this.sharedPath;
        
        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
      },
      filename: (req, file, cb) => {
        let fileName = file.originalname;
        const uploadPath = req.body.path ? 
          path.join(this.sharedPath, req.body.path) : 
          this.sharedPath;
        
        // Handle file conflicts by auto-renaming
        let counter = 1;
        while (fs.existsSync(path.join(uploadPath, fileName))) {
          const ext = path.extname(file.originalname);
          const name = path.basename(file.originalname, ext);
          fileName = `${name} (${counter})${ext}`;
          counter++;
        }
        
        cb(null, fileName);
      }
    });

    this.upload = multer({
      storage,
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB per file
        files: 20 // Maximum 20 files per upload
      }
    });
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });

    // Authentication middleware
    this.app.use((req, res, next) => {
      const headerAuth = req.headers.authorization?.replace('Bearer ', '');
      const queryAuth = req.query.auth as string;
      const bodyAuth = req.body.auth;
      
      const session = headerAuth || queryAuth || bodyAuth;
      
      // Allow access to root, auth endpoints, favicon, and valid sessions
      if (req.path === '/' || req.path === '/api/auth' || req.path === '/favicon.ico' || session === this.passcode) {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
  }

  private setupRoutes(): void {
    // Serve the main UI
    this.app.get('/', (req, res) => {
      res.send(this.generateHTML());
    });

    // Authentication
    this.app.post('/api/auth', (req, res) => {
      const { passcode } = req.body;
      if (passcode === this.passcode) {
        res.json({ success: true, token: this.passcode });
      } else {
        res.status(401).json({ error: 'Invalid passcode' });
      }
    });

    // List files
    this.app.get('/api/files', (req, res) => {
      try {
        const requestPath = req.query.path as string || '';
        const fullPath = path.join(this.sharedPath, requestPath);
        
        // Security check
        if (!fullPath.startsWith(this.sharedPath)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: 'Path not found' });
        }

        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Not a directory' });
        }

        const items = fs.readdirSync(fullPath);
        const files: FileItem[] = items.map(name => {
          const itemPath = path.join(fullPath, name);
          const itemStats = fs.statSync(itemPath);
          return {
            name,
            type: itemStats.isDirectory() ? 'folder' : 'file',
            size: itemStats.size,
            modified: itemStats.mtime,
            path: path.join(requestPath, name).replace(/\\/g, '/')
          };
        });

        // Sort: folders first, then files, alphabetically
        files.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'folder' ? -1 : 1;
        });

        res.json({ path: requestPath, files });
      } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: 'Failed to list files' });
      }
    });

    // Preview file
    this.app.get('/api/preview/:path(*)', (req, res) => {
      try {
        const filePath = req.params.path || '';
        const fullPath = path.join(this.sharedPath, filePath);
        
        // Security check
        if (!fullPath.startsWith(this.sharedPath)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) {
          return res.status(400).json({ error: 'Not a file' });
        }

        const ext = path.extname(fullPath).toLowerCase();
        const fileName = path.basename(fullPath);
        
        // Set appropriate content type with enhanced MIME types
        const mimeTypes: { [key: string]: string } = {
          '.txt': 'text/plain',
          '.md': 'text/markdown',
          '.js': 'text/javascript',
          '.ts': 'text/plain',
          '.json': 'application/json',
          '.html': 'text/html',
          '.htm': 'text/html',
          '.css': 'text/css',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.bmp': 'image/bmp',
          '.ico': 'image/x-icon',
          '.tiff': 'image/tiff',
          '.tif': 'image/tiff',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.ogv': 'video/ogg',
          '.avi': 'video/x-msvideo',
          '.mov': 'video/quicktime',
          '.wmv': 'video/x-ms-wmv',
          '.flv': 'video/x-flv',
          '.mkv': 'video/x-matroska',
          '.m4v': 'video/mp4',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.flac': 'audio/flac',
          '.aac': 'audio/aac',
          '.m4a': 'audio/mp4',
          '.pdf': 'application/pdf',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.ppt': 'application/vnd.ms-powerpoint',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.zip': 'application/zip',
          '.rar': 'application/x-rar-compressed',
          '.7z': 'application/x-7z-compressed',
          '.tar': 'application/x-tar',
          '.gz': 'application/gzip',
          '.xml': 'application/xml',
          '.csv': 'text/csv'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const isVideo = ['.mp4', '.webm', '.ogv', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.m4v'].includes(ext);
        const isAudio = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext);
        
        // Handle range requests for video/audio streaming
        const range = req.headers.range;
        const fileSize = stats.size;
        
        if ((isVideo || isAudio) && range) {
          // Parse range header
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          
          // Set headers for partial content
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize.toString(),
            'Content-Type': contentType,
            'Content-Disposition': `inline; filename="${fileName}"`,
            'Cache-Control': 'public, max-age=3600'
          });
          
          // Create stream with range
          const stream = fs.createReadStream(fullPath, { start, end });
          stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Failed to stream file' });
            }
          });
          stream.pipe(res);
          
        } else {
          // Set headers for inline preview
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
          res.setHeader('Content-Length', stats.size.toString());
          
          // Add cache control for better performance
          res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
          
          // Enable range requests for video/audio files
          if (isVideo || isAudio) {
            res.setHeader('Accept-Ranges', 'bytes');
          }
          
          // For certain file types that might have issues, add specific headers
          if (ext === '.pdf') {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'self'");
          }
          
          // Stream the file
          const stream = fs.createReadStream(fullPath);
          
          // Handle stream errors
          stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Failed to stream file' });
            }
          });
          
          stream.pipe(res);
        }
      } catch (error) {
        console.error('Error previewing file:', error);
        res.status(500).json({ error: 'Failed to preview file' });
      }
    });

    // Download file or folder
    this.app.get('/api/download/:path(*)', (req, res) => {
      try {
        const requestPath = req.params.path || '';
        const fullPath = path.join(this.sharedPath, requestPath);
        
        // Security check
        if (!fullPath.startsWith(this.sharedPath)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Create ZIP for directories
          const folderName = path.basename(fullPath) || 'files';
          const archive = archiver('zip', { zlib: { level: 9 } });
          
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);
          
          archive.pipe(res);
          archive.directory(fullPath, false);
          archive.finalize();
        } else {
          // Stream file directly
          const fileName = path.basename(fullPath);
          res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
          const stream = fs.createReadStream(fullPath);
          stream.pipe(res);
        }
      } catch (error) {
        console.error('Error downloading:', error);
        res.status(500).json({ error: 'Failed to download' });
      }
    });

    // Upload files
    this.app.post('/api/upload', this.upload.array('files'), (req, res) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({ error: 'No files uploaded' });
        }

        const results = files.map(file => ({
          name: file.filename,
          originalName: file.originalname,
          size: file.size
        }));

        res.json({ success: true, files: results });
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
      }
    });

    // Delete file or folder
    this.app.delete('/api/delete', (req, res) => {
      try {
        const { path: deletePath } = req.body;
        if (!deletePath) {
          return res.status(400).json({ error: 'Path is required' });
        }

        const fullPath = path.join(this.sharedPath, deletePath);
        
        // Security check
        if (!fullPath.startsWith(this.sharedPath)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: 'File not found' });
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete' });
      }
    });

    // Search files and folders
    this.app.get('/api/search', (req, res) => {
      try {
        const query = req.query.q as string;
        const searchPath = req.query.path as string || '';
        
        if (!query || query.trim().length === 0) {
          return res.status(400).json({ error: 'Search query is required' });
        }

        const fullPath = path.join(this.sharedPath, searchPath);
        
        // Security check
        if (!fullPath.startsWith(this.sharedPath)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fullPath)) {
          return res.status(404).json({ error: 'Path not found' });
        }

        const results = this.searchFiles(fullPath, query.toLowerCase());
        res.json({ query, path: searchPath, results });
      } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
      }
    });
  }

  private searchFiles(searchPath: string, query: string): FileItem[] {
    const results: FileItem[] = [];

    const searchRecursive = (currentPath: string, relativePath: string = '') => {
      try {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
          const itemPath = path.join(currentPath, item);
          const itemRelativePath = path.join(relativePath, item).replace(/\\/g, '/');
          
          if (item.toLowerCase().includes(query)) {
            const stats = fs.statSync(itemPath);
            results.push({
              name: item,
              type: stats.isDirectory() ? 'folder' : 'file',
              size: stats.size,
              modified: stats.mtime,
              path: itemRelativePath
            });
          }

          // Recursively search subdirectories (limit depth to prevent infinite loops)
          if (fs.statSync(itemPath).isDirectory() && relativePath.split('/').length < 10) {
            searchRecursive(itemPath, itemRelativePath);
          }
        }
      } catch (error) {
        // Skip directories we can't read
        console.warn(`Skipping directory ${currentPath}:`, error);
      }
    };

    searchRecursive(searchPath);
    
    // Sort results: folders first, then by name
    results.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'folder' ? -1 : 1;
    });

    return results.slice(0, 100); // Limit to 100 results
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`📁 File server started on port ${this.port}`);
        console.log(`🔗 Access: http://localhost:${this.port}`);
        this.emit('started', { port: this.port });
        resolve();
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.log(`Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port = this.port + 1;
          this.start().then(resolve).catch(reject);
        } else {
          reject(error);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('📁 File server stopped');
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  public getPort(): number {
    return this.port;
  }

  public getSharedPath(): string {
    return this.sharedPath;
  }

  public setPasscode(passcode: string): void {
    this.passcode = passcode;
  }

  private generateHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Share</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            line-height: 1.5;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: #161b22; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .title { font-size: 24px; font-weight: 600; color: #58a6ff; margin-bottom: 10px; }
        .subtitle { color: #7d8590; }
        .auth-form { background: #161b22; border-radius: 8px; padding: 20px; text-align: center; }
        .form-group { margin-bottom: 15px; }
        .form-input {
            width: 100%; max-width: 300px; padding: 10px; border: 1px solid #30363d;
            border-radius: 6px; background: #0d1117; color: #c9d1d9; font-size: 16px;
        }
        .btn {
            background: #238636; color: white; border: none; padding: 10px 20px;
            border-radius: 6px; cursor: pointer; font-size: 14px; margin: 5px;
        }
        .btn:hover { background: #2ea043; }
        .btn-primary { background: #1f6feb; }
        .btn-primary:hover { background: #388bfd; }
        .file-list { display: grid; gap: 10px; }
        .file-item {
            background: #161b22; border: 1px solid #30363d; border-radius: 8px;
            padding: 15px; display: flex; align-items: center; justify-content: space-between;
        }
        .file-info { display: flex; align-items: center; }
        .file-icon { font-size: 20px; margin-right: 12px; }
        .file-name { font-weight: 500; color: #f0f6fc; }
        .file-meta { color: #7d8590; font-size: 14px; margin-top: 4px; }
        .file-actions { display: flex; gap: 8px; }
        .hidden { display: none; }
        .error { color: #f85149; background: rgba(248, 81, 73, 0.1); padding: 10px; border-radius: 6px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">📁 File Share</div>
            <div class="subtitle">Secure file sharing with passcode protection</div>
        </div>
        
        <div id="auth-section" class="auth-form">
            <h2>🔐 Enter Passcode</h2>
            <form id="auth-form">
                <div class="form-group">
                    <input type="password" id="passcode" class="form-input" placeholder="Enter access code" required>
                </div>
                <button type="submit" class="btn btn-primary">Access Files</button>
            </form>
            <div id="auth-error" class="error hidden"></div>
        </div>
        
        <div id="file-section" class="hidden">
            <div style="margin-bottom: 20px;">
                <button id="refresh-btn" class="btn">🔄 Refresh</button>
                <button id="upload-btn" class="btn">📤 Upload</button>
                <button id="download-zip-btn" class="btn">📦 Download Zip</button>
                <input type="text" id="search-input" class="form-input" placeholder="🔍 Search files..." style="max-width: 250px; margin-left: 10px;">
            </div>
            <div id="search-results" class="hidden">
                <h3 style="color: #58a6ff; margin-bottom: 15px;">Search Results</h3>
                <div id="search-list" class="file-list"></div>
                <button id="clear-search" class="btn" style="margin-top: 10px;">Clear Search</button>
            </div>
            <div id="file-list" class="file-list"></div>
        </div>
    </div>
    
    <input type="file" id="file-input" multiple style="display: none;">
    
    <script>
        let authToken = '';
        
        // Auth handling
        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const passcode = document.getElementById('passcode').value.trim();
            
            try {
                const response = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ passcode })
                });
                
                if (response.ok) {
                    authToken = passcode;
                    document.getElementById('auth-section').classList.add('hidden');
                    document.getElementById('file-section').classList.remove('hidden');
                    loadFiles();
                } else {
                    showError('Invalid passcode');
                }
            } catch (error) {
                showError('Connection error');
            }
        });
        
        function showError(message) {
            const errorEl = document.getElementById('auth-error');
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
        
        // File operations
        async function loadFiles() {
            try {
                const response = await fetch('/api/files', {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    displayFiles(data.files || []);
                }
            } catch (error) {
                console.error('Error loading files:', error);
            }
        }
        
        function displayFiles(files) {
            const fileList = document.getElementById('file-list');
            
            if (files.length === 0) {
                fileList.innerHTML = '<div style="text-align: center; color: #7d8590; padding: 40px;">No files found</div>';
                return;
            }
            
            fileList.innerHTML = files.map(file => {
                const icon = file.type === 'folder' ? '📁' : getFileIcon(file.name);
                const size = file.type === 'folder' ? '' : formatSize(file.size);
                const date = new Date(file.modified).toLocaleDateString();
                
                return \`<div class="file-item">
                    <div class="file-info">
                        <div class="file-icon">\${icon}</div>
                        <div>
                            <div class="file-name">\${escapeHtml(file.name)}</div>
                            <div class="file-meta">\${size} \${date}</div>
                        </div>
                    </div>
                    <div class="file-actions">
                        \${file.type === 'file' ? \`<button class="btn" onclick="previewFile('\${file.path}')">👁️ Preview</button>\` : ''}
                        <button class="btn" onclick="downloadFile('\${file.path}')">⬇️ Download</button>
                    </div>
                </div>\`;
            }).join('');
        }
        
        function getFileIcon(filename) {
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const iconMap = {
                'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️',
                'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'webm': '🎬',
                'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'ogg': '🎵',
                'pdf': '📕', 'doc': '📘', 'docx': '📘', 'txt': '📄',
                'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦',
                'js': '💻', 'ts': '💻', 'html': '💻', 'css': '💻', 'json': '💻'
            };
            return iconMap[ext] || '📄';
        }
        
        function formatSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function downloadFile(path) {
            const url = '/api/download/' + encodeURIComponent(path) + '?auth=' + encodeURIComponent(authToken);
            window.open(url, '_blank');
        }
        
        // Event listeners
        document.getElementById('refresh-btn').addEventListener('click', loadFiles);
        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        // Download entire folder as zip
        document.getElementById('download-zip-btn').addEventListener('click', () => {
            downloadFile(''); // Empty path triggers download of root (entire shared folder)
        });

        // Search functionality
        let searchTimeout;
        document.getElementById('search-input').addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchFiles();
            }, 300); // Debounce search
        });

        document.getElementById('clear-search').addEventListener('click', clearSearch);
        
        document.getElementById('file-input').addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            
            const formData = new FormData();
            files.forEach(file => formData.append('files', file));
            
            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + authToken },
                    body: formData
                });
                
                if (response.ok) {
                    loadFiles();
                    e.target.value = '';
                }
            } catch (error) {
                console.error('Upload error:', error);
            }
        });

        async function searchFiles() {
            const query = document.getElementById('search-input').value.trim();
            if (!query) {
                clearSearch();
                return;
            }

            try {
                const response = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`, {
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    displaySearchResults(data.results, data.query);
                }
            } catch (error) {
                console.error('Search error:', error);
            }
        }

        function displaySearchResults(results, query) {
            const searchResults = document.getElementById('search-results');
            const searchList = document.getElementById('search-list');
            const fileList = document.getElementById('file-list');

            if (results.length === 0) {
                searchList.innerHTML = \`<div style="text-align: center; color: #7d8590; padding: 40px;">No results found for "\${escapeHtml(query)}"</div>\`;
            } else {
                searchList.innerHTML = results.map(file => {
                    const icon = file.type === 'folder' ? '📁' : getFileIcon(file.name);
                    const size = file.type === 'folder' ? '' : formatSize(file.size);
                    const date = new Date(file.modified).toLocaleDateString();
                    
                    return \`<div class="file-item">
                        <div class="file-info">
                            <div class="file-icon">\${icon}</div>
                            <div>
                                <div class="file-name">\${escapeHtml(file.name)}</div>
                                <div class="file-meta">\${size} \${date} • \${escapeHtml(file.path)}</div>
                            </div>
                        </div>
                        <div class="file-actions">
                            \${file.type === 'file' ? \`<button class="btn" onclick="previewFile('\${file.path}')">👁️ Preview</button>\` : ''}
                            <button class="btn" onclick="downloadFile('\${file.path}')">⬇️ Download</button>
                        </div>
                    </div>\`;
                }).join('');
            }

            searchResults.classList.remove('hidden');
            fileList.classList.add('hidden');
        }

        function clearSearch() {
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').classList.add('hidden');
            document.getElementById('file-list').classList.remove('hidden');
        }

        function previewFile(path) {
            const previewUrl = '/api/preview/' + encodeURIComponent(path) + '?auth=' + encodeURIComponent(authToken);
            window.open(previewUrl, '_blank');
        }
    </script>
</body>
</html>`;
  }

  private generateJavaScript(): string {
    return '// JavaScript moved to inline HTML for simplicity';
  }
} 