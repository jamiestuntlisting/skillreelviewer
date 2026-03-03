const express = require('express');
const router = express.Router();
const mysql = require('../db/mysql');
const sqlite = require('../db/sqlite');
const { sendFeedbackEmail } = require('../lib/email');

const IMAGE_BASE = 'https://stuntlisting-uploads-production.s3.amazonaws.com/';

function resolveImageUrl(path) {
  if (!path || path.trim() === '') return null;
  if (path.startsWith('http')) return path;
  return IMAGE_BASE + path;
}

function getEmbedInfo(url) {
  if (!url || url.trim() === '' || url.trim() === ' ') return null;
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return {
      type: 'youtube',
      videoId: ytMatch[1],
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`,
      thumbnail: `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`,
    };
  }
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return {
      type: 'vimeo',
      videoId: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      thumbnail: null,
    };
  }
  return { type: 'link', originalUrl: url, thumbnail: null };
}

// My Reels — performer sees their own skill reels
router.get('/my-reels', async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const [reels] = await mysql.query(
      `SELECT
         ss.id AS skill_set_id,
         ss.skill_name,
         ss.level,
         ss.category,
         ss.description,
         ss.skill_url
       FROM skill_sets ss
       WHERE ss.userId = ?
         AND ss.skill_url IS NOT NULL
         AND TRIM(ss.skill_url) != ''
         AND TRIM(ss.skill_url) != ' '
       ORDER BY ss.skill_name ASC`,
      [userId]
    );

    const hiddenRows = sqlite.prepare(
      'SELECT skill_set_id FROM hidden_reels WHERE user_id = ?'
    ).all(userId);
    const hiddenSet = new Set(hiddenRows.map(r => r.skill_set_id));

    const feedbackRows = sqlite.prepare(
      `SELECT skill_set_id, id as request_id, created_at FROM feedback_requests
       WHERE user_id = ?
         AND datetime(created_at, '+14 days') > datetime('now')`
    ).all(userId);
    const feedbackMap = {};
    feedbackRows.forEach(r => { feedbackMap[r.skill_set_id] = r; });

    const feedbackCounts = sqlite.prepare(
      `SELECT fs.skill_set_id, COUNT(*) AS count
       FROM feedback_submissions fs
       WHERE fs.performer_user_id = ?
       GROUP BY fs.skill_set_id`
    ).all(userId);
    const feedbackCountMap = {};
    feedbackCounts.forEach(r => { feedbackCountMap[r.skill_set_id] = r.count; });

    const enrichedReels = reels.map(r => ({
      ...r,
      skillEmbed: getEmbedInfo(r.skill_url),
      isHidden: hiddenSet.has(r.skill_set_id),
      feedbackRequest: feedbackMap[r.skill_set_id] || null,
      feedbackCount: feedbackCountMap[r.skill_set_id] || 0,
    }));

    res.render('my-reels', { reels: enrichedReels });
  } catch (err) {
    next(err);
  }
});

// Toggle hide/unhide a reel
router.post('/my-reels/hide', async (req, res) => {
  const { skill_set_id } = req.body;
  const userId = req.session.user.id;

  const [rows] = await mysql.query(
    'SELECT id FROM skill_sets WHERE id = ? AND userId = ?',
    [skill_set_id, userId]
  );
  if (rows.length === 0) {
    return res.status(403).json({ error: 'Not your reel' });
  }

  const existing = sqlite.prepare(
    'SELECT id FROM hidden_reels WHERE skill_set_id = ?'
  ).get(skill_set_id);

  if (existing) {
    sqlite.prepare('DELETE FROM hidden_reels WHERE skill_set_id = ?').run(skill_set_id);
    return res.json({ success: true, hidden: false });
  } else {
    sqlite.prepare(
      'INSERT OR IGNORE INTO hidden_reels (skill_set_id, user_id) VALUES (?, ?)'
    ).run(skill_set_id, userId);
    return res.json({ success: true, hidden: true });
  }
});

// Request feedback on a reel (2-week window)
router.post('/my-reels/request-feedback', async (req, res) => {
  const { skill_set_id } = req.body;
  const userId = req.session.user.id;

  const [rows] = await mysql.query(
    'SELECT id FROM skill_sets WHERE id = ? AND userId = ?',
    [skill_set_id, userId]
  );
  if (rows.length === 0) {
    return res.status(403).json({ error: 'Not your reel' });
  }

  const existing = sqlite.prepare(
    `SELECT id FROM feedback_requests
     WHERE skill_set_id = ?
       AND datetime(created_at, '+14 days') > datetime('now')`
  ).get(skill_set_id);

  if (existing) {
    return res.status(409).json({ error: 'Feedback already requested for this reel' });
  }

  sqlite.prepare('DELETE FROM feedback_requests WHERE skill_set_id = ?').run(skill_set_id);
  sqlite.prepare(
    'INSERT INTO feedback_requests (skill_set_id, user_id) VALUES (?, ?)'
  ).run(skill_set_id, userId);

  return res.json({ success: true });
});

// List reels open for feedback
router.get('/feedback', async (req, res, next) => {
  try {
    const activeRequests = sqlite.prepare(
      `SELECT id, skill_set_id, user_id, created_at
       FROM feedback_requests
       WHERE datetime(created_at, '+14 days') > datetime('now')
       ORDER BY created_at DESC`
    ).all();

    if (activeRequests.length === 0) {
      return res.render('feedback-list', { reels: [] });
    }

    const skillSetIds = activeRequests.map(r => r.skill_set_id);
    const placeholders = skillSetIds.map(() => '?').join(',');
    const [mysqlReels] = await mysql.query(
      `SELECT
         ss.id AS skill_set_id,
         ss.userId,
         ss.skill_name,
         ss.level,
         ss.skill_url,
         u.first_name,
         u.last_name,
         u.display_image
       FROM skill_sets ss
       JOIN user u ON ss.userId = u.id
       WHERE ss.id IN (${placeholders})`,
      skillSetIds
    );

    const reelMap = {};
    mysqlReels.forEach(r => { reelMap[r.skill_set_id] = r; });

    const countRows = sqlite.prepare(
      `SELECT feedback_request_id, COUNT(*) AS count
       FROM feedback_submissions
       GROUP BY feedback_request_id`
    ).all();
    const countMap = {};
    countRows.forEach(r => { countMap[r.feedback_request_id] = r.count; });

    const enrichedReels = activeRequests
      .filter(r => reelMap[r.skill_set_id])
      .map(r => {
        const reel = reelMap[r.skill_set_id];
        const createdAt = new Date(r.created_at.replace(' ', 'T') + 'Z');
        const expiresAt = new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
        const daysRemaining = Math.max(0, Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24)));

        return {
          requestId: r.id,
          skill_set_id: r.skill_set_id,
          skill_name: reel.skill_name,
          level: reel.level,
          first_name: reel.first_name,
          last_name: reel.last_name,
          display_image: resolveImageUrl(reel.display_image),
          skillEmbed: getEmbedInfo(reel.skill_url),
          daysRemaining,
          feedbackCount: countMap[r.id] || 0,
        };
      });

    res.render('feedback-list', { reels: enrichedReels });
  } catch (err) {
    next(err);
  }
});

// View reel + submit feedback
router.get('/feedback/:requestId', async (req, res, next) => {
  try {
    const requestId = parseInt(req.params.requestId);
    const request = sqlite.prepare(
      `SELECT id, skill_set_id, user_id, created_at
       FROM feedback_requests
       WHERE id = ?
         AND datetime(created_at, '+14 days') > datetime('now')`
    ).get(requestId);

    if (!request) {
      return res.status(404).render('error', { message: 'Feedback request not found or expired' });
    }

    const [rows] = await mysql.query(
      `SELECT ss.id AS skill_set_id, ss.skill_name, ss.level, ss.skill_url,
              ss.description, u.first_name, u.last_name, u.display_image
       FROM skill_sets ss
       JOIN user u ON ss.userId = u.id
       WHERE ss.id = ?`,
      [request.skill_set_id]
    );
    if (!rows[0]) {
      return res.status(404).render('error', { message: 'Reel not found' });
    }

    const submissions = sqlite.prepare(
      `SELECT id, reviewer_user_id, feedback_text, created_at
       FROM feedback_submissions
       WHERE feedback_request_id = ?
       ORDER BY created_at DESC`
    ).all(requestId);

    const reviewerIds = [...new Set(submissions.map(s => s.reviewer_user_id))];
    let reviewerMap = {};
    if (reviewerIds.length > 0) {
      const ph = reviewerIds.map(() => '?').join(',');
      const [users] = await mysql.query(
        `SELECT id, first_name, last_name FROM user WHERE id IN (${ph})`,
        reviewerIds
      );
      users.forEach(u => { reviewerMap[u.id] = u; });
    }

    const enrichedSubmissions = submissions.map(s => ({
      ...s,
      reviewer_name: reviewerMap[s.reviewer_user_id]
        ? `${reviewerMap[s.reviewer_user_id].first_name} ${reviewerMap[s.reviewer_user_id].last_name}`
        : `User #${s.reviewer_user_id}`,
    }));

    const createdAt = new Date(request.created_at.replace(' ', 'T') + 'Z');
    const expiresAt = new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24)));

    const reel = rows[0];
    res.render('feedback-detail', {
      requestId,
      reel: {
        ...reel,
        display_image: resolveImageUrl(reel.display_image),
        skillEmbed: getEmbedInfo(reel.skill_url),
      },
      submissions: enrichedSubmissions,
      daysRemaining,
      isOwnReel: req.session.user.id === request.user_id,
    });
  } catch (err) {
    next(err);
  }
});

// Submit feedback
router.post('/feedback/:requestId', async (req, res, next) => {
  try {
    const requestId = parseInt(req.params.requestId);
    const { feedback_text } = req.body;
    const reviewerUserId = req.session.user.id;

    if (!feedback_text || feedback_text.trim().length === 0) {
      return res.status(400).json({ error: 'Feedback text is required' });
    }

    const request = sqlite.prepare(
      `SELECT id, skill_set_id, user_id FROM feedback_requests
       WHERE id = ?
         AND datetime(created_at, '+14 days') > datetime('now')`
    ).get(requestId);

    if (!request) {
      return res.status(404).json({ error: 'Feedback request expired or not found' });
    }

    sqlite.prepare(
      `INSERT INTO feedback_submissions
         (feedback_request_id, skill_set_id, performer_user_id, reviewer_user_id, feedback_text)
       VALUES (?, ?, ?, ?, ?)`
    ).run(requestId, request.skill_set_id, request.user_id, reviewerUserId, feedback_text.trim());

    // Send email via SendGrid
    const [performerRows] = await mysql.query(
      'SELECT email, first_name FROM user WHERE id = ?',
      [request.user_id]
    );
    if (performerRows.length > 0) {
      const [skillRows] = await mysql.query(
        'SELECT skill_name FROM skill_sets WHERE id = ?',
        [request.skill_set_id]
      );
      const skillName = skillRows[0]?.skill_name || 'Unknown';
      const reviewerName = `${req.session.user.first_name} ${req.session.user.last_name}`;

      await sendFeedbackEmail(
        performerRows[0].email,
        performerRows[0].first_name,
        skillName,
        feedback_text.trim(),
        reviewerName
      );
    }

    res.redirect('/feedback/' + requestId);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
