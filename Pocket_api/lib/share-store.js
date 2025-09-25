const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { generateToken, now, toTimestamp } = require('./utils');

class ShareStore {
  constructor({ webhookService, websocketHub } = {}) {
    this.shares = new Map();
    this.tokens = new Map();
    this.webhookService = webhookService;
    this.websocketHub = websocketHub;
  }

  listShares() {
    return Array.from(this.shares.values());
  }

  getShareById(id) {
    const share = this.shares.get(id);
    if (!share) return null;
    if (this._isExpired(share)) {
      this._expireShare(share, false);
    }
    return share.active ? share : null;
  }

  getShareByToken(accessToken) {
    const shareId = this.tokens.get(accessToken);
    if (!shareId) return null;
    return this.getShareById(shareId);
  }

  async createShare(options) {
    const rootPath = path.resolve(options.path);
    const permissions = options.permissions === 'read-write' ? 'read-write' : 'read';
    const ttlSeconds = Number(options.ttl) || 0;
    if (ttlSeconds <= 0) {
      throw new Error('ttl must be greater than 0');
    }
    const stat = await fsp.stat(rootPath).catch(() => null);
    if (!stat) {
      throw new Error('Path does not exist');
    }
    const shareId = `shr_${generateToken(12)}`;
    const accessToken = generateToken(18);
    const expiresAt = now() + ttlSeconds * 1000;
    const share = {
      id: shareId,
      rootPath,
      permissions,
      ttl: ttlSeconds,
      expiresAt,
      maxDownloads: options.max_downloads ? Number(options.max_downloads) : undefined,
      downloads: 0,
      webhookUrl: options.webhook_url || null,
      accessToken,
      active: true,
      locks: new Map(),
      expireTimer: null,
      watcher: null
    };
    this.shares.set(shareId, share);
    this.tokens.set(accessToken, shareId);
    this._scheduleExpiry(share);
    this._attachWatcher(share);
    this._emitWebhook(share, 'share.created', { permissions, ttl: ttlSeconds });
    return this._serializeShare(share, { includeToken: true });
  }

  async revokeShare(id) {
    const share = this.shares.get(id);
    if (!share) return false;
    this._expireShare(share, true);
    return true;
  }

  async updateShare(id, updates = {}) {
    const share = this.getShareById(id);
    if (!share) {
      throw new Error('Share not found');
    }
    if (updates.permissions) {
      share.permissions = updates.permissions === 'read-write' ? 'read-write' : 'read';
    }
    if (updates.ttl) {
      const ttlSeconds = Number(updates.ttl);
      if (ttlSeconds > 0) {
        share.ttl = ttlSeconds;
        share.expiresAt = now() + ttlSeconds * 1000;
        this._scheduleExpiry(share);
      }
    }
    this._emitWebhook(share, 'share.updated', { permissions: share.permissions, ttl: share.ttl });
    return this._serializeShare(share, { includeToken: true });
  }

  markShareAccessed(share) {
    this._emitWebhook(share, 'share.accessed', { share_id: share.id });
  }

  recordDownload(share) {
    share.downloads += 1;
    if (share.maxDownloads && share.downloads > share.maxDownloads) {
      throw new Error('Download limit reached');
    }
  }

  listLocks(share) {
    return Array.from(share.locks.entries()).map(([file, info]) => ({
      path: file,
      locked_by: info.lockedBy,
      timestamp: info.timestamp
    }));
  }

  lockFile(share, relativePath, lockedBy) {
    const entry = share.locks.get(relativePath);
    if (entry) {
      throw new Error('File already locked');
    }
    const info = { lockedBy, timestamp: toTimestamp(now()) };
    share.locks.set(relativePath, info);
    this._broadcast(share.id, {
      event: 'file_lock',
      data: { path: relativePath, locked_by: lockedBy, timestamp: info.timestamp }
    });
    return info;
  }

  unlockFile(share, relativePath) {
    if (!share.locks.has(relativePath)) {
      throw new Error('Lock not found');
    }
    share.locks.delete(relativePath);
    this._broadcast(share.id, {
      event: 'file_unlock',
      data: { path: relativePath }
    });
  }

  touchFileEvent(share, relativePath, eventType) {
    this._broadcast(share.id, {
      event: 'file_changed',
      data: {
        path: relativePath,
        event_type: eventType
      }
    });
    this._emitWebhook(share, 'file.modified', { path: relativePath, event_type: eventType });
  }

  serializeForResponse(share, { includeToken = false } = {}) {
    return this._serializeShare(share, { includeToken });
  }

  _serializeShare(share, { includeToken = false } = {}) {
    return {
      share_id: share.id,
      permissions: share.permissions,
      expires_at: toTimestamp(share.expiresAt),
      active: share.active,
      access_token: includeToken ? share.accessToken : undefined,
      websocket_url: includeToken ? `/shares/${share.id}/sync` : undefined
    };
  }

  _isExpired(share) {
    return share.active && share.expiresAt <= now();
  }

  _scheduleExpiry(share) {
    if (share.expireTimer) {
      clearTimeout(share.expireTimer);
    }
    const delay = Math.max(share.expiresAt - now(), 0);
    share.expireTimer = setTimeout(() => this._expireShare(share, false), delay).unref();
  }

  _expireShare(share, manual) {
    if (!share.active) return;
    share.active = false;
    if (share.expireTimer) {
      clearTimeout(share.expireTimer);
      share.expireTimer = null;
    }
    if (share.watcher) {
      share.watcher.close();
      share.watcher = null;
    }
    this.tokens.delete(share.accessToken);
    this._broadcast(share.id, {
      event: 'share_closed',
      data: { reason: manual ? 'revoked' : 'expired' }
    });
    if (this.websocketHub) {
      this.websocketHub.closeShare(share.id);
    }
    this._emitWebhook(share, manual ? 'share.revoked' : 'share.expired', { share_id: share.id });
  }

  _attachWatcher(share) {
    try {
      const watcher = fs.watch(share.rootPath, { recursive: true }, async (eventType, filename) => {
        if (!filename) return;
        const relative = filename.toString();
        let type = 'modified';
        try {
          await fsp.access(path.join(share.rootPath, relative));
          type = eventType === 'rename' ? 'created' : 'modified';
        } catch {
          type = 'deleted';
        }
        this.touchFileEvent(share, relative, type);
      });
      share.watcher = watcher;
    } catch (err) {
      // Recursive watch not supported; fall back to non-recursive watch
      try {
        const watcher = fs.watch(share.rootPath, async (eventType, filename) => {
          if (!filename) return;
          const relative = filename.toString();
          let type = 'modified';
          try {
            await fsp.access(path.join(share.rootPath, relative));
            type = eventType === 'rename' ? 'created' : 'modified';
          } catch {
            type = 'deleted';
          }
          this.touchFileEvent(share, relative, type);
        });
        share.watcher = watcher;
      } catch (_) {
        share.watcher = null;
      }
    }
  }

  _broadcast(shareId, payload) {
    if (this.websocketHub) {
      this.websocketHub.broadcast(shareId, payload);
    }
  }

  _emitWebhook(share, eventName, metadata) {
    if (this.webhookService) {
      this.webhookService.emit(share, eventName, metadata);
    }
  }
}

module.exports = { ShareStore };
