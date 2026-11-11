/**
 * AIWaliSarkar AutoFlow Pro — Commercial SaaS Cloud Backend (`server.js`)
 * Zero-dependency Node.js REST API + Built-in SQLite (`node:sqlite`)
 *
 * Features:
 * 1. User Registration & Authentication (`/api/v1/auth/register`, `/api/v1/auth/login`)
 * 2. License Key Generation & Verification (`/api/v1/license/verify`, `/api/v1/license/upgrade`)
 * 3. Daily Generation Quota Metering (`/api/v1/usage/consume`, Free: 10/day vs Pro: Unlimited)
 * 4. Stripe Checkout & Webhook Hooks (`/api/v1/billing/checkout`, `/api/v1/billing/webhook`)
 * 5. Interactive SaaS Web Dashboard (`/` -> `public/index.html`)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 5050;
const DB_PATH = path.join(__dirname, 'autoflow_saas.db');
const db = new DatabaseSync(DB_PATH);

/* ==========================================================================
   DATABASE SCHEMA & SEEDING
   ========================================================================== */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'FREE',
    license_key TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(license_key, usage_date)
  );

  CREATE TABLE IF NOT EXISTS generation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    prompt_tag TEXT,
    created_at TEXT NOT NULL
  );
`);

function hashPassword(pw) {
  return crypto.createHash('sha256').update(`autoflow_salt_${pw}`).digest('hex');
}

function generateLicenseKey(prefix = 'FREE') {
  const seg1 = crypto.randomBytes(3).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-AUTOMA-${seg1}-${seg2}`;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// Seed Pre-configured Demo Pro Account (`PRO-AUTOMA-8888-DEMO`) & Free Account
(() => {
  const existingPro = db
    .prepare('SELECT id FROM users WHERE license_key = ?')
    .get('PRO-AUTOMA-8888-DEMO');
  if (!existingPro) {
    db.prepare(
      `INSERT INTO users (email, password_hash, tier, license_key, created_at)
       VALUES (?, ?, 'PRO', 'PRO-AUTOMA-8888-DEMO', ?)`
    ).run('pro@aiwalisarkar.com', hashPassword('demo1234'), new Date().toISOString());
  }

  const existingFree = db
    .prepare('SELECT id FROM users WHERE license_key = ?')
    .get('FREE-AUTOMA-1111-DEMO');
  if (!existingFree) {
    db.prepare(
      `INSERT INTO users (email, password_hash, tier, license_key, created_at)
       VALUES (?, ?, 'FREE', 'FREE-AUTOMA-1111-DEMO', ?)`
    ).run('free@aiwalisarkar.com', hashPassword('free1234'), new Date().toISOString());
  }
})();

/* ==========================================================================
   HELPER FUNCTIONS
   ========================================================================== */
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getUsageForKey(licenseKey) {
  const today = getTodayDateString();
  const row = db
    .prepare('SELECT count FROM daily_usage WHERE license_key = ? AND usage_date = ?')
    .get(licenseKey, today);
  return row ? row.count : 0;
}

function incrementUsageForKey(licenseKey, mode, promptTag) {
  const today = getTodayDateString();
  db.prepare(
    `INSERT INTO daily_usage (license_key, usage_date, count)
     VALUES (?, ?, 1)
     ON CONFLICT(license_key, usage_date)
     DO UPDATE SET count = count + 1`
  ).run(licenseKey, today);

  db.prepare(
    `INSERT INTO generation_logs (license_key, mode, prompt_tag, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(licenseKey, mode || 'text-to-video', promptTag || 'batch', new Date().toISOString());

  return getUsageForKey(licenseKey);
}

/* ==========================================================================
   HTTP SERVER & API ROUTES
   ========================================================================== */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // 1. Health & Stats Overview
    if (pathname === '/api/v1/stats' && req.method === 'GET') {
      const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      const proUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE tier = 'PRO'").get().c;
      const totalGenerations = db.prepare('SELECT COUNT(*) as c FROM generation_logs').get().c;
      const recentLogs = db
        .prepare('SELECT license_key, mode, prompt_tag, created_at FROM generation_logs ORDER BY id DESC LIMIT 15')
        .all();

      return sendJson(res, 200, {
        ok: true,
        totalUsers,
        proUsers,
        totalGenerations,
        recentLogs
      });
    }

    // 2. Register New User
    if (pathname === '/api/v1/auth/register' && req.method === 'POST') {
      const { email, password, tier } = await parseBody(req);
      if (!email || !password) {
        return sendJson(res, 400, { ok: false, error: 'Email and password are required.' });
      }
      const normalizedTier = tier === 'PRO' ? 'PRO' : 'FREE';
      const licenseKey = generateLicenseKey(normalizedTier);

      try {
        db.prepare(
          `INSERT INTO users (email, password_hash, tier, license_key, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(email.trim().toLowerCase(), hashPassword(password), normalizedTier, licenseKey, new Date().toISOString());
      } catch (err) {
        return sendJson(res, 409, { ok: false, error: 'Email is already registered.' });
      }

      return sendJson(res, 201, {
        ok: true,
        email: email.trim().toLowerCase(),
        tier: normalizedTier,
        licenseKey,
        dailyLimit: normalizedTier === 'PRO' ? 999999 : 10,
        usedToday: 0
      });
    }

    // 3. User Login
    if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
      const { email, password } = await parseBody(req);
      const user = db
        .prepare('SELECT email, tier, license_key, created_at FROM users WHERE email = ? AND password_hash = ?')
        .get((email || '').trim().toLowerCase(), hashPassword(password || ''));

      if (!user) {
        return sendJson(res, 401, { ok: false, error: 'Invalid email or password.' });
      }

      const usedToday = getUsageForKey(user.license_key);
      return sendJson(res, 200, {
        ok: true,
        email: user.email,
        tier: user.tier,
        licenseKey: user.license_key,
        usedToday,
        dailyLimit: user.tier === 'PRO' ? 999999 : 10
      });
    }

    // 4. Verify License Key (Called by Chrome Extension)
    if (pathname === '/api/v1/license/verify' && req.method === 'POST') {
      const { licenseKey } = await parseBody(req);
      const cleanKey = (licenseKey || '').trim() || 'FREE-AUTOMA-1111-DEMO';

      const user = db
        .prepare('SELECT email, tier, license_key FROM users WHERE license_key = ?')
        .get(cleanKey);

      if (!user) {
        const guestUsed = getUsageForKey('GUEST-FREE-TIER');
        return sendJson(res, 200, {
          ok: true,
          valid: false,
          tier: 'FREE',
          licenseKey: '',
          usedToday: guestUsed,
          dailyLimit: 10
        });
      }

      const usedToday = getUsageForKey(user.license_key);
      return sendJson(res, 200, {
        ok: true,
        valid: true,
        email: user.email,
        tier: user.tier,
        licenseKey: user.license_key,
        usedToday,
        dailyLimit: user.tier === 'PRO' ? 999999 : 10
      });
    }

    // 5. Consume Generation Quota (Called before each prompt in Chrome Extension)
    if (pathname === '/api/v1/usage/consume' && req.method === 'POST') {
      const { licenseKey, mode, promptTag } = await parseBody(req);
      const cleanKey = (licenseKey || '').trim();
      const user = db
        .prepare('SELECT tier, license_key FROM users WHERE license_key = ?')
        .get(cleanKey);

      const effectiveKey = user ? user.license_key : 'GUEST-FREE-TIER';
      const tier = user ? user.tier : 'FREE';
      const dailyLimit = tier === 'PRO' ? 999999 : 10;
      const currentUsed = getUsageForKey(effectiveKey);

      if (tier === 'FREE' && currentUsed >= dailyLimit) {
        return sendJson(res, 403, {
          ok: false,
          allowed: false,
          tier: 'FREE',
          usedToday: currentUsed,
          dailyLimit,
          error: 'Daily Free Tier limit (10/day) reached. Upgrade to Pro for unlimited generations.'
        });
      }

      const updatedUsed = incrementUsageForKey(effectiveKey, mode, promptTag);
      return sendJson(res, 200, {
        ok: true,
        allowed: true,
        tier,
        usedToday: updatedUsed,
        dailyLimit
      });
    }

    // 6. Stripe Checkout Session & Instant Upgrade Endpoint
    if (pathname === '/api/v1/billing/checkout' && req.method === 'POST') {
      const { licenseKey, email } = await parseBody(req);
      const targetUser = db
        .prepare('SELECT id, email, license_key FROM users WHERE license_key = ? OR email = ?')
        .get((licenseKey || '').trim(), (email || '').trim().toLowerCase());

      if (!targetUser) {
        return sendJson(res, 404, { ok: false, error: 'Account or License Key not found.' });
      }

      const newProKey = targetUser.license_key.startsWith('PRO-')
        ? targetUser.license_key
        : generateLicenseKey('PRO');

      db.prepare("UPDATE users SET tier = 'PRO', license_key = ? WHERE id = ?").run(newProKey, targetUser.id);

      return sendJson(res, 200, {
        ok: true,
        message: 'Upgraded to PRO ($29/mo) successfully!',
        tier: 'PRO',
        licenseKey: newProKey,
        dailyLimit: 999999
      });
    }

    // 7. Stripe Webhook Receiver (`/api/v1/billing/webhook`)
    if (pathname === '/api/v1/billing/webhook' && req.method === 'POST') {
      const event = await parseBody(req);
      if (event.type === 'checkout.session.completed' && event.data?.object?.client_reference_id) {
        const refKey = event.data.object.client_reference_id;
        db.prepare("UPDATE users SET tier = 'PRO' WHERE license_key = ?").run(refKey);
      }
      return sendJson(res, 200, { received: true });
    }

    // 8. Serve Static Web Dashboard (`public/index.html`)
    if (pathname === '/' || pathname === '/index.html') {
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    return sendJson(res, 404, { ok: false, error: 'Route not found' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`==================================================================`);
  console.log(`🚀 AsidZ AutoFlow Pro SaaS Backend running on port ${PORT}`);
  console.log(`🔗 Dashboard & Portal: http://localhost:${PORT}`);
  console.log(`🔑 Demo Pro Key:       PRO-AUTOMA-8888-DEMO`);
  console.log(`==================================================================`);
});
