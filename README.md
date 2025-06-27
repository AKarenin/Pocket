# Pocket File Sharing

A secure desktop file sharing application that creates instant, password-protected public URLs for your folders using Cloudflare Tunnel integration.

## Features

### 🚀 Core Functionality
- **Instant Sharing**: Share any folder with a single click
- **Unique URLs**: Each share gets a unique `https://{shareId}.pocketfileshare.com` URL
- **Password Protection**: 6-digit passcodes for secure access
- **Real-time Updates**: Live file synchronization via WebSocket
- **Mobile Responsive**: Clean web interface works on all devices

### 🔒 Security & Access Control
- **HTTPS Only**: All traffic encrypted via Cloudflare
- **Rate Limiting**: Prevents brute force passcode attempts
- **Directory Traversal Protection**: Secure file access
- **Session Management**: Remember passcode during browser session

### 💻 Desktop Application
- **Modern UI**: Clean GitHub/Vercel-inspired interface
- **System Tray**: Minimize to system tray
- **Persistent Storage**: Remember shares between app restarts
- **Cross-platform**: Works on macOS, Windows, and Linux

### 🌐 Web Interface Features
- **File Browser**: Navigate folder structure with breadcrumbs
- **File Preview**: Built-in preview for images and text files
- **Download Options**: Single files or entire folders as ZIP
- **Search**: Find files within shared directories
- **File Icons**: Appropriate icons for different file types

## Prerequisites

1. **Node.js**: Version 18 or higher
2. **Cloudflared**: Cloudflare Tunnel client
3. **Cloudflare Account**: With a configured tunnel

### Installing Cloudflared

#### macOS
```bash
brew install cloudflared
```

#### Windows
Download from [Cloudflare's official page](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)

#### Linux
```bash
# Debian/Ubuntu
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Other distributions - download binary
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd pocket-file-sharing
npm install
```

### 2. Configure Cloudflare Tunnel

The application is pre-configured to use the tunnel ID `442abcac-4aab-409f-854a-1c879870b60d` with the domain `pocketfileshare.com`.

You need to place the tunnel credentials file at:
```
~/.cloudflared/442abcac-4aab-409f-854a-1c879870b60d.json
```

### 3. Build and Run

#### Development Mode
```bash
npm run dev
```

#### Production Build
```bash
npm run build
npm start
```

#### Create Distributable
```bash
npm run dist
```

## How It Works

### Share Creation Process
1. Click "Add Folder" to select a directory
2. System generates:
   - Unique share ID (format: `mcc` + 19 random characters)
   - 6-digit numeric passcode
   - Dedicated Express server on random port (50000-65000)
3. Cloudflare tunnel routes `{shareId}.pocketfileshare.com` to local server
4. Share becomes accessible via public URL

### Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Electron UI   │    │   Share Manager  │    │ Cloudflare Tunnel│
│                 │◄──►│                  │◄──►│                 │
│ React Frontend  │    │ Express Servers  │    │ Public Internet │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   File System   │    │   WebSocket      │    │ Web Clients     │
│   Monitoring    │    │   Real-time      │    │ (Browser)       │
│                 │    │   Updates        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Technology Stack
- **Frontend**: Electron + React + TypeScript
- **Backend**: Express.js servers (one per share)
- **Real-time**: WebSocket for live updates
- **File Watching**: Chokidar for filesystem monitoring
- **Tunneling**: Cloudflare Tunnel for public access
- **Security**: Passcode authentication + HTTPS

## Usage

### Creating a Share
1. Launch the application
2. Click "Add Folder" button
3. Select the directory you want to share
4. Copy the generated URL and passcode
5. Share these credentials with your intended recipients

### Accessing a Share
1. Open the provided URL in any web browser
2. Enter the 6-digit passcode
3. Browse, preview, and download files
4. Changes to the shared folder appear in real-time

### Managing Shares
- **Start/Stop**: Toggle individual shares on/off
- **Remove**: Delete shares (stops server and removes from list)
- **Monitor**: View access counts and last accessed times
- **Tunnel Status**: Monitor Cloudflare tunnel connection

## File Types & Features

### Supported Operations
- **Browse**: Navigate through folder structure
- **Download**: Individual files or folders (as ZIP)
- **Preview**: Images, text files, and JSON
- **Search**: Find files by name within shared directory

### File Type Icons
- 📄 Documents (PDF, DOC, TXT)
- 🖼️ Images (JPG, PNG, GIF, SVG)
- 🎥 Videos (MP4, AVI, MOV)
- 🎵 Audio (MP3, WAV, FLAC)
- 📦 Archives (ZIP, RAR, 7Z)
- ⚡ Code files (JS, HTML, CSS)

## Security Considerations

### Access Control
- **Passcode Protection**: All shares require 6-digit codes
- **Rate Limiting**: Prevents brute force attacks
- **Path Validation**: Prevents directory traversal
- **HTTPS Only**: All traffic encrypted

### Network Security
- **Cloudflare Protection**: DDoS mitigation and security
- **Origin Validation**: Requests verified through tunnel
- **No Direct Exposure**: Local ports not directly accessible
- **Session Management**: Secure passcode storage

## Troubleshooting

### Common Issues

#### Tunnel Not Starting
- Verify cloudflared is installed: `cloudflared --version`
- Check credentials file exists in `~/.cloudflared/`
- Try restarting tunnel from the app interface
- Check console logs for detailed error messages

#### Share Not Accessible
- Confirm tunnel is running (green indicator in app)
- Verify passcode is entered correctly
- Check if share is active (toggle on/off)

#### Port Conflicts
- Application automatically finds available ports (50000-65000)
- Restart the app if port issues persist

### Logs and Debugging
- Check application console for detailed error messages
- Tunnel logs appear in the main process output
- Enable development mode for additional debugging

## Development

### Project Structure
```
src/
├── main.ts                 # Electron main process
├── preload.ts             # Electron preload scripts
├── types/                 # TypeScript type definitions
├── renderer/              # React frontend
│   ├── App.tsx
│   ├── components/
│   └── styles.css
└── server/                # Backend services
    ├── share-manager.ts   # Share orchestration
    ├── share-server.ts    # Individual share servers
    ├── cloudflare-tunnel.ts # Tunnel management
    └── file-watcher.ts    # File system monitoring
```

### Building from Source
```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev

# Build for production
npm run build

# Package for distribution
npm run dist
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review application logs
3. Open an issue on GitHub

---

**Note**: This application uses the pre-configured Cloudflare tunnel `442abcac-4aab-409f-854a-1c879870b60d` with the domain `pocketfileshare.com`. You need to set up the tunnel credentials file to get started. 