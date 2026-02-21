const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect(302, '/skills');
  }
  res.render('login', { error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render('login', { error: 'Email and password are required' });
    }

    // Sanitize for GraphQL string interpolation
    const safeEmail = email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safePassword = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Step 1: Login to get access token
    const loginResponse = await fetch('https://api.stuntlisting.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'login',
        variables: {},
        query: `mutation login {
          login(email: "${safeEmail}", password: "${safePassword}") {
            access_token
            refresh_token
          }
        }`,
      }),
    });

    const loginResult = await loginResponse.json();

    if (loginResult.errors || !loginResult.data || !loginResult.data.login) {
      const msg = loginResult.errors?.[0]?.message || 'Invalid email or password';
      return res.render('login', { error: msg });
    }

    const { access_token } = loginResult.data.login;

    // Step 2: Fetch user profile using the access token
    const profileResponse = await fetch('https://api.stuntlisting.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        query: `query {
          getMyProfile {
            id
            first_name
            last_name
            email
            role
            subscription_type
            is_subscription_active
          }
        }`,
      }),
    });

    const profileResult = await profileResponse.json();

    if (profileResult.errors || !profileResult.data || !profileResult.data.getMyProfile) {
      return res.render('login', { error: 'Login succeeded but failed to load profile' });
    }

    const user = profileResult.data.getMyProfile;

    req.session.user = {
      id: typeof user.id === 'string' ? parseInt(user.id, 10) : user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      subscription_type: user.subscription_type,
      is_subscription_active: user.is_subscription_active,
    };

    const returnTo = req.session.returnTo || '/skills';
    delete req.session.returnTo;
    res.redirect(302, returnTo);
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(302, '/login');
  });
});

module.exports = router;
