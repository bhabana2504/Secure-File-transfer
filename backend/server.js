/**
 * server.js - Main Express + Socket.IO server
 * Handles file uploads, AES encryption, and real-time communication
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');


// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 500 * 1024 * 1024 // 500 MB max file size via socket
});

app.use(cors());
app.use(express.json());

// Ensure upload/download dirs exist
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const DOWNLOADS_DIR = path.join(__dirname, '../downloads');
[UPLOADS_DIR, DOWNLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve downloads statically
app.use('/downloads', express.static(DOWNLOADS_DIR));

// ─── Multer Config (disk storage for HTTP uploads) ────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4().slice(0, 8)}`;
    cb(null, `${unique}-${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ─── AES Encryption Helpers ───────────────────────────────────────────────────
/**
 * Generates a cryptographically secure AES-256 key + IV
 */
function generateAESKey() {
  return {
    key: crypto.randomBytes(32).toString('hex'),  // 256-bit key
    iv: crypto.randomBytes(16).toString('hex')    // 128-bit IV
  };
}

/**
 * Encrypts a Buffer using AES-256-CBC
 * @param {Buffer} data - plaintext data
 * @param {string} keyHex - 32-byte key as hex string
 * @param {string} ivHex  - 16-byte IV as hex string
 * @returns {Buffer} encrypted data
 */
function encryptBuffer(data, keyHex, ivHex) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Decrypts a Buffer using AES-256-CBC
 * @param {Buffer} data - encrypted data
 * @param {string} keyHex - 32-byte key as hex string
 * @param {string} ivHex  - 16-byte IV as hex string
 * @returns {Buffer} decrypted data
 */
function decryptBuffer(data, keyHex, ivHex) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ─── In-Memory State ──────────────────────────────────────────────────────────
// Stores transfer history & connected clients
const transferHistory = [];
const connectedClients = new Map(); // socketId -> { id, connectedAt, name }

// ─── HTTP REST Endpoints ──────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    clients: connectedClients.size,
    uptime: Math.floor(process.uptime()),
    transfers: transferHistory.length
  });
});

// Generate new AES key pair
app.get('/api/generate-key', (req, res) => {
  const keys = generateAESKey();
  res.json({ success: true, ...keys });
});

// Get transfer history
app.get('/api/history', (req, res) => {
  res.json({ success: true, history: transferHistory.slice(-50).reverse() });
});

// HTTP file upload endpoint (fallback / large files)
app.post('/api/upload', upload.array('files'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    const encrypted = req.body.encrypted === 'true';
    const keyHex = req.body.key;
    const ivHex = req.body.iv;
    const results = [];

    for (const file of req.files) {
      let filePath = file.path;
      let finalName = file.originalname;

      // If encryption requested, encrypt the file
      if (encrypted && keyHex && ivHex) {
        const raw = fs.readFileSync(filePath);
        const enc = encryptBuffer(raw, keyHex, ivHex);
        const encPath = filePath + '.enc';
        fs.writeFileSync(encPath, enc);
        fs.unlinkSync(filePath); // remove unencrypted version
        filePath = encPath;
        finalName = file.originalname + '.enc';
      }

      // Move to downloads so receivers can fetch it
      const destName = path.basename(filePath);
      const destPath = path.join(DOWNLOADS_DIR, destName);
      fs.renameSync(filePath, destPath);

      const record = {
        id: uuidv4(),
        originalName: file.originalname,
        storedName: destName,
        size: fs.statSync(destPath).size,
        encrypted,
        timestamp: new Date().toISOString(),
        downloadUrl: `/downloads/${destName}`,
        direction: 'sent'
      };

      transferHistory.push(record);
      results.push(record);

      // Notify all connected clients about new file
      io.emit('file:received', record);
    }

    res.json({ success: true, files: results });
  } catch (err) {
    console.error('[Upload Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download + decrypt endpoint
app.get('/api/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { key, iv } = req.query;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // If key+iv provided, decrypt on the fly before sending
    if (key && iv) {
      const encrypted = fs.readFileSync(filePath);
      const decrypted = decryptBuffer(encrypted, key, iv);
      const cleanName = filename.replace(/\.enc$/, '');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(decrypted);
    }

    // Plain download
    res.download(filePath);
  } catch (err) {
    console.error('[Download Error]', err);
    res.status(500).json({ success: false, error: 'Decryption failed - check your key/IV' });
  }
});

// ─── Socket.IO Real-Time Events ───────────────────────────────────────────────
io.on('connection', (socket) => {
  const clientInfo = {
    id: socket.id,
    connectedAt: new Date().toISOString(),
    name: `Client-${socket.id.slice(0, 6)}`
  };
  connectedClients.set(socket.id, clientInfo);

  console.log(`[+] Client connected: ${socket.id} (total: ${connectedClients.size})`);

  // Announce updated client count to everyone
  io.emit('clients:update', {
    count: connectedClients.size,
    clients: [...connectedClients.values()]
  });

  // Send current history to newly connected client
  socket.emit('history:sync', transferHistory.slice(-50).reverse());

  // ── Socket File Transfer (chunked for large files) ──────────────────────────
  socket.on('file:send', async (payload) => {
    try {
      const {
        fileName,       // original file name
        fileData,       // base64 encoded file content
        fileSize,
        encrypted,      // boolean
        keyHex,
        ivHex,
        mimeType
      } = payload;

      if (!fileName || !fileData) throw new Error('Missing fileName or fileData');

      // Decode base64 → Buffer
      let buffer = Buffer.from(fileData, 'base64');

      // Encrypt if requested
      if (encrypted && keyHex && ivHex) {
        buffer = encryptBuffer(buffer, keyHex, ivHex);
      }

      // Save to downloads dir (so any client can fetch it)
      const storedName = `${Date.now()}-${uuidv4().slice(0, 6)}-${fileName}${encrypted ? '.enc' : ''}`;
      const destPath = path.join(DOWNLOADS_DIR, storedName);
      fs.writeFileSync(destPath, buffer);

      const record = {
        id: uuidv4(),
        originalName: fileName,
        storedName,
        size: buffer.length,
        encrypted: !!encrypted,
        mimeType,
        timestamp: new Date().toISOString(),
        downloadUrl: `/downloads/${storedName}`,
        senderId: socket.id,
        direction: 'sent'
      };

      transferHistory.push(record);

      // Ack back to sender
      socket.emit('file:sent:ack', { success: true, record });

      // Notify all OTHER clients about the new file
      socket.broadcast.emit('file:received', record);

      console.log(`[File] Sent: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB) encrypted=${encrypted}`);
    } catch (err) {
      console.error('[Socket file:send Error]', err.message);
      socket.emit('file:error', { error: err.message });
    }
  });

  // ── Client sets a display name ──────────────────────────────────────────────
  socket.on('client:setName', (name) => {
    if (connectedClients.has(socket.id)) {
      connectedClients.get(socket.id).name = name.slice(0, 32);
      io.emit('clients:update', {
        count: connectedClients.size,
        clients: [...connectedClients.values()]
      });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`[-] Client disconnected: ${socket.id} (total: ${connectedClients.size})`);
    io.emit('clients:update', {
      count: connectedClients.size,
      clients: [...connectedClients.values()]
    });
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🔒 Secure File Transfer Server`);
  console.log(`   HTTP  → http://localhost:${PORT}`);
  console.log(`   WS    → ws://localhost:${PORT}`);
  console.log(`   Uploads  : ${UPLOADS_DIR}`);
  console.log(`   Downloads: ${DOWNLOADS_DIR}\n`);
});

module.exports = { app, server };
