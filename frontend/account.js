const ACCOUNT_DRAFT_KEY = 'isukaAccountDraft';
const FARM_RECORDS_KEY = 'isukaFarmRecords';
const ALERTS_KEY = 'isukaAlerts';
const USER_SCOPE_KEY = 'isukaCurrentUserId';

function withQuickUiFeedback(button, pendingText, action) {
  if (!button) return action();
  const previousText = button.textContent;
  const previousDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (pendingText) button.textContent = pendingText;
  const finish = (nextText = previousText, resetDisabled = true) => {
    button.textContent = nextText;
    button.disabled = resetDisabled ? previousDisabled : false;
    button.removeAttribute('aria-busy');
  };
  return Promise.resolve(action()).then((result) => {
    finish();
    return result;
  }).catch((error) => {
    finish(previousText, false);
    throw error;
  });
}

function getCurrentUserScope() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(ACCOUNT_DRAFT_KEY) || '{}');
    if (draft && draft.userId) return String(draft.userId);
  } catch {}
  const currentUserId = sessionStorage.getItem(USER_SCOPE_KEY);
  return currentUserId ? String(currentUserId) : 'guest';
}

function getScopedStorageKey(baseKey) {
  return `${baseKey}:${getCurrentUserScope()}`;
}

function setCurrentUserScope(userId) {
  if (!userId) return;
  sessionStorage.setItem(USER_SCOPE_KEY, String(userId));
  try {
    const draft = JSON.parse(sessionStorage.getItem(ACCOUNT_DRAFT_KEY) || '{}');
    sessionStorage.setItem(ACCOUNT_DRAFT_KEY, JSON.stringify({ ...draft, userId: String(userId) }));
  } catch {
    sessionStorage.setItem(ACCOUNT_DRAFT_KEY, JSON.stringify({ userId: String(userId) }));
  }
}

function clearAccountSession() {
  sessionStorage.removeItem(USER_SCOPE_KEY);
  sessionStorage.removeItem(ACCOUNT_DRAFT_KEY);
  sessionStorage.removeItem(FARM_RECORDS_KEY);
  sessionStorage.removeItem(ALERTS_KEY);
  sessionStorage.removeItem('isukaSidebarCollapsed');
  sessionStorage.removeItem('isukaAssistantChats');
  sessionStorage.removeItem(getScopedStorageKey(ACCOUNT_DRAFT_KEY));
  sessionStorage.removeItem(getScopedStorageKey(FARM_RECORDS_KEY));
  sessionStorage.removeItem(getScopedStorageKey(ALERTS_KEY));
  sessionStorage.removeItem(getScopedStorageKey('isukaSidebarCollapsed'));
  sessionStorage.removeItem(getScopedStorageKey('isukaAssistantChats'));
  localStorage.removeItem(FARM_RECORDS_KEY);
  localStorage.removeItem(getScopedStorageKey(FARM_RECORDS_KEY));
}

function readFarmRecords() {
  try {
    const scopedValue = sessionStorage.getItem(getScopedStorageKey(FARM_RECORDS_KEY));
    if (scopedValue) {
      const parsed = JSON.parse(scopedValue);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  try {
    const legacyValue = localStorage.getItem(FARM_RECORDS_KEY) || localStorage.getItem(getScopedStorageKey(FARM_RECORDS_KEY));
    if (!legacyValue) return [];
    const parsed = JSON.parse(legacyValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFarmRecords(records) {
  const normalized = Array.isArray(records) ? records : [];
  const key = getScopedStorageKey(FARM_RECORDS_KEY);
  sessionStorage.setItem(key, JSON.stringify(normalized));
  localStorage.setItem(key, JSON.stringify(normalized));
}

function createFarmId(prefix = 'record') {
  const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function formatFarmDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

async function saveFarmRecordRemote(record, existingId) {
  const payload = { data: record, recordType: record.recordType };
  const isUpdate = Boolean(existingId && record.id && record.id === existingId);
  const endpoint = isUpdate ? `/api/farm/records/${encodeURIComponent(record.id)}` : '/api/farm/records';
  const response = await fetch(endpoint, {
    method: isUpdate ? 'PATCH' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...payload, ...(isUpdate ? { version: Number(record.version || 1) } : {}) })
  });
  const result = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(result.error || 'Farm record could not be saved.');
  }
  return result;
}

async function deleteFarmRecordRemote(id) {
  const response = await fetch(`/api/farm/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  const result = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(result.error || 'Farm record could not be deleted.');
  }
  return result;
}

function buildFarmAlerts(records) {
  const items = Array.isArray(records) ? records : [];
  return items.filter((record) => !record.archived).slice(0, 4).map((record) => ({
    id: String(record.id || createFarmId('alert')),
    title: record.recordType === 'crop' ? `${record.cropName || 'Crop'} update` : `${record.name || record.species || 'Livestock'} check`,
    description: record.recordType === 'crop'
      ? `Field status: ${record.stage || 'active'}. ${record.expectedYield ? `Expected yield ${record.expectedYield}.` : 'Track the next harvest window.'}`
      : `Health status: ${record.status || 'active'}. ${record.nextVaccinationDate ? `Next vaccination ${record.nextVaccinationDate}.` : 'Keep monitoring this animal.'}`,
    location: record.plotName || record.name || 'Your farm',
    type: record.recordType === 'crop' ? 'crop' : 'livestock',
    priority: record.status === 'sick' || record.stage === 'failed' ? 'high' : 'moderate',
    time: 'Recently',
    read: false
  }));
}

function setAccountSyncStatus(message, state = '') { const status = document.querySelector('[data-sync-status]'); if (status) { status.textContent = message; status.dataset.state = state; } }
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="/account/"]');
  if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && link.target !== '_blank') {
    document.body.classList.add('is-navigating');
    link.setAttribute('aria-busy', 'true');
  }
});

function showAccountLoader(label = 'Loading Isuka', destination) {
  if (!destination) return;
  window.location.replace(destination);
}

// Temporary client-side handoff until real authentication and profile storage exist.
function readAccountDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem(getScopedStorageKey(ACCOUNT_DRAFT_KEY)) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeAccountDraft(nextDraft) {
  const scopeKey = getScopedStorageKey(ACCOUNT_DRAFT_KEY);
  sessionStorage.setItem(scopeKey, JSON.stringify({ ...readAccountDraft(), ...nextDraft }));
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function accountServiceMessage(error, fallback) {
  const message = String(error?.message || '');
  if (/failed to fetch|networkerror|load failed|temporarily unavailable|database|mongodb/i.test(message)) return fallback;
  return message || fallback;
}

function setupPasswordToggle() {
  const toggles = document.querySelectorAll('[data-password-toggle]');
  if (!toggles.length) return;
  toggles.forEach((toggle) => {
    const wrapper = toggle.closest('.account-password');
    const input = wrapper?.querySelector('input[data-password]') || document.querySelector('input[data-password]');
    if (!input) return;
    toggle.addEventListener('click', () => {
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
      toggle.setAttribute('aria-pressed', String(!isVisible));
      toggle.closest('.account-password')?.querySelector('input')?.focus();
    });
  });
}

function setupAccountNavigationIcons() {
  const settingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>';
  document.querySelectorAll('.farmer-nav a[href="/account/settings"] .nav-icon').forEach((icon) => { icon.innerHTML = settingsIcon; });
}

function setupUnreadAlertBadge() {
  const alertLinks = document.querySelectorAll('.farmer-nav a[href="/account/alerts"]');
  if (!alertLinks.length) return;
  const badge = document.createElement('span');
  badge.className = 'account-alert-badge';
  badge.setAttribute('aria-label', 'Unread alerts');
  badge.hidden = true;
  alertLinks.forEach((link) => { if (!link.querySelector('.account-alert-badge')) link.appendChild(badge.cloneNode(true)); });
  const render = (count) => document.querySelectorAll('.account-alert-badge').forEach((item) => { item.textContent = count > 99 ? '99+' : String(count); item.hidden = count < 1; });
  const refresh = () => fetch('/api/farm/alerts/unread-count', { credentials: 'include', cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Unread alert count unavailable.'))).then((result) => render(Number(result.count) || 0)).catch(() => render(0));
  window.addEventListener('alerts-updated', refresh);
  refresh();
}

function setupAlertDeletion() {
  const button = document.querySelector('[data-delete-alerts]');
  if (!button) return;
  button.addEventListener('click', async () => {
    if (!window.confirm('Delete the current farm alerts?')) return;
    try {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const response = await fetch('/api/farm/alerts', { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Could not delete alerts.');
      sessionStorage.removeItem(getScopedStorageKey(ALERTS_KEY));
      window.dispatchEvent(new Event('alerts-updated'));
      const list = document.querySelector('[data-alert-list]');
      if (list) {
        list.innerHTML = '<div class="alerts-empty"><span aria-hidden="true">✓</span><h2>No alerts yet</h2><p>Important updates for your district and farm will appear here.</p></div>';
      }
    } catch {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      setAccountSyncStatus('Alerts could not be deleted.', 'offline');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}

function setupAlerts() {
  const list = document.querySelector('[data-alert-list]');
  if (!list) return;
  const search = document.querySelector('[data-alert-search]');
  const filterMenu = document.querySelector('[data-filter-menu]');
  const storedAlerts = JSON.parse(sessionStorage.getItem(getScopedStorageKey(ALERTS_KEY)) || '[]');
  const farmAlerts = buildFarmAlerts(readFarmRecords());
  let alerts = [...farmAlerts, ...storedAlerts.filter((alert) => !farmAlerts.some((farmAlert) => farmAlert.id === alert.id))];
  let activeTab = 'all';
  let activeFilter = 'all';
  const save = () => sessionStorage.setItem(getScopedStorageKey(ALERTS_KEY), JSON.stringify(alerts));
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const render = () => {
    const query = (search?.value || '').trim().toLowerCase();
    const unread = alerts.filter((alert) => !alert.read);
    document.querySelector('[data-all-count]').textContent = `(${alerts.length})`;
    document.querySelector('[data-unread-count]').textContent = `(${unread.length})`;
    const visible = alerts.filter((alert) => {
      const matchesTab = activeTab === 'all' || (activeTab === 'unread' && !alert.read) || (activeTab === 'high' && alert.priority === 'high');
      const matchesFilter = activeFilter === 'all' || alert.type === activeFilter;
      const matchesSearch = !query || `${alert.title} ${alert.description} ${alert.location} ${alert.type}`.toLowerCase().includes(query);
      return matchesTab && matchesFilter && matchesSearch;
    });
    if (!visible.length) { list.innerHTML = `<div class="alerts-empty"><span aria-hidden="true">✓</span><h2>${alerts.length ? 'No matching alerts' : 'No alerts yet'}</h2><p>${alerts.length ? 'Try another search or filter.' : 'Important updates for your district and farm will appear here.'}</p></div>`; return; }
    list.innerHTML = visible.map((alert) => `<article class="alert-item ${alert.read ? 'is-read' : ''}" role="button" tabindex="0" data-alert-id="${escapeHtml(alert.id)}"><span class="alert-severity ${escapeHtml(alert.priority || 'low')}"></span><span class="alert-copy"><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.description)}</small><em>⌖ ${escapeHtml(alert.location || 'Your district')} <b>${escapeHtml(alert.type || 'System')}</b></em></span><time>${escapeHtml(alert.time || 'Recently')}</time><span class="alert-chevron" aria-hidden="true">›</span><button class="alert-delete" type="button" data-alert-delete="${escapeHtml(alert.id)}" aria-label="Delete ${escapeHtml(alert.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></article>`).join('');
    list.querySelectorAll('[data-alert-id]').forEach((row) => {
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
      row.querySelector('[data-alert-delete]').addEventListener('click', async (event) => {
        event.stopPropagation();
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const response = await fetch(`/api/farm/alerts/${encodeURIComponent(row.dataset.alertId)}`, { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } });
          if (!response.ok) { let detail = ''; try { detail = (await response.json()).error || ''; } catch {} throw new Error(detail || 'Alert could not be deleted.'); }
          alerts = alerts.filter((alert) => alert.id !== row.dataset.alertId);
          save();
          render();
          window.dispatchEvent(new Event('alerts-updated'));
        } catch (error) {
          button.disabled = false;
          setAccountSyncStatus(error.message, 'offline');
        }
      });
      row.addEventListener('click', async () => { const item = alerts.find((alert) => alert.id === row.dataset.alertId); if (!item || item.read) return; try { const response = await fetch('/api/farm/alerts/read', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id: item.id }) }); if (!response.ok) { let detail = ''; try { detail = (await response.json()).error || ''; } catch {} throw new Error(detail || 'Alert read status could not be saved.'); } item.read = true; save(); render(); window.dispatchEvent(new Event('alerts-updated')); } catch (error) { setAccountSyncStatus(error.message, 'offline'); } });
    });
  };
  document.querySelectorAll('[data-alert-tab]').forEach((tab) => tab.addEventListener('click', () => { activeTab = tab.dataset.alertTab; document.querySelectorAll('[data-alert-tab]').forEach((item) => { item.classList.toggle('is-active', item === tab); item.setAttribute('aria-selected', String(item === tab)); }); render(); }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { activeFilter = button.dataset.filter; filterMenu.hidden = true; document.querySelector('[data-filter-toggle]').setAttribute('aria-expanded', 'false'); render(); }));
  document.querySelector('[data-filter-toggle]').addEventListener('click', (event) => { const open = filterMenu.hidden; filterMenu.hidden = !open; event.currentTarget.setAttribute('aria-expanded', String(open)); });
  const markReadButton = document.querySelector('[data-mark-read]');
  markReadButton?.addEventListener('click', async () => { try { markReadButton.disabled = true; markReadButton.setAttribute('aria-busy', 'true'); const response = await fetch('/api/farm/alerts/read', { method: 'PATCH', credentials: 'include', headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(); alerts = alerts.map((alert) => ({ ...alert, read: true })); save(); render(); window.dispatchEvent(new Event('alerts-updated')); } catch (error) { setAccountSyncStatus(error.message || 'Alert status could not be saved.', 'offline'); } finally { markReadButton.disabled = false; markReadButton.removeAttribute('aria-busy'); } });
  search?.addEventListener('input', render);
  render();
  fetch('/api/farm/reminders', { credentials: 'include', cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Reminders unavailable.'))).then((remoteAlerts) => { const savedReadState = new Map(alerts.map((alert) => [alert.id, Boolean(alert.read)])); alerts = remoteAlerts.map((alert) => ({ ...alert, description: alert.description || alert.message || alert.recommendation || 'Review this farm notice.', type: alert.type || 'system', location: alert.location || 'Your farm', read: savedReadState.get(alert.id) || Boolean(alert.read) })); save(); render(); }).catch(() => { setAccountSyncStatus('Alerts could not be loaded.', 'offline'); });
}

function setupSettings() {
  const form = document.querySelector('[data-settings-form]');
  if (!form) return;
  setupPasswordToggle();
  fetch('/api/auth/me', { credentials: 'include' }).then(async (response) => {
    if (!response.ok) throw new Error('Authentication required.');
    const user = (await response.json()).user;
    const profile = user.profile || {};
    form.fullName.value = [user.firstName || profile.firstName, user.lastName || profile.lastName].filter(Boolean).join(' ') || 'Not set';
    form.district.value = user.district || profile.district || 'Not set';
    form.phone.value = user.phone || 'Not set';
    if (typeof profile.smsAlerts === 'boolean') form.alerts.checked = profile.smsAlerts;
  }).catch(() => { setAccountSyncStatus('Account details could not be loaded.', 'offline'); });
  form.addEventListener('submit', async (event) => { event.preventDefault(); const submitButton = form.querySelector('[type="submit"]'); const status = document.querySelector('[data-settings-status]'); if (submitButton?.disabled) return; if (submitButton) { submitButton.disabled = true; submitButton.setAttribute('aria-busy', 'true'); } status.textContent = 'Saving...'; try { const response = await fetch('/api/auth/profile', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { smsAlerts: form.alerts.checked } }) }); if (!response.ok) throw new Error('Could not save alert preferences.'); writeAccountDraft({ setup: { ...readAccountDraft().setup, smsAlerts: form.alerts.checked } }); setAccountSyncStatus('Data connected', 'connected'); status.textContent = 'Changes saved to your account.'; } catch { setAccountSyncStatus('Account settings could not be saved.', 'offline'); status.textContent = 'Could not save changes. Please try again.'; } finally { if (submitButton) { submitButton.disabled = false; submitButton.removeAttribute('aria-busy'); } window.setTimeout(() => { status.textContent = ''; }, 3500); } });
  const passwordPanel = document.querySelector('[data-change-password-panel]');
  document.querySelector('[data-change-password]').addEventListener('click', () => { passwordPanel.hidden = !passwordPanel.hidden; if (!passwordPanel.hidden) passwordPanel.querySelector('input').focus(); });
  document.querySelector('[data-close-password]').addEventListener('click', () => { passwordPanel.hidden = true; });
  document.querySelector('[data-submit-change-password]').addEventListener('click', async (event) => { const button = event.currentTarget; const passwordPanel = document.querySelector('[data-change-password-form]'); const currentPassword = passwordPanel.querySelector('[name="currentPassword"]').value; const newPassword = passwordPanel.querySelector('[name="newPassword"]').value; const confirmPassword = passwordPanel.querySelector('[name="confirmPassword"]').value; const note = document.querySelector('[data-password-note]'); note.classList.remove('is-success'); if (!currentPassword || !newPassword || !confirmPassword) { note.textContent = 'Complete all password fields to continue.'; return; } if (newPassword !== confirmPassword) { note.textContent = 'New passwords do not match.'; return; } if (currentPassword === newPassword) { note.textContent = 'New password must be different from your current password.'; return; } button.disabled = true; button.classList.add('is-saving'); button.textContent = 'Saving...'; note.textContent = ''; try { const response = await fetch('/api/auth/password', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) }); const result = await readJsonResponse(response); note.textContent = response.ok ? 'Password changed successfully. Please log in again.' : (result.error || 'Could not change password.'); note.classList.toggle('is-success', response.ok); if (response.ok) passwordPanel.querySelectorAll('input').forEach((input) => { input.value = ''; }); } catch { note.textContent = 'Could not reach the account service. Try again.'; } finally { button.disabled = false; button.classList.remove('is-saving'); button.textContent = 'Save new password'; } });
  const deletePanel = document.querySelector('[data-delete-account-panel]');
  document.querySelector('[data-delete-account]').addEventListener('click', () => { deletePanel.hidden = !deletePanel.hidden; });
  document.querySelector('[data-cancel-delete]').addEventListener('click', () => { deletePanel.hidden = true; });
  document.querySelector('[data-confirm-delete]').addEventListener('click', async (event) => { const button = event.currentTarget; const note = document.querySelector('[data-delete-account-note]'); button.disabled = true; button.textContent = 'Deleting...'; try { const response = await fetch('/api/auth/account', { method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' } }); const result = await readJsonResponse(response); if (!response.ok) { button.disabled = false; button.textContent = 'Delete permanently'; note.textContent = result.requestId ? `${result.error || 'Could not delete your account.'} Reference: ${result.requestId}` : (result.error || 'Could not delete your account.'); return; } clearAccountSession(); window.location.replace('/account/signup'); } catch { button.disabled = false; button.textContent = 'Delete permanently'; note.textContent = 'Could not reach the account service. Try again.'; } });
  document.querySelector('[data-settings-logout]').addEventListener('click', () => { fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => { clearAccountSession(); window.location.href = '/'; }); });
}

function setupPasswordRecovery() {
  const trigger = document.querySelector('[data-forgot-password]');
  const panel = document.querySelector('[data-recovery-panel]');
  const form = document.querySelector('[data-recovery-form]');
  if (!trigger || !panel || !form) return;
  const note = panel.querySelector('.recovery-note');
  const resetPanel = panel.querySelector('[data-reset-token-panel]');
  const codeField = resetPanel.querySelector('[data-reset-code-field]');
  let activeToken = '';
  const clearTokenFromUrl = () => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  const tokenFromUrl = new URLSearchParams(window.location.hash.slice(1)).get('resetToken');
  if (tokenFromUrl && /^[A-Za-z0-9_-]{40,60}$/.test(tokenFromUrl)) {
    activeToken = tokenFromUrl;
    panel.hidden = false;
    form.hidden = true;
    resetPanel.hidden = false;
    codeField.hidden = true;
    note.textContent = 'Choose a new password for your account.';
    resetPanel.querySelector('[name="recoveryPassword"]').focus();
  }
  trigger.addEventListener('click', () => { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); form.querySelector('input').focus(); });
  document.querySelector('[data-recovery-close]').addEventListener('click', () => {
    panel.hidden = true;
    activeToken = '';
    form.hidden = false;
    resetPanel.hidden = true;
    codeField.hidden = false;
    if (tokenFromUrl) clearTokenFromUrl();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    note.textContent = '';
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: form.recoveryIdentity.value.trim() })
      });
      if (response.ok) {
        form.hidden = true;
        resetPanel.hidden = false;
        codeField.hidden = false;
        note.textContent = 'If an account matches that information, a reset link and code will arrive shortly.';
        codeField.querySelector('input').focus();
      } else {
        note.textContent = 'Recovery service is unavailable. Please try again later.';
      }
    } catch {
      note.textContent = 'Recovery service is unavailable. Please try again later.';
    } finally {
      button.disabled = false;
    }
  });
  resetPanel.querySelector('[data-complete-password-reset]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const password = resetPanel.querySelector('[name="recoveryPassword"]').value;
    const confirmation = resetPanel.querySelector('[name="recoveryPasswordConfirm"]').value;
    const code = resetPanel.querySelector('[name="recoveryCode"]').value.trim();
    if (password.length < 8 || password.length > 128) {
      note.textContent = 'Password must be between 8 and 128 characters.';
      return;
    }
    if (password !== confirmation) {
      note.textContent = 'The new password and confirmation do not match.';
      return;
    }
    if (!activeToken && !/^\d{6}$/.test(code)) {
      note.textContent = 'Enter the 6-digit verification code from your email.';
      return;
    }
    button.disabled = true;
    note.textContent = '';
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeToken
          ? { token: activeToken, password, passwordConfirm: confirmation }
          : { identity: form.recoveryIdentity.value.trim(), code, password, passwordConfirm: confirmation })
      });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || 'This reset link is invalid or expired.');
      activeToken = '';
      resetPanel.hidden = true;
      form.hidden = false;
      codeField.hidden = false;
      resetPanel.querySelector('[name="recoveryCode"]').value = '';
      resetPanel.querySelector('[name="recoveryPassword"]').value = '';
      resetPanel.querySelector('[name="recoveryPasswordConfirm"]').value = '';
      note.textContent = 'Password reset complete. You can now sign in.';
      clearTokenFromUrl();
    } catch (error) {
      note.textContent = error.message || 'Could not reset your password. Request a new link and try again.';
    } finally {
      button.disabled = false;
    }
  });
}

document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
  event.preventDefault();
  clearAccountSession();
  localStorage.removeItem(getScopedStorageKey(FARM_RECORDS_KEY));
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  window.location.href = '/';
});

function setupDistrictPicker() {
  const picker = document.querySelector('.district-picker');
  if (!picker) return;
  const search = picker.querySelector('#district-search');
  const value = picker.querySelector('#district');
  const options = [...picker.querySelectorAll('[data-district]')];
  const list = picker.querySelector('.district-options');
  options.sort((left, right) => left.dataset.district.localeCompare(right.dataset.district)).forEach((option) => list.appendChild(option));
  const setOpen = (open) => { list.hidden = !open; search.setAttribute('aria-expanded', String(open)); };
  const filterOptions = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    options.forEach((option) => {
      const matches = option.dataset.district.toLowerCase().includes(query);
      option.hidden = !matches;
      if (matches) visible += 1;
    });
    const shouldOpen = query.length === 0 || visible > 0;
    setOpen(shouldOpen);
    if (!visible && query.length > 0) setOpen(false);
  };
  search.addEventListener('focus', () => { search.select(); filterOptions(); });
  search.addEventListener('click', () => { filterOptions(); });
  setOpen(false);
  search.addEventListener('input', () => {
    const typed = search.value.trim();
    const exactMatch = options.find((option) => option.dataset.district.toLowerCase() === typed.toLowerCase());
    if (value) value.value = exactMatch ? exactMatch.dataset.district : typed;
    filterOptions();
  });
  search.addEventListener('keydown', (event) => { if (event.key === 'Escape') { setOpen(false); search.blur(); } });
  options.forEach((option) => option.addEventListener('click', () => {
    value.value = option.dataset.district;
    search.value = option.dataset.district;
    setOpen(false);
  }));
  document.addEventListener('click', (event) => { if (!picker.contains(event.target)) setOpen(false); });
}

function setupSidebarToggle() {
  const shell = document.querySelector('.farmer-shell');
  const toggle = document.querySelector('[data-sidebar-toggle]');
  if (!shell || !toggle) return;

  const applyState = (collapsed) => {
    shell.classList.toggle('farmer-shell-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    toggle.textContent = collapsed ? '›' : '‹';
  };

  toggle.addEventListener('click', () => {
    const collapsed = shell.classList.contains('farmer-shell-collapsed');
    applyState(!collapsed);
  });

  applyState(false);
}

function setupAccountForm() {
  const form = document.querySelector('.account-form');
  const status = document.querySelector('.account-status');
  const loginButton = form?.querySelector('[data-login-submit]');
  if (!form || document.body.classList.contains('account-flow')) return;
  setupPasswordToggle();
  setupDistrictPicker();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelectorAll('.field-error').forEach((item) => { item.textContent = ''; });
    if (status) status.classList.remove('is-visible');
    let valid = true;
    form.querySelectorAll('[required]').forEach((field) => {
      if (field.type === 'checkbox' ? !field.checked : !field.value.trim()) {
        const error = field.closest('.account-field, .account-check')?.querySelector('.field-error');
        if (error) error.textContent = field.type === 'checkbox' ? 'Please accept the terms to continue.' : 'This field is required.';
        valid = false;
      }
    });
    const phone = form.querySelector('[name="phone"]');
    if (phone?.value && !/^[+\d][\d\s().-]{7,}$/.test(phone.value.trim())) {
      const phoneError = phone.closest('.account-field')?.querySelector('.field-error');
      if (phoneError) phoneError.textContent = 'Enter a valid phone number.';
      valid = false;
    }
    const password = form.querySelector('[name="password"]');
    if (password?.value && password.value.length < 8) {
      const passwordError = password.closest('.account-field')?.querySelector('.field-error');
      if (passwordError) passwordError.textContent = 'Use at least 8 characters.';
      valid = false;
    }
    if (!valid) return;
    if (document.body.classList.contains('account-login')) {
      if (loginButton) {
        loginButton.disabled = true;
        loginButton.classList.add('is-loading');
        loginButton.textContent = 'Signing in...';
      }
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: form.identity.value.trim(), password: form.password.value })
        });
        const result = await readJsonResponse(response);
        if (!response.ok) throw new Error(result.error || 'Login failed.');
        if (result.user?.id) setCurrentUserScope(result.user.id);
        window.location.replace('/account/dashboard');
      } catch (error) {
        if (loginButton) {
          loginButton.disabled = false;
          loginButton.classList.remove('is-loading');
          loginButton.textContent = 'Log in';
        }
        if (status) {
          status.textContent = accountServiceMessage(error, 'We could not sign you in right now. Please try again shortly.');
          status.classList.add('is-visible');
        }
      }
      return;
    }
    if (document.body.classList.contains('account-signup')) {
      const submitButton = form.querySelector('.account-submit');
      if (submitButton) { submitButton.disabled = true; submitButton.classList.add('is-loading'); submitButton.textContent = 'Creating account...'; }
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.value.trim(),
            phone: form.phone.value.trim(),
            password: form.password.value,
            profile: { firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim() }
          })
        });
        const result = await readJsonResponse(response);
        if (!response.ok) throw new Error(result.error || 'Account creation failed.');
        if (result.user?.id) setCurrentUserScope(result.user.id);
        writeAccountDraft({ signup: { firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(), phone: form.phone.value.trim() } });
        window.location.replace('/account/setup');
      } catch (error) {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove('is-loading');
          submitButton.textContent = 'Create account';
        }
        if (status) {
          status.textContent = error.message.includes('Too many requests')
            ? 'Please wait a moment and try again.'
            : accountServiceMessage(error, 'We could not create your account right now. Please try again shortly.');
          status.classList.add('is-visible');
        }
      }
      return;
    }
    if (status) {
      status.textContent = 'Account services are not connected yet. Your details were not submitted.';
      status.classList.add('is-visible');
    }
  });
}

function setupProfileFlow() {
  const form = document.querySelector('.setup-form');
  if (!form) return;
  setupDistrictPicker();
  const submitButton = form.querySelector('[type="submit"]');
  const districtInput = form.querySelector('[name="district"]');
  const districtError = form.querySelector('[data-error="district"]');
  const saveDraft = () => writeAccountDraft({ setup: { ...(readAccountDraft().setup || {}) } });

  const goToDashboard = async () => {
    const district = (districtInput?.value || '').trim();
    if (!district) {
      if (districtError) districtError.textContent = 'Enter your district.';
      return;
    }
    const profile = { district };
    try {
      if (submitButton) { submitButton.disabled = true; submitButton.classList.add('is-loading'); submitButton.textContent = 'Saving...'; }
      const response = await fetch('/api/auth/profile', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not save your profile.');
      saveDraft();
      window.location.href = '/account/dashboard';
    } catch (error) {
      if (submitButton) { submitButton.disabled = false; submitButton.classList.remove('is-loading'); submitButton.textContent = 'Finish setup'; }
      if (districtError) districtError.textContent = error.message;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (districtError) districtError.textContent = '';
    const district = (districtInput?.value || '').trim();
    if (!district) {
      if (districtError) districtError.textContent = 'Enter your district.';
      return;
    }
    goToDashboard();
  });
}

function renderAccountPlaceholder() {
  const dashboard = document.querySelector('[data-first-name]');
  if (dashboard) {
    renderFarmerDashboard();
    return;
  }
  const farmList = document.querySelector('[data-inventory-list]');
  if (farmList) {
    renderFarmList(farmList);
    return;
  }
  const message = document.querySelector('[data-dashboard-message]');
  const summary = document.querySelector('[data-profile-summary]');
  if (!message || !summary) return;
  const draft = readAccountDraft();
  const setup = draft.setup || {};
  message.textContent = 'Your profile details have been saved for this session.';
  const details = [draft.signup?.firstName && `Name: ${draft.signup.firstName} ${draft.signup.lastName}`, draft.signup?.district && `District: ${draft.signup.district}`].filter(Boolean);
  summary.innerHTML = details.length ? `<h2>Session summary</h2><ul>${details.map((detail) => `<li>${detail}</li>`).join('')}</ul>` : '<p>No profile details captured yet.</p>';
}

function renderFarmList(container) {
  const signup = readAccountDraft().signup || {};
  const userLabel = document.querySelector('[data-user-name]');
  if (userLabel) userLabel.textContent = `${signup.firstName || 'Farmer'}${signup.district ? ` · ${signup.district}` : ''}`;
  const offlineRecords = [];
  let records = [];
  let recordsReady = false;
  const deletedRecordIds = new Set();
  const locallyChangedRecords = new Map();
  const pendingRecordActions = new Set();
  let activeTab = 'crops';
  let showArchived = false;
  let editingId = null;
  let selectedPhoto = '';
  const search = document.querySelector('[data-inventory-search]');
  const tabs = [...document.querySelectorAll('[data-inventory-tab]')];
  const registerLabel = document.querySelector('[data-register-label]');
  const addPanel = document.querySelector('[data-add-panel]');
  const addForm = addPanel?.closest('form');
  const addTitle = addPanel?.querySelector('[data-add-title]');
  const livestockFields = addPanel?.querySelector('[data-livestock-fields]');
  const individualFields = addPanel?.querySelector('[data-individual-fields]');
  const cropFields = addPanel?.querySelector('[data-crop-fields]');
  const cropOutcomeFields = addPanel?.querySelector('[data-crop-outcome-fields]');
  const typeField = addPanel?.querySelector('[name="livestockType"]');
  const statusField = addPanel?.querySelector('[name="status"]');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const loadRemoteRecords = () => fetch('/api/farm/records', { credentials: 'include', cache: 'no-store' }).then((response) => {
    if (response.status === 401) {
      window.location.replace('/account/login');
      throw new Error('Your session expired. Please log in again.');
    }
    return response.ok ? response.json() : Promise.reject(new Error('Farm records unavailable.'));
  }).then((remoteRecords) => {
    const remoteIds = new Set(remoteRecords.map((record) => record.id));
    const changedRecords = [...locallyChangedRecords.values()];
    records = remoteRecords
      .filter((record) => !deletedRecordIds.has(record.id))
      .map((record) => locallyChangedRecords.get(record.id) || record)
      .concat(changedRecords.filter((record) => !remoteIds.has(record.id) && !deletedRecordIds.has(record.id)));
    recordsReady = true;
    saveFarmRecords(records);
    setAccountSyncStatus('Data connected', 'connected');
    render();
  }).catch(() => {
    records = offlineRecords;
    recordsReady = true;
    setAccountSyncStatus('Reconnect to manage saved farm records.', 'offline');
    render();
  });
  const activeRecords = () => records.filter((record) => record.recordType === activeTab.slice(0, -1) || (activeTab === 'livestock' && ['animal', 'group'].includes(record.recordType))).filter((record) => Boolean(record.archived) === showArchived);
  const resetForm = () => { addForm?.reset(); editingId = null; if (addTitle) addTitle.textContent = activeTab === 'crops' ? 'Add a crop record' : 'Add livestock'; if (addForm) addForm.querySelector('[name="recordType"]').value = activeTab === 'crops' ? 'crop' : 'animal'; updateFields(); };
  const updateFields = () => {
    const isCrop = activeTab === 'crops';
    const isIndividual = typeField?.value === 'Cattle' || typeField?.value === 'Goats';
    if (cropFields) cropFields.hidden = !isCrop;
    if (livestockFields) livestockFields.hidden = isCrop;
    if (individualFields) individualFields.hidden = isCrop || !isIndividual;
    if (cropOutcomeFields) cropOutcomeFields.hidden = !isCrop || !['harvested', 'failed'].includes(addForm?.stage?.value);
    const isPregnant = !isCrop && isIndividual && statusField?.value === 'pregnant';
    const pregnancyField = addPanel?.querySelector('[data-pregnancy-field]');
    const offspringField = addPanel?.querySelector('[data-offspring-field]');
    if (pregnancyField) pregnancyField.hidden = !isPregnant;
    if (offspringField) offspringField.hidden = isCrop || !isIndividual || statusField?.value !== 'active';
    if (addTitle && !editingId) addTitle.textContent = isCrop ? 'Add a crop record' : isIndividual ? 'Add an animal' : 'Add livestock group';
  };
  const render = () => {
    if (!recordsReady) {
      container.innerHTML = '<p class="inventory-empty">Loading farm records...</p>';
      return;
    }
    const query = (search?.value || '').trim().toLowerCase();
    const filtered = activeRecords().filter((record) => JSON.stringify(record).toLowerCase().includes(query));
    const archiveToggle = document.querySelector('[data-inventory-archive-toggle]');
    if (archiveToggle) archiveToggle.textContent = showArchived ? 'Show active' : 'Show archived';
    if (registerLabel) registerLabel.textContent = showArchived ? 'Show active records' : activeTab === 'crops' ? 'Register another crop' : 'Register livestock';
    if (!filtered.length) { container.innerHTML = `<p class="inventory-empty">No ${showArchived ? 'archived ' : ''}${activeTab} records found.</p>`; return; }
    container.innerHTML = filtered.map((record) => {
      const isCrop = record.recordType === 'crop';
      const name = isCrop ? (record.cropName || 'Untitled crop') : (record.name || record.species || 'Livestock');
      const detail = isCrop ? [record.plotName, record.stage].filter(Boolean).join(' · ') || 'Crop record' : record.recordType === 'group' ? `${record.count || 'No'} recorded` : [record.species, record.sex, record.status].filter(Boolean).join(' · ');
      const dates = isCrop ? record.expectedHarvestDate ? `Harvest ${formatFarmDate(record.expectedHarvestDate)}` : 'Harvest date not set' : record.expectedBirthDate ? `Birth expected ${formatFarmDate(record.expectedBirthDate)}` : record.dateOfBirth ? `Born ${formatFarmDate(record.dateOfBirth)}` : 'Dates not set';
      const photo = !isCrop ? record.photo : '';
      return `<article class="inventory-row" data-record-id="${escapeHtml(record.id)}"><div class="inventory-description"><span class="inventory-thumb ${photo ? 'has-photo' : ''}" ${photo ? `style="background-image:url('${escapeHtml(photo)}')"` : 'aria-hidden="true"'}>${photo ? '' : activeTab === 'crops' ? '✣' : '♧'}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></span></div><div class="inventory-metric"><span><small>STATUS</small><strong>${escapeHtml(record.archived ? 'ARCHIVED' : record.stage || record.status || 'TRACKED')}</strong></span><span><small>UPCOMING</small><strong>${escapeHtml(dates)}</strong></span></div><div class="inventory-actions"><button type="button" data-edit-record="${escapeHtml(record.id)}">Edit</button><button type="button" data-archive-record="${escapeHtml(record.id)}">${record.archived ? 'Restore' : 'Archive'}</button><button type="button" data-delete-record="${escapeHtml(record.id)}" aria-label="Delete ${escapeHtml(name)}">Delete</button></div></article>`;
    }).join('');
  };
  const openForm = (record = null) => {
    addPanel.hidden = false;
    editingId = record?.id || null;
    selectedPhoto = record?.photo || '';
    if (record) {
      activeTab = record.recordType === 'crop' ? 'crops' : 'livestock';
      addForm.querySelector('[name="recordType"]').value = record.recordType;
      addForm.querySelector('[name="cropName"]').value = record.cropName || '';
      addForm.querySelector('[name="variety"]').value = record.variety || '';
      addForm.querySelector('[name="plotName"]').value = record.plotName || '';
      addForm.querySelector('[name="area"]').value = record.area || '';
      addForm.querySelector('[name="plantingDate"]').value = record.plantingDate || '';
      addForm.querySelector('[name="expectedHarvestDate"]').value = record.expectedHarvestDate || '';
      addForm.querySelector('[name="stage"]').value = record.stage || 'planned';
      addForm.querySelector('[name="expectedYield"]').value = record.expectedYield || '';
      addForm.querySelector('[name="harvestQuantity"]').value = record.harvestQuantity || '';
      addForm.querySelector('[name="harvestQuality"]').value = record.harvestQuality || '';
      addForm.querySelector('[name="lossQuantity"]').value = record.lossQuantity || '';
      addForm.querySelector('[name="lossReason"]').value = record.lossReason || '';
      addForm.querySelector('[name="livestockType"]').value = record.species || 'Cattle';
      addForm.querySelector('[name="animalName"]').value = record.name || '';
      addForm.querySelector('[name="count"]').value = record.count || '';
      addForm.querySelector('[name="tagNumber"]').value = record.tagNumber || '';
      addForm.querySelector('[name="dateOfBirth"]').value = record.dateOfBirth || '';
      addForm.querySelector('[name="sex"]').value = record.sex || '';
      addForm.querySelector('[name="status"]').value = record.status || 'active';
      addForm.querySelector('[name="expectedBirthDate"]').value = record.expectedBirthDate || '';
      addForm.querySelector('[name="nextVaccinationDate"]').value = record.nextVaccinationDate || '';
      addForm.querySelector('[name="offspringCount"]').value = record.offspringCount || '';
      addForm.querySelector('[name="notes"]').value = record.notes || '';
      if (addTitle) addTitle.textContent = 'Edit farm record';
    } else resetForm();
    updateFields();
    addPanel.querySelector('[name="cropName"]').focus();
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => { activeTab = tab.dataset.inventoryTab; showArchived = false; tabs.forEach((item) => { item.classList.toggle('is-active', item === tab); item.setAttribute('aria-selected', String(item === tab)); }); resetForm(); render(); }));
  search?.addEventListener('input', render);
  document.querySelector('[data-inventory-archive-toggle]')?.addEventListener('click', (event) => { showArchived = !showArchived; event.currentTarget.textContent = showArchived ? 'Show active' : 'Show archived'; render(); });
  document.querySelectorAll('[data-add-item]').forEach((button) => button.addEventListener('click', () => openForm()));
  document.querySelector('[data-cancel-add]')?.addEventListener('click', () => { addPanel.hidden = true; resetForm(); });
  typeField?.addEventListener('change', updateFields);
  addForm?.querySelector('[name="stage"]')?.addEventListener('change', updateFields);
  statusField?.addEventListener('change', updateFields);
  addForm?.querySelector('[name="photo"]')?.addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.addEventListener('load', () => { selectedPhoto = reader.result; }); reader.readAsDataURL(file); });
  container.addEventListener('click', (event) => {
    if (!recordsReady) return;
    const button = event.target.closest('button');
    if (!button) return;

    const editTarget = button.closest('[data-edit-record]');
    if (editTarget) {
      const matched = records.find((item) => item.id === editTarget.dataset.editRecord);
      if (matched) openForm(matched);
      return;
    }

    const archiveTarget = button.closest('[data-archive-record]');
    if (archiveTarget) {
      const matched = records.find((item) => item.id === archiveTarget.dataset.archiveRecord);
      if (!matched || pendingRecordActions.has(matched.id)) return;
      pendingRecordActions.add(matched.id);
      archiveTarget.disabled = true;
      archiveTarget.setAttribute('aria-busy', 'true');
      matched.archived = !matched.archived;
      saveFarmRecordRemote(matched, matched.id).then((saved) => {
        Object.assign(matched, saved);
        saveFarmRecords(records);
        showArchived = false;
        render();
      }).catch(() => {
        matched.archived = !matched.archived;
        render();
      }).finally(() => {
        pendingRecordActions.delete(matched.id);
      });
      return;
    }

    const deleteTarget = button.closest('[data-delete-record]');
    if (!deleteTarget) return;
    const matched = records.find((item) => item.id === deleteTarget.dataset.deleteRecord);
    if (!matched || pendingRecordActions.has(matched.id)) return;
    pendingRecordActions.add(matched.id);
    deleteTarget.disabled = true;

    const row = deleteTarget.closest('.inventory-row');
    if (row) row.classList.add('is-removing');
    deletedRecordIds.add(matched.id);
    deleteFarmRecordRemote(matched.id).then(() => {
      records = records.filter((item) => item.id !== matched.id);
      locallyChangedRecords.delete(matched.id);
      saveFarmRecords(records);
      render();
      setAccountSyncStatus('Record deleted', 'connected');
    }).catch((error) => {
      deletedRecordIds.delete(matched.id);
      if (row) row.classList.remove('is-removing');
      setAccountSyncStatus(error.message || 'Delete failed. This record is still saved.', 'offline');
    }).finally(() => {
      pendingRecordActions.delete(matched.id);
    });
  });
  addForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!recordsReady) return;
    const submitButton = addForm.querySelector('.farm-save');
    const isCrop = activeTab === 'crops';
    const livestockType = addForm.livestockType.value;
    submitButton.disabled = true;
    submitButton.classList.add('is-saving');
    submitButton.textContent = editingId ? 'Updating...' : 'Saving...';
    const inputCropName = addForm.cropName.value.trim();
    const existingRecord = editingId ? records.find((item) => item.id === editingId) : null;
    const record = isCrop ? {
      id: editingId || createFarmId('crop'),
      recordType: 'crop',
      cropName: inputCropName || 'Crop record',
      variety: addForm.variety.value.trim(),
      plotName: addForm.plotName.value.trim(),
      area: addForm.area.value,
      plantingDate: addForm.plantingDate.value,
      expectedHarvestDate: addForm.expectedHarvestDate.value,
      stage: addForm.stage.value,
      expectedYield: addForm.expectedYield.value,
      harvestQuantity: addForm.harvestQuantity.value,
      harvestQuality: addForm.harvestQuality.value,
      lossQuantity: addForm.lossQuantity.value,
      lossReason: addForm.lossReason.value.trim(),
      notes: addForm.notes.value.trim(),
      photo: selectedPhoto,
      archived: Boolean(existingRecord?.archived)
    } : {
      id: editingId || createFarmId('livestock'),
      recordType: ['Cattle', 'Goats'].includes(livestockType) ? 'animal' : 'group',
      species: livestockType,
      name: addForm.animalName.value.trim() || livestockType || 'Livestock record',
      count: addForm.count.value || '0',
      tagNumber: addForm.tagNumber.value.trim(),
      dateOfBirth: addForm.dateOfBirth.value,
      sex: addForm.sex.value,
      status: addForm.status.value,
      expectedBirthDate: addForm.expectedBirthDate.value,
      nextVaccinationDate: addForm.nextVaccinationDate.value,
      offspringCount: addForm.offspringCount.value,
      notes: addForm.notes.value.trim(),
      photo: selectedPhoto,
      archived: Boolean(existingRecord?.archived)
    };
    const index = records.findIndex((item) => item.id === editingId);
    const finalize = () => {
      submitButton.disabled = false;
      submitButton.classList.remove('is-saving');
      submitButton.classList.add('is-saved');
      submitButton.textContent = 'Saved';
      window.setTimeout(() => {
        submitButton.classList.remove('is-saved');
        submitButton.textContent = 'Save record';
      }, 700);
    };
    const failSave = () => {
      submitButton.disabled = false;
      submitButton.classList.remove('is-saving');
      submitButton.textContent = editingId ? 'Update record' : 'Save record';
      setAccountSyncStatus('Record was not saved. Check the database connection and try again.', 'offline');
    };
    saveFarmRecordRemote(record, editingId).then((saved) => {
      const savedRecord = { ...record, ...saved };
      locallyChangedRecords.set(savedRecord.id, savedRecord);
      if (index >= 0) records[index] = savedRecord; else records.push(savedRecord);
      saveFarmRecords(records);
      addPanel.hidden = true;
      resetForm();
      render();
      finalize();
    }).catch(failSave);
  });
  loadRemoteRecords();
  resetForm();
  render();
}

function setupAssistantChat() {
  const form = document.querySelector('[data-assistant-form]');
  const messages = document.querySelector('[data-assistant-messages]');
  const empty = document.querySelector('[data-assistant-empty]');
  const suggestions = document.querySelector('[data-assistant-suggestions]');
  if (!form || !messages || !empty || !suggestions) return;
  const assistantFailureMessage = 'I could not reach Isuka just now. Please try again shortly.';
  const sanitizeAssistantMessage = (text) => {
    const value = String(text ?? '');
    return /^\s*(?:typeerror:\s*)?(?:failed to fetch|fetch failed|networkerror|network request failed|the ai service is unavailable|assistant unavailable|(?:gemini|openai) request failed \()/i.test(value)
      ? assistantFailureMessage
      : value;
  };
  const fileInput = form.querySelector('[data-file-input]');
  const fileName = form.querySelector('[data-file-name]');
  const assistantAvatarPath = '/assets/ISUKA%20BOT.png';
  const createAssistantAvatar = () => { const avatar = document.createElement('img'); avatar.className = 'assistant-message-icon'; avatar.src = assistantAvatarPath; avatar.alt = 'Isuka AI'; return avatar; };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const createTypingIndicator = () => {
    const typing = document.createElement('div');
    typing.className = 'assistant-message assistant-message-assistant assistant-typing';
    typing.append(createAssistantAvatar());
    typing.insertAdjacentHTML('beforeend', '<span class="typing-label">Isuka is thinking</span><span class="typing-dots"><i></i><i></i><i></i></span>');
    return typing;
  };
  const historyToggle = document.querySelector('[data-assistant-history-toggle]');
  const historyCollapse = document.querySelector('[data-assistant-history-collapse]');
  const historyCard = document.querySelector('.assistant-history-card');
  const assistantLayout = document.querySelector('.assistant-layout');
  const assistantHistoryPanel = document.querySelector('[data-assistant-history-panel]');
  const assistantHistoryList = document.querySelector('[data-assistant-history-list]');
  const renameDialog = document.querySelector('[data-chat-rename-dialog]');
  const renameForm = document.querySelector('[data-chat-rename-form]');
  const renameInput = document.querySelector('#chat-rename-input');
  const deleteDialog = document.querySelector('[data-chat-delete-dialog]');
  const deleteConfirm = document.querySelector('[data-chat-delete-confirm]');
  let renameTarget = null;
  let deleteTarget = null;
  let selectedFile = null;
  let activeChat = { id: crypto.randomUUID(), title: 'New chat', messages: [] };
  const updateAttachment = () => { if (!fileName) return; fileName.textContent = selectedFile ? selectedFile.name : ''; fileName.hidden = !selectedFile; };
  const clearAttachment = () => { selectedFile = null; if (fileInput) fileInput.value = ''; updateAttachment(); };
  const requestAssistant = async (text) => { if (activeChat.title === 'New chat') activeChat.title = text.slice(0, 48).trim() || 'Uploaded farm file'; const body = new FormData(); body.append('message', text); body.append('conversationId', activeChat.id); body.append('conversationTitle', activeChat.title); if (selectedFile) body.append('attachment', selectedFile); return fetch('/api/assistant/messages', { method: 'POST', credentials: 'include', body }); };
  const animateTextReveal = (element, text, { speedMs = 18, onFinish } = {}) => {
    if (!element) return;
    if (!text) {
      element.textContent = '';
      onFinish?.();
      return;
    }
    element.textContent = '';
    let index = 0;
    const tick = () => {
      index += 1;
      element.textContent = text.slice(0, index);
      if (index >= text.length) {
        onFinish?.();
        return;
      }
      window.setTimeout(tick, speedMs);
    };
    tick();
  };
  const renderSelectedMessages = (history) => { messages.innerHTML = ''; if (!history.length) { messages.hidden = true; empty.hidden = false; suggestions.hidden = false; return; } messages.hidden = false; empty.hidden = true; suggestions.hidden = true; history.forEach((entry) => { const message = document.createElement('div'); message.className = `assistant-message assistant-message-${entry.role}`; if (entry.role === 'assistant') message.appendChild(createAssistantAvatar()); const copy = document.createElement('p'); copy.textContent = entry.role === 'assistant' ? sanitizeAssistantMessage(entry.text) : entry.text || ''; message.appendChild(copy); messages.appendChild(message); }); messages.scrollTop = messages.scrollHeight; };
  fileInput?.addEventListener('change', () => { selectedFile = fileInput.files[0] || null; updateAttachment(); });
  const renderAssistantHistory = (history) => {
    if (!assistantHistoryList) return;
    assistantHistoryList.innerHTML = history.length ? history.map((chat) => `<div class="assistant-history-row${chat.id === activeChat.id ? ' is-active' : ''}" data-chat-id="${escapeHtml(chat.id)}"><button type="button" class="assistant-history-name" data-open-chat>${escapeHtml(chat.title || 'Conversation')}</button><button type="button" class="assistant-history-menu" data-chat-options aria-label="Options for ${escapeHtml(chat.title || 'conversation')}">⋯</button><div class="assistant-chat-menu" data-chat-menu hidden><button type="button" data-rename-chat>Rename</button><button type="button" data-delete-chat>Delete</button></div></div>`).join('') : '<p class="history-empty">No conversations yet.</p>';
    assistantHistoryList.querySelectorAll('[data-chat-id]').forEach((row) => {
      const chat = history.find((item) => item.id === row.dataset.chatId);
      row.querySelector('[data-open-chat]').addEventListener('click', () => { activeChat = chat; renderAssistantHistory(history); renderSelectedMessages(chat.messages); });
      row.querySelector('[data-chat-options]').addEventListener('click', (event) => { event.stopPropagation(); row.querySelector('[data-chat-menu]').hidden = !row.querySelector('[data-chat-menu]').hidden; });
      row.querySelector('[data-rename-chat]').addEventListener('click', () => { renameTarget = chat; renameInput.value = chat.title; renameDialog.hidden = false; renameInput.focus(); renameInput.select(); });
      row.querySelector('[data-delete-chat]').addEventListener('click', () => { deleteTarget = chat; deleteDialog.hidden = false; deleteConfirm.focus(); });
    });
  };
  const closeRenameDialog = () => { renameDialog.hidden = true; renameTarget = null; };
  renameDialog?.querySelectorAll('[data-chat-rename-close]').forEach((button) => button.addEventListener('click', closeRenameDialog));
  renameForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = renameInput.value.trim();
    if (!renameTarget || !title) return;
    const response = await fetch(`/api/assistant/chats/${encodeURIComponent(renameTarget.id)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    if (!response.ok) return;
    renameTarget.title = title;
    if (renameTarget.id === activeChat.id) activeChat.title = title;
    assistantHistoryList?.querySelectorAll('[data-chat-id]').forEach((row) => { if (row.dataset.chatId === renameTarget.id) row.querySelector('[data-open-chat]').textContent = title; });
    closeRenameDialog();
  });
  const closeDeleteDialog = () => { deleteDialog.hidden = true; deleteTarget = null; };
  deleteDialog?.querySelectorAll('[data-chat-delete-close]').forEach((button) => button.addEventListener('click', closeDeleteDialog));
  deleteConfirm?.addEventListener('click', async () => {
    if (!deleteTarget) return;
    deleteConfirm.disabled = true;
    const chat = deleteTarget;
    try {
      const response = await fetch(`/api/assistant/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE', credentials: 'include', signal: AbortSignal.timeout(10000) });
      if (!response.ok) { let detail = ''; try { detail = (await response.json()).error || ''; } catch {} throw new Error(detail || `The chat could not be deleted (${response.status}).`); }
      if (chat.id === activeChat.id) { activeChat = { id: crypto.randomUUID(), title: 'New chat', messages: [] }; renderSelectedMessages(activeChat.messages); }
      closeDeleteDialog();
      window.dispatchEvent(new Event('assistant-chat-updated'));
    } catch (error) {
      setAccountSyncStatus(error.message, 'offline');
    } finally {
      deleteConfirm.disabled = false;
    }
  });
  const setHistoryCollapsed = (collapsed) => { historyCard?.classList.toggle('is-collapsed', collapsed); assistantLayout?.classList.toggle('assistant-layout-collapsed', collapsed); historyCollapse?.setAttribute('aria-expanded', String(!collapsed)); historyCollapse?.setAttribute('aria-label', collapsed ? 'Expand chat history' : 'Collapse chat history'); historyToggle?.setAttribute('aria-expanded', String(!collapsed)); };
  historyCollapse?.addEventListener('click', () => setHistoryCollapsed(!historyCard.classList.contains('is-collapsed')));
  historyToggle?.addEventListener('click', () => setHistoryCollapsed(false));
  if (!document.querySelector('[data-history-panel]')) {
    const input = form.querySelector('input[name="message"]');
    const appendMessage = (text, role) => { const message = document.createElement('div'); message.className = `assistant-message assistant-message-${role}`; if (role === 'assistant') message.appendChild(createAssistantAvatar()); const copy = document.createElement('p'); copy.textContent = text; message.appendChild(copy); messages.appendChild(message); messages.hidden = false; empty.hidden = true; suggestions.hidden = true; messages.scrollTop = messages.scrollHeight; return message; };
    let chatHistory = [];
    let chatLoadVersion = 0;
    const loadChats = async () => {
      const version = ++chatLoadVersion;
      try {
        const response = await fetch('/api/assistant/chats', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('History unavailable.');
        const history = await response.json();
        if (version !== chatLoadVersion) return;
        chatHistory = history;
        if (history.length && !activeChat.messages.length) activeChat = history[0];
        renderAssistantHistory(history);
        renderSelectedMessages(activeChat.messages);
      } catch (error) {
        if (assistantHistoryList) assistantHistoryList.innerHTML = '<p class="history-empty">Chat history is temporarily unavailable. Please try again shortly.</p>';
      }
    };
    loadChats();
    window.addEventListener('assistant-chat-updated', loadChats);
    document.querySelector('[data-assistant-new-chat]')?.addEventListener('click', () => { activeChat = { id: crypto.randomUUID(), title: 'New chat', messages: [] }; renderSelectedMessages(activeChat.messages); input.focus(); });
    const addMessage = (text) => appendMessage(text, 'user');
    suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { input.value = button.textContent; input.focus(); }));
    form.addEventListener('submit', async (event) => { event.preventDefault(); const text = input.value.trim(); if (!text && !selectedFile) return; const requestText = text || 'Please analyze this uploaded farm file and tell me what I should do next.'; const userText = selectedFile ? `${text || 'Analyze this upload.'}\n[Attached: ${selectedFile.name}]` : text; activeChat.messages.push({ role: 'user', text: userText }); addMessage(userText); input.value = ''; form.querySelector('button[type="submit"]').disabled = true; const typing = createTypingIndicator(); messages.appendChild(typing); messages.hidden = false; empty.hidden = true; suggestions.hidden = true; messages.scrollTop = messages.scrollHeight; try { const response = await requestAssistant(requestText); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The AI service is unavailable.'); typing.remove(); const assistantMessage = document.createElement('div'); assistantMessage.className = 'assistant-message assistant-message-assistant'; assistantMessage.appendChild(createAssistantAvatar()); const assistantText = document.createElement('p'); assistantMessage.appendChild(assistantText); messages.appendChild(assistantMessage); activeChat.messages.push({ role: 'assistant', text: result.answer }); animateTextReveal(assistantText, result.answer, { speedMs: 18, onFinish: () => { messages.scrollTop = messages.scrollHeight; window.dispatchEvent(new Event('assistant-chat-updated')); } }); } catch { typing.remove(); const assistantMessage = document.createElement('div'); assistantMessage.className = 'assistant-message assistant-message-assistant'; assistantMessage.appendChild(createAssistantAvatar()); const assistantText = document.createElement('p'); assistantText.textContent = assistantFailureMessage; messages.appendChild(assistantMessage); assistantMessage.appendChild(assistantText); activeChat.messages.push({ role: 'assistant', text: assistantFailureMessage }); } finally { clearAttachment(); form.querySelector('button[type="submit"]').disabled = false; input.focus(); } });
    document.querySelector('[data-file-trigger]')?.addEventListener('click', () => fileInput?.click());
    return;
  }
  const input = form.querySelector('input[name="message"]');
  const historyKey = getScopedStorageKey('isukaAssistantChats');
  let chats = JSON.parse(sessionStorage.getItem(historyKey) || '[]');
  let activeId = chats.at(-1)?.id || null;
  const historyPanel = document.querySelector('[data-history-panel]');
  const historyList = document.querySelector('[data-history-list]');
  const pinnedList = document.querySelector('[data-pinned-list]');
  const historySearch = document.querySelector('[data-history-search]');
  const menu = document.querySelector('[data-chat-menu]');
  const sanitizeStoredFailures = () => {
    chats.forEach((chat) => chat.messages.forEach((entry, index) => {
      const role = typeof entry === 'string' ? index % 2 ? 'assistant' : 'user' : entry.role || 'user';
      if (role !== 'assistant') return;
      const text = typeof entry === 'string' ? entry : entry.text || '';
      const safeText = sanitizeAssistantMessage(text);
      if (safeText === text) return;
      if (typeof entry === 'string') chat.messages[index] = safeText;
      else entry.text = safeText;
    }));
  };
  const save = () => { sanitizeStoredFailures(); sessionStorage.setItem(historyKey, JSON.stringify(chats)); };
  sanitizeStoredFailures();
  sessionStorage.setItem(historyKey, JSON.stringify(chats));
  const currentChat = () => chats.find((chat) => chat.id === activeId);
  const messageText = (message) => typeof message === 'string' ? message : message?.text || '';
  const titleFor = (text) => text.length > 34 ? `${text.slice(0, 34).trim()}...` : text;
  const renderMessages = () => {
    const chat = currentChat();
    messages.innerHTML = '';
    if (!chat || !chat.messages.length) { messages.hidden = true; empty.hidden = false; suggestions.hidden = false; return; }
    messages.hidden = false; empty.hidden = true; suggestions.hidden = true;
    chat.messages.forEach((entry, index) => {
      const role = typeof entry === 'string' ? index % 2 ? 'assistant' : 'user' : entry.role || 'user';
      const message = document.createElement('div');
      message.className = `assistant-message assistant-message-${role}`;
      if (role === 'assistant') message.appendChild(createAssistantAvatar());
      const copy = document.createElement('p'); const text = messageText(entry); copy.textContent = role === 'assistant' ? sanitizeAssistantMessage(text) : text; message.appendChild(copy); messages.appendChild(message);
    });
    messages.scrollTop = messages.scrollHeight;
  };
  const renderHistory = () => {
    const query = (historySearch?.value || '').trim().toLowerCase();
    const matches = chats.filter((chat) => `${chat.title} ${chat.messages.map(messageText).join(' ')}`.toLowerCase().includes(query));
    const renderRows = (target, items, emptyText) => {
      target.innerHTML = items.length ? '' : `<p class="history-empty">${emptyText}</p>`;
      items.slice().reverse().forEach((chat) => {
        const row = document.createElement('div'); row.className = `history-row${chat.id === activeId ? ' is-active' : ''}`;
        const open = document.createElement('button'); open.type = 'button'; open.className = 'history-chat'; open.textContent = chat.title; open.addEventListener('click', () => { activeId = chat.id; renderHistory(); renderMessages(); });
        const actions = document.createElement('button'); actions.type = 'button'; actions.className = 'history-actions'; actions.setAttribute('aria-label', `Options for ${chat.title}`); actions.textContent = '⋮';
        const actionMenu = document.createElement('span'); actionMenu.className = 'history-action-menu'; actionMenu.hidden = true;
        const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Rename'; rename.addEventListener('click', () => { renameChat(chat); actionMenu.hidden = true; });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.addEventListener('click', () => { chats = chats.filter((item) => item.id !== chat.id); if (activeId === chat.id) activeId = chats.at(-1)?.id || null; save(); renderHistory(); renderMessages(); });
        actionMenu.append(rename, remove); actions.addEventListener('click', (event) => { event.stopPropagation(); actionMenu.hidden = !actionMenu.hidden; });
        row.append(open, actions, actionMenu); target.appendChild(row);
      });
    };
    renderRows(pinnedList, matches.filter((chat) => chat.pinned), 'No pinned chats');
    renderRows(historyList, matches.filter((chat) => !chat.pinned), matches.length ? '' : 'No saved chats yet.');
  };
  const newChat = () => { const chat = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: 'New chat', messages: [] }; chats.push(chat); activeId = chat.id; save(); renderHistory(); renderMessages(); input.focus(); };
  const renameChat = (chat = currentChat()) => {
    if (!chat) return;
    const name = window.prompt('Name this chat', chat.title);
    if (name?.trim()) { chat.title = name.trim(); save(); renderHistory(); }
  };
  const deleteChat = () => { if (!activeId) return; chats = chats.filter((chat) => chat.id !== activeId); activeId = chats.at(-1)?.id || null; save(); renderHistory(); renderMessages(); };
  const addMessage = (text) => { let chat = currentChat(); if (!chat) { newChat(); chat = currentChat(); } chat.messages.push({ role: 'user', text }); if (chat.title === 'New chat') chat.title = titleFor(text); save(); renderHistory(); renderMessages(); input.value = ''; input.focus(); };
  document.querySelector('[data-history-toggle]').addEventListener('click', (event) => { const open = historyPanel.hidden; historyPanel.hidden = !open; event.currentTarget.setAttribute('aria-expanded', String(open)); });
  document.querySelector('[data-new-chat]').addEventListener('click', newChat);
  historySearch?.addEventListener('input', renderHistory);
  document.querySelector('[data-chat-menu-toggle]').addEventListener('click', (event) => { const open = menu.hidden; menu.hidden = !open; event.currentTarget.setAttribute('aria-expanded', String(open)); });
  document.querySelector('[data-rename-chat]').addEventListener('click', () => { renameChat(); menu.hidden = true; });
  document.querySelector('[data-delete-chat]').addEventListener('click', () => { deleteChat(); menu.hidden = true; });
  suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { input.value = button.textContent; input.focus(); }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text && !selectedFile) return;
    const requestText = text || 'Please analyze this uploaded farm file and tell me what I should do next.';
    addMessage(selectedFile ? `${text || 'Analyze this upload.'}\n[Attached: ${selectedFile.name}]` : text);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const typing = createTypingIndicator();
    messages.appendChild(typing);
    messages.hidden = false;
    messages.scrollTop = messages.scrollHeight;
    try {
      const response = await requestAssistant(requestText);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Assistant unavailable.');
      typing.remove();
      const chat = currentChat();
      chat.messages.push({ role: 'assistant', text: result.answer });
      save();
      const assistantMessage = document.createElement('div');
      assistantMessage.className = 'assistant-message assistant-message-assistant';
      assistantMessage.appendChild(createAssistantAvatar());
      const assistantText = document.createElement('p');
      assistantMessage.appendChild(assistantText);
      messages.appendChild(assistantMessage);
      animateTextReveal(assistantText, result.answer, { speedMs: 22, onFinish: () => { messages.scrollTop = messages.scrollHeight; } });
    } catch (error) {
      typing.remove();
      const chat = currentChat();
      const safeError = assistantFailureMessage;
      chat.messages.push({ role: 'assistant', text: safeError });
      save();
      const assistantMessage = document.createElement('div');
      assistantMessage.className = 'assistant-message assistant-message-assistant';
      assistantMessage.appendChild(createAssistantAvatar());
      const assistantText = document.createElement('p');
      assistantMessage.appendChild(assistantText);
      messages.appendChild(assistantMessage);
      animateTextReveal(assistantText, safeError, { speedMs: 18, onFinish: () => { messages.scrollTop = messages.scrollHeight; } });
    } finally {
      renderMessages();
      clearAttachment();
      submit.disabled = false;
      input.focus();
    }
  });
  document.querySelector('[data-file-trigger]').addEventListener('click', () => fileInput?.click());
  renderHistory(); renderMessages();
}

async function bootstrapAuthenticatedAccount() {
  const publicPage = document.body.classList.contains('account-login') || document.body.classList.contains('account-signup');
  if (publicPage) return renderAccountPlaceholder();
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Authentication required.');
    const result = await response.json();
    if (result.user?.id) setCurrentUserScope(result.user.id);
    const profile = result.user.profile || {};
    const setup = profile.setup || {};
    const firstName = profile.firstName || result.user.firstName || '';
    const lastName = profile.lastName || result.user.lastName || '';
    const district = profile.district || result.user.district || '';
    writeAccountDraft({ signup: { firstName, lastName, phone: result.user.phone || '', district }, setup: { ...setup, language: profile.language, smsAlerts: profile.smsAlerts } });
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Farmer';
    const greetingName = firstName || 'Farmer';
    document.querySelectorAll('[data-user-name]').forEach((item) => { item.textContent = `${displayName}${district ? ` · ${district}` : ''}`; });
    document.querySelectorAll('[data-first-name]').forEach((item) => { item.textContent = `Muraho, ${greetingName}`; });
    document.querySelectorAll('[data-district-label]').forEach((item) => { item.textContent = district || 'your district'; });
    renderAccountPlaceholder();
    setAccountSyncStatus('Data connected', 'connected');
    document.body.classList.add('is-authenticated');
  } catch {
    window.location.replace('/account/login');
  }
}

async function renderFarmerDashboard() {
  const draft = readAccountDraft();
  const signup = draft.signup || {};
  const setup = draft.setup || {};
  let farmRecords = [];
  try {
    const response = await fetch('/api/farm/records', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Farm records unavailable.');
    farmRecords = await response.json();
    saveFarmRecords(farmRecords);
    setAccountSyncStatus('Data connected', 'connected');
  } catch {
    farmRecords = [];
    setAccountSyncStatus('Offline: saved on this device', 'offline');
  }
  farmRecords = farmRecords.filter((record) => !record.archived);
  const crops = farmRecords.filter((record) => record.recordType === 'crop');
  const animals = farmRecords.filter((record) => ['animal', 'group'].includes(record.recordType));
  const attentionRecords = farmRecords.filter((record) => record.status === 'sick' || record.stage === 'failed' || Number.parseFloat(record.lossQuantity) > 0);
  const displayName = [signup.firstName, signup.lastName].filter(Boolean).join(' ') || 'Farmer';
  const district = signup.district || 'District not set';
  const greetingName = signup.firstName || 'Farmer';
  document.querySelector('[data-first-name]').textContent = `Muraho, ${greetingName}`;
  document.querySelector('[data-user-name]').textContent = `${displayName}${district === 'District not set' ? '' : ` · ${district}`}`;
  document.querySelector('[data-district-label]').textContent = district;
  document.querySelectorAll('[data-crop-count]').forEach((item) => { item.textContent = crops.length; });
  document.querySelectorAll('[data-livestock-count]').forEach((item) => { item.textContent = animals.length; });
  document.querySelectorAll('[data-attention-count]').forEach((item) => { item.textContent = attentionRecords.length; });
  document.querySelectorAll('[data-record-count]').forEach((item) => { item.textContent = farmRecords.length; });
  try {
    const response = await fetch('/api/farm/reminders', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Reminders unavailable.');
    const reminders = await response.json();
    const title = document.querySelector('[data-alert-title]');
    const meta = document.querySelector('[data-alert-meta]');
    const alertRow = document.querySelector('.alert-row');
    if (reminders.length) {
      const reminder = reminders[0];
      alertRow?.classList.remove('is-empty');
      if (title) title.textContent = reminder.title || 'Farm reminder';
      if (meta) meta.textContent = reminder.description || reminder.message || reminder.recommendation || 'Review this farm notice.';
    } else {
      alertRow?.classList.add('is-empty');
      if (title) title.textContent = 'No alerts yet';
      if (meta) meta.textContent = 'There are no recent alerts for your farm.';
    }
  } catch {
    setAccountSyncStatus('Data connected', 'connected');
  }
}

setupAccountForm();
setupSidebarToggle();
setupAccountNavigationIcons();
setupUnreadAlertBadge();
setupAlerts();
setupAlertDeletion();
setupSettings();
setupPasswordRecovery();
setupProfileFlow();
setupAssistantChat();
bootstrapAuthenticatedAccount();
