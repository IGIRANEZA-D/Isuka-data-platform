const adminSessionKey = 'isukaAdminSession';

function escapeAdminText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function setupAdminNavigationIcons() {
  const icons = {
    '/admin': '<path d="M4 12.5V4h7.5v8.5H4zm8.5 0V8H20v4.5h-7.5zm0 7.5V12H20v8.5h-7.5zm-8.5 0V16h7.5v4.5H4z"/>',
    '/admin/datasets': '<path d="M5 5h14v14H5zM8 8h8M8 12h8M8 16h5"/>',
    '/admin/upload': '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
    '/admin/reports': '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6"/>'
  };
  document.querySelectorAll('.admin-nav a').forEach((link) => {
    if (link.querySelector('.admin-nav-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'admin-nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24">${icons[new URL(link.href).pathname] || icons['/admin']}</svg>`;
    link.prepend(icon);
  });
}

function setupAdminNavigation() {
  document.querySelectorAll('.admin-nav a, .admin-brand').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
      document.body.classList.add('is-navigating');
      link.setAttribute('aria-busy', 'true');
    });
  });
}

async function loadAdminRegistry() {
  const tableBody = document.querySelector('.admin-table tbody');
  if (!tableBody) return;
  const path = window.location.pathname;
  if (path === '/admin/datasets') {
    const response = await fetch('/api/admin/datasets');
    if (!response.ok) throw new Error('Dataset registry unavailable.');
    const datasets = await response.json();
    tableBody.innerHTML = datasets.map((dataset) => {
      const id = escapeAdminText(dataset._id);
      const status = String(dataset.status || 'draft').replace('_', ' ');
      const format = String(dataset.fileName || dataset.sourcePath || '').split('.').pop().toUpperCase();
      const needsReview = ['draft', 'queued', 'needs_review', 'rejected'].includes(dataset.status);
      const approved = ['approved', 'published'].includes(dataset.status);
      return `<tr data-dataset-id="${id}"><td>${escapeAdminText(dataset.title || dataset.datasetType || 'Dataset')}</td><td>${escapeAdminText(dataset.year || '—')} · ${escapeAdminText(dataset.season || '—')}</td><td>${escapeAdminText(format || '—')}</td><td><span class="admin-badge">${escapeAdminText(status)}</span><small class="admin-row-note" data-dataset-note></small></td><td class="admin-row-actions">${needsReview ? `<button class="admin-table-action" type="button" data-dataset-action="validate">Validate</button><button class="admin-table-action" type="button" data-dataset-action="approve">Approve</button>` : ''}${approved && dataset.status !== 'published' ? '<button class="admin-table-action" type="button" data-dataset-action="publish">Publish</button>' : ''}${dataset.status === 'published' ? '<span class="admin-muted-action">Live</span>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="5">No datasets registered.</td></tr>';
  }
  if (path === '/admin/reports') {
    const response = await fetch('/api/admin/reports');
    if (!response.ok) throw new Error('Validation reports unavailable.');
    const reports = await response.json();
    tableBody.innerHTML = reports.map((report) => {
      const dataset = report.dataset || {};
      const review = report.review || {};
      const id = escapeAdminText(report.datasetId);
      const reviewStatus = review.reviewStatus || 'pending';
      return `<tr data-dataset-id="${id}"><td>${escapeAdminText(dataset.fileName || dataset.title || 'Dataset')}</td><td>${escapeAdminText(dataset.year || '—')} · ${escapeAdminText(dataset.season || '—')}</td><td>${escapeAdminText(report.rowCount)}</td><td>${escapeAdminText(report.fitScore)} / 100</td><td>${escapeAdminText(report.aiRecommendation || 'needs_review')}</td><td><span class="admin-badge">${escapeAdminText(reviewStatus)}</span><small class="admin-row-note" data-dataset-note>${escapeAdminText(report.aiSummary || review.reviewNotes || '')}</small></td><td class="admin-row-actions"><button class="admin-table-action" type="button" data-dataset-action="approve">Approve</button><button class="admin-table-action" type="button" data-dataset-action="reject">Reject</button></td></tr>`;
    }).join('') || '<tr><td colspan="7">No validation reports registered.</td></tr>';
  }
}

async function runDatasetAction(button) {
  const row = button.closest('[data-dataset-id]');
  const datasetId = row?.dataset.datasetId;
  const action = button.dataset.datasetAction;
  if (!datasetId || !action) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const note = row.querySelector('[data-dataset-note]');
  try {
    let endpoint = `/api/admin/datasets/${encodeURIComponent(datasetId)}/review`;
    let payload = { status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'needs_update', notes: action === 'reject' ? 'Rejected from the validation reports review panel.' : 'Approved from the validation reports review panel.' };
    if (action === 'validate') {
      endpoint = `/api/datasets/${encodeURIComponent(datasetId)}/validate`;
      payload = null;
    } else if (action === 'publish') {
      endpoint = `/api/admin/datasets/${encodeURIComponent(datasetId)}/publish`;
      payload = null;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Dataset action failed.');
    if (action === 'validate') {
      note.textContent = 'Validation queued...';
      let job = result;
      for (let attempt = 0; attempt < 30 && !['completed', 'failed'].includes(job.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const jobResponse = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/job`, { credentials: 'include', cache: 'no-store' });
        job = await jobResponse.json();
      }
      if (job.status === 'failed') throw new Error(job.errorMessage || 'Dataset validation failed.');
      note.textContent = `Validation ${job.status}${job.outputJson?.fitScore ? ` · fit score ${job.outputJson.fitScore}` : ''}`;
    } else {
      note.textContent = `Updated: ${result.status}`;
    }
    await loadAdminRegistry();
  } catch (error) {
    note.textContent = error.message;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

async function loadAdminOverview() {
  const count = document.querySelector('[data-registered-farmers]');
  const status = document.querySelector('[data-registered-farmers-status]');
  if (!count || !status) return;
  try {
    const response = await fetch('/api/admin/overview');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
    count.textContent = Number(result.registeredFarmers).toLocaleString();
    status.textContent = 'Registered accounts';
  } catch {
    count.textContent = '—';
    status.textContent = 'Account summary unavailable.';
  }
}

function setAdminLoginBanner(message, state = 'error') {
  const banner = document.querySelector('[data-admin-login-banner]');
  const text = document.querySelector('[data-admin-login-banner-text]');
  if (!banner || !text) return;
  banner.hidden = !message;
  text.textContent = message || '';
  banner.dataset.state = state;
}

function setAdminNote(message, tone = 'error') {
  const note = document.querySelector('[data-admin-login-note]');
  if (!note) return;
  note.textContent = message || '';
  note.classList.toggle('is-success', tone === 'success');
}

function setupAdminLogin() {
  const form = document.querySelector('[data-admin-login]');
  if (!form) return;
  const password = form.elements.password;
  const toggle = form.querySelector('[data-admin-password-toggle]');
  const button = form.querySelector('[data-admin-login-submit]');
  toggle?.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    const passwordValue = form.password.value;
    if (!email || !passwordValue) {
      setAdminLoginBanner('');
      setAdminNote('Please enter both email and password.');
      return;
    }
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Signing in...';
    setAdminLoginBanner('');
    setAdminNote('');
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: passwordValue }) });
      const responseText = await response.text();
      let result;
      try { result = JSON.parse(responseText); } catch { result = null; }
      if (!response.ok) {
        if (response.status === 401) {
          setAdminLoginBanner('');
          setAdminNote('Invalid credentials.');
        } else {
          const message = typeof result?.error === 'string'
            ? result.error
            : `Sign-in endpoint returned HTTP ${response.status} without a JSON error. Check the deployment logs.`;
          setAdminLoginBanner(message, 'error');
          setAdminNote(message);
        }
        return;
      }
      sessionStorage.setItem(adminSessionKey, 'true');
      setAdminNote('Signed in successfully.', 'success');
      window.location.href = '/admin';
    } catch (error) {
      console.error('Admin sign-in request failed.', error);
      setAdminLoginBanner('Could not reach the sign-in service. Check your connection and try again.', 'error');
      setAdminNote('Could not reach the sign-in service.');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Enter admin workspace';
    }
  });
}

function setupCustomDropdowns() {
  document.querySelectorAll('[data-custom-select]').forEach((select) => {
    const trigger = select.querySelector('[data-custom-trigger]');
    const valueEl = select.querySelector('.custom-select-value');
    const hiddenSelect = select.querySelector('select');
    const options = [...select.querySelectorAll('.custom-option')];
    if (!trigger || !valueEl || !hiddenSelect) return;
    const syncValue = (nextValue) => {
      const selected = options.find((option) => option.dataset.value === nextValue) || options[0];
      const label = selected ? selected.textContent.trim() : '';
      valueEl.textContent = label;
      options.forEach((option) => option.classList.toggle('is-selected', option === selected));
      hiddenSelect.value = selected ? selected.dataset.value : '';
      hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = select.classList.contains('is-open');
      document.querySelectorAll('[data-custom-select].is-open').forEach((other) => {
        if (other !== select) other.classList.remove('is-open');
      });
      select.classList.toggle('is-open', !isOpen);
    });
    options.forEach((option) => {
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        syncValue(option.dataset.value);
        select.classList.remove('is-open');
      });
    });
    const initialValue = hiddenSelect.value || options[0]?.dataset.value || '';
    syncValue(initialValue);
    document.addEventListener('click', (event) => {
      if (!select.contains(event.target)) select.classList.remove('is-open');
    });
  });
}

function setupDatasetUploadWorkflow() {
  const form = document.querySelector('[data-admin-upload]');
  if (!form || form.dataset.workflowReady === 'true') return;
  form.dataset.workflowReady = 'true';
  let step = 1;
  let datasetId = null;
  let validationJob = null;
  const panelRoot = form.closest('.admin-panel');
  setupCustomDropdowns();
  const indicators = [...document.querySelectorAll('[data-upload-step-indicator]')];
  const kicker = panelRoot?.querySelector('[data-upload-panel-kicker]');
  const title = panelRoot?.querySelector('[data-upload-panel-title]');
  const status = panelRoot?.querySelector('[data-upload-status]');
  const note = form.querySelector('[data-upload-note]');
  const activity = form.querySelector('[data-upload-activity]');
  const activityState = form.querySelector('[data-upload-activity-state]');
  const activityList = form.querySelector('[data-upload-activity-list]');
  const summary = form.querySelector('[data-upload-summary]');
  const details = [...form.querySelectorAll('[data-upload-details]')];
  const validationWorkspace = form.querySelector('[data-upload-validation-workspace]');
  const validationMessage = form.querySelector('[data-upload-validation-message]');
  const validationRunStatus = form.querySelector('[data-upload-run-status]');
  const validationAiState = form.querySelector('[data-upload-ai-state]');
  const validationCurrentStep = form.querySelector('[data-upload-current-step]');
  const validationElapsed = form.querySelector('[data-upload-elapsed]');
  const validationProgress = form.querySelector('[data-upload-progress]');
  const validationStages = [...form.querySelectorAll('[data-run-stage]')];
  const validationChecks = [...form.querySelectorAll('[data-validation-check]')];
  const validationExplanation = form.querySelector('[data-upload-validation-explanation]');
  const submit = form.querySelector('[data-upload-submit]');
  const back = form.querySelector('[data-upload-back]');
  const repairButton = form.querySelector('[data-upload-repair]');
  const downloadButton = form.querySelector('[data-upload-download]');
  const preparedStatus = form.querySelector('[data-upload-prepared-status]');
  const syncSubmitState = () => {
    if (!submit) return;
    const titleField = form.querySelector('input[name="title"]');
    const yearField = form.querySelector('select[name="year"]');
    const seasonField = form.querySelector('select[name="season"]');
    const fileField = form.querySelector('input[name="dataset"]');
    const canContinueFromStepOne = !!titleField?.value.trim() && !!yearField?.value && !!seasonField?.value;
    if (step === 1) {
      submit.disabled = !canContinueFromStepOne;
      submit.textContent = 'Next';
      return;
    }
    if (step === 2) {
      const isBlocked = validationJob?.status === 'completed' && (validationJob.outputJson?.validationResult === 'fail' || ['reject', 'blocked'].includes(validationJob.outputJson?.aiReview?.recommendation));
      submit.disabled = validationJob?.status === 'running' || isBlocked || (!validationJob && !fileField?.files?.length);
      submit.textContent = validationJob?.status === 'completed' ? 'Next' : (fileField?.files?.length ? 'Run validation' : 'Choose file');
    }
  };
  const setPreparedDatasetState = (visible = false, label = 'Prepared dataset') => {
    if (!preparedStatus) return;
    preparedStatus.hidden = !visible;
    preparedStatus.textContent = label;
  };
  const setValidationCheck = (name, state) => {
    const check = validationChecks.find((item) => item.dataset.validationCheck === name);
    if (!check) return;
    check.dataset.state = state;
    const stateLabel = check.querySelector('[data-validation-check-state]');
    if (stateLabel) stateLabel.textContent = state === 'complete' ? 'Passed' : state === 'running' ? 'Running' : state === 'blocked' ? 'Blocked' : 'Waiting';
  };
  const setValidationConsoleState = (state) => {
    validationWorkspace.dataset.validationState = state;
    const labels = {
      ready: ['Ready to run', 'Ready to inspect the dataset structure, quality, and model compatibility.', 'Ready when you are'],
      running: ['Running', 'Isuka is checking the dataset and preparing a validation report.', 'AI review in progress'],
      complete: ['Complete', 'All deterministic checks finished and the dataset is ready for review.', 'Validation complete'],
      blocked: ['Blocked', 'A blocking issue needs attention before this dataset can continue.', 'Review required'],
      failed: ['Failed', 'The validation service stopped before completing the checks.', 'Validation paused']
    };
    const [statusText, messageText, aiText] = labels[state] || labels.ready;
    if (validationRunStatus) validationRunStatus.textContent = statusText;
    if (validationMessage) validationMessage.textContent = messageText;
    if (validationAiState) validationAiState.textContent = aiText;
    if (validationExplanation && state !== 'blocked') validationExplanation.hidden = true;
    validationChecks.forEach((check) => {
      const checkState = state === 'complete' ? 'complete' : state === 'blocked' && check.dataset.validationCheck === 'readiness' ? 'blocked' : state === 'running' ? 'running' : 'waiting';
      setValidationCheck(check.dataset.validationCheck, checkState);
    });
  };
  const updateRunEnvironment = (progress = {}) => {
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || (progress.phase === 'complete' ? 100 : progress.phase === 'ai_review' ? 82 : progress.phase === 'deterministic' ? 48 : 8)));
    const phase = progress.phase || 'queued';
    const activeStage = phase === 'queued' ? 'system' : phase === 'ai_review' ? (percent < 95 ? 'model' : 'ai') : percent < 35 ? 'system' : percent < 52 ? 'detect' : percent < 75 ? 'clean' : 'model';
    const stageOrder = ['system', 'detect', 'clean', 'model', 'ai'];
    if (validationProgress) validationProgress.style.width = `${percent}%`;
    if (validationCurrentStep) validationCurrentStep.textContent = progress.currentStep || 'Preparing dataset';
    validationStages.forEach((stage) => {
      const index = stageOrder.indexOf(stage.dataset.runStage);
      const activeIndex = stageOrder.indexOf(activeStage);
      stage.dataset.state = percent >= 100 || index < activeIndex ? 'complete' : stage.dataset.runStage === activeStage ? 'running' : 'waiting';
    });
  };
  const updateElapsed = (startedAt) => {
    if (!validationElapsed || !startedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    validationElapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const updateValidationProgress = (progress = {}) => {
    updateRunEnvironment(progress);
    const completedChecks = new Set(progress.completedChecks || []);
    validationChecks.forEach((check) => setValidationCheck(check.dataset.validationCheck, completedChecks.has(check.dataset.validationCheck) ? 'complete' : progress.phase === 'failed' ? 'blocked' : ['deterministic', 'model_check', 'ai_review'].includes(progress.phase) ? 'running' : 'waiting'));
    if (progress.currentStep || progress.stage) {
      activityState.textContent = progress.phase === 'failed' ? 'Failed' : progress.phase === 'complete' ? 'Complete' : 'Running';
      validationMessage.textContent = progress.currentStep || progress.stage;
      validationAiState.textContent = progress.stage || progress.currentStep;
      if (validationCurrentStep) validationCurrentStep.textContent = progress.currentStep || progress.stage;
    }
  };
  const setStep = (nextStep) => {
    step = nextStep;
    panelRoot?.classList.remove('upload-phase-enter');
    requestAnimationFrame(() => panelRoot?.classList.add('upload-phase-enter'));
    const progressWidth = ((step - 1) / 2) * 100;
    document.documentElement.style.setProperty('--upload-line-width', `${progressWidth}%`);
    indicators.forEach((indicator) => {
      const indicatorStep = Number(indicator.dataset.uploadStepIndicator);
      const blockedForValidation = indicatorStep === 2 && validationJob && ['fail', 'blocked'].includes(validationJob.outputJson?.validationResult || '');
      indicator.classList.toggle('is-active', indicatorStep === step);
      indicator.classList.toggle('is-complete', indicatorStep < step);
      indicator.classList.toggle('is-blocked', blockedForValidation);
    });
    kicker.textContent = `Step ${step}`;
    title.textContent = ['Dataset details', 'Clean & validate', 'Review & submit'][step - 1];
    const validationStateText = validationJob?.status === 'completed'
      ? (validationJob.outputJson?.validationResult === 'fail' || ['reject', 'blocked'].includes(validationJob.outputJson?.aiReview?.recommendation) ? 'Blocked' : 'Complete')
      : validationJob?.status === 'running'
        ? 'Running'
        : step === 2
          ? 'Ready to run'
          : 'Ready for review';
    status.textContent = step === 1 ? 'Draft workflow' : step === 2 ? validationStateText : 'Ready for review';
    status.classList.toggle('is-blocked', step === 2 && validationStateText === 'Blocked');
    status.classList.toggle('is-success', step === 2 && validationStateText === 'Complete');
    if (back) back.hidden = step === 1;
    const canAdvanceFromValidation = validationJob?.status === 'completed' && validationJob.outputJson?.validationResult !== 'fail' && !['reject', 'blocked'].includes(validationJob.outputJson?.aiReview?.recommendation);
    submit.textContent = step === 1 ? 'Next' : step === 2 ? 'Next' : 'Submit';
    details.forEach((field) => { field.hidden = step !== 1; });
    validationWorkspace.hidden = step !== 2;
    activity.hidden = step !== 2;
    summary.hidden = step !== 3;
    if (step === 2 && !validationJob) setValidationConsoleState('ready');
    if (step !== 2) {
      activityState.textContent = step === 1 ? 'Ready to run' : 'Complete';
    }
    syncSubmitState();
  };
  const addActivity = (message, state = 'done') => {
    const item = document.createElement('li');
    item.className = `upload-activity-item is-${state}`;
    item.innerHTML = `<span aria-hidden="true">${state === 'done' ? '✓' : state === 'error' ? '!' : '•'}</span>${escapeAdminText(message)}`;
    activityList.append(item);
    item.scrollIntoView({ block: 'nearest' });
  };
  const resetUploadInputs = () => {
    const titleField = form.querySelector('input[name="title"]');
    const yearField = form.querySelector('select[name="year"]');
    const seasonField = form.querySelector('select[name="season"]');
    const datasetField = form.querySelector('input[name="dataset"]');
    if (titleField) titleField.value = titleField.value || '';
    if (yearField && !yearField.value) yearField.value = '2026';
    if (seasonField && !seasonField.value) seasonField.value = 'Season A';
    if (datasetField) datasetField.value = '';
  };
  const renderSummary = (job) => {
    const output = job.outputJson || {};
    const review = output.aiReview || {};
    const period = output.periodCheck || {};
    const cleaningActions = output.cleaningActions || [];
    const warningIssues = Array.isArray(output.warnings) ? output.warnings : [];
    const modelReadiness = output.modelReadiness || {};
    const explanation = output.explanation || {};
    const requiredActions = Array.isArray(explanation.requiredActions) ? explanation.requiredActions : [];
    const whyBlocked = Array.isArray(explanation.whyBlocked) ? explanation.whyBlocked : [];
    const missingInformation = Array.isArray(explanation.missingInformation) ? explanation.missingInformation : [];
    const recommendation = review.recommendation || 'needs_review';
    const readinessPercentage = output.readinessPercentage ?? output.readinessScore ?? review.readinessPercentage ?? 0;
    const confidencePercentage = output.confidencePercentage ?? review.confidencePercentage ?? (review.confidence ? Math.round(Number(review.confidence) * 100) : 0);
    const systemDecision = output.validationResult === 'fail' || ['reject', 'blocked'].includes(recommendation) ? 'Blocked by system checks' : 'Ready for administrator review';
    const decisionText = recommendation === 'approve' ? 'Approved for desk review' : recommendation === 'needs_review' ? 'Needs human review' : 'Blocked by validation';
    const preparedDatasetNotice = cleaningActions.length ? '<span class="admin-status is-success">Prepared dataset</span>' : '';
    summary.innerHTML = `
      <div class="review-summary-header"><div><span class="admin-panel-kicker">Step 3 / administrator review</span><h3>Review &amp; submit</h3><p>Confirm the validation decision before sending this private dataset to the admin review queue.</p></div>${preparedDatasetNotice}<span class="review-recommendation">${escapeAdminText(recommendation)}</span></div>
      <div class="review-decision"><div><small>System decision</small><strong>${escapeAdminText(systemDecision)}</strong></div><div><small>AI recommendation</small><strong>${escapeAdminText(decisionText)}</strong></div><span>${escapeAdminText(review.provider || 'deterministic')} provider</span></div>
      <div class="review-readiness"><div><small>Dataset readiness</small><strong>${escapeAdminText(readinessPercentage)}<sup>%</sup></strong><span>Suitability for dashboard and forecasting workflows</span></div><div><small>AI confidence</small><strong>${escapeAdminText(confidencePercentage)}<sup>%</sup></strong><span>Confidence in the explanation and recommendation</span></div></div>
      <div class="upload-summary-grid">
        <div><small>Rows accepted</small><strong>${escapeAdminText(output.validationResult === 'fail' ? 'Review required' : (output.acceptedRows ?? '—'))}</strong></div>
        <div><small>Fit score</small><strong>${escapeAdminText(output.fitScore ?? '—')} / 100</strong></div>
        <div><small>AI confidence</small><strong>${escapeAdminText(review.confidence ? `${Math.round(Number(review.confidence) * 100)}%` : '—')}</strong></div>
        <div><small>Period check</small><strong>${period.yearMismatch || period.seasonMismatch ? 'Mismatch' : 'Matched'}</strong></div>
        <div><small>Duplicates removed</small><strong>${escapeAdminText(output.duplicateRowsRemoved ?? 0)}</strong></div>
        <div><small>Revalidation score</small><strong>${escapeAdminText(output.readinessScore ?? readinessPercentage ?? '—')}% </strong></div>
      </div>
      <p>${escapeAdminText(review.summary || job.resultSummary || 'Dataset is ready for administrator review.')}</p>
      <div class="upload-summary-explanation"><strong>Model readiness: ${escapeAdminText(modelReadiness.status || 'not assessed')}</strong><p>${escapeAdminText((modelReadiness.blockingReasons || []).join(' ') || 'Compatibility checks completed for dashboard and forecasting features.')}</p></div>
      ${requiredActions.length ? `<div class="upload-summary-explanation"><strong>Required before submission</strong><ul>${requiredActions.map((action) => `<li>${escapeAdminText(action)}</li>`).join('')}</ul></div>` : ''}
      ${whyBlocked.length || missingInformation.length ? `<div class="review-explanation"><strong>Why this decision was made</strong><ul>${[...whyBlocked, ...missingInformation].map((item) => `<li>${escapeAdminText(item)}</li>`).join('')}</ul></div>` : ''}
      <div class="review-models"><div><strong>Model checks</strong><span>${escapeAdminText(modelReadiness.status || 'not assessed')}</span></div><ul>${(modelReadiness.algorithms || []).map((algorithm) => `<li class="${algorithm.ready ? 'is-ready' : 'is-blocked'}">${algorithm.ready ? 'Passed' : 'Blocked'}: ${escapeAdminText(algorithm.name)}</li>`).join('') || '<li>Model checks were not returned.</li>'}</ul></div>
      <div class="upload-summary-columns">
        <section>
          <h4>Warnings</h4>
          ${warningIssues.length ? `<ul>${warningIssues.map((warning) => `<li>${escapeAdminText(warning)}</li>`).join('')}</ul>` : '<ul><li>None</li></ul>'}
        </section>
        <section>
          <h4>AI repair actions</h4>
          ${cleaningActions.length ? `<ul>${cleaningActions.map((action) => `<li>${escapeAdminText(action)}</li>`).join('')}</ul>` : '<ul><li>No additional clean-up required</li></ul>'}
        </section>
      </div>
    `;
    summary.hidden = false;
  };
  const waitForJob = async () => {
    let lastProgressStep = '';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/job`, { credentials: 'include', cache: 'no-store' });
      const job = await response.json();
      if (job.status === 'running') {
        setValidationConsoleState('running');
        updateValidationProgress(job.progress);
        updateElapsed(job.startedAt);
        if (job.progress?.currentStep && job.progress.currentStep !== lastProgressStep) {
          addActivity(job.progress.currentStep, 'working');
          lastProgressStep = job.progress.currentStep;
        }
      }
      if (job.status === 'completed') {
        updateValidationProgress(job.progress || { phase: 'complete', stage: 'Validation complete', currentStep: 'Validation complete', percent: 100, completedChecks: ['period', 'schema', 'quality', 'readiness'] });
        updateElapsed(job.startedAt);
        return job;
      }
      if (job.status === 'failed') {
        updateValidationProgress(job.progress || { phase: 'failed', stage: 'Validation failed', currentStep: job.errorMessage || 'Validation failed.', percent: 0, completedChecks: [] });
        throw new Error(job.errorMessage || 'Validation failed.');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Validation is taking longer than expected. Check the dataset reports page for progress.');
  };
  form.querySelectorAll('input, select').forEach((field) => {
    field.addEventListener('input', syncSubmitState);
    field.addEventListener('change', syncSubmitState);
  });
  submit.addEventListener('click', async () => {
    if (step === 3) {
      const blocked = !datasetId || validationJob?.status !== 'completed' || validationJob.outputJson?.validationResult === 'fail' || ['reject', 'blocked'].includes(validationJob.outputJson?.aiReview?.recommendation);
      if (blocked) {
        submit.disabled = true;
        note.textContent = 'Submission is disabled until the dataset passes system and AI validation.';
        return;
      }
      submit.disabled = true;
      const response = await fetch(`/api/admin/datasets/${encodeURIComponent(datasetId)}/submit`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Submitted from the three-step upload workflow.' }) });
      const result = await response.json();
      if (!response.ok) { note.textContent = result.error || 'Submission failed.'; submit.disabled = false; return; }
      status.textContent = 'Awaiting admin approval';
      submit.textContent = 'Submitted for approval';
      note.textContent = 'The dataset is private and waiting in the admin review queue.';
      return;
    }
    if (step === 2 && validationJob?.status === 'completed') {
      const blocked = validationJob.outputJson?.validationResult === 'fail' || ['reject', 'blocked'].includes(validationJob.outputJson?.aiReview?.recommendation);
      if (blocked) return;
      setStep(3);
      note.textContent = 'Review the validation result, then submit for admin approval.';
      return;
    }
    if (step === 1) {
      const titleInput = form.querySelector('input[name="title"]');
      const yearInput = form.querySelector('select[name="year"]');
      const seasonInput = form.querySelector('select[name="season"]');
      const titleValue = titleInput?.value.trim();
      if (!titleValue) { note.textContent = 'Enter a dataset title before continuing.'; titleInput?.focus(); return; }
      if (!yearInput?.value || !seasonInput?.value) { note.textContent = 'Select the publication year and season before continuing.'; return; }
      setStep(2);
      activity.hidden = false;
      summary.hidden = true;
      note.textContent = 'Review the metadata, then choose a dataset file and run validation.';
      return;
    }
    if (repairButton && !repairButton.hidden && repairButton.dataset.mode === 'repair') {
      if (!datasetId) {
        note.textContent = 'Select or upload a dataset before preparing an AI repair.';
        return;
      }
      repairButton.disabled = true;
      repairButton.textContent = 'Preparing repaired dataset...';
      const response = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/prepare-ai`, { method: 'POST', credentials: 'include', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI repair failed.');
      note.textContent = 'AI repair complete. Review the cleaned file below, then validate it again.';
      const repairStatus = result.validation?.status || 'warn';
      const validForDownload = ['pass', 'warn'].includes(repairStatus);
      setPreparedDatasetState(true, repairStatus === 'pass' ? 'Prepared dataset' : 'Prepared dataset · needs review');
      if (downloadButton) {
        downloadButton.hidden = false;
        downloadButton.setAttribute('href', result.downloadUrl || '#');
        downloadButton.setAttribute('download', result.cleanedFileName || 'cleaned-dataset.csv');
        downloadButton.classList.toggle('is-disabled', !validForDownload);
        downloadButton.textContent = validForDownload ? 'Download cleaned dataset' : 'Cleaned dataset needs review';
      }
      if (repairButton) {
        repairButton.textContent = 'AI repair complete';
        repairButton.disabled = true;
      }
      if (result.validation) {
        const evidence = {
          ...result.validation,
          cleaningActions: result.repairSummary || [],
          warnings: Array.isArray(result.warnings) ? result.warnings : (result.validation.warnings || []),
          readinessScore: Number(result.validation.readinessScore ?? result.validation.fitScore ?? 0),
          validationResult: result.validation.status === 'pass' ? 'pass' : 'warn'
        };
        renderSummary({ outputJson: evidence, resultSummary: 'AI repair completed; the dataset has been cleaned and revalidated.' });
      }
      return;
    }
    const file = form.querySelector('input[name="dataset"]')?.files?.[0];
    if (!file) { note.textContent = 'Choose a dataset file before validation.'; return; }
    if (!/\.(csv|sav|dta|xlsx|xls|rds|rda|rdata)$/i.test(file.name)) { note.textContent = 'Choose a CSV, Excel, SPSS, Stata, or R data file.'; return; }
    setStep(2);
    activity.hidden = false;
    summary.hidden = true;
    validationJob = null;
    setValidationConsoleState('running');
    updateRunEnvironment({ phase: 'queued', currentStep: 'Queueing validation run', percent: 5 });
    submit.disabled = true;
    activityList.innerHTML = '';
    try {
      const response = await fetch('/api/datasets/upload', { method: 'POST', credentials: 'include', cache: 'no-store', body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Upload failed.');
      datasetId = result.datasetId;
      addActivity('Dataset stored privately', 'done');
      const job = await waitForJob();
      validationJob = job;
      addActivity('Validation complete', 'done');
      renderSummary(job);
      activityState.textContent = 'Complete';
      const blocked = job.outputJson?.validationResult === 'fail' || ['reject', 'blocked'].includes(job.outputJson?.aiReview?.recommendation);
      setValidationConsoleState(blocked ? 'blocked' : 'complete');
      submit.disabled = blocked;
      submit.textContent = blocked ? 'Validation blocked' : 'Next';
      if (blocked) {
        const output = job.outputJson || {};
        const review = output.aiReview || {};
        const warnings = Array.isArray(output.warnings) ? output.warnings : [];
        const explanation = output.explanation || {};
        if (validationExplanation) {
          validationExplanation.querySelector('p').textContent = explanation.reasons?.[0] || review.summary || job.resultSummary || warnings[0] || 'The system or AI reviewer found a blocking issue that must be corrected before submission.';
          validationExplanation.hidden = false;
        }
        note.textContent = 'This dataset cannot continue because the system or AI detected a blocking format or quality issue.';
        indicators[1].classList.add('is-blocked');
      } else {
        note.textContent = 'Validation complete. Click Next to continue.';
      }
    } catch (error) {
      addActivity(error.message, 'error');
      activityState.textContent = 'Failed';
      setValidationConsoleState('failed');
      note.textContent = error.message;
      submit.disabled = false;
      setStep(2);
      submit.textContent = 'Retry validation';
    }
  });
  back?.addEventListener('click', () => {
    if (step === 3) {
      setStep(2);
      note.textContent = 'Review the validation result before continuing.';
      return;
    }
    validationJob = null;
    datasetId = null;
    activityList.innerHTML = '';
    summary.hidden = true;
    submit.disabled = false;
    setValidationConsoleState('ready');
    setStep(1);
    note.textContent = 'Update the dataset details, then continue to cleaning and validation.';
  });
  resetUploadInputs();
  syncSubmitState();
  setStep(1);
  syncSubmitState();
}

function setupAdminDashboard() {
  if (!document.querySelector('.admin-shell')) return;
  if (sessionStorage.getItem(adminSessionKey) !== 'true') {
    window.location.replace('/admin/login');
    return;
  }
  loadAdminRegistry().catch((error) => {
    const tableBody = document.querySelector('.admin-table tbody');
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="5">${escapeAdminText(error.message || 'Registry unavailable.')}</td></tr>`;
  });
  document.querySelector('.admin-table')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dataset-action]');
    if (button) runDatasetAction(button);
  });
  loadAdminOverview();
  document.querySelector('[data-admin-logout]')?.addEventListener('click', () => {
    sessionStorage.removeItem(adminSessionKey);
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => { window.location.href = '/'; });
  });
  document.querySelectorAll('.admin-nav a[href^="#"]').forEach((link) => link.addEventListener('click', () => {
    document.querySelectorAll('.admin-nav a').forEach((item) => item.classList.toggle('is-active', item === link));
  }));
  setupDatasetUploadWorkflow();
}

setupAdminLogin();
setupAdminDashboard();
setupAdminNavigationIcons();
setupAdminNavigation();
