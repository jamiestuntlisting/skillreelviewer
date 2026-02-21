document.addEventListener('DOMContentLoaded', () => {
  // Rating button click handlers (exclude the star button)
  document.querySelectorAll('.rating-btn:not(.star-rating-btn)').forEach(btn => {
    btn.addEventListener('click', async function () {
      submitRating(parseInt(this.dataset.value));
    });
  });

  // Broken link button handler
  document.querySelectorAll('.broken-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card');
      await flagEntry(card, '/api/broken', this, 'Marked as broken');
    });
  });

  // Does not demonstrate skill button handler
  document.querySelectorAll('.no-demo-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card');
      await flagEntry(card, '/api/no-demo-skill', this, 'Marked');
    });
  });

  // Not a skill reel button handler
  document.querySelectorAll('.not-skill-reel-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card');
      await flagEntry(card, '/api/not-skill-reel', this, 'Marked');
    });
  });

  // Star (best of the best) button handler
  document.querySelectorAll('.star-rating-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card');
      const starred = card.dataset.starred === 'true';

      try {
        const res = await fetch('/api/best', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill_set_id: parseInt(card.dataset.skillSetId),
            user_id: parseInt(card.dataset.userId),
            skill_name: card.dataset.skillName,
            starred,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          card.dataset.starred = data.starred ? 'true' : 'false';
          this.classList.toggle('active', data.starred);

          if (data.starred) {
            // Bounce animation
            this.classList.remove('star-pop');
            void this.offsetWidth; // force reflow
            this.classList.add('star-pop');

            // Spark burst
            const burst = document.createElement('div');
            burst.className = 'star-burst';
            for (let i = 0; i < 6; i++) {
              const spark = document.createElement('div');
              spark.className = 'spark';
              burst.appendChild(spark);
            }
            this.appendChild(burst);
            setTimeout(() => burst.remove(), 700);
          }
        }
      } catch (err) {
        console.error('Star toggle failed:', err);
      }
    });
  });

  // Mute checkbox — persists via localStorage
  const muteCheckbox = document.getElementById('mute-checkbox');
  const videoIframe = document.getElementById('skill-video');
  if (muteCheckbox && videoIframe) {
    const isMuted = localStorage.getItem('mute-videos') === 'true';
    muteCheckbox.checked = isMuted;
    if (isMuted) {
      applyMute(true);
    }

    muteCheckbox.addEventListener('change', function () {
      localStorage.setItem('mute-videos', this.checked);
      applyMute(this.checked);
    });
  }

  function applyMute(muted) {
    if (!videoIframe) return;
    const baseUrl = videoIframe.dataset.baseUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    videoIframe.src = muted ? baseUrl + separator + 'mute=1' : baseUrl;
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Left/right arrow navigation
    if (e.key === 'ArrowLeft') {
      const prevLink = document.querySelector('.viewer-nav:not(.bottom) .nav-btn[href]');
      if (prevLink && prevLink.textContent.includes('Previous')) {
        prevLink.click();
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      const links = document.querySelectorAll('.viewer-nav:not(.bottom) .nav-btn[href]');
      for (const link of links) {
        if (link.textContent.includes('Next')) {
          link.click();
          return;
        }
      }
      return;
    }

    // Number keys for rating: 1-9 = ratings 1-9, 0 = rating 10
    if (e.key >= '0' && e.key <= '9') {
      const rating = e.key === '0' ? 10 : parseInt(e.key);
      submitRating(rating);
    }
  });

  async function submitRating(rating) {
    const card = document.querySelector('.person-card');
    if (!card) return;

    const skillSetId = card.dataset.skillSetId;
    const userId = card.dataset.userId;
    const skillName = card.dataset.skillName;

    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_set_id: parseInt(skillSetId),
          user_id: parseInt(userId),
          skill_name: skillName,
          rating,
        }),
      });

      if (res.ok) {
        card.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = card.querySelector(`.rating-btn[data-value="${rating}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        let saved = card.querySelector('.rating-saved');
        if (!saved) {
          saved = document.createElement('span');
          saved.className = 'rating-saved';
          card.querySelector('.rating-buttons').after(saved);
        }
        saved.innerHTML = `Rated: <strong>${rating}/10</strong>`;

        const status = card.querySelector('.rating-status');
        status.textContent = 'Saved!';
        status.style.display = 'inline';
        setTimeout(() => { status.style.display = 'none'; }, 1500);
      }
    } catch (err) {
      console.error('Rating failed:', err);
    }
  }

  async function flagEntry(card, endpoint, btn, label) {
    const skillSetId = card.dataset.skillSetId;
    const userId = card.dataset.userId;
    const skillName = card.dataset.skillName;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_set_id: parseInt(skillSetId),
          user_id: parseInt(userId),
          skill_name: skillName,
        }),
      });

      if (res.ok) {
        btn.textContent = label;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        setTimeout(() => window.location.reload(), 500);
      }
    } catch (err) {
      console.error('Flag action failed:', err);
    }
  }
});
