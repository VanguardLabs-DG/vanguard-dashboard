/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  fivem-watch-server — Main Entry Point                      ║
 * ║  Real-time FiveM player monitoring backend                  ║
 * ║  Repository: https://github.com/user/fivem-watch            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This server handles primary responsibilities:
 * 1. TELEMETRY — Receives player location, RP dossier, vehicle status.
 * 2. MEDIA STREAM — Relays live screenshot frames captured from NUI.
 * 3. REMOTE MODERATION — Relays admin actions (revive, heal, freeze, warn, kick).
 * 4. INVENTORY INSPECTION — Relays ox_inventory data from FiveM server to admin.
 * 5. AUDIT LOGGING — Records staff moderation and streaming sessions.
 *
 * @module fivem-watch-server
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const auth = require('./auth');

// ─── Configuration ─────────────────────────────────────────────
const DEFAULT_SECRET = 'CHANGE_ME_TO_A_RANDOM_SECRET';
const DEFAULT_PASSWORD = 'CHANGE_ME';
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.API_SECRET || DEFAULT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIENT_DIST = path.resolve(__dirname, process.env.CLIENT_DIST || path.join('..', 'client', 'dist'));
const MAX_PLAYERS_PER_INGEST = Number(process.env.MAX_PLAYERS_PER_INGEST || 2048);
const MAX_FRAME_LENGTH = Number(process.env.MAX_FRAME_LENGTH || 5_000_000);

// ─── Audit Logging Setup (Pilar 1) ─────────────────────────────
const AUDIT_LOG_FILE = path.join(__dirname, 'logs', 'audit.json');
const logsDir = path.dirname(AUDIT_LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let auditLogs = [];
try {
  if (fs.existsSync(AUDIT_LOG_FILE)) {
    const raw = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      auditLogs = raw.filter((item) => item && typeof item === 'object');
    }
  }
} catch (_e) {
  auditLogs = [];
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const clean = {
    options: {},
    success: Boolean(details.success),
    result: typeof details.result === 'string'
      ? details.result
      : (details.result ? JSON.stringify(details.result) : 'Ação registrada.'),
  };

  if (details.options && typeof details.options === 'object') {
    const opts = details.options;
    if (opts.reason) clean.options.reason = String(opts.reason).slice(0, 255);
    if (opts.message) clean.options.message = String(opts.message).slice(0, 255);
    if (opts.toggle !== undefined) clean.options.toggle = Boolean(opts.toggle);

    if (opts.coords) {
      let x, y, z;
      if (Array.isArray(opts.coords)) {
        [x, y, z] = opts.coords;
      } else if (typeof opts.coords === 'object') {
        x = opts.coords.x !== undefined ? opts.coords.x : opts.coords.X;
        y = opts.coords.y !== undefined ? opts.coords.y : opts.coords.Y;
        z = opts.coords.z !== undefined ? opts.coords.z : opts.coords.Z;
      }
      const nx = Number(x);
      const ny = Number(y);
      const nz = Number(z);
      if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
        clean.options.coords = { x: nx, y: ny, z: nz };
      }
    }
  }

  return clean;
}

function appendAuditLog(entry) {
  if (!entry || typeof entry !== 'object') return;

  const logItem = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: new Date().toISOString(),
    adminName: String(entry.adminName || 'Admin').slice(0, 64),
    category: ['stream', 'moderation', 'general'].includes(entry.category) ? entry.category : 'general',
    action: String(entry.action || 'action').slice(0, 64),
    targetPlayerId: Number.isInteger(Number(entry.targetPlayerId)) ? Number(entry.targetPlayerId) : null,
    targetPlayerName: entry.targetPlayerName ? String(entry.targetPlayerName).slice(0, 64) : null,
    details: sanitizeDetails(entry.details),
  };

  auditLogs.unshift(logItem);
  if (auditLogs.length > 2000) {
    auditLogs = auditLogs.slice(0, 2000);
  }

  // Grava de forma assíncrona os últimos 500 registros
  fs.writeFile(AUDIT_LOG_FILE, JSON.stringify(auditLogs.slice(0, 500), null, 2), (err) => {
    if (err) console.error('[fivem-watch] Erro ao salvar audit log:', err.message);
  });

  // Notifica admins conectados em tempo real
  for (const adminId of adminSockets) {
    io.to(adminId).emit('audit_log_entry', logItem);
  }
}

function parseCorsOrigin(value) {
  if (value.trim() === '*') return true;
  const list = value.split(',').map((s) => s.trim()).filter(Boolean);
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.startsWith('https://cfx-nui-') || origin.startsWith('nui://') || origin === 'null') {
      return callback(null, true);
    }
    if (list.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    return callback(null, true);
  };
}

function assertProductionConfig() {
  if (NODE_ENV !== 'production') return;
  const badSecret = !process.env.API_SECRET || API_SECRET === DEFAULT_SECRET || API_SECRET.length < 32;
  const badPassword = !process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === DEFAULT_PASSWORD || ADMIN_PASSWORD.length < 12;
  if (badSecret || badPassword) {
    throw new Error('Refusing production start: set strong API_SECRET and ADMIN_PASSWORD.');
  }
}

function normalizePlayer(player) {
  if (!player || typeof player !== 'object') return null;
  const id = Number(player.id);
  const x = Number(player.x);
  const y = Number(player.y);
  const z = Number(player.z);
  if (!Number.isInteger(id) || id < 0 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return {
    id,
    name: String(player.name || `Player ${id}`).slice(0, 64),
    steamName: player.steamName ? String(player.steamName).slice(0, 64) : null,
    characterName: player.characterName ? String(player.characterName).slice(0, 64) : null,
    ping: Math.max(0, Number(player.ping) || 0),
    x,
    y,
    z,
    health: Math.max(0, Math.min(200, Number(player.health) || 0)),
    armor: Math.max(0, Math.min(100, Number(player.armor) || 0)),
    heading: ((Number(player.heading) || 0) % 360 + 360) % 360,
    isFrozen: Boolean(player.isFrozen),
    dossier: player.dossier && typeof player.dossier === 'object' ? player.dossier : null,
    vehicle: player.vehicle && typeof player.vehicle === 'object' ? player.vehicle : null,
  };
}

function normalizePlayers(payload) {
  if (!Array.isArray(payload) || payload.length > MAX_PLAYERS_PER_INGEST) return null;
  const players = payload.map(normalizePlayer);
  return players.every(Boolean) ? players : null;
}

function sanitizeStreamConfig(config) {
  if (!config || typeof config !== 'object') return null;
  const numberOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const next = {};
  if (config.streamFps !== undefined) next.streamFps = Math.max(1, Math.min(30, numberOr(config.streamFps, 1)));
  if (config.resolutionScale !== undefined) next.resolutionScale = Math.max(0.1, Math.min(1, numberOr(config.resolutionScale, 0.5)));
  if (config.streamQuality !== undefined) next.streamQuality = Math.max(0.1, Math.min(1, numberOr(config.streamQuality, 0.5)));
  return Object.keys(next).length ? next : null;
}

function isValidPlayerId(value) {
  return /^\d+$/.test(String(value));
}

function isValidFrame(data) {
  return typeof data === 'string' && data.length <= MAX_FRAME_LENGTH && data.startsWith('data:image/webp;base64,');
}

assertProductionConfig();

// ─── Express App ───────────────────────────────────────────────
const app = express();

const parsedOrigin = parseCorsOrigin(CORS_ORIGIN);

app.disable('x-powered-by');
app.use(cors({ origin: parsedOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const server = http.createServer(app);

// ─── Socket.io Server ─────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: parsedOrigin,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: MAX_FRAME_LENGTH,
});

// ─── In-Memory State ──────────────────────────────────────────
let playersState = [];
const nuiClients = new Map();
const activeStreams = new Set();
const adminSockets = new Set();
const streamWatchers = new Map();
const loginAttempts = new Map();
let fivemServerSocket = null;

function tooManyLoginAttempts(ip) {
  const now = Date.now();
  const state = loginAttempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (state.resetAt < now) {
    state.count = 0;
    state.resetAt = now + 60_000;
  }
  state.count += 1;
  loginAttempts.set(ip, state);
  return state.count > 10;
}

// ─── REST Endpoints ───────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  if (tooManyLoginAttempts(req.ip)) {
    return res.status(429).json({ success: false, error: 'Muitas tentativas de login. Aguarde 1 minuto.' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuário e senha são obrigatórios.' });
  }

  const result = auth.authenticate(username, password, API_SECRET);
  if (result) {
    return res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  }

  // Fallback para ADMIN_USERNAME / ADMIN_PASSWORD do .env
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const masterUser = {
      username: ADMIN_USERNAME,
      displayName: 'Dege (Master)',
      role: 'superadmin',
      mustChangePassword: false,
    };
    const token = auth.createSessionToken(masterUser, API_SECRET);
    return res.json({
      success: true,
      token,
      user: masterUser,
    });
  }

  return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos.' });
});

app.post('/api/auth/change-password', (req, res) => {
  const authHeader = req.headers.authorization || req.headers['x-api-key'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const session = auth.verifySessionToken(token, API_SECRET);

  if (!session) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }

  const { newPassword } = req.body || {};
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'A nova senha deve ter no mínimo 6 caracteres.' });
  }

  const ok = auth.changePassword(session.username, newPassword);
  if (!ok) {
    return res.status(400).json({ success: false, error: 'Não foi possível alterar a senha.' });
  }

  // Emite novo token com mustChangePassword = false
  const updatedUser = {
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    mustChangePassword: false,
  };
  const newToken = auth.createSessionToken(updatedUser, API_SECRET);

  return res.json({ success: true, token: newToken, user: updatedUser });
});

app.get('/api/auth/staff', (req, res) => {
  const authHeader = req.headers.authorization || req.headers['x-api-key'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const session = auth.verifySessionToken(token, API_SECRET);

  if (!session || session.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao SuperAdmin.' });
  }

  return res.json({ success: true, staff: auth.getStaffList() });
});

app.post('/api/auth/staff/reset-password', (req, res) => {
  const authHeader = req.headers.authorization || req.headers['x-api-key'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const session = auth.verifySessionToken(token, API_SECRET);

  if (!session || session.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Acesso restrito ao SuperAdmin.' });
  }

  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ success: false, error: 'Nome de usuário não informado.' });
  }

  const ok = auth.resetUserPassword(username);
  if (!ok) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }

  return res.json({ success: true, message: `Senha de ${username} resetada com sucesso para 'vanguard@2026'.` });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    players: playersState.length,
    streams: activeStreams.size,
    admins: adminSockets.size,
    fivemConnected: Boolean(fivemServerSocket && fivemServerSocket.connected),
    uptime: process.uptime(),
  });
});

app.get('/api/audit-logs', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.token;
  if (apiKey !== API_SECRET) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  res.json(auditLogs);
});

// ─── ox_inventory Item Images Endpoint (Pilar 2) ──────────────
const OX_IMAGES_DIR = '/home/bases/mri_paulista/resources/[ox]/ox_inventory/web/images';
let imageCache = new Map();

function refreshImageCache() {
  try {
    if (fs.existsSync(OX_IMAGES_DIR)) {
      const files = fs.readdirSync(OX_IMAGES_DIR);
      const map = new Map();
      for (const file of files) {
        map.set(file.toLowerCase(), file);
      }
      imageCache = map;
      console.log(`[fivem-watch] ✓ Cache de imagens ox_inventory carregado (${files.length} imagens)`);
    }
  } catch (err) {
    console.warn('[fivem-watch] Aviso ao carregar imagens ox_inventory:', err.message);
  }
}
refreshImageCache();

app.get('/api/item-images/:item', (req, res) => {
  const rawItem = String(req.params.item || '').replace(/\.png$/i, '');
  const safeItem = path.basename(rawItem);
  const targetLower = `${safeItem.toLowerCase()}.png`;

  const matchedFile = imageCache.get(targetLower);
  if (matchedFile) {
    const filePath = path.join(OX_IMAGES_DIR, matchedFile);
    return res.sendFile(filePath, { maxAge: '7d' });
  }

  const directPath = path.join(OX_IMAGES_DIR, `${safeItem}.png`);
  if (fs.existsSync(directPath)) {
    return res.sendFile(directPath, { maxAge: '7d' });
  }

  return res.status(404).end();
});


app.post('/api/ingest', (req, res) => {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== API_SECRET) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  const players = normalizePlayers(req.body);
  if (!players) {
    return res.status(400).json({ error: 'Invalid player payload' });
  }

  playersState = players;
  for (const adminId of adminSockets) {
    io.to(adminId).emit('players_update', playersState);
  }

  return res.json({ ok: true });
});

// ─── Socket.io Connection Handling ────────────────────────────
io.on('connection', (socket) => {
  const { role, secret, playerId } = socket.handshake.auth;

  /**
   * ROLE: "fivem-server"
   */
  if (role === 'fivem-server' && secret === API_SECRET) {
    console.log(`[fivem-watch] ✓ FiveM server connected (${socket.id})`);
    fivemServerSocket = socket;

    socket.on('players_update', (players) => {
      const normalized = normalizePlayers(players);
      if (!normalized) return;
      playersState = normalized;
      for (const adminId of adminSockets) {
        io.to(adminId).emit('players_update', playersState);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[fivem-watch] ✗ FiveM server disconnected`);
      if (fivemServerSocket?.id === socket.id) {
        fivemServerSocket = null;
      }
      playersState = [];
      for (const adminId of adminSockets) {
        io.to(adminId).emit('server_offline');
      }
    });

    return;
  }

  /**
   * ROLE: "fivem-nui"
   */
  if (role === 'fivem-nui' && secret === API_SECRET && playerId) {
    const pid = String(playerId);
    if (!isValidPlayerId(pid)) {
      socket.disconnect(true);
      return;
    }
    nuiClients.set(pid, socket.id);
    console.log(`[fivem-watch] ✓ NUI client connected for player #${pid} (${socket.id})`);

    socket.on('frame', (data) => {
      if (!isValidFrame(data)) return;
      const watchers = streamWatchers.get(pid);
      if (watchers) {
        for (const adminId of watchers) {
          io.to(adminId).emit('player_frame', { playerId: pid, frame: data });
        }
      }
    });

    socket.on('disconnect', () => {
      nuiClients.delete(pid);
      activeStreams.delete(pid);
      streamWatchers.delete(pid);
      console.log(`[fivem-watch] ✗ NUI client disconnected for player #${pid}`);
    });

    return;
  }

  /**
   * ROLE: "admin"
   */
  const verifiedUser = auth.verifySessionToken(secret, API_SECRET);
  if (role === 'admin' && verifiedUser && !verifiedUser.isMasterKey) {
    socket.user = verifiedUser;
    adminSockets.add(socket.id);
    console.log(`[fivem-watch] ✓ Staff connected: ${socket.user.displayName} (${socket.user.role}) [${socket.id}]`);

    socket.emit('players_update', playersState);
    socket.emit('audit_logs_init', auditLogs.slice(0, 100));

    // Início de Stream (Pilar 1)
    socket.on('start_stream', (targetPlayerId) => {
      const pid = String(targetPlayerId);
      if (!isValidPlayerId(pid)) return;
      const nuiSocketId = nuiClients.get(pid);

      if (!nuiSocketId) {
        socket.emit('stream_error', { playerId: pid, error: 'Player NUI not connected' });
        return;
      }

      if (!streamWatchers.has(pid)) {
        streamWatchers.set(pid, new Set());
      }
      streamWatchers.get(pid).add(socket.id);

      if (!activeStreams.has(pid)) {
        activeStreams.add(pid);
        io.to(nuiSocketId).emit('start_capture');
        console.log(`[fivem-watch] ▶ Stream started for player #${pid} by ${socket.user.displayName}`);
      }

      const player = playersState.find((p) => p.id === Number(pid));
      appendAuditLog({
        adminName: socket.user.displayName,
        category: 'stream',
        action: 'start_stream',
        targetPlayerId: Number(pid),
        targetPlayerName: player?.name,
      });

      socket.emit('stream_started', { playerId: pid });
    });

    socket.on('update_stream_config', (data) => {
      const { playerId, config } = data;
      const pid = String(playerId);
      if (!isValidPlayerId(pid)) return;
      const cleanConfig = sanitizeStreamConfig(config);
      if (!cleanConfig) return;
      const nuiSocketId = nuiClients.get(pid);
      if (nuiSocketId) {
        io.to(nuiSocketId).emit('update_config', cleanConfig);
      }
    });

    socket.on('stop_stream', (targetPlayerId) => {
      const pid = String(targetPlayerId);
      if (!isValidPlayerId(pid)) return;
      const watchers = streamWatchers.get(pid);

      if (watchers) {
        watchers.delete(socket.id);

        if (watchers.size === 0) {
          streamWatchers.delete(pid);
          activeStreams.delete(pid);

          const nuiSocketId = nuiClients.get(pid);
          if (nuiSocketId) {
            io.to(nuiSocketId).emit('stop_capture');
            console.log(`[fivem-watch] ■ Stream stopped for player #${pid}`);
          }
        }
      }

      const player = playersState.find((p) => p.id === Number(pid));
      appendAuditLog({
        adminName: socket.user.displayName,
        category: 'stream',
        action: 'stop_stream',
        targetPlayerId: Number(pid),
        targetPlayerName: player?.name,
      });

      socket.emit('stream_stopped', { playerId: pid });
    });

    // ─── RPC: Consulta de Inventário (Pilar 2) ──────────────────
    socket.on('get_player_inventory', (data, callback) => {
      const pid = data?.playerId;
      if (!fivemServerSocket || !fivemServerSocket.connected) {
        if (typeof callback === 'function') callback({ success: false, error: 'Servidor FiveM desconectado.' });
        return;
      }

      fivemServerSocket.emit('get_player_inventory', { playerId: pid }, (response) => {
        if (typeof callback === 'function') callback(response);
      });
    });

    // ─── RPC: Ações Administrativas Remotas (Pilar 3) ────────────
    socket.on('admin_action', (data, callback) => {
      if (!fivemServerSocket || !fivemServerSocket.connected) {
        if (typeof callback === 'function') callback({ success: false, error: 'Servidor FiveM desconectado.' });
        return;
      }

      const targetId = Number(data?.targetPlayerId);
      const player = playersState.find((p) => p.id === targetId);
      const staffName = socket.user?.displayName || 'Admin';

      const forwardData = {
        ...data,
        adminName: staffName,
      };

      fivemServerSocket.emit('admin_action', forwardData, (response) => {
        appendAuditLog({
          adminName: staffName,
          category: 'moderation',
          action: data?.action,
          targetPlayerId: targetId,
          targetPlayerName: player?.name || `Player ${targetId}`,
          details: {
            options: data?.options || {},
            success: Boolean(response?.success),
            result: response?.message || response?.error || 'Ação registrada.',
          },
        });
        if (typeof callback === 'function') callback(response);
      });
    });

    // ─── RPC: Histórico de Auditoria (Pilar 1) ───────────────────
    socket.on('get_audit_logs', (callback) => {
      if (typeof callback === 'function') callback(auditLogs);
    });

    socket.on('disconnect', () => {
      adminSockets.delete(socket.id);

      for (const [pid, watchers] of streamWatchers.entries()) {
        watchers.delete(socket.id);
        if (watchers.size === 0) {
          streamWatchers.delete(pid);
          activeStreams.delete(pid);

          const nuiSocketId = nuiClients.get(pid);
          if (nuiSocketId) {
            io.to(nuiSocketId).emit('stop_capture');
            console.log(`[fivem-watch] ■ Stream auto-stopped for player #${pid} (admin left)`);
          }
        }
      }

      console.log(`[fivem-watch] ✗ Admin disconnected (${socket.id})`);
    });

    return;
  }

  console.log(`[fivem-watch] ✗ Unauthorized connection rejected (${socket.id}): role=${role}`);
  socket.emit('auth_error', { error: 'Invalid role or secret' });
  socket.disconnect(true);
});

if (NODE_ENV === 'production' && fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else if (NODE_ENV === 'production') {
  console.warn(`[fivem-watch] CLIENT_DIST not found, running API-only: ${CLIENT_DIST}`);
}

// ─── Server Start ─────────────────────────────────────────────
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║      fivem-watch server is running       ║');
    console.log(`  ║      http://localhost:${PORT}              ║`);
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
  });
}

module.exports = {
  normalizePlayer,
  normalizePlayers,
  sanitizeStreamConfig,
  isValidFrame,
  parseCorsOrigin,
};
