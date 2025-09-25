const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { URL } = require('url');
const { AuthManager } = require('../lib/auth');
const { ShareStore } = require('../lib/share-store');
const { WebSocketHub } = require('../lib/websocket-hub');
const { WebhookService } = require('../lib/webhook');
const {
  parseJsonBody,
  parseRawBody,
  sendJson,
  sendError,
  resolveSharePath,
  ensureDirectory,
  toTimestamp
} = require('../lib/utils');

const authManager = new AuthManager();
const webhookService = new WebhookService();
const shareStore = new ShareStore({ webhookService });
const websocketHub = new WebSocketHub({ shareStore });
shareStore.websocketHub = websocketHub;

const PORT = process.env.PORT || 8080;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const segments = pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'POST' && pathname === '/auth/token') {
      return await handleAuthToken(req, res);
    }

    if (segments[0] === 'shares') {
      if (segments.length === 1) {
        if (req.method === 'POST') {
          return await handleCreateShare(req, res);
        }
      } else {
        const shareId = segments[1];
        if (segments.length === 2) {
          if (req.method === 'GET') {
            return await handleGetShare(req, res, shareId);
          }
          if (req.method === 'DELETE') {
            return await handleDeleteShare(req, res, shareId);
          }
          if (req.method === 'PATCH') {
            return await handlePatchShare(req, res, shareId);
          }
        } else if (segments[2] === 'files') {
          const relativePath = decodeURIComponent(segments.slice(3).join('/'));
          if (req.method === 'GET') {
            return await handleFileGet(req, res, shareId, relativePath);
          }
          if (req.method === 'POST') {
            return await handleFileCreate(req, res, shareId, relativePath);
          }
          if (req.method === 'PUT') {
            return await handleFileUpdate(req, res, shareId, relativePath);
          }
          if (req.method === 'DELETE') {
            return await handleFileDelete(req, res, shareId, relativePath);
          }
        } else if (segments[2] === 'lock') {
          const relativePath = decodeURIComponent(segments.slice(3).join('/'));
          if (req.method === 'POST') {
            return await handleLock(req, res, shareId, relativePath);
          }
          if (req.method === 'DELETE') {
            return await handleUnlock(req, res, shareId, relativePath);
          }
        }
      }
    }

    sendError(res, 404, 'Not found');
  } catch (err) {
    console.error('Request failed', err);
    if (!res.headersSent) {
      sendError(res, err.statusCode || 500, err.message || 'Internal server error');
    } else {
      res.end();
    }
  }
});

server.on('upgrade', (req, socket, head) => {
  websocketHub.handleUpgrade(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`Pocket API server listening on port ${PORT}`);
});

async function handleAuthToken(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return sendError(res, 400, 'Invalid JSON body');
  }
  const apiKey = body.api_key;
  if (!apiKey) {
    return sendError(res, 400, 'api_key is required');
  }
  const issued = authManager.issueToken(apiKey);
  if (!issued) {
    return sendError(res, 401, 'Invalid API key');
  }
  sendJson(res, 200, {
    access_token: issued.token,
    expires_in: Math.floor((issued.expiresAt - Date.now()) / 1000)
  });
}

function requireManagementToken(req, res) {
  const bearer = extractBearer(req.headers['authorization']);
  const verified = authManager.verifyToken(bearer);
  if (!verified) {
    sendError(res, 401, 'Unauthorized');
    return null;
  }
  return verified;
}

function requireShare(req, res, shareId) {
  const bearer = extractBearer(req.headers['authorization']);
  const share = shareStore.getShareByToken(bearer);
  if (!share || share.id !== shareId || !share.active) {
    sendError(res, 401, 'Invalid or expired access token');
    return null;
  }
  return share;
}

async function handleCreateShare(req, res) {
  if (!requireManagementToken(req, res)) return;
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return sendError(res, 400, 'Invalid JSON body');
  }
  try {
    const share = await shareStore.createShare(body);
    sendJson(res, 201, share);
  } catch (err) {
    return sendError(res, 400, err.message);
  }
}

async function handleGetShare(req, res, shareId) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  shareStore.markShareAccessed(share);
  const response = shareStore.serializeForResponse(share, { includeToken: false });
  sendJson(res, 200, response);
}

async function handleDeleteShare(req, res, shareId) {
  if (!requireManagementToken(req, res)) return;
  const removed = await shareStore.revokeShare(shareId);
  if (!removed) {
    return sendError(res, 404, 'Share not found');
  }
  sendJson(res, 200, { success: true });
}

async function handlePatchShare(req, res, shareId) {
  if (!requireManagementToken(req, res)) return;
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return sendError(res, 400, 'Invalid JSON body');
  }
  try {
    const updated = await shareStore.updateShare(shareId, body);
    sendJson(res, 200, updated);
  } catch (err) {
    if (err.message === 'Share not found') {
      return sendError(res, 404, err.message);
    }
    sendError(res, 400, err.message);
  }
}

async function handleFileGet(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  const safePath = resolveSharePath(share.rootPath, relativePath || '.');
  let stat;
  try {
    stat = await fsp.stat(safePath);
  } catch (err) {
    return sendError(res, 404, 'File not found');
  }
  if (stat.isDirectory()) {
    const entries = await fsp.readdir(safePath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = path.join(safePath, entry.name);
      const entryStat = await fsp.stat(entryPath);
      files.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entryStat.size,
        modified: toTimestamp(entryStat.mtimeMs)
      });
    }
    sendJson(res, 200, { files });
    return;
  }

  try {
    shareStore.recordDownload(share);
  } catch (err) {
    return sendError(res, 403, err.message);
  }

  const range = req.headers['range'];
  const total = stat.size;
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : total - 1;
      if (start >= total || end >= total) {
        res.writeHead(416, {
          'Content-Range': `bytes */${total}`
        });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${total}`
      });
      fs.createReadStream(safePath, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': total
  });
  fs.createReadStream(safePath).pipe(res);
}

async function handleFileCreate(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  if (share.permissions !== 'read-write') {
    return sendError(res, 403, 'Share is read-only');
  }
  if (!relativePath) {
    return sendError(res, 400, 'Path is required');
  }
  const safePath = resolveSharePath(share.rootPath, relativePath);
  const exists = await fsp.access(safePath).then(() => true).catch(() => false);
  if (exists) {
    return sendError(res, 409, 'File already exists');
  }
  let buffer;
  try {
    buffer = await parseRawBody(req);
  } catch (err) {
    return sendError(res, 400, err.message);
  }
  ensureDirectory(safePath);
  await fsp.writeFile(safePath, buffer);
  shareStore.touchFileEvent(share, relativePath, 'created');
  sendJson(res, 201, { success: true });
}

async function handleFileUpdate(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  if (share.permissions !== 'read-write') {
    return sendError(res, 403, 'Share is read-only');
  }
  if (!relativePath) {
    return sendError(res, 400, 'Path is required');
  }
  const safePath = resolveSharePath(share.rootPath, relativePath);
  const exists = await fsp.access(safePath).then(() => true).catch(() => false);
  if (!exists) {
    return sendError(res, 404, 'File not found');
  }
  let buffer;
  try {
    buffer = await parseRawBody(req);
  } catch (err) {
    return sendError(res, 400, err.message);
  }
  ensureDirectory(safePath);
  await fsp.writeFile(safePath, buffer);
  shareStore.touchFileEvent(share, relativePath, 'modified');
  sendJson(res, 200, { success: true });
}

async function handleFileDelete(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  if (share.permissions !== 'read-write') {
    return sendError(res, 403, 'Share is read-only');
  }
  if (!relativePath) {
    return sendError(res, 400, 'Path is required');
  }
  const safePath = resolveSharePath(share.rootPath, relativePath);
  const exists = await fsp.access(safePath).then(() => true).catch(() => false);
  if (!exists) {
    return sendError(res, 404, 'File not found');
  }
  const stat = await fsp.stat(safePath);
  if (stat.isDirectory()) {
    await fsp.rm(safePath, { recursive: true, force: true });
  } else {
    await fsp.unlink(safePath);
  }
  shareStore.touchFileEvent(share, relativePath, 'deleted');
  sendJson(res, 200, { success: true });
}

async function handleLock(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  if (!relativePath) {
    return sendError(res, 400, 'Path is required');
  }
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return sendError(res, 400, 'Invalid JSON body');
  }
  const lockedBy = body.locked_by || body.lockedBy || 'unknown';
  try {
    const info = shareStore.lockFile(share, relativePath, lockedBy);
    sendJson(res, 200, info);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

async function handleUnlock(req, res, shareId, relativePath) {
  const share = requireShare(req, res, shareId);
  if (!share) return;
  if (!relativePath) {
    return sendError(res, 400, 'Path is required');
  }
  try {
    shareStore.unlockFile(share, relativePath);
    sendJson(res, 200, { success: true });
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

function extractBearer(header) {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

module.exports = { server, shareStore, authManager };
