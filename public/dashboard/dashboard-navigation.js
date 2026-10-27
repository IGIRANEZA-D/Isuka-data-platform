const prefetchedDashboardPages = new Set();

function prefetchDashboardPage(link) {
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || prefetchedDashboardPages.has(url.href)) return;
  prefetchedDashboardPages.add(url.href);
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.as = 'document';
  hint.href = url.href;
  document.head.appendChild(hint);
}

document.querySelectorAll('.sidebar-nav a').forEach((link) => {
  link.addEventListener('pointerenter', () => prefetchDashboardPage(link), { passive: true });
  link.addEventListener('focus', () => prefetchDashboardPage(link), { passive: true });
  link.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    document.body.classList.add('is-navigating');
    link.setAttribute('aria-busy', 'true');
    if (link.getAttribute('href') === '/dashboard/') sessionStorage.setItem('isuka-internal-dashboard-return', '1');
  });
});

window.addEventListener('pageshow', () => {
  document.body.classList.remove('is-navigating');
  document.querySelectorAll('a[aria-busy="true"]').forEach((link) => link.removeAttribute('aria-busy'));
});
