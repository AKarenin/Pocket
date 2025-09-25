const crypto = require('crypto');
const { URL } = require('url');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WebSocketHub {
  constructor({ shareStore }) {
    this.shareStore = shareStore;
    this.connections = new Map(); // shareId -> Set<socket>
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch (err) {
      socket.destroy();
      return;
    }
    const match = url.pathname.match(/^\/shares\/([^/]+)\/sync$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const shareId = match[1];
    const token = url.searchParams.get('access_token');
    const share = this.shareStore.getShareByToken(token);
    if (!share || share.id !== shareId || !share.active) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ];
    socket.write(headers.join('\r\n') + '\r\n\r\n');
    socket.on('data', data => this._handleFrame(socket, data));
    socket.on('close', () => this._removeConnection(shareId, socket));
    socket.on('error', () => this._removeConnection(shareId, socket));
    this._addConnection(shareId, socket);
  }

  broadcast(shareId, payload) {
    const message = JSON.stringify(payload);
    const sockets = this.connections.get(shareId);
    if (!sockets || sockets.size === 0) return;
    const frame = this._encodeFrame(message);
    for (const socket of sockets) {
      try {
        socket.write(frame);
      } catch (_) {
        this._removeConnection(shareId, socket);
      }
    }
  }

  closeShare(shareId) {
    const sockets = this.connections.get(shareId);
    if (!sockets) return;
    const frame = this._encodeCloseFrame();
    for (const socket of sockets) {
      try {
        socket.end(frame);
      } catch (_) {
        socket.destroy();
      }
    }
    this.connections.delete(shareId);
  }

  _addConnection(shareId, socket) {
    if (!this.connections.has(shareId)) {
      this.connections.set(shareId, new Set());
    }
    this.connections.get(shareId).add(socket);
  }

  _removeConnection(shareId, socket) {
    const sockets = this.connections.get(shareId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.connections.delete(shareId);
    }
  }

  _handleFrame(socket, buffer) {
    if (!buffer || buffer.length < 2) return;
    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;
    const isMasked = (buffer[1] & 0x80) === 0x80;
    let payloadLength = buffer[1] & 0x7f;
    let offset = 2;
    if (payloadLength === 126) {
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      payloadLength = high * 2 ** 32 + low;
      offset += 8;
    }
    let mask;
    if (isMasked) {
      mask = buffer.slice(offset, offset + 4);
      offset += 4;
    }
    const payload = buffer.slice(offset, offset + payloadLength);
    if (isMasked && mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }
    if (opcode === 0x8) {
      // close
      try {
        socket.end(this._encodeCloseFrame());
      } catch (_) {
        socket.destroy();
      }
    } else if (opcode === 0x9) {
      // ping
      const frame = this._encodePongFrame(payload);
      socket.write(frame);
    }
  }

  _encodeFrame(message) {
    const payload = Buffer.from(message);
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
      header.writeUInt32BE(length % 2 ** 32, 6);
    }
    return Buffer.concat([header, payload]);
  }

  _encodeCloseFrame() {
    return Buffer.from([0x88, 0x00]);
  }

  _encodePongFrame(payload) {
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x8a;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x8a;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x8a;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
      header.writeUInt32BE(length % 2 ** 32, 6);
    }
    return Buffer.concat([header, payload]);
  }
}

module.exports = { WebSocketHub };
