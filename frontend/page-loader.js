(() => {
  const loader = document.querySelector('[data-isuka-page-loader]');
  if (!loader) return;

  const progressBar = loader.querySelector('[data-loader-progress]');
  const percentage = loader.querySelector('[data-loader-percent]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startedAt = performance.now();
  const minimumVisibleMs = reducedMotion ? 140 : 480;
  let hidden = false;

  function setProgress(value) {
    const boundedValue = Math.min(100, Math.max(0, Math.round(value)));
    progressBar.style.width = `${boundedValue}%`;
    percentage.textContent = `${boundedValue}%`;
  }

  function hideLoader() {
    if (hidden) return;
    hidden = true;
    setProgress(100);
    window.setTimeout(() => loader.classList.add('is-hidden'), reducedMotion ? 30 : 120);
  }

  function animateProgress(now) {
    if (hidden) return;
    const elapsed = now - startedAt;
    // Show steady progress while the document initializes; completion is tied to DOM readiness.
    setProgress(Math.min(92, (elapsed / (reducedMotion ? 180 : 1100)) * 92));
    if (elapsed < (reducedMotion ? 180 : 1100)) window.requestAnimationFrame(animateProgress);
  }

  window.requestAnimationFrame(animateProgress);

  function finishWhenReady() {
    const remaining = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
    window.setTimeout(hideLoader, remaining);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', finishWhenReady, { once: true });
  } else {
    finishWhenReady();
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = event.target.closest('a[href]');
    if (link) {
      if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      loader.classList.remove('is-hidden');
      setProgress(0);
      return;
    }

    // These actions finish with a full-page redirect after their sign-out request.
    if (event.target.closest('[data-logout], [data-settings-logout], [data-admin-logout]')) {
      hidden = false;
      loader.classList.remove('is-hidden');
      setProgress(0);
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      hidden = true;
      loader.classList.add('is-hidden');
    }
  });
})();
