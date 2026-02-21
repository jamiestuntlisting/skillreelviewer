const express = require('express');
const router = express.Router();
const sqlite = require('../db/sqlite');

const upsert = sqlite.prepare(`
  INSERT INTO ratings (skill_set_id, user_id, skill_name, rating, rater_id, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(skill_set_id) DO UPDATE SET
    rating = excluded.rating,
    rater_id = excluded.rater_id,
    updated_at = datetime('now')
`);

router.post('/ratings', (req, res) => {
  const { skill_set_id, user_id, skill_name, rating } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name || !rating) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 10) {
    return res.status(400).json({ error: 'Rating must be between 1 and 10' });
  }

  upsert.run(skill_set_id, user_id, skill_name, ratingNum, rater_id);
  res.json({ success: true, rating: ratingNum });
});

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

const toggleBest = sqlite.prepare(`
  INSERT INTO best_skill_reels (skill_set_id, user_id, skill_name, rater_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(skill_set_id) DO UPDATE SET
    rater_id = excluded.rater_id
`);
const removeBest = sqlite.prepare(`
  DELETE FROM best_skill_reels WHERE skill_set_id = ?
`);

router.post('/best', (req, res) => {
  const { skill_set_id, user_id, skill_name, starred } = req.body;
  const rater_id = req.session.user ? req.session.user.id : null;

  if (!skill_set_id || !user_id || !skill_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (starred) {
    removeBest.run(skill_set_id);
    res.json({ success: true, starred: false });
  } else {
    toggleBest.run(skill_set_id, user_id, skill_name, rater_id);
    res.json({ success: true, starred: true });
  }
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
