const prefetchedDashboardPages = new Set();
const dashboardNavigationKey = 'isuka-dashboard-navigation-target';

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function playDashboardEntry() {
  let target = null;
  try {
    target = sessionStorage.getItem(dashboardNavigationKey);
    if (target) sessionStorage.removeItem(dashboardNavigationKey);
  } catch { /* storage may be disabled */ }

  if (!target || normalizePath(target) !== normalizePath(window.location.pathname)) return;
  const main = document.querySelector('.dashboard-shell > main');
  if (!main) return;
  main.classList.remove('dashboard-nav-enter');
  void main.offsetWidth;
  main.classList.add('dashboard-nav-enter');
  main.addEventListener('animationend', () => main.classList.remove('dashboard-nav-enter'), { once: true });
}

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
    try {
      sessionStorage.setItem(dashboardNavigationKey, new URL(link.href, window.location.href).pathname);
      if (link.getAttribute('href') === '/dashboard/') sessionStorage.setItem('isuka-internal-dashboard-return', '1');
    } catch { /* navigation still works without storage */ }
    link.setAttribute('aria-busy', 'true');
  });
});

playDashboardEntry();

window.addEventListener('pageshow', () => {
  playDashboardEntry();
  document.querySelectorAll('a[aria-busy="true"]').forEach((link) => link.removeAttribute('aria-busy'));
});
