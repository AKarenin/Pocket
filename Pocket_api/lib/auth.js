const { generateToken, now } = require('./utils');

class AuthManager {
  constructor(options = {}) {
    const keys = options.apiKeys || process.env.API_KEYS || 'pocket-dev-key';
    this.apiKeys = new Set(
      Array.isArray(keys)
        ? keys
        : String(keys)
            .split(',')
            .map(k => k.trim())
            .filter(Boolean)
    );
    this.tokenTtlMs = options.tokenTtlMs || 60 * 60 * 1000; // 1 hour
    this.tokens = new Map();
  }

  addApiKey(key) {
    if (key) {
      this.apiKeys.add(key);
    }
  }

  issueToken(apiKey) {
    if (!this.apiKeys.has(apiKey)) {
      return null;
    }
    const expiresAt = now() + this.tokenTtlMs;
    const token = generateToken();
    this.tokens.set(token, expiresAt);
    return { token, expiresAt };
  }

  verifyToken(token) {
    if (!token) return null;
    const expiresAt = this.tokens.get(token);
    if (!expiresAt) {
      return null;
    }
    if (expiresAt <= now()) {
      this.tokens.delete(token);
      return null;
    }
    return { token, expiresAt };
  }
}

module.exports = { AuthManager };
