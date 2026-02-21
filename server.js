require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'db'),
  }),
  secret: process.env.SESSION_SECRET || 'skill-reel-rater-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Initialize SQLite (creates tables on require)
require('./db/sqlite');

// Make user available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Auth routes (no auth required)
app.use('/', require('./routes/auth'));

// All other routes require auth
app.use(requireAuth);
app.use('/', require('./routes/skills'));
app.use('/', require('./routes/people'));
app.use('/api', require('./routes/ratings'));
app.use('/admin', require('./routes/admin'));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send(`<h1>Error</h1><pre>${err.message}</pre>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skill Reel Rater running on http://localhost:${PORT}`);
});
