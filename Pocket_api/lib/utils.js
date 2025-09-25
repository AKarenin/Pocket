const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function now() {
  return Date.now();
}

function parseJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = [];
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      data.push(chunk);
    });
    req.on('end', () => {
      if (data.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(data).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseRawBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function resolveSharePath(rootPath, relativePath = '') {
  const safePath = relativePath.replace(/^\/+/, '');
  const resolved = path.resolve(rootPath, safePath);
  if (!resolved.startsWith(path.resolve(rootPath))) {
    throw new Error('Invalid path');
  }
  return resolved;
}

function ensureDirectory(resolvedPath) {
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });
}

function toTimestamp(ms) {
  return new Date(ms).toISOString();
}

module.exports = {
  generateToken,
  now,
  parseJsonBody,
  parseRawBody,
  sendJson,
  sendError,
  resolveSharePath,
  ensureDirectory,
  toTimestamp
};
