const express = require('express');
const router = express.Router();
const sqlite = require('../db/sqlite');
const mysql = require('../db/mysql');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

// Helper: level from rating number
function levelFromRating(r) {
  if (r >= 10) return 'Expert';
  if (r >= 8) return 'Advanced';
  if (r >= 6) return 'Intermediate';
  return 'Beginner';
}

// Helper: look up MySQL user names by IDs
async function getUserMap(ids) {
  const userMap = {};
  if (ids.length === 0) return userMap;
  const placeholders = ids.map(() => '?').join(',');
  const [users] = await mysql.query(
    `SELECT id, first_name, last_name, email FROM user WHERE id IN (${placeholders})`,
    ids
  );
  users.forEach(u => { userMap[u.id] = u; });
  return userMap;
}

// Main admin ratings page with filters + analytics
router.get('/ratings', async (req, res, next) => {
  try {
    const { rater, skill, performer, rating, date } = req.query;

    // Get ALL ratings for analytics (unfiltered)
    const allRatings = sqlite.prepare(`
      SELECT skill_set_id, user_id, skill_name, rating, rater_id,
             created_at, updated_at
      FROM ratings ORDER BY updated_at DESC
    `).all();

    // Build filtered query
    let whereClauses = [];
    let params = [];

    if (rater) {
      whereClauses.push('r.rater_id = ?');
      params.push(parseInt(rater));
    }
    if (skill) {
      whereClauses.push('r.skill_name = ?');
      params.push(skill);
    }
    if (performer) {
      whereClauses.push('r.user_id = ?');
      params.push(parseInt(performer));
    }
    if (rating) {
      whereClauses.push('r.rating = ?');
      params.push(parseInt(rating));
    }
    if (date) {
      whereClauses.push("DATE(r.updated_at) = ?");
      params.push(date);
    }

    const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const filteredRatings = sqlite.prepare(`
      SELECT r.id, r.skill_set_id, r.user_id, r.skill_name, r.rating,
             r.rater_id, r.created_at, r.updated_at
      FROM ratings r
      ${whereStr}
      ORDER BY r.updated_at DESC
      LIMIT 1000
    `).all(...params);

    // Collect all user IDs from all ratings (for dropdowns + enrichment)
    const allRaterIds = [...new Set(allRatings.map(r => r.rater_id).filter(Boolean))];
    const allPerformerIds = [...new Set(allRatings.map(r => r.user_id).filter(Boolean))];
    const allUserIds = [...new Set([...allRaterIds, ...allPerformerIds])];
    const userMap = await getUserMap(allUserIds);

    // Enrich filtered ratings for display
    const enrichedRatings = filteredRatings.map(r => ({
      ...r,
      rater_name: r.rater_id && userMap[r.rater_id]
        ? `${userMap[r.rater_id].first_name} ${userMap[r.rater_id].last_name}`
        : 'Unknown',
      rater_email: r.rater_id && userMap[r.rater_id] ? userMap[r.rater_id].email : null,
      performer_name: userMap[r.user_id]
        ? `${userMap[r.user_id].first_name} ${userMap[r.user_id].last_name}`
        : `User #${r.user_id}`,
    }));

    // Build dropdown options from ALL ratings
    const raterOptions = allRaterIds.map(id => ({
      id,
      name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const skillOptions = [...new Set(allRatings.map(r => r.skill_name))].sort();

    const performerOptions = allPerformerIds.map(id => ({
      id,
      name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const dateOptions = [...new Set(allRatings.map(r => {
      const d = r.updated_at || r.created_at;
      return d ? d.split(' ')[0] || d.split('T')[0] : null;
    }).filter(Boolean))].sort().reverse();

    // === ANALYTICS ===

    // Total ratings count
    const totalRatings = allRatings.length;

    // Total unique raters
    const uniqueRaters = allRaterIds.length;

    // Total unique skills rated
    const uniqueSkills = new Set(allRatings.map(r => r.skill_name)).size;

    // Total unique performers rated
    const uniquePerformers = new Set(allRatings.map(r => r.user_id)).size;

    // Average rating overall
    const avgRating = totalRatings > 0
      ? (allRatings.reduce((s, r) => s + r.rating, 0) / totalRatings).toFixed(1)
      : '—';

    // Rating distribution (1-10)
    const ratingDistribution = {};
    for (let i = 1; i <= 10; i++) ratingDistribution[i] = 0;
    allRatings.forEach(r => { ratingDistribution[r.rating]++; });

    // Average rating per skill (top 20 by count)
    const skillStats = {};
    allRatings.forEach(r => {
      if (!skillStats[r.skill_name]) skillStats[r.skill_name] = { sum: 0, count: 0 };
      skillStats[r.skill_name].sum += r.rating;
      skillStats[r.skill_name].count++;
    });
    const avgBySkill = Object.entries(skillStats)
      .map(([name, s]) => ({ name, avg: (s.sum / s.count).toFixed(1), count: s.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Ratings vs self-rating comparison
    // We need to get the self-reported level from MySQL for each rated skill_set
    const skillSetIds = [...new Set(allRatings.map(r => r.skill_set_id))];
    let selfRatingMap = {};
    if (skillSetIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < skillSetIds.length; i += batchSize) {
        const batch = skillSetIds.slice(i, i + batchSize);
        const ph = batch.map(() => '?').join(',');
        const [rows] = await mysql.query(
          `SELECT id, level FROM skill_sets WHERE id IN (${ph})`,
          batch
        );
        rows.forEach(r => { selfRatingMap[r.id] = r.level; });
      }
    }

    // Build comparison: self-reported level vs our avg rating
    const levelComparison = { Beginner: [], Intermediate: [], Advanced: [], Expert: [] };
    allRatings.forEach(r => {
      const selfLevel = selfRatingMap[r.skill_set_id];
      if (selfLevel && levelComparison[selfLevel]) {
        levelComparison[selfLevel].push(r.rating);
      }
    });

    const selfVsRated = Object.entries(levelComparison).map(([level, ratings]) => {
      const count = ratings.length;
      const avg = count > 0 ? (ratings.reduce((s, v) => s + v, 0) / count).toFixed(1) : '—';
      // What we'd expect based on our scale
      const expectedRange = {
        Beginner: '0-5', Intermediate: '6-7', Advanced: '8-9', Expert: '10',
      }[level];
      return { level, count, avg, expectedRange };
    });

    // Flags counts
    const brokenCount = sqlite.prepare('SELECT COUNT(*) as c FROM broken_links').get().c;
    const notSkillReelCount = sqlite.prepare('SELECT COUNT(*) as c FROM not_skill_reels').get().c;
    const noDemoCount = sqlite.prepare('SELECT COUNT(*) as c FROM no_demo_skill').get().c;
    const bestCount = sqlite.prepare('SELECT COUNT(*) as c FROM best_skill_reels').get().c;

    res.render('admin-ratings', {
      ratings: enrichedRatings,
      filters: { rater, skill, performer, rating, date },
      raterOptions,
      skillOptions,
      performerOptions,
      dateOptions,
      analytics: {
        totalRatings,
        uniqueRaters,
        uniqueSkills,
        uniquePerformers,
        avgRating,
        ratingDistribution,
        avgBySkill,
        selfVsRated,
        brokenCount,
        notSkillReelCount,
        noDemoCount,
        bestCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Rater analytics page
router.get('/raters', async (req, res, next) => {
  try {
    const allRatings = sqlite.prepare(`
      SELECT skill_set_id, user_id, skill_name, rating, rater_id, updated_at
      FROM ratings
    `).all();

    const allFlags = [
      ...sqlite.prepare('SELECT rater_id, skill_name, "broken_link" as type, created_at FROM broken_links').all(),
      ...sqlite.prepare('SELECT rater_id, skill_name, "not_skill_reel" as type, created_at FROM not_skill_reels').all(),
      ...sqlite.prepare('SELECT rater_id, skill_name, "no_demo" as type, created_at FROM no_demo_skill').all(),
      ...sqlite.prepare('SELECT rater_id, skill_name, "best" as type, created_at FROM best_skill_reels').all(),
    ];

    const raterIds = [...new Set([
      ...allRatings.map(r => r.rater_id),
      ...allFlags.map(f => f.rater_id),
    ].filter(Boolean))];

    const userMap = await getUserMap(raterIds);

    // Build per-rater stats
    const raterStats = {};
    raterIds.forEach(id => {
      raterStats[id] = {
        id,
        name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
        email: userMap[id] ? userMap[id].email : null,
        totalRatings: 0,
        ratingSum: 0,
        ratings: [],
        flags: { broken_link: 0, not_skill_reel: 0, no_demo: 0, best: 0 },
        skillsRated: new Set(),
        lastActivity: null,
      };
    });

    allRatings.forEach(r => {
      if (!r.rater_id || !raterStats[r.rater_id]) return;
      const s = raterStats[r.rater_id];
      s.totalRatings++;
      s.ratingSum += r.rating;
      s.ratings.push(r.rating);
      s.skillsRated.add(r.skill_name);
      const ts = r.updated_at || '';
      if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    });

    allFlags.forEach(f => {
      if (!f.rater_id || !raterStats[f.rater_id]) return;
      const s = raterStats[f.rater_id];
      s.flags[f.type]++;
      const ts = f.created_at || '';
      if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    });

    const raters = Object.values(raterStats).map(s => {
      const avg = s.totalRatings > 0 ? (s.ratingSum / s.totalRatings).toFixed(1) : '—';
      // Rating distribution for this rater
      const dist = {};
      for (let i = 1; i <= 10; i++) dist[i] = 0;
      s.ratings.forEach(r => dist[r]++);
      // How many they rated at each derived level
      const levelCounts = { Beginner: 0, Intermediate: 0, Advanced: 0, Expert: 0 };
      s.ratings.forEach(r => { levelCounts[levelFromRating(r)]++; });

      return {
        ...s,
        avg,
        skillsRatedCount: s.skillsRated.size,
        distribution: dist,
        levelCounts,
        totalFlags: s.flags.broken_link + s.flags.not_skill_reel + s.flags.no_demo + s.flags.best,
      };
    }).sort((a, b) => b.totalRatings - a.totalRatings);

    res.render('admin-raters', { raters });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
