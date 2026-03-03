const express = require('express');
const router = express.Router();
const sqlite = require('../db/sqlite');
const mysql = require('../db/mysql');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

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

// Main admin dashboard — likes + bests analytics
router.get('/ratings', async (req, res, next) => {
  try {
    const { rater, skill, performer, date } = req.query;

    // Get ALL likes for analytics
    const allLikes = sqlite.prepare(`
      SELECT skill_set_id, user_id, skill_name, rater_id, created_at
      FROM likes ORDER BY created_at DESC
    `).all();

    // Get ALL bests
    const allBests = sqlite.prepare(`
      SELECT skill_set_id, user_id, skill_name, rater_id, created_at
      FROM best_skill_reels ORDER BY created_at DESC
    `).all();

    // Build filtered likes query
    let whereClauses = [];
    let params = [];

    if (rater) {
      whereClauses.push('l.rater_id = ?');
      params.push(parseInt(rater));
    }
    if (skill) {
      whereClauses.push('l.skill_name = ?');
      params.push(skill);
    }
    if (performer) {
      whereClauses.push('l.user_id = ?');
      params.push(parseInt(performer));
    }
    if (date) {
      whereClauses.push("DATE(l.created_at) = ?");
      params.push(date);
    }

    const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const filteredLikes = sqlite.prepare(`
      SELECT l.id, l.skill_set_id, l.user_id, l.skill_name,
             l.rater_id, l.created_at
      FROM likes l
      ${whereStr}
      ORDER BY l.created_at DESC
      LIMIT 1000
    `).all(...params);

    // Collect all user IDs
    const allRaterIds = [...new Set([
      ...allLikes.map(r => r.rater_id),
      ...allBests.map(r => r.rater_id),
    ].filter(Boolean))];
    const allPerformerIds = [...new Set([
      ...allLikes.map(r => r.user_id),
      ...allBests.map(r => r.user_id),
    ].filter(Boolean))];
    const allUserIds = [...new Set([...allRaterIds, ...allPerformerIds])];
    const userMap = await getUserMap(allUserIds);

    // Enrich filtered likes
    const enrichedLikes = filteredLikes.map(r => ({
      ...r,
      rater_name: r.rater_id && userMap[r.rater_id]
        ? `${userMap[r.rater_id].first_name} ${userMap[r.rater_id].last_name}`
        : 'Unknown',
      performer_name: userMap[r.user_id]
        ? `${userMap[r.user_id].first_name} ${userMap[r.user_id].last_name}`
        : `User #${r.user_id}`,
    }));

    // Dropdown options
    const raterOptions = allRaterIds.map(id => ({
      id,
      name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const skillOptions = [...new Set(allLikes.map(r => r.skill_name))].sort();

    const performerOptions = allPerformerIds.map(id => ({
      id,
      name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const dateOptions = [...new Set(allLikes.map(r => {
      const d = r.created_at;
      return d ? d.split(' ')[0] || d.split('T')[0] : null;
    }).filter(Boolean))].sort().reverse();

    // === ANALYTICS ===
    const totalLikes = allLikes.length;
    const totalBests = allBests.length;
    const uniqueRaters = allRaterIds.length;
    const uniqueSkills = new Set(allLikes.map(r => r.skill_name)).size;
    const uniquePerformers = new Set(allLikes.map(r => r.user_id)).size;

    // Most liked performers (top 10)
    const performerLikes = {};
    allLikes.forEach(r => {
      if (!performerLikes[r.user_id]) performerLikes[r.user_id] = { count: 0, skill_name: r.skill_name };
      performerLikes[r.user_id].count++;
    });
    const topPerformers = Object.entries(performerLikes)
      .map(([id, d]) => ({
        id: parseInt(id),
        name: userMap[parseInt(id)] ? `${userMap[parseInt(id)].first_name} ${userMap[parseInt(id)].last_name}` : `User #${id}`,
        count: d.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Most liked skills (top 10)
    const skillLikes = {};
    allLikes.forEach(r => {
      if (!skillLikes[r.skill_name]) skillLikes[r.skill_name] = 0;
      skillLikes[r.skill_name]++;
    });
    const topSkills = Object.entries(skillLikes)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Best of All Time leaderboard (by total nominations)
    const bestByPerformer = {};
    allBests.forEach(r => {
      const key = `${r.user_id}:${r.skill_set_id}`;
      if (!bestByPerformer[key]) bestByPerformer[key] = { user_id: r.user_id, skill_name: r.skill_name, count: 0 };
      bestByPerformer[key].count++;
    });
    const bestLeaderboard = Object.values(bestByPerformer)
      .map(d => ({
        ...d,
        performer_name: userMap[d.user_id] ? `${userMap[d.user_id].first_name} ${userMap[d.user_id].last_name}` : `User #${d.user_id}`,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Flag counts
    const brokenCount = sqlite.prepare('SELECT COUNT(*) as c FROM broken_links').get().c;
    const notSkillReelCount = sqlite.prepare('SELECT COUNT(*) as c FROM not_skill_reels').get().c;
    const noDemoCount = sqlite.prepare('SELECT COUNT(*) as c FROM no_demo_skill').get().c;

    res.render('admin-ratings', {
      likes: enrichedLikes,
      filters: { rater, skill, performer, date },
      raterOptions,
      skillOptions,
      performerOptions,
      dateOptions,
      analytics: {
        totalLikes,
        totalBests,
        uniqueRaters,
        uniqueSkills,
        uniquePerformers,
        topPerformers,
        topSkills,
        bestLeaderboard,
        brokenCount,
        notSkillReelCount,
        noDemoCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Rater analytics page
router.get('/raters', async (req, res, next) => {
  try {
    const allLikes = sqlite.prepare('SELECT skill_set_id, user_id, skill_name, rater_id, created_at FROM likes').all();
    const allBests = sqlite.prepare('SELECT skill_set_id, user_id, skill_name, rater_id, created_at FROM best_skill_reels').all();

    const allFlags = [
      ...sqlite.prepare("SELECT rater_id, skill_name, 'broken_link' as type, created_at FROM broken_links").all(),
      ...sqlite.prepare("SELECT rater_id, skill_name, 'not_skill_reel' as type, created_at FROM not_skill_reels").all(),
      ...sqlite.prepare("SELECT rater_id, skill_name, 'no_demo' as type, created_at FROM no_demo_skill").all(),
    ];

    const raterIds = [...new Set([
      ...allLikes.map(r => r.rater_id),
      ...allBests.map(r => r.rater_id),
      ...allFlags.map(f => f.rater_id),
    ].filter(Boolean))];

    const userMap = await getUserMap(raterIds);

    const raterStats = {};
    raterIds.forEach(id => {
      raterStats[id] = {
        id,
        name: userMap[id] ? `${userMap[id].first_name} ${userMap[id].last_name}` : `User #${id}`,
        email: userMap[id] ? userMap[id].email : null,
        totalLikes: 0,
        totalBests: 0,
        flags: { broken_link: 0, not_skill_reel: 0, no_demo: 0 },
        skillsLiked: new Set(),
        lastActivity: null,
      };
    });

    allLikes.forEach(r => {
      if (!r.rater_id || !raterStats[r.rater_id]) return;
      const s = raterStats[r.rater_id];
      s.totalLikes++;
      s.skillsLiked.add(r.skill_name);
      const ts = r.created_at || '';
      if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    });

    allBests.forEach(r => {
      if (!r.rater_id || !raterStats[r.rater_id]) return;
      const s = raterStats[r.rater_id];
      s.totalBests++;
      const ts = r.created_at || '';
      if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    });

    allFlags.forEach(f => {
      if (!f.rater_id || !raterStats[f.rater_id]) return;
      const s = raterStats[f.rater_id];
      s.flags[f.type]++;
      const ts = f.created_at || '';
      if (!s.lastActivity || ts > s.lastActivity) s.lastActivity = ts;
    });

    const raters = Object.values(raterStats).map(s => ({
      ...s,
      skillsLikedCount: s.skillsLiked.size,
      totalFlags: s.flags.broken_link + s.flags.not_skill_reel + s.flags.no_demo,
    })).sort((a, b) => b.totalLikes - a.totalLikes);

    res.render('admin-raters', { raters });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
