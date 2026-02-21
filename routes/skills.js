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
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
