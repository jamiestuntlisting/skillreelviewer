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

// Cache for Vimeo thumbnails (in-memory, persists for server lifetime)
const vimeoThumbCache = {};

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
  return { brokenIds, notSkillReelIds, noDemoSkillIds };
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

    const { brokenIds, notSkillReelIds, noDemoSkillIds } = getExcludedIds();

    const people = allPeople
      .filter(p =>
        !brokenIds.has(p.skill_set_id) &&
        !notSkillReelIds.has(p.skill_set_id) &&
        !noDemoSkillIds.has(p.skill_set_id)
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

    // Fetch Vimeo thumbnails in parallel
    const vimeoPromises = people
      .filter(p => p.skillEmbed && p.skillEmbed.type === 'vimeo')
      .map(async p => {
        p.skillEmbed.thumbnail = await fetchVimeoThumbnail(p.skillEmbed.videoId);
      });
    await Promise.all(vimeoPromises);

    // Get ratings for all performers
    const ratingRows = sqlite.prepare('SELECT skill_set_id, rating FROM ratings').all();
    const ratingMap = {};
    ratingRows.forEach(r => { ratingMap[r.skill_set_id] = r.rating; });

    // Track carousel index — only count paid users with YouTube/Vimeo embeds
    // (must match the carousel route's filtering exactly)
    let carouselIdx = 0;
    const enrichedPeople = people.map(p => {
      const inCarousel = p.isPaid &&
        p.skillEmbed &&
        (p.skillEmbed.type === 'youtube' || p.skillEmbed.type === 'vimeo');
      const result = {
        ...p,
        rating: ratingMap[p.skill_set_id] || null,
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
       AND (ss.skill_url LIKE '%youtube.com%' OR ss.skill_url LIKE '%youtu.be%' OR ss.skill_url LIKE '%vimeo.com%')
       AND u.subscription_type IN ('standard_monthly', 'standard_yearly', 'plus_monthly', 'plus_yearly')
       AND u.is_subscription_active = 1
       ${locFilter.clause}
     ORDER BY
       FIELD(ss.level, 'Expert', 'Advanced', 'Intermediate', 'Beginner', 'Not rated', '') ASC,
       u.last_name ASC, u.first_name ASC`,
    [skillName, ...locFilter.params]
  );

  const { brokenIds, notSkillReelIds, noDemoSkillIds } = getExcludedIds();
  const people = allPeople.filter(p =>
    !brokenIds.has(p.skill_set_id) &&
    !notSkillReelIds.has(p.skill_set_id) &&
    !noDemoSkillIds.has(p.skill_set_id)
  );

  const total = people.length;
  const currentIdx = Math.max(0, Math.min(idx, people.length - 1));
  const person = people[currentIdx];

  if (!person) {
    return res.render('skill-detail', {
      skillName, person: null, total, currentIdx: 0, totalPeople: 0, location,
    });
  }

  const ratingRow = sqlite
    .prepare('SELECT rating FROM ratings WHERE skill_set_id = ?')
    .get(person.skill_set_id);

  const bestRow = sqlite
    .prepare('SELECT id FROM best_skill_reels WHERE skill_set_id = ?')
    .get(person.skill_set_id);

  const enriched = {
    ...person,
    display_image: resolveImageUrl(person.display_image),
    skillEmbed: getEmbedInfo(person.skill_url),
    rating: ratingRow ? ratingRow.rating : null,
    starred: !!bestRow,
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

module.exports = router;
