function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // Only store returnTo for real page navigations, not assets/api/favicon
  const url = req.originalUrl;
  if (!url.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|map|woff|woff2|ttf)$/) && !url.startsWith('/api/')) {
    req.session.returnTo = url;
  }
  res.redirect(302, '/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.id === 33) {
    return next();
  }
  res.status(403).send('<h1>Forbidden</h1><p>Admin access required.</p>');
}

module.exports = { requireAuth, requireAdmin };
