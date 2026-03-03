const express = require('express');
const router = express.Router();
const mysql = require('../db/mysql');

router.get('/', (req, res) => res.redirect(302, '/skills'));

router.get('/skills', async (req, res, next) => {
  try {
    const activeCategory = req.query.category || '';
    const activeLocation = req.query.location || '';

    // Fetch locations that have users
    const [locations] = await mysql.query(`
      SELECT l.id, l.name, l.code, COUNT(DISTINCT u.id) AS user_count
      FROM locations l
      JOIN user u ON u.primaryLocationId = l.id
      GROUP BY l.id, l.name, l.code
      HAVING COUNT(DISTINCT u.id) > 0
      ORDER BY
        CASE WHEN l.name LIKE 'US-%' THEN 0 ELSE 1 END,
        user_count DESC
    `);

    let skillsQuery;
    let queryParams = [];

    if (activeLocation) {
      // Filter skills by location — only count people in that location
      skillsQuery = `
        SELECT
          ss.skill_name,
          ss.category,
          COUNT(DISTINCT ss.userId) AS person_count
        FROM skill_sets ss
        JOIN user u ON ss.userId = u.id
        JOIN locations l ON u.primaryLocationId = l.id
        WHERE ss.skill_name IS NOT NULL
          AND TRIM(ss.skill_name) != ''
          AND l.name = ?
        GROUP BY ss.skill_name, ss.category
        HAVING COUNT(DISTINCT ss.userId) > 5
        ORDER BY person_count DESC
      `;
      queryParams = [activeLocation];
    } else {
      skillsQuery = `
        SELECT
          ss.skill_name,
          ss.category,
          COUNT(DISTINCT ss.userId) AS person_count
        FROM skill_sets ss
        WHERE ss.skill_name IS NOT NULL
          AND TRIM(ss.skill_name) != ''
        GROUP BY ss.skill_name, ss.category
        HAVING COUNT(DISTINCT ss.userId) > 5
        ORDER BY person_count DESC
      `;
    }

    const [rows] = await mysql.query(skillsQuery, queryParams);

    // Stunt reels count
    let stuntQuery;
    let stuntParams = [];
    if (activeLocation) {
      stuntQuery = `
        SELECT COUNT(DISTINCT sr.userId) AS person_count
        FROM stunt_reels sr
        JOIN user u ON sr.userId = u.id
        JOIN locations l ON u.primaryLocationId = l.id
        WHERE sr.reel_url IS NOT NULL AND TRIM(sr.reel_url) != ''
          AND l.name = ?
      `;
      stuntParams = [activeLocation];
    } else {
      stuntQuery = `
        SELECT COUNT(DISTINCT sr.userId) AS person_count
        FROM stunt_reels sr
        WHERE sr.reel_url IS NOT NULL AND TRIM(sr.reel_url) != ''
      `;
    }
    const [stuntRows] = await mysql.query(stuntQuery, stuntParams);
    const stuntReelCount = stuntRows[0].person_count;

    const categories = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();

    const filtered = activeCategory
      ? rows.filter(r => r.category === activeCategory)
      : rows;

    res.render('skills-list', {
      skills: filtered,
      categories,
      activeCategory,
      locations,
      activeLocation,
      stuntReelCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
