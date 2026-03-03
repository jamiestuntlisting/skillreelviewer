const express = require('express');
const router = express.Router();
const sqlite = require('../db/sqlite');

// Like toggle — insert or delete
const insertLike = sqlite.prepare(`
  INSERT OR IGNORE INTO likes (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
`);
const deleteLike = sqlite.prepare(`
  DELETE FROM likes WHERE skill_set_id = ? AND rater_id = ?
`);
const getLike = sqlite.prepare(`
  SELECT id FROM likes WHERE skill_set_id = ? AND rater_id = ?
`);
const getLikeCount = sqlite.prepare(`
  SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ?
`);

router.post('/like', (req, res) => {
  const { skill_set_id, user_id, skill_name } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existing = getLike.get(skill_set_id, rater_id);
  if (existing) {
    deleteLike.run(skill_set_id, rater_id);
    const count = getLikeCount.get(skill_set_id).count;
    return res.json({ success: true, liked: false, likeCount: count });
  } else {
    insertLike.run(skill_set_id, user_id, skill_name, rater_id);
    const count = getLikeCount.get(skill_set_id).count;
    return res.json({ success: true, liked: true, likeCount: count });
  }
});

// Best of All Time — toggle with 2/week limit
const insertBest = sqlite.prepare(`
  INSERT OR IGNORE INTO best_skill_reels (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
`);
const deleteBest = sqlite.prepare(`
  DELETE FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ?
`);
const getBest = sqlite.prepare(`
  SELECT id FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ?
`);
const getBestThisWeek = sqlite.prepare(`
  SELECT COUNT(*) AS count FROM best_skill_reels
  WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')
`);
const getBestCount = sqlite.prepare(`
  SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ?
`);

router.post('/best', (req, res) => {
  const { skill_set_id, user_id, skill_name } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existing = getBest.get(skill_set_id, rater_id);
  if (existing) {
    // Un-best
    deleteBest.run(skill_set_id, rater_id);
    const weekCount = getBestThisWeek.get(rater_id).count;
    const totalCount = getBestCount.get(skill_set_id).count;
    return res.json({ success: true, starred: false, remaining: 2 - weekCount, bestCount: totalCount });
  } else {
    // Check weekly limit
    const weekCount = getBestThisWeek.get(rater_id).count;
    if (weekCount >= 2) {
      return res.status(429).json({
        error: 'You have used your 2 Best of All Time votes this week',
        remaining: 0,
      });
    }
    insertBest.run(skill_set_id, user_id, skill_name, rater_id);
    const totalCount = getBestCount.get(skill_set_id).count;
    return res.json({ success: true, starred: true, remaining: 2 - weekCount - 1, bestCount: totalCount });
  }
});

router.get('/best-remaining', (req, res) => {
  const rater_id = req.session.user ? req.session.user.id : null;
  const weekCount = getBestThisWeek.get(rater_id).count;
  res.json({ remaining: 2 - weekCount });
});

// Flag endpoints (unchanged)
const markBroken = sqlite.prepare(`
  INSERT OR IGNORE INTO broken_links (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
`);

router.post('/broken', (req, res) => {
  const { skill_set_id, user_id, skill_name } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  markBroken.run(skill_set_id, user_id, skill_name, rater_id);
  res.json({ success: true });
});

const markNotSkillReel = sqlite.prepare(`
  INSERT OR IGNORE INTO not_skill_reels (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
`);

router.post('/not-skill-reel', (req, res) => {
  const { skill_set_id, user_id, skill_name } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  markNotSkillReel.run(skill_set_id, user_id, skill_name, rater_id);
  res.json({ success: true });
});

const markNoDemoSkill = sqlite.prepare(`
  INSERT OR IGNORE INTO no_demo_skill (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
`);

router.post('/no-demo-skill', (req, res) => {
  const { skill_set_id, user_id, skill_name } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;
  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  markNoDemoSkill.run(skill_set_id, user_id, skill_name, rater_id);
  res.json({ success: true });
});

module.exports = router;
