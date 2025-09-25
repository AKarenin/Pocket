# Pocket API

Pocket API is a headless HTTP service that exposes Pocket-inspired file sharing flows for agent-to-agent workflows. It implements token-based authentication, share lifecycle management, file operations, WebSocket sync events, and outbound webhooks without relying on the original Electron shell.

## Features

- **Authentication** – Exchange API keys for short-lived bearer tokens via `POST /auth/token`.
- **Share management** – Create, inspect, update, and revoke file shares with TTLs, permissions, download limits, and optional webhooks.
- **File operations** – List directories, download files with HTTP range requests, and upload/update/delete content when shares are read-write.
- **Real-time sync** – Subscribe to per-share WebSocket channels for file change and lock notifications.
- **File locking** – Coordinate optimistic locking with dedicated endpoints and broadcast events.
- **Webhooks** – Receive lifecycle notifications (`share.created`, `share.accessed`, `file.modified`, `share.expired`, `share.revoked`).

## Getting started

1. **Install dependencies** – The server relies only on the Node.js standard library and runs on Node 18+ (for built-in `fetch`).
2. **Start the server**
   ```bash
   npm start
   ```
   The API listens on port `8080` by default. Override the port with the `PORT` environment variable. Provide allowed API keys via `API_KEYS` (comma-separated) if you need to rotate the default `pocket-dev-key`.

## Request flow

1. **Authenticate**
   ```http
   POST /auth/token
   Content-Type: application/json

   { "api_key": "pocket-dev-key" }
   ```
   Response:
   ```json
   {
     "access_token": "...",
     "expires_in": 3600
   }
   ```

2. **Create a share**
   ```http
   POST /shares
   Authorization: Bearer <access_token>
   Content-Type: application/json

   {
     "path": "/absolute/path/to/folder",
     "ttl": 3600,
     "permissions": "read-write",
     "max_downloads": 10,
     "webhook_url": "https://example.com/webhook"
   }
   ```

   Response:
   ```json
   {
     "share_id": "shr_...",
     "permissions": "read-write",
     "expires_at": "2025-01-01T00:00:00.000Z",
     "active": true,
     "access_token": "...",
     "websocket_url": "/shares/shr_.../sync"
   }
   ```

3. **Use the share access token** – Interact with file endpoints by presenting the returned `access_token` in the `Authorization` header.

4. **Subscribe to sync events** – Connect to `ws://<host>/shares/<share_id>/sync?access_token=<token>` to receive JSON events:
   - `file_changed`
   - `file_lock`
   - `file_unlock`
   - `share_closed`

5. **Handle webhooks** – When configured, the API posts lifecycle payloads to `webhook_url`.

## Development notes

- File watching uses `fs.watch`; recursive watching may not be available on all platforms, but explicit API operations always broadcast events.
- Webhooks are best-effort; failures are logged but do not block API responses.
- Download limits are enforced per successful `GET /shares/:id/files/:path` request.
- The in-memory store is suitable for a single-node demo. Persisting shares or distributing load would require adapting `ShareStore` to use an external database and shared event bus.

## License

MIT
