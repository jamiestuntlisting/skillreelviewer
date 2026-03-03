const express = require('express');
const router = express.Router();
const sqlite = require('../db/sqlite');

// Detect if reel_type column exists
let hasReelType = true;
try {
  sqlite.prepare("SELECT reel_type FROM likes LIMIT 0").all();
} catch (e) {
  hasReelType = false;
}

// Like toggle — insert or delete
router.post('/like', (req, res) => {
  const { skill_set_id, user_id, skill_name, reel_type } = req.body;
  const rt = reel_type || 'skill';
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existing = hasReelType
    ? sqlite.prepare("SELECT id FROM likes WHERE skill_set_id = ? AND rater_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rater_id, rt)
    : sqlite.prepare("SELECT id FROM likes WHERE skill_set_id = ? AND rater_id = ?").get(skill_set_id, rater_id);

  if (existing) {
    if (hasReelType) {
      sqlite.prepare("DELETE FROM likes WHERE skill_set_id = ? AND rater_id = ? AND COALESCE(reel_type, 'skill') = ?").run(skill_set_id, rater_id, rt);
    } else {
      sqlite.prepare("DELETE FROM likes WHERE skill_set_id = ? AND rater_id = ?").run(skill_set_id, rater_id);
    }
    const count = hasReelType
      ? sqlite.prepare("SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rt).count
      : sqlite.prepare("SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ?").get(skill_set_id).count;
    return res.json({ success: true, liked: false, likeCount: count });
  } else {
    if (hasReelType) {
      sqlite.prepare('INSERT INTO likes (skill_set_id, user_id, skill_name, rater_id, reel_type) VALUES (?, ?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id, rt);
    } else {
      sqlite.prepare('INSERT INTO likes (skill_set_id, user_id, skill_name, rater_id) VALUES (?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id);
    }
    const count = hasReelType
      ? sqlite.prepare("SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rt).count
      : sqlite.prepare("SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ?").get(skill_set_id).count;
    return res.json({ success: true, liked: true, likeCount: count });
  }
});

// Best of the Best — toggle with 2/week limit
router.post('/best', (req, res) => {
  const { skill_set_id, user_id, skill_name, reel_type } = req.body;
  const rt = reel_type || 'skill';
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existing = hasReelType
    ? sqlite.prepare("SELECT id FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rater_id, rt)
    : sqlite.prepare("SELECT id FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ?").get(skill_set_id, rater_id);

  if (existing) {
    if (hasReelType) {
      sqlite.prepare("DELETE FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ? AND COALESCE(reel_type, 'skill') = ?").run(skill_set_id, rater_id, rt);
    } else {
      sqlite.prepare("DELETE FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ?").run(skill_set_id, rater_id);
    }
    const weekCount = sqlite.prepare(
      "SELECT COUNT(*) AS count FROM best_skill_reels WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')"
    ).get(rater_id).count;
    const totalCount = hasReelType
      ? sqlite.prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rt).count
      : sqlite.prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ?").get(skill_set_id).count;
    return res.json({ success: true, starred: false, remaining: 2 - weekCount, bestCount: totalCount });
  } else {
    const weekCount = sqlite.prepare(
      "SELECT COUNT(*) AS count FROM best_skill_reels WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')"
    ).get(rater_id).count;
    if (weekCount >= 2) {
      return res.status(429).json({
        error: 'You have used your 2 Best of the Best votes this week',
        remaining: 0,
      });
    }
    if (hasReelType) {
      sqlite.prepare('INSERT INTO best_skill_reels (skill_set_id, user_id, skill_name, rater_id, reel_type) VALUES (?, ?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id, rt);
    } else {
      sqlite.prepare('INSERT INTO best_skill_reels (skill_set_id, user_id, skill_name, rater_id) VALUES (?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id);
    }
    const totalCount = hasReelType
      ? sqlite.prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ? AND COALESCE(reel_type, 'skill') = ?").get(skill_set_id, rt).count
      : sqlite.prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ?").get(skill_set_id).count;
    return res.json({ success: true, starred: true, remaining: 2 - weekCount - 1, bestCount: totalCount });
  }
});

router.get('/best-remaining', (req, res) => {
  const rater_id = req.session.user ? req.session.user.id : null;
  const weekCount = sqlite.prepare(
    "SELECT COUNT(*) AS count FROM best_skill_reels WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')"
  ).get(rater_id).count;
  res.json({ remaining: 2 - weekCount });
});

// Flag endpoints
router.post('/broken', (req, res) => {
  const { skill_set_id, user_id, skill_name, reel_type } = req.body;
  const rt = reel_type || 'skill';
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (hasReelType) {
    sqlite.prepare('INSERT OR IGNORE INTO broken_links (skill_set_id, user_id, skill_name, rater_id, reel_type) VALUES (?, ?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id, rt);
  } else {
    sqlite.prepare('INSERT OR IGNORE INTO broken_links (skill_set_id, user_id, skill_name, rater_id) VALUES (?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id);
  }
  res.json({ success: true });
});

router.post('/not-skill-reel', (req, res) => {
  const { skill_set_id, user_id, skill_name, reel_type } = req.body;
  const rt = reel_type || 'skill';
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (hasReelType) {
    sqlite.prepare('INSERT OR IGNORE INTO not_skill_reels (skill_set_id, user_id, skill_name, rater_id, reel_type) VALUES (?, ?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id, rt);
  } else {
    sqlite.prepare('INSERT OR IGNORE INTO not_skill_reels (skill_set_id, user_id, skill_name, rater_id) VALUES (?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id);
  }
  res.json({ success: true });
});

router.post('/no-demo-skill', (req, res) => {
  const { skill_set_id, user_id, skill_name, reel_type } = req.body;
  const rt = reel_type || 'skill';
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (hasReelType) {
    sqlite.prepare('INSERT OR IGNORE INTO no_demo_skill (skill_set_id, user_id, skill_name, rater_id, reel_type) VALUES (?, ?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id, rt);
  } else {
    sqlite.prepare('INSERT OR IGNORE INTO no_demo_skill (skill_set_id, user_id, skill_name, rater_id) VALUES (?, ?, ?, ?)').run(skill_set_id, user_id, skill_name, rater_id);
  }
  res.json({ success: true });
});

module.exports = router;
