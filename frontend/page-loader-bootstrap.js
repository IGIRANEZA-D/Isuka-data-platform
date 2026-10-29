(() => {
  const transitionKey = 'isuka-page-loader-transition';
  let transition = null;
  let showLoader = false;

  try {
    transition = JSON.parse(sessionStorage.getItem(transitionKey) || 'null');
    sessionStorage.removeItem(transitionKey);
    if (!transition || transition.to !== window.location.pathname) transition = null;

    const navigation = performance.getEntriesByType('navigation')[0];
    const hasVisited = sessionStorage.getItem('isuka-page-seen') === '1';
    showLoader = Boolean(transition) || navigation?.type === 'reload' || !hasVisited;
    sessionStorage.setItem('isuka-page-seen', '1');
  } catch {
    showLoader = true;
  }

  window.__isukaLoaderEntry = { show: showLoader, startedAt: transition?.startedAt || Date.now() };
  if (showLoader) document.documentElement.classList.add('isuka-loader-enabled');
})();
