-- schema.sql - PostgreSQL schema for card-game
-- Run manually or via database.js initSchema()

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- internal user ID (random)
  google_id TEXT UNIQUE,             -- Google's 'sub' claim, NULL for guests
  guest_id TEXT UNIQUE,              -- random ID from guest cookie, NULL for Google users
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  event_type TEXT NOT NULL,          -- e.g. 'room_join', 'card_played', 'game_start', 'win'
  event_data JSONB,                  -- arbitrary JSON payload
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_guest_id ON users(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_events_user_id ON game_events(user_id);
CREATE INDEX IF NOT EXISTS idx_game_events_type ON game_events(event_type);
