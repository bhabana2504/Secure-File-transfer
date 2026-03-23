# SecureTransfer
### Cybersecurity & Networking

A cross-platform **desktop application** for transferring files securely over a local network. Built with **Electron + Node.js + Socket.IO**, featuring real-time communication, AES-256-CBC encryption, and a sleek terminal-style UI.

---

## Overview

SecureTransfer is a self-contained desktop app where:
- Multiple clients connect to a shared local server
- Files are **encrypted with AES-256 before transfer**
- Transfers happen in **real-time over WebSockets**
- The UI features a **hacker/terminal aesthetic** (dark green-on-black + light mode)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ELECTRON DESKTOP APP                         │
│                                                                     │
│  ┌──────────────────────┐         ┌──────────────────────────────┐  │
│  │   Renderer Process   │  IPC    │      Main Process            │  │
│  │   (frontend UI)      │◀──────▶│   electron/main.js           │  │
│  │   frontend/index.html│         │   - BrowserWindow            │  │
│  │   Socket.IO Client   │         │   - IPC Handlers             │  │
│  │   AES Key Generator  │         │   - Native File Dialog       │  │
│  └──────────┬───────────┘         │   - Spawns Backend Process   │  │
│             │  preload.js         └──────────┬───────────────────┘  │
│             │  (contextBridge)               │ child_process.spawn  │
└─────────────┼───────────────────────────────┼──────────────────────┘
              │                               │
              │ WebSocket (Socket.IO)          │ starts
              │ HTTP REST (Express)            ▼
              │                  ┌────────────────────────────┐
              └─────────────────▶│   Backend Process          │
                                 │   backend/server.js        │
                                 │                            │
                                 │  ┌──────────────────────┐  │
                                 │  │  Express REST API    │  │
                                 │  │  POST /api/upload    │  │
                                 │  │  GET  /api/download  │  │
                                 │  │  GET  /api/history   │  │
                                 │  │  GET  /api/health    │  │
                                 │  │  GET  /api/gen-key   │  │
                                 │  └──────────────────────┘  │
                                 │  ┌──────────────────────┐  │
                                 │  │  Socket.IO Server    │  │
                                 │  │  file:send           │  │
                                 │  │  file:received       │  │
                                 │  │  file:sent:ack       │  │
                                 │  │  clients:update      │  │
                                 │  │  history:sync        │  │
                                 │  └──────────────────────┘  │
                                 │  ┌──────────────────────┐  │
                                 │  │  AES-256-CBC Crypto  │  │
                                 │  │  (Node.js crypto)    │  │
                                 │  └──────────────────────┘  │
                                 │  ┌──────────────────────┐  │
                                 │  │  File System         │  │
                                 │  │  /uploads /downloads │  │
                                 │  └──────────────────────┘  │
                                 └────────────────────────────┘
```

### File Transfer Flow

```
SENDER                          SERVER                        RECEIVER
  │                               │                               │
  │── Select file ───────────────▶│                               │
  │── Generate AES Key + IV ─────▶│                               │
  │── Encrypt (AES-256-CBC) ─────▶│                               │
  │── Emit file:send (base64) ───▶│                               │
  │                               │── Save .enc file to disk      │
  │                               │── Broadcast file:received ───▶│
  │◀── file:sent:ack ─────────────│                               │
  │                               │◀── GET /api/download/:file?key=&iv=
  │                               │── Decrypt on-the-fly ────────▶│
  │                               │── Stream decrypted file ─────▶│
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Desktop Shell** | Electron | ^27.3 | Cross-platform window, IPC, native file dialogs |
| **Backend Runtime** | Node.js | LTS | Server-side JavaScript runtime |
| **HTTP Server** | Express | ^5.2 | REST API for uploads, downloads, health |
| **Real-Time** | Socket.IO | ^4.8 | WebSocket live file transfer & client sync |
| **Encryption** | Node.js `crypto` | built-in | AES-256-CBC encrypt/decrypt |
| **File Uploads** | Multer | ^2.1 | HTTP multipart file handling |
| **Frontend** | HTML + Vanilla JS | — | Renderer UI with Socket.IO client |
| **Unique IDs** | uuid | ^8.3 | Unique filenames and transfer records |
| **Build Tool** | electron-builder | ^26.8 | Package & distribute the app |
| **Dev Tooling** | concurrently, nodemon, wait-on | — | Dev workflow utilities |

### Security Details

| Property | Value |
|---|---|
| **Algorithm** | AES-256-CBC |
| **Key Size** | 256-bit (32 bytes) via `crypto.randomBytes(32)` |
| **IV Size** | 128-bit (16 bytes) via `crypto.randomBytes(16)` |
| **Encoding** | Keys and IVs stored and transmitted as hex strings |
| **Max File Size** | 500 MB (Socket.IO buffer + Multer limit) |
| **Key Lifecycle** | Fresh key + IV generated per transfer session |
| **Server Decryption** | On-the-fly, only when correct key + IV are supplied at download |

---

## Project Structure

```
Secure-File-transfer/
├── electron/
│   └── main.js          
├── frontend/
│   └── index.html        
├── backend/
│   └── server.js         
├── preload.js            
├── package.json          
├── package-lock.json
├── .gitignore
├── uploads/              
└── downloads/            
```

---

## Usage

### Sending a File

1. Launch the app — the backend starts automatically on `http://localhost:3001`
2. Go to the **Send** tab
3. Click **Select Files** (or drag & drop) to choose files
4. Click **Generate Key** to create a new AES-256 key + IV
5. Enable the **Encrypt** toggle
6. Click **Send** — the file is encrypted and pushed to all connected clients

### Receiving a File

1. Go to the **Receive** tab
2. Incoming files appear in real-time via Socket.IO events
3. Click **Download** on any received file
4. If the file is encrypted, enter the sender's **Key** and **IV** to decrypt on download

### Viewing History

The **History** tab shows the last 50 transfers. History is synced to newly connected clients automatically on join.

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server status, uptime, connected client count |
| `GET` | `/api/generate-key` | Generate a new AES-256 key + IV pair |
| `GET` | `/api/history` | Last 50 transfer records (newest first) |
| `POST` | `/api/upload` | Multipart upload; pass `encrypted`, `key`, `iv` in body |
| `GET` | `/api/download/:filename` | Download file; add `?key=&iv=` to decrypt on-the-fly |

### Socket.IO Events

| Event | Direction | Description |
|---|---|---|
| `file:send` | Client → Server | Send an encrypted file as base64 payload |
| `file:sent:ack` | Server → Sender | Acknowledgement with transfer record |
| `file:received` | Server → All Others | Notify peers of a new downloadable file |
| `clients:update` | Server → All | Updated list of connected clients |
| `client:setName` | Client → Server | Set a display name for the session |
| `history:sync` | Server → New Client | Push recent history on connect |

---

## Security Notes

- Each transfer generates a **unique random key and IV** — no shared static secret
- Keys and IVs must be shared with the recipient out-of-band (e.g. copy-paste in person)
- Encrypted `.enc` files persist on the server; decryption only happens when the correct credentials are supplied
- For use over the internet, add **TLS/SSL** to protect key + IV in transit
- Periodically clean the `uploads/` and `downloads/` directories in production

---

## NOTE :-

 This project represents a foundational implementation of a secure, real-time file transfer system, with significant scope for further enhancements in scalability, security, and user experience.

---

## License

MIT — see [LICENSE](LICENSE) for details.
