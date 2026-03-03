const express = require('express');
const router = express.Router();
const mysql = require('../db/mysql');
const sqlite = require('../db/sqlite');

const IMAGE_BASE = 'https://stuntlisting-uploads-production.s3.amazonaws.com/';

function resolveImageUrl(path) {
  if (!path || path.trim() === '') return null;
  if (path.startsWith('http')) return path;
  return IMAGE_BASE + path;
}

// Cache for Vimeo/Instagram thumbnails (in-memory, persists for server lifetime)
const vimeoThumbCache = {};
const instagramThumbCache = {};

async function fetchVimeoThumbnail(videoId) {
  if (vimeoThumbCache[videoId] !== undefined) return vimeoThumbCache[videoId];
  try {
    const resp = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}&width=320`);
    if (resp.ok) {
      const data = await resp.json();
      vimeoThumbCache[videoId] = data.thumbnail_url || null;
      return vimeoThumbCache[videoId];
    }
  } catch (e) {
    // Ignore fetch errors
  }
  vimeoThumbCache[videoId] = null;
  return null;
}

async function fetchInstagramThumbnail(shortcode) {
  if (instagramThumbCache[shortcode] !== undefined) return instagramThumbCache[shortcode];
  try {
    const url = `https://www.instagram.com/reel/${shortcode}/`;
    const resp = await fetch(`https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${process.env.INSTAGRAM_TOKEN || ''}`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      instagramThumbCache[shortcode] = data.thumbnail_url || null;
      return instagramThumbCache[shortcode];
    }
  } catch (e) {
    // Ignore — Instagram oembed requires a token, fallback to null
  }
  instagramThumbCache[shortcode] = null;
  return null;
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
      thumbnail: null, // will be filled async
    };
  }

  // Instagram reels: instagram.com/reel/CODE/ or instagram.com/p/CODE/
  const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
  if (igMatch) {
    return {
      type: 'instagram',
      videoId: igMatch[1],
      embedUrl: `https://www.instagram.com/reel/${igMatch[1]}/embed/`,
      thumbnail: null, // will be filled async if token available
    };
  }

  return { type: 'link', originalUrl: url, thumbnail: null };
}

function getExcludedIds() {
  const brokenIds = new Set(
    sqlite.prepare('SELECT skill_set_id FROM broken_links').all().map(r => r.skill_set_id)
  );
  const notSkillReelIds = new Set(
    sqlite.prepare('SELECT skill_set_id FROM not_skill_reels').all().map(r => r.skill_set_id)
  );
  const noDemoSkillIds = new Set(
    sqlite.prepare('SELECT skill_set_id FROM no_demo_skill').all().map(r => r.skill_set_id)
  );
  const hiddenReelIds = new Set(
    sqlite.prepare('SELECT skill_set_id FROM hidden_reels').all().map(r => r.skill_set_id)
  );
  return { brokenIds, notSkillReelIds, noDemoSkillIds, hiddenReelIds };
}

// Build location WHERE clause + params
function locationFilter(location) {
  if (!location) return { clause: '', params: [] };
  return {
    clause: `AND u.primaryLocationId IN (SELECT id FROM locations WHERE name = ?)`,
    params: [location],
  };
}

// All performers page (paid + free)
router.get('/skill/:skillName/all', async (req, res, next) => {
  try {
    const skillName = req.params.skillName;
    const location = req.query.location || '';
    const locFilter = locationFilter(location);

    const [allPeople] = await mysql.query(
      `SELECT
         ss.id AS skill_set_id,
         ss.userId,
         ss.skill_name,
         ss.level,
         ss.category,
         ss.description,
         ss.skill_url,
         u.first_name,
         u.last_name,
         u.display_image,
         u.subscription_type,
         u.is_subscription_active
       FROM skill_sets ss
       JOIN user u ON ss.userId = u.id
       WHERE ss.skill_name = ?
         AND ss.skill_url IS NOT NULL
         AND TRIM(ss.skill_url) != ''
         AND TRIM(ss.skill_url) != ' '
         ${locFilter.clause}
       ORDER BY
         FIELD(ss.level, 'Expert', 'Advanced', 'Intermediate', 'Beginner', 'Not rated', '') ASC,
         u.last_name ASC, u.first_name ASC`,
      [skillName, ...locFilter.params]
    );

    const { brokenIds, notSkillReelIds, noDemoSkillIds, hiddenReelIds } = getExcludedIds();

    const people = allPeople
      .filter(p =>
        !brokenIds.has(p.skill_set_id) &&
        !notSkillReelIds.has(p.skill_set_id) &&
        !noDemoSkillIds.has(p.skill_set_id) &&
        !hiddenReelIds.has(p.skill_set_id)
      )
      .map(p => {
        const isPaid = ['standard_monthly', 'standard_yearly', 'plus_monthly', 'plus_yearly']
          .includes(p.subscription_type) && p.is_subscription_active === 1;

        return {
          ...p,
          display_image: resolveImageUrl(p.display_image),
          isPaid,
          skillEmbed: getEmbedInfo(p.skill_url),
        };
      });

    // Fetch Vimeo + Instagram thumbnails in parallel
    const thumbPromises = people
      .filter(p => p.skillEmbed && (p.skillEmbed.type === 'vimeo' || p.skillEmbed.type === 'instagram'))
      .map(async p => {
        if (p.skillEmbed.type === 'vimeo') {
          p.skillEmbed.thumbnail = await fetchVimeoThumbnail(p.skillEmbed.videoId);
        } else if (p.skillEmbed.type === 'instagram') {
          p.skillEmbed.thumbnail = await fetchInstagramThumbnail(p.skillEmbed.videoId);
        }
      });
    await Promise.all(thumbPromises);

    // Get current rater's likes
    const raterId = req.session.user ? req.session.user.id : null;
    const likedRows = sqlite.prepare('SELECT skill_set_id FROM likes WHERE rater_id = ?').all(raterId);
    const likedSet = new Set(likedRows.map(r => r.skill_set_id));

    // Get like counts for all skill_set_ids
    const allLikeCounts = sqlite.prepare('SELECT skill_set_id, COUNT(*) AS count FROM likes GROUP BY skill_set_id').all();
    const likeCountMap = {};
    allLikeCounts.forEach(r => { likeCountMap[r.skill_set_id] = r.count; });

    // Track carousel index — only count paid users with embeddable videos
    // (must match the carousel route's filtering exactly)
    let carouselIdx = 0;
    const enrichedPeople = people.map(p => {
      const inCarousel = p.isPaid &&
        p.skillEmbed &&
        (p.skillEmbed.type === 'youtube' || p.skillEmbed.type === 'vimeo' || p.skillEmbed.type === 'instagram');
      const result = {
        ...p,
        liked: likedSet.has(p.skill_set_id),
        likeCount: likeCountMap[p.skill_set_id] || 0,
        paidIndex: inCarousel ? carouselIdx : null,
      };
      if (inCarousel) carouselIdx++;
      return result;
    });

    res.render('all-performers', {
      skillName,
      people: enrichedPeople,
      paidCount: enrichedPeople.filter(p => p.isPaid).length,
      freeCount: enrichedPeople.filter(p => !p.isPaid).length,
      location,
    });
  } catch (err) {
    next(err);
  }
});

// Carousel / rating page — PAID USERS ONLY
router.get('/skill/:skillName', async (req, res, next) => {
  try {
  const skillName = req.params.skillName;
  const shareId = req.query.id ? parseInt(req.query.id) : null;
  const idx = parseInt(req.query.idx) || 0;
  const location = req.query.location || '';
  const locFilter = locationFilter(location);

  const [allPeople] = await mysql.query(
    `SELECT
       ss.id AS skill_set_id,
       ss.userId,
       ss.skill_name,
       ss.level,
       ss.category,
       ss.description,
       ss.skill_url,
       u.first_name,
       u.last_name,
       u.display_image
     FROM skill_sets ss
     JOIN user u ON ss.userId = u.id
     WHERE ss.skill_name = ?
       AND ss.skill_url IS NOT NULL
       AND TRIM(ss.skill_url) != ''
       AND TRIM(ss.skill_url) != ' '
       AND (ss.skill_url LIKE '%youtube.com%' OR ss.skill_url LIKE '%youtu.be%' OR ss.skill_url LIKE '%vimeo.com%' OR ss.skill_url LIKE '%instagram.com%')
       AND u.subscription_type IN ('standard_monthly', 'standard_yearly', 'plus_monthly', 'plus_yearly')
       AND u.is_subscription_active = 1
       ${locFilter.clause}
     ORDER BY
       FIELD(ss.level, 'Expert', 'Advanced', 'Intermediate', 'Beginner', 'Not rated', '') ASC,
       u.last_name ASC, u.first_name ASC`,
    [skillName, ...locFilter.params]
  );

  const { brokenIds, notSkillReelIds, noDemoSkillIds, hiddenReelIds } = getExcludedIds();
  const people = allPeople.filter(p =>
    !brokenIds.has(p.skill_set_id) &&
    !notSkillReelIds.has(p.skill_set_id) &&
    !noDemoSkillIds.has(p.skill_set_id) &&
    !hiddenReelIds.has(p.skill_set_id)
  );

  const total = people.length;

  // Support ?id=SKILL_SET_ID for stable share URLs
  let currentIdx;
  if (shareId) {
    const foundIdx = people.findIndex(p => p.skill_set_id === shareId);
    currentIdx = foundIdx >= 0 ? foundIdx : 0;
  } else {
    currentIdx = Math.max(0, Math.min(idx, people.length - 1));
  }
  const person = people[currentIdx];

  if (!person) {
    return res.render('skill-detail', {
      skillName, person: null, total, currentIdx: 0, totalPeople: 0, location,
    });
  }

  const raterId = req.session.user ? req.session.user.id : null;
  const likeRow = sqlite
    .prepare('SELECT id FROM likes WHERE skill_set_id = ? AND rater_id = ?')
    .get(person.skill_set_id, raterId);
  const likeCount = sqlite
    .prepare('SELECT COUNT(*) AS count FROM likes WHERE skill_set_id = ?')
    .get(person.skill_set_id).count;

  const bestRow = sqlite
    .prepare('SELECT id FROM best_skill_reels WHERE skill_set_id = ? AND rater_id = ?')
    .get(person.skill_set_id, raterId);
  const bestCount = sqlite
    .prepare('SELECT COUNT(*) AS count FROM best_skill_reels WHERE skill_set_id = ?')
    .get(person.skill_set_id).count;
  const bestRemaining = 2 - sqlite
    .prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')")
    .get(raterId).count;

  const enriched = {
    ...person,
    display_image: resolveImageUrl(person.display_image),
    skillEmbed: getEmbedInfo(person.skill_url),
    liked: !!likeRow,
    likeCount,
    starred: !!bestRow,
    bestCount,
    bestRemaining,
  };

  res.render('skill-detail', {
    skillName,
    person: enriched,
    total,
    currentIdx,
    totalPeople: people.length,
    location,
  });
  } catch (err) {
    next(err);
  }
});

// Feed page — most recently added skill reels, vertical scroll
router.get('/feed', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 20;
    const offset = page * limit;

    const [reels] = await mysql.query(
      `SELECT
         ss.id AS skill_set_id,
         ss.userId,
         ss.skill_name,
         ss.level,
         ss.skill_url,
         ss.created_at AS reel_created_at,
         u.first_name,
         u.last_name,
         u.display_image
       FROM skill_sets ss
       JOIN user u ON ss.userId = u.id
       WHERE ss.skill_url IS NOT NULL
         AND TRIM(ss.skill_url) != ''
         AND TRIM(ss.skill_url) != ' '
         AND (ss.skill_url LIKE '%youtube.com%' OR ss.skill_url LIKE '%youtu.be%' OR ss.skill_url LIKE '%vimeo.com%' OR ss.skill_url LIKE '%instagram.com%')
         AND u.subscription_type IN ('standard_monthly', 'standard_yearly', 'plus_monthly', 'plus_yearly')
         AND u.is_subscription_active = 1
       ORDER BY ss.id DESC
       LIMIT ? OFFSET ?`,
      [limit + 1, offset]  // fetch one extra to know if there's more
    );

    const hasMore = reels.length > limit;
    const pageReels = reels.slice(0, limit);

    const { brokenIds, notSkillReelIds, noDemoSkillIds, hiddenReelIds } = getExcludedIds();

    const feedItems = pageReels
      .filter(p =>
        !brokenIds.has(p.skill_set_id) &&
        !notSkillReelIds.has(p.skill_set_id) &&
        !noDemoSkillIds.has(p.skill_set_id) &&
        !hiddenReelIds.has(p.skill_set_id)
      )
      .map(p => ({
        ...p,
        display_image: resolveImageUrl(p.display_image),
        skillEmbed: getEmbedInfo(p.skill_url),
      }));

    // Get current rater's likes and best status
    const raterId = req.session.user ? req.session.user.id : null;
    const likedRows = sqlite.prepare('SELECT skill_set_id FROM likes WHERE rater_id = ?').all(raterId);
    const likedSet = new Set(likedRows.map(r => r.skill_set_id));

    const bestRows = sqlite.prepare('SELECT skill_set_id FROM best_skill_reels WHERE rater_id = ?').all(raterId);
    const bestSet = new Set(bestRows.map(r => r.skill_set_id));

    const allLikeCounts = sqlite.prepare('SELECT skill_set_id, COUNT(*) AS count FROM likes GROUP BY skill_set_id').all();
    const likeCountMap = {};
    allLikeCounts.forEach(r => { likeCountMap[r.skill_set_id] = r.count; });

    const allBestCounts = sqlite.prepare('SELECT skill_set_id, COUNT(*) AS count FROM best_skill_reels GROUP BY skill_set_id').all();
    const bestCountMap = {};
    allBestCounts.forEach(r => { bestCountMap[r.skill_set_id] = r.count; });

    const bestRemaining = 2 - sqlite
      .prepare("SELECT COUNT(*) AS count FROM best_skill_reels WHERE rater_id = ? AND created_at >= datetime('now', '-7 days')")
      .get(raterId).count;

    const enrichedFeed = feedItems.map(p => ({
      ...p,
      liked: likedSet.has(p.skill_set_id),
      likeCount: likeCountMap[p.skill_set_id] || 0,
      starred: bestSet.has(p.skill_set_id),
      bestCount: bestCountMap[p.skill_set_id] || 0,
    }));

    res.render('feed', {
      reels: enrichedFeed,
      page,
      hasMore,
      bestRemaining,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
