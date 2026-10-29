(() => {
  const loader = document.querySelector('[data-isuka-page-loader]');
  if (!loader) return;

  const progressBar = loader.querySelector('[data-loader-progress]');
  const percentage = loader.querySelector('[data-loader-percent]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const minimumVisibleMs = reducedMotion ? 140 : 480;
  const entry = window.__isukaLoaderEntry || { show: true, startedAt: Date.now() };
  let startedAt = entry.startedAt;
  let navigating = false;
  let hidden = !entry.show;
  let animationFrame = 0;
  let hideTimer = 0;

  function setProgress(value) {
    const boundedValue = Math.min(100, Math.max(0, Math.round(value)));
    progressBar.style.width = `${boundedValue}%`;
    percentage.textContent = `${boundedValue}%`;
  }

  function hideLoader() {
    if (hidden || navigating) return;
    hidden = true;
    setProgress(100);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      loader.classList.add('is-hidden');
      document.documentElement.classList.remove('isuka-loader-enabled');
      loader.setAttribute('aria-hidden', 'true');
      window.cancelAnimationFrame(animationFrame);
    }, reducedMotion ? 30 : 120);
  }

  function animateProgress() {
    if (hidden) return;
    const elapsed = Date.now() - startedAt;
    setProgress(Math.min(92, (elapsed / (reducedMotion ? 180 : 1100)) * 92));
    if (elapsed < (reducedMotion ? 180 : 1100)) animationFrame = window.requestAnimationFrame(animateProgress);
  }

  function finishWhenReady() {
    const remaining = Math.max(0, minimumVisibleMs - (Date.now() - startedAt));
    hideTimer = window.setTimeout(hideLoader, remaining);
  }

  function showForTransition(destinationPath) {
    navigating = true;
    hidden = false;
    startedAt = Date.now();
    window.clearTimeout(hideTimer);
    loader.classList.remove('is-hidden');
    loader.removeAttribute('aria-hidden');
    document.documentElement.classList.add('isuka-loader-enabled');
    setProgress(0);
    try {
      sessionStorage.setItem('isuka-page-loader-transition', JSON.stringify({ to: destinationPath, startedAt }));
    } catch {}
    animationFrame = window.requestAnimationFrame(animateProgress);
  }

  if (entry.show) {
    loader.removeAttribute('aria-hidden');
    animationFrame = window.requestAnimationFrame(animateProgress);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', finishWhenReady, { once: true });
    else finishWhenReady();
  } else {
    loader.setAttribute('aria-hidden', 'true');
  }

  function shouldAnimateTransition(from, to) {
    const isHome = (pathname) => pathname === '/' || pathname === '/index.html';
    const isDashboard = (pathname) => /^\/dashboard(?:\/|$)/.test(pathname);
    const isLogin = (pathname) => pathname === '/account/login' || pathname === '/account/login/' || pathname === '/admin/login' || pathname === '/admin/login/';
    return (isHome(from) && isDashboard(to))
      || (isDashboard(from) && isHome(to))
      || isLogin(to)
      || (isLogin(from) && isHome(to));
  }

  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const logoutAction = event.target.closest('[data-logout], [data-settings-logout], [data-admin-logout]');
    if (logoutAction) {
      showForTransition('/');
      return;
    }

    if (event.defaultPrevented) return;
    const link = event.target.closest('a[href]');
    if (link) {
      if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (shouldAnimateTransition(window.location.pathname, destination.pathname)) showForTransition(destination.pathname);
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      hidden = true;
      loader.classList.add('is-hidden');
    }
  });
})();
