const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.SQLITE_PATH || './db/ratings.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Likes table — one like per rater per skill reel
db.exec(`
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    rater_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(skill_set_id, rater_id)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_likes_rater_id ON likes(rater_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_likes_skill_name ON likes(skill_name)`);

// Best of All Time — per rater, limited to 2 per week
// Migrate old best_skill_reels if it has UNIQUE(skill_set_id) instead of per-rater
const bestInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='best_skill_reels'").get();
if (bestInfo && !bestInfo.sql.includes('UNIQUE(skill_set_id, rater_id)')) {
  db.exec(`
    ALTER TABLE best_skill_reels RENAME TO best_skill_reels_old;
    CREATE TABLE best_skill_reels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_set_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      skill_name TEXT NOT NULL,
      rater_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(skill_set_id, rater_id)
    );
    INSERT OR IGNORE INTO best_skill_reels (id, skill_set_id, user_id, skill_name, rater_id, created_at)
      SELECT id, skill_set_id, user_id, skill_name, COALESCE(rater_id, 0), created_at FROM best_skill_reels_old;
    DROP TABLE best_skill_reels_old;
  `);
} else if (!bestInfo) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS best_skill_reels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_set_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      skill_name TEXT NOT NULL,
      rater_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(skill_set_id, rater_id)
    )
  `);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_best_rater_id ON best_skill_reels(rater_id)`);

// Flag tables (unchanged)
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
  CREATE TABLE IF NOT EXISTS no_demo_skill (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_set_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Add rater_id column to flag tables if missing
['broken_links', 'not_skill_reels', 'no_demo_skill'].forEach(table => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN rater_id INTEGER`);
  } catch (e) {
    // Column already exists
  }
});

module.exports = db;
