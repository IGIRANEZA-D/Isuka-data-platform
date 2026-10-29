(() => {
  const entry = window.__isukaLoaderEntry || { show: false, startedAt: Date.now() };
  const loader = document.querySelector('[data-isuka-page-loader]');
  const transitionKey = 'isuka-page-loader-transition';
  const dashboardPath = (path) => /^\/dashboard(?:\/|$)/.test(path);
  const loginPath = (path) => /^\/(?:account|admin)\/login\/?$/.test(path);
  const homePath = (path) => path === '/' || path === '/index.html';

  function shouldAnimate(from, to) {
    return (homePath(from) && dashboardPath(to))
      || (dashboardPath(from) && homePath(to))
      || loginPath(to)
      || (loginPath(from) && homePath(to));
  }

  // This listener must be installed even when this page has no entry
  // animation; otherwise logout clicks on a previously visited page are lost.
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const logout = event.target.closest('[data-logout], [data-settings-logout], [data-admin-logout]');
    if (logout) {
      try { sessionStorage.setItem(transitionKey, JSON.stringify({ to: '/' })); } catch { /* storage may be disabled */ }
      return;
    }

    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

    let destination;
    try { destination = new URL(link.href, window.location.href); } catch { return; }
    if (destination.origin !== window.location.origin || !shouldAnimate(window.location.pathname, destination.pathname)) return;

    try {
      sessionStorage.setItem(transitionKey, JSON.stringify({ to: destination.pathname }));
    } catch { /* destination will still render normally */ }
  }, true);

  if (!loader || !entry.show) return;

  const progress = loader.querySelector('[data-loader-progress]');
  const percent = loader.querySelector('[data-loader-percent]');
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 760;
  let domReady = document.readyState !== 'loading';
  let hidden = false;

  loader.removeAttribute('aria-hidden');

  function hideLoader() {
    if (hidden) return;
    hidden = true;
    if (progress) progress.style.width = '100%';
    if (percent) percent.textContent = '100%';
    loader.classList.add('is-hidden');
    document.documentElement.classList.remove('isuka-loader-enabled');
  }

  function animate() {
    if (hidden) return;
    const elapsed = Math.max(0, Date.now() - entry.startedAt);
    const value = Math.min(100, Math.round((elapsed / duration) * 100));
    if (progress) progress.style.width = `${value}%`;
    if (percent) percent.textContent = `${value}%`;

    if (domReady && elapsed >= duration) {
      hideLoader();
      return;
    }
    window.requestAnimationFrame(animate);
  }

  if (!domReady) {
    document.addEventListener('DOMContentLoaded', () => {
      domReady = true;
    }, { once: true });
  }
  window.requestAnimationFrame(animate);

  // A page restored from the back/forward cache should never retain a stale
  // full-screen overlay.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    hidden = true;
    loader.classList.add('is-hidden');
    document.documentElement.classList.remove('isuka-loader-enabled');
  }, { once: true });

})();
