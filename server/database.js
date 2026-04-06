/**
 * database.js - Minimal PostgreSQL persistence for card game
 * Uses pg pool; schema is initialized on startup.
 * Works with Render.com Postgres (DATABASE_URL env var).
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL not set. Database features disabled.');
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      // Render.com Postgres requires SSL
      ssl: DATABASE_URL.includes('render.com') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    })
  : null;

async function query(sql, params = []) {
  if (!pool) throw new Error('Database not configured (DATABASE_URL missing)');
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Initialize schema (idempotent). Call on server startup.
 */
async function initSchema() {
  if (!pool) {
    console.log('DB: Skipping schema init (no DATABASE_URL)');
    return;
  }
  console.log('DB: Initializing schema...');
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      guest_id TEXT UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS game_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      event_type TEXT NOT NULL,
      event_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB: Schema ready.');
}

/**
 * Find or create a user by Google OAuth info.
 * Returns the user row.
 */
async function upsertGoogleUser({ googleId, displayName }) {
  // Try to find existing
  const existing = await query(
    'SELECT * FROM users WHERE google_id = $1',
    [googleId]
  );
  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    await query('UPDATE users SET last_seen = NOW(), display_name = COALESCE($2, display_name) WHERE id = $1', [user.id, displayName]);
    return user;
  }
  // Create new
  const id = generateId();
  const res = await query(
    `INSERT INTO users (id, google_id, display_name, created_at, last_seen)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [id, googleId, displayName || 'Player']
  );
  return res.rows[0];
}

/**
 * Find or create a guest user by guestId (from cookie).
 * Returns the user row.
 */
async function upsertGuestUser(guestId, displayName) {
  const existing = await query('SELECT * FROM users WHERE guest_id = $1', [guestId]);
  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    await query('UPDATE users SET last_seen = NOW(), display_name = COALESCE($2, display_name) WHERE id = $1', [user.id, displayName]);
    return user;
  }
  const id = generateId();
  const res = await query(
    `INSERT INTO users (id, guest_id, display_name, created_at, last_seen)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [id, guestId, displayName || 'Guest']
  );
  return res.rows[0];
}

/**
 * Get user by internal id.
 */
async function getUserById(userId) {
  const res = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return res.rows[0] || null;
}

/**
 * Log a game event (action log). Non-blocking best-effort.
 */
async function logEvent(userId, eventType, eventData = {}) {
  if (!pool) return; // no-op if no DB
  try {
    const id = generateId();
    await query(
      `INSERT INTO game_events (id, user_id, event_type, event_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [id, userId || null, eventType, JSON.stringify(eventData)]
    );
  } catch (e) {
    console.error('DB logEvent error:', e.message);
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

module.exports = {
  initSchema,
  upsertGoogleUser,
  upsertGuestUser,
  getUserById,
  logEvent,
  query,
  pool,
};
