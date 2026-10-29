(() => {
  const transitionKey = 'isuka-page-loader-transition';
  let transition = null;
  let showLoader = false;

  const normalizePath = (pathname) => {
    if (pathname === '/index.html') return '/';
    return pathname.replace(/\/+$/, '') || '/';
  };

  try {
    transition = JSON.parse(sessionStorage.getItem(transitionKey) || 'null');
    sessionStorage.removeItem(transitionKey);
    if (!transition || normalizePath(transition.to) !== normalizePath(window.location.pathname)) transition = null;

    const navigation = performance.getEntriesByType('navigation')[0];
    const hasVisited = sessionStorage.getItem('isuka-page-seen') === '1';
    showLoader = Boolean(transition) || navigation?.type === 'reload' || !hasVisited;
    sessionStorage.setItem('isuka-page-seen', '1');
  } catch {
    showLoader = true;
  }

  // Start the animation on the destination page. Carrying the source-page
  // timestamp made slow navigations land with the bar already complete.
  window.__isukaLoaderEntry = { show: showLoader, startedAt: Date.now() };
  if (showLoader) document.documentElement.classList.add('isuka-loader-enabled');
})();
