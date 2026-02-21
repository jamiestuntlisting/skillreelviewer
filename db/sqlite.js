const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.SQLITE_PATH || './db/ratings.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 10),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(skill_set_id)
  )
`);

// Add reason column if it doesn't exist yet
try {
  db.exec(`ALTER TABLE ratings ADD COLUMN reason TEXT`);
} catch (e) {
  // Column already exists
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON ratings(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ratings_skill_name ON ratings(skill_name)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS broken_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS not_skill_reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS best_skill_reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS no_demo_skill (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Add rater_id column to all tables (the logged-in user who performed the action)
const tables = ['ratings', 'broken_links', 'not_skill_reels', 'best_skill_reels', 'no_demo_skill'];
tables.forEach(table => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN rater_id INTEGER`);
  } catch (e) {
    // Column already exists
  }
});

db.exec(`CREATE INDEX IF NOT EXISTS idx_ratings_rater_id ON ratings(rater_id)`);

module.exports = db;
