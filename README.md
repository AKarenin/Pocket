## MVP for Pocket: Ephemeral Access Framework

### Vision
We imagine a world where data flows like conversation — immediate, private and dynamic. Pocket re‑imagines file sharing as a connection, not a destination. It allows humans and AI agents to share work securely and instantly without uploading to permanent storage. As our digital lives become more agentic and distributed across devices, Pocket bridges the gap, enabling creative workflows and collaborations that respect ownership and privacy.

### Mission
Pocket empowers people and autonomous agents to share and collaborate on data in a frictionless, local‑first way. Our mission is to turn storage into a fleeting moment of access: a secure, time‑limited window into your files where your data remains at the source. By eliminating the need to upload to third‑party servers, Pocket protects sensitive content, cuts costs and reduces latency. Whether you're moving a sketch from a tablet to a workstation, synchronising AI agent outputs across edge devices or handing off large media files to collaborators, Pocket gives you control, speed and peace of mind.

### Library Overview

Pocket can now be consumed directly as a Node.js library. Import the
`PocketShare` helper to explore directories, stream files, zip folders and
modify content without standing up an HTTP server. Sessions are protected with
the same passcode gate that the Pocket web server uses so human-to-human and
agent-to-agent exchanges follow the identical access model.

```ts
import { createPocketShare } from 'pocket-file-sharing';

const share = createPocketShare({
  rootPath: '/Users/me/Documents/designs',
  passcode: '654321',
});

const session = share.authenticate('654321');
const items = await session.list();
const preview = await session.readFile('concept.pdf');
await session.writeFile('notes/todo.txt', 'Ship the new icon set');

// Revoke the token when you are done interacting with the share
session.close();
```

### Cloudflare Tunnel Integration

For decentralized agent-to-agent sharing you can start the built-in HTTP
server and automatically attach a Cloudflare Tunnel. This opens a globally
reachable URL that enforces the same passcode protection as the local API.

```ts
const share = createPocketShare({
  rootPath: '/Users/me/Documents/designs',
  passcode: '654321',
});

const connection = await share.startSharing({
  tunnel: {
    tunnelId: '442abcac-4aab-409f-854a-1c879870b60d',
    domain: 'pocketfileshare.com',
    subdomain: 'agent-hub', // optional; a random one is generated when omitted
  },
});

console.log('Public URL:', connection.publicUrl);
console.log('Local URL:', connection.localUrl);

// Later, tear everything down (this also stops the Cloudflare tunnel)
await connection.stop();
```

You can also call `await share.stopSharing()` to close any running server from
elsewhere in your application.

### Core Features of the MVP
#### 🚀 Instant, Secure Sharing

- Ephemeral access – Share any folder without uploading; create a short‑lived, permissioned window to your data.
- Unique URLs – Every share gets a unique address (for example, https://{shareId}.pocketfileshare.com) so you can invite collaborators quickly.
- Passcode protection – Simple 6‑digit passcodes grant access; you decide who can view, download or edit.
- Real‑time updates – Changes to your files propagate instantly through a WebSocket connection.
- Cross‑platform – A modern desktop app built with Electron, React and TypeScript works on macOS, Windows and Linux.

#### 🔒 Built‑In Security

- Zero custody – Your data never sits on our servers; Pocket opens a tunnel directly from your device.
- HTTPS everywhere – Cloudflare Tunnel handles encryption and public access, keeping the connection secure.
- Rate limiting & anti‑brute force – Stops malicious attempts against passcodes.
- Path traversal protection – Only the intended folder is exposed; everything else stays private.
- Session management – Pocket remembers passcodes within a browser session for convenience.

#### 🌐 Web Interface & Desktop Experience

- Responsive browser view – Recipients can explore your shared folder from any device.
- File browser & preview – Navigate using breadcrumbs, preview images and text files, and search within the directory. This function is currently unstable in the MVP.
- Download options – Fetch single files or entire directories as ZIP archives.
- Persistent shares – Pocket remembers your shares across restarts; start/stop or remove them with one click.
- System tray – Keep the app running in the background with quick access from the tray.

### How It Works

- Create a share – In the desktop app, choose a folder to share. Pocket generates a unique share ID, sets up an Express server on a random local port and creates a 6‑digit passcode.
- Open a tunnel – Pocket uses Cloudflare Tunnel to expose the local server at https://{shareId}.pocketfileshare.com without exposing your local network.
- Invite others – Share the URL and passcode. Recipients can access your files directly through HTTPS; they never need to install anything.
- Live collaboration – Changes appear in real time via WebSocket. You can revoke access at any time by stopping the share.

### Prerequisites & Setup

Pocket is open‑source and built with Node.js. To run it yourself you will need:

- Node.js 18+
- A Cloudflare account and the Cloudflared client
- The tunnel credentials file for a pre‑configured tunnel (442abcac-4aab-409f-854a-1c879870b60d) saved at ~/.cloudflared/442abcac-4aab-409f-854a-1c879870b60d.json.

Clone this repository, install dependencies, set up the Cloudflare tunnel and run the app in development or production mode. See the original README for detailed commands.

### Future use cases for Pocket:

- Design and media workflows – Hand off high‑resolution images, videos or animation assets without waiting for uploads.
- Edge and IoT devices – Transfer data from sensors and devices to analysis tools without routing through the cloud.
- Agentic AI and robotics – Provide secure, revocable windows for agents to read or write data during their tasks.
- Collaborative creation – Share drafts or working folders in real time with teammates while retaining full control of your files.

### License

Pocket is distributed under the MIT License. See the LICENSE file for details.

Storage as a place is over. With Pocket, storage is a connection — fleeting, secure and under your control.