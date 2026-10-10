/**
 * auth.js — Cryptographic authentication & user management service
 *
 * Implements:
 * - Scrypt password hashing with unique random cryptographic salt
 * - Timing-safe password verification
 * - Cryptographically signed session tokens (HMAC-SHA256) with 7-day expiration
 * - Role-Based Access Control (RBAC): SuperAdmin vs Admin
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');
const USERS_FILE = path.join(CONFIG_DIR, 'users.json');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure config dir exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * Generates a random salt.
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hashes a password using scrypt.
 */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

/**
 * Verifies a password against a salt and hash using timing-safe comparison.
 */
function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  const hashBuf = Buffer.from(hash, 'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (hashBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, storedBuf);
}

/**
 * Loads users from file or bootstraps initial accounts.
 */
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('[auth] Error loading users.json:', err.message);
  }

  // Bootstrap initial accounts if file doesn't exist
  const initialAccounts = [
    { username: 'dege', displayName: 'Dege', role: 'superadmin' },
    { username: 'isa', displayName: 'Isa', role: 'admin' },
    { username: 'mimy', displayName: 'Mimy', role: 'admin' },
    { username: 'berlim', displayName: 'Berlim', role: 'admin' },
    { username: 'baya', displayName: 'Baya', role: 'admin' },
    { username: 'morgan', displayName: 'Morgan', role: 'admin' },
  ];

  const defaultPassword = 'vanguard@2026';
  const bootstrapped = initialAccounts.map((acc) => {
    const salt = generateSalt();
    return {
      username: acc.username,
      displayName: acc.displayName,
      role: acc.role,
      salt,
      passwordHash: hashPassword(defaultPassword, salt),
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLogin: null,
    };
  });

  saveUsers(bootstrapped);
  return bootstrapped;
}

/**
 * Saves users list to users.json safely.
 */
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[auth] Error saving users.json:', err.message);
  }
}

/**
 * Signs a session payload using HMAC-SHA256 with the server API_SECRET.
 */
function createSessionToken(user, apiSecret) {
  const payload = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    exp: Date.now() + SESSION_TTL_MS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', apiSecret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies and decodes a session token.
 */
function verifySessionToken(token, apiSecret) {
  if (!token || typeof token !== 'string') return null;

  // Support master API_SECRET fallback for FiveM server / legacy integrations
  if (token === apiSecret) {
    return {
      username: 'dege',
      displayName: 'Dege (Master)',
      role: 'superadmin',
      mustChangePassword: false,
      isMasterKey: true,
    };
  }

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', apiSecret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null; // Expired
    }
    return payload;
  } catch (_e) {
    return null;
  }
}

/**
 * Authenticates a user by username & password.
 */
function authenticate(username, password, apiSecret) {
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase().trim());
  if (!user) return null;

  const isValid = verifyPassword(password, user.salt, user.passwordHash);
  if (!isValid) return null;

  user.lastLogin = new Date().toISOString();
  saveUsers(users);

  const token = createSessionToken(user, apiSecret);
  return {
    token,
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
    },
  };
}

/**
 * Changes a user's password.
 */
function changePassword(username, newPassword) {
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase().trim());
  if (!user) return false;

  const newSalt = generateSalt();
  user.salt = newSalt;
  user.passwordHash = hashPassword(newPassword, newSalt);
  user.mustChangePassword = false;
  user.passwordUpdatedAt = new Date().toISOString();

  saveUsers(users);
  return true;
}

/**
 * Resets a user's password back to temporary vanguard@2026 (SuperAdmin only).
 */
function resetUserPassword(username) {
  const defaultPassword = 'vanguard@2026';
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase().trim());
  if (!user) return false;

  const newSalt = generateSalt();
  user.salt = newSalt;
  user.passwordHash = hashPassword(defaultPassword, newSalt);
  user.mustChangePassword = true;
  user.passwordUpdatedAt = new Date().toISOString();

  saveUsers(users);
  return true;
}

/**
 * Returns public staff list (safe, without hashes/salts).
 */
function getStaffList() {
  const users = loadUsers();
  return users.map((u) => ({
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    mustChangePassword: Boolean(u.mustChangePassword),
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  }));
}

module.exports = {
  loadUsers,
  authenticate,
  createSessionToken,
  verifySessionToken,
  changePassword,
  resetUserPassword,
  getStaffList,
};
