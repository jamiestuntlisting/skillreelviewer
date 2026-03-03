document.addEventListener('DOMContentLoaded', () => {
  // Like button handler
  document.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card') || this.closest('.feed-card');
      const liked = card.dataset.liked === 'true';

      try {
        const res = await fetch('/api/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill_set_id: parseInt(card.dataset.skillSetId),
            user_id: parseInt(card.dataset.userId),
            skill_name: card.dataset.skillName,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          card.dataset.liked = data.liked ? 'true' : 'false';
          this.classList.toggle('active', data.liked);
          const countEl = this.querySelector('.like-count');
          if (countEl) countEl.textContent = data.likeCount || '';

          if (data.liked) {
            this.classList.remove('like-pop');
            void this.offsetWidth;
            this.classList.add('like-pop');
          }

          showStatus(card, data.liked ? 'Liked!' : 'Unliked');
        }
      } catch (err) {
        console.error('Like failed:', err);
      }
    });
  });

  // Best of All Time button handler
  document.querySelectorAll('.best-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card') || this.closest('.feed-card');
      const starred = card.dataset.starred === 'true';

      try {
        const res = await fetch('/api/best', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill_set_id: parseInt(card.dataset.skillSetId),
            user_id: parseInt(card.dataset.userId),
            skill_name: card.dataset.skillName,
          }),
        });

        if (res.status === 429) {
          const data = await res.json();
          showStatus(card, data.error, true);
          return;
        }

        if (res.ok) {
          const data = await res.json();
          card.dataset.starred = data.starred ? 'true' : 'false';
          card.dataset.bestRemaining = data.remaining;
          this.classList.toggle('active', data.starred);

          const countEl = this.querySelector('.best-count');
          if (countEl) countEl.textContent = data.bestCount || '';

          // Update remaining display
          const remainEl = card.querySelector('.best-remaining-count');
          if (remainEl) remainEl.textContent = data.remaining;

          if (data.starred) {
            // Bounce animation
            this.classList.remove('star-pop');
            void this.offsetWidth;
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

          showStatus(card, data.starred ? 'Best of All Time!' : 'Removed');
        }
      } catch (err) {
        console.error('Best toggle failed:', err);
      }
    });
  });

  // Broken link button handler
  document.querySelectorAll('.broken-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card') || this.closest('.feed-card');
      await flagEntry(card, '/api/broken', this, 'Marked as broken');
    });
  });

  // Does not demonstrate skill button handler
  document.querySelectorAll('.no-demo-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card') || this.closest('.feed-card');
      await flagEntry(card, '/api/no-demo-skill', this, 'Marked');
    });
  });

  // Not a skill reel button handler
  document.querySelectorAll('.not-skill-reel-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      const card = this.closest('.person-card') || this.closest('.feed-card');
      await flagEntry(card, '/api/not-skill-reel', this, 'Marked');
    });
  });

  // Mute checkbox — persists via localStorage
  const muteCheckbox = document.getElementById('mute-checkbox');
  const videoIframe = document.getElementById('skill-video');
  if (muteCheckbox && videoIframe) {
    const isMuted = localStorage.getItem('mute-videos') === 'true';
    muteCheckbox.checked = isMuted;
    if (isMuted) applyMute(true);

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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Left/right arrow navigation
    if (e.key === 'ArrowLeft') {
      const prevLink = document.querySelector('.viewer-nav:not(.bottom) .nav-btn[href]');
      if (prevLink && prevLink.textContent.includes('Previous')) prevLink.click();
      return;
    }
    if (e.key === 'ArrowRight') {
      const links = document.querySelectorAll('.viewer-nav:not(.bottom) .nav-btn[href]');
      for (const link of links) {
        if (link.textContent.includes('Next')) { link.click(); return; }
      }
      return;
    }

    // L key = toggle like
    if (e.key === 'l' || e.key === 'L') {
      const likeBtn = document.querySelector('.like-btn');
      if (likeBtn) likeBtn.click();
    }
    // B key = toggle best
    if (e.key === 'b' || e.key === 'B') {
      const bestBtn = document.querySelector('.best-btn');
      if (bestBtn) bestBtn.click();
    }
  });

  function showStatus(card, text, isError) {
    const status = card.querySelector('.rating-status');
    if (!status) return;
    status.textContent = text;
    status.style.display = 'inline';
    if (isError) status.style.color = '#f85149';
    else status.style.color = '#3fb950';
    setTimeout(() => { status.style.display = 'none'; status.style.color = ''; }, 2000);
  }

  async function flagEntry(card, endpoint, btn, label) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_set_id: parseInt(card.dataset.skillSetId),
          user_id: parseInt(card.dataset.userId),
          skill_name: card.dataset.skillName,
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
