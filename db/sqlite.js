const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.SQLITE_PATH || './db/ratings.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Check if ratings table needs migration from UNIQUE(skill_set_id) to UNIQUE(skill_set_id, rater_id)
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ratings'").get();
if (tableInfo && tableInfo.sql.includes('UNIQUE(skill_set_id)') && !tableInfo.sql.includes('UNIQUE(skill_set_id, rater_id)')) {
  // Migrate old schema -> new per-rater schema
  db.exec(`
    ALTER TABLE ratings RENAME TO ratings_old;
    CREATE TABLE ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_set_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      skill_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 10),
      rater_id INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(skill_set_id, rater_id)
    );
    INSERT OR IGNORE INTO ratings (id, skill_set_id, user_id, skill_name, rating, rater_id, reason, created_at, updated_at)
      SELECT id, skill_set_id, user_id, skill_name, rating, COALESCE(rater_id, 0), reason, created_at, updated_at FROM ratings_old;
    DROP TABLE ratings_old;
  `);
} else if (!tableInfo) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_set_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      skill_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 10),
      rater_id INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(skill_set_id, rater_id)
    )
  `);
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
