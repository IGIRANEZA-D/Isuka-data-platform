const prefetchedDashboardPages = new Set();
const dashboardNavigationKey = 'isuka-dashboard-navigation-target';
const dashboardSidebarKey = 'isuka-dashboard-sidebar-collapsed';

const dashboardIcons = {
  'national overview': '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.2"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/>',
  'crops & land': '<path d="M3 18.5V8.5l9-5 9 5v10l-9 5-9-5Z"/><path d="M12 3.5v19M12 7 6 10.5l6 3.5 6-3.5L12 7Z"/>',
  'district risk': '<path d="M12 3v18"/><path d="M5 8.5c2.5-2 4.6-2.7 7-2.7 3.1 0 5.4 1.2 7 2.9M5 15.5c2.5 2 4.6 2.7 7 2.7 3.1 0 5.4-1.2 7-2.9"/>',
  'farm inputs & practices': '<path d="M5 9.5A7 7 0 0 1 19 9.5V17H5V9.5Z"/><path d="M7.5 9.5h9M9 12.5h6M9 15.5h4"/>',
  'district map': '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/><circle cx="12" cy="10" r="1.6"/>',
  forecasts: '<path d="M4 19V5m0 14h16"/><path d="m6 15 4-4 3 2 6-7"/><path d="M15 6h4v4"/>',
  'harvest recovery': '<path d="M12 21s7-3.5 7-9V5l-7-2-7 2v7c0 5.5 7 9 7 9Z"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'
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
  let restoreCollapsedSidebar = document.documentElement.classList.contains('sidebar-collapsed-onload');
  try {
    restoreCollapsedSidebar = restoreCollapsedSidebar || localStorage.getItem(dashboardSidebarKey) === 'true';
  } catch { /* use the expanded default when storage is disabled */ }
  if (restoreCollapsedSidebar) {
    dashboardSidebar.classList.add('sidebar-state-restoring', 'collapsed');
    void dashboardSidebar.offsetWidth;
    document.documentElement.classList.remove('sidebar-collapsed-onload');
    requestAnimationFrame(() => dashboardSidebar.classList.remove('sidebar-state-restoring'));
  }
  updateSidebarState(dashboardSidebar, dashboardSidebarToggle);
  dashboardSidebarToggle.addEventListener('click', () => {
    dashboardSidebar.classList.toggle('collapsed');
    updateSidebarState(dashboardSidebar, dashboardSidebarToggle, true);
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
  const activeLink = document.querySelector('.sidebar-nav .nav-item.active');
  if (activeLink) {
    activeLink.classList.add('is-arriving');
    activeLink.addEventListener('animationend', () => activeLink.classList.remove('is-arriving'), { once: true });
  }
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
