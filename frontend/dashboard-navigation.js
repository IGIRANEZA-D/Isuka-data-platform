const prefetchedDashboardPages = new Set();
const dashboardNavigationKey = 'isuka-dashboard-navigation-target';
const dashboardSidebarKey = 'isuka-dashboard-sidebar-collapsed';

const dashboardIcons = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.2"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/>',
  'land & crops': '<path d="M4 20h16M6 17V9l6-5 6 5v8"/><path d="M9 17v-4h6v4M12 4v-2"/>',
  'climate & risk': '<path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18Z"/><path d="m9 21 1-2m4 2 1-2"/>',
  'inputs & practices': '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8a3 3 0 0 1 6 0M8 12h8M10 16h4"/>',
  'district explorer': '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/><circle cx="12" cy="10" r="1.6"/>',
  forecasting: '<path d="M4 19V5m0 14h16"/><path d="m6 15 4-4 3 2 6-7"/><path d="M15 6h4v4"/>',
  'loss planner': '<path d="M12 21s7-3.5 7-9V5l-7-2-7 2v7c0 5.5 7 9 7 9Z"/><path d="M12 8v7m-3-3 3 3 3-3"/>'
};

function updateSidebarState(sidebar, toggle, persist = false) {
  const collapsed = sidebar.classList.contains('collapsed');
  toggle?.setAttribute('aria-expanded', String(!collapsed));
  toggle?.setAttribute('aria-label', collapsed ? 'Expand dashboard navigation' : 'Collapse dashboard navigation');
  if (persist) {
    try { localStorage.setItem(dashboardSidebarKey, String(collapsed)); } catch { /* the sidebar still works without storage */ }
  }
}

const dashboardSidebar = document.querySelector('.sidebar');
const dashboardSidebarToggle = document.querySelector('.collapse-toggle');
if (dashboardSidebar && dashboardSidebarToggle) {
  try {
    if (localStorage.getItem(dashboardSidebarKey) === 'true') dashboardSidebar.classList.add('collapsed');
  } catch { /* use the expanded default when storage is disabled */ }
  updateSidebarState(dashboardSidebar, dashboardSidebarToggle);
  document.addEventListener('click', (event) => {
    if (event.target.closest('.collapse-toggle')) updateSidebarState(dashboardSidebar, dashboardSidebarToggle, true);
  });
}

document.querySelectorAll('.sidebar-nav .nav-item').forEach((item) => {
  const label = item.querySelector('.nav-label')?.textContent.trim() || '';
  const icon = item.querySelector('.nav-icon');
  const paths = dashboardIcons[label.toLowerCase()];
  if (icon && paths) {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    icon.setAttribute('aria-hidden', 'true');
  }
  if (label) {
    item.setAttribute('aria-label', label);
    item.setAttribute('title', label);
  }
});

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
