(() => {
  const API = '/api';
  let catalog = null, overlay = null, activeTab = 'ask', aborter = null, lastResult = null, initialized = false, askLog = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const xml = value => esc(value);

  async function getCatalog() {
    if (!catalog) {
      const response = await fetch(`${API}/data/catalog`);
      if (!response.ok) throw Error('Could not load data options.');
      catalog = await response.json();
    }
    return catalog;
  }

  function requestFromUrl() {
    try {
      const raw = new URL(location.href).searchParams.get('assistant');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function shortPageName() {
    const titles = {
      'Data Hub Overview': 'Overview', Overview: 'Overview', 'Land & Crops': 'Land & Crops',
      'Climate & Risk': 'Climate & Risk', 'Inputs & Practices': 'Inputs & Practices',
      'District Explorer': 'District Explorer', Forecasting: 'Forecasting',
      'Forecasting Analysis': 'Forecasting', 'Loss Planner': 'Loss Planner'
    };
    const candidate = (document.title.split('|').at(-1) || document.title).trim();
    return titles[candidate] || candidate.split(/[–-]/)[0].trim() || 'Dashboard';
  }

  function contextText() {
    const params = new URL(location.href).searchParams, parts = [shortPageName()], seen = new Set();
    const add = (kind, value) => {
      if (!value || seen.has(kind)) return;
      seen.add(kind);
      const lower = value.toLowerCase();
      const text = kind === 'Season'
        ? (lower === 'all' || lower === 'all seasons' ? 'All seasons' : `Season ${value}`)
        : lower === 'all' || lower === `all ${kind.toLowerCase()}s` ? `All ${kind.toLowerCase()}s` : value;
      parts.push(text);
    };
    add('Year', params.get('year'));
    add('District', params.get('district'));
    add('Season', params.get('season'));
    for (const select of document.querySelectorAll('select')) {
      const identity = `${select.getAttribute('aria-label') || ''} ${select.id || ''} ${select.closest('label')?.innerText || ''}`.toLowerCase();
      const kind = /year/.test(identity) ? 'Year' : /district/.test(identity) ? 'District' : /season/.test(identity) ? 'Season' : null;
      if (kind && select.selectedOptions?.[0]) add(kind, select.selectedOptions[0].textContent.trim().replace(/^season\s+/i, ''));
    }
    return parts.join(' · ');
  }

  function open() {
    if (!overlay) build();
    overlay.querySelector('.isuka-assistant-context').textContent = contextText();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.querySelector('.isuka-assistant-close').focus();
    if (!initialized) {
      initialized = true;
      renderTab('ask').then(() => {
        const request = requestFromUrl();
        if (request && askLog) runRequest(request, askLog, { asChat: true, label: 'Saved request' });
      });
    }
  }

  function close() {
    if (!overlay) return;
    sessionStorage.setItem('isuka-assistant-state', 'closed');
    overlay.classList.remove('open');
    setTimeout(() => {
      overlay.hidden = true;
      document.querySelector('.isuka-assistant-launcher')?.focus();
    }, 220);
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'isuka-assistant-overlay';
    overlay.hidden = true;
    overlay.innerHTML = [
      '<section class="isuka-assistant-drawer" role="dialog" aria-modal="true" aria-label="Ask Isuka">',
      '<header class="isuka-assistant-header">',
      '<img src="/assets/ISUKA%20BOT.png" alt="">',
      '<strong>Ask Isuka</strong>',
      '<button type="button" class="isuka-assistant-close" aria-label="Close">×</button>',
      '</header>',
      '<div class="isuka-assistant-context"></div>',
      '<nav class="isuka-assistant-tabs" aria-label="Mode">',
      '<button type="button" data-tab="ask" aria-selected="true">Ask</button>',
      '<button type="button" data-tab="form" aria-selected="false">Build</button>',
      '</nav>',
      '<main class="isuka-assistant-body" aria-live="polite"></main>',
      '</section>'
    ].join('');
    document.body.append(overlay);
    overlay.querySelector('.isuka-assistant-close').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => renderTab(button.dataset.tab)));
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(item => !item.disabled);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    });
  }

  function skeleton() {
    const block = document.createElement('div');
    block.className = 'isuka-assistant-skeleton';
    block.setAttribute('aria-label', 'Loading');
    block.innerHTML = '<div class="sk sk-a"></div><div class="sk sk-b"></div><div class="sk sk-c"></div>';
    return block;
  }

  function createTyping() {
    const typing = document.createElement('div');
    typing.className = 'isuka-assistant-typing';
    typing.setAttribute('aria-label', 'Isuka is thinking');
    typing.innerHTML = [
      '<img src="/assets/ISUKA%20BOT.png" alt="">',
      '<span class="typing-label">Isuka is thinking</span>',
      '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
    ].join('');
    return typing;
  }

  function scrollAsk(node) {
    const log = askLog || node?.closest?.('.isuka-assistant-chat-log') || node;
    if (!log) return;
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function hideEmpty() {
    const empty = askLog?.querySelector('[data-empty]');
    if (empty) empty.hidden = true;
  }

  async function renderTab(tab) {
    activeTab = tab;
    overlay.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    const body = overlay.querySelector('.isuka-assistant-body');
    let showLoading = setTimeout(() => body.replaceChildren(skeleton()), 100);
    try {
      const options = await getCatalog();
      clearTimeout(showLoading);
      if (tab === 'ask') renderAsk(body, options);
      else renderForm(body, options);
    } catch (error) {
      clearTimeout(showLoading);
      showError(body, error.message, () => renderTab(tab));
    }
  }

  function starterRequests(data) {
    const covered = (crop, years) => Object.entries(data.coverage || {}).some(([key, count]) => {
      if (count < 30) return false;
      const [c, , y] = key.split('|');
      return (crop === 'all' || c === crop) && years.includes(Number(y));
    });
    const maize = data.crops.find(item => /maize/i.test(item.name));
    const page = shortPageName();
    const out = [];
    if (covered('all', [2025])) {
      out.push(['Production by district, 2025', {
        metric: 'production', crop: 'all', districts: 'all', years: ['2025'], seasons: 'all', breakdown: 'district'
      }]);
    }
    if (maize && covered(maize.code, [2020, 2021, 2022, 2023, 2024, 2025])) {
      out.push([`${maize.name} production, 2020–2025`, {
        metric: 'production', crop: maize.code, districts: 'all',
        years: ['2020', '2021', '2022', '2023', '2024', '2025'], seasons: 'all', breakdown: 'year'
      }]);
    }
    if (/Climate|Loss/i.test(page) && covered('all', [2025])) {
      out.push(['Recorded loss by district', {
        metric: 'lossRate', crop: 'all', districts: 'all', years: ['2025'], seasons: 'all', breakdown: 'district'
      }]);
    } else if (covered('all', [2025]) && out.length < 2) {
      out.push(['Recorded loss by district', {
        metric: 'lossRate', crop: 'all', districts: 'all', years: ['2025'], seasons: 'all', breakdown: 'district'
      }]);
    }
    return out.slice(0, 3);
  }

  function renderAsk(body, data) {
    const wrap = document.createElement('section');
    wrap.className = 'isuka-assistant-chat';

    const log = document.createElement('div');
    log.className = 'isuka-assistant-chat-log';
    log.dataset.askStage = '1';
    log.setAttribute('aria-live', 'polite');
    askLog = log;

    const empty = document.createElement('div');
    empty.className = 'isuka-assistant-empty';
    empty.dataset.empty = '1';

    const welcome = document.createElement('div');
    welcome.className = 'isuka-assistant-welcome';
    const heading = document.createElement('strong');
    heading.textContent = 'What do you need?';
    const line = document.createElement('span');
    line.textContent = 'Ask in your own words — charts, production, yield, area, or recorded loss.';
    welcome.append(heading, line);
    empty.append(welcome);

    const starters = starterRequests(data);
    if (starters.length) {
      const list = document.createElement('div');
      list.className = 'isuka-assistant-suggestions';
      for (const [label, request] of starters) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'isuka-assistant-suggest';
        chip.textContent = label;
        chip.addEventListener('click', () => runRequest(request, log, { asChat: true, label }));
        list.append(chip);
      }
      empty.append(list);
    }
    log.append(empty);

    const composer = document.createElement('form');
    composer.className = 'isuka-assistant-composer';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'question';
    input.maxLength = 300;
    input.autocomplete = 'off';
    input.placeholder = 'Ask anything about the survey data…';
    input.setAttribute('aria-label', 'Ask a question about survey data');
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send';
    composer.append(input, send);

    composer.addEventListener('submit', event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      submitQuestion(question, log);
      input.focus({ preventScroll: true });
    });

    wrap.append(log, composer);
    body.replaceChildren(wrap);
    input.focus({ preventScroll: true });
  }

  function field(label, control) {
    const element = document.createElement('label');
    element.append(document.createTextNode(label), control);
    return element;
  }

  function renderForm(body, data) {
    askLog = null;
    const panel = document.createElement('section');
    panel.className = 'isuka-assistant-build';

    const form = document.createElement('form');
    form.className = 'isuka-assistant-form';
    const select = (items, value) => {
      const control = document.createElement('select');
      for (const [code, name] of items) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        control.append(option);
      }
      if (value) control.value = value;
      return control;
    };
    const crop = select([['all', 'All crops'], ...data.crops.map(item => [item.code, item.name])]);
    const district = select([['all', 'All districts'], ...data.districts.map(item => [item.code, item.name])]);
    const metric = select(data.metrics.map(item => [item.id, item.label]));
    const from = select(data.years.map(year => [String(year), String(year)]), '2025');
    const to = select(data.years.map(year => [String(year), String(year)]), '2025');
    const season = select([['all', 'All seasons'], ...data.seasons.map(item => [item, `Season ${item}`])]);
    const breakdown = select([
      ['none', 'None'], ['year', 'By year'], ['season', 'By season'],
      ['district', 'By district'], ['crop', 'By crop']
    ]);
    metric.addEventListener('change', () => {
      const existing = breakdown.querySelector('option[value="stage"]');
      if (metric.value === 'lossByStage') {
        if (!existing) {
          const stageOpt = document.createElement('option');
          stageOpt.value = 'stage';
          stageOpt.textContent = 'By stage';
          breakdown.append(stageOpt);
        }
        breakdown.value = 'stage';
      } else {
        existing?.remove();
        if (breakdown.value === 'stage') breakdown.value = 'none';
      }
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Run';
    form.append(
      field('Crop', crop), field('District', district), field('Metric', metric),
      field('From', from), field('To', to), field('Season', season),
      field('Breakdown', breakdown), submit
    );

    const result = document.createElement('div');
    result.className = 'isuka-assistant-form-result';
    result.setAttribute('aria-live', 'polite');

    form.addEventListener('submit', event => {
      event.preventDefault();
      const start = Number(from.value), end = Number(to.value);
      if (end < start) {
        result.textContent = 'End year must be on or after start year.';
        return;
      }
      runRequest({
        metric: metric.value,
        crop: crop.value,
        districts: district.value === 'all' ? 'all' : [district.value],
        years: data.years.filter(year => year >= start && year <= end).map(String),
        seasons: season.value,
        breakdown: metric.value === 'lossByStage' ? 'stage' : breakdown.value,
        format: 'table'
      }, result);
    });

    panel.append(form, result);
    body.replaceChildren(panel);
  }

  function showError(target, message, retry) {
    const p = document.createElement('p');
    p.className = 'isuka-assistant-error';
    p.append(document.createTextNode(message + ' '));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Retry';
    button.addEventListener('click', retry);
    p.append(button);
    target.replaceChildren(p);
    scrollAsk(target);
  }

  function flashDone(button, label) {
    const previous = button.textContent;
    button.textContent = label;
    button.classList.add('is-done');
    setTimeout(() => {
      button.textContent = previous;
      button.classList.remove('is-done');
    }, 1400);
  }

  function appendUser(log, text) {
    hideEmpty();
    const user = document.createElement('p');
    user.className = 'isuka-assistant-user-query';
    user.textContent = text;
    log.append(user);
    scrollAsk(log);
    return user;
  }

  function appendAssistantSlot(log) {
    const slot = document.createElement('div');
    slot.className = 'isuka-assistant-turn-result';
    const typing = createTyping();
    slot.append(typing);
    log.append(slot);
    scrollAsk(log);
    return slot;
  }

  function revealText(element, text, onFinish) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !text) {
      element.textContent = text || '';
      onFinish?.();
      return;
    }
    element.textContent = '';
    let index = 0;
    const tick = () => {
      index += 1;
      element.textContent = text.slice(0, index);
      scrollAsk(element);
      if (index >= text.length) {
        onFinish?.();
        return;
      }
      window.setTimeout(tick, 16);
    };
    tick();
  }

  async function submitQuestion(question, log) {
    aborter?.abort();
    aborter = new AbortController();
    const controller = aborter;
    appendUser(log, question);
    const slot = appendAssistantSlot(log);
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: question, context: { page: location.pathname, filters: contextText() } }),
        signal: controller.signal
      });
      const data = await response.json();
      if (data.result?.greeting || data.result?.refusal) {
        const note = document.createElement('p');
        note.className = 'isuka-assistant-note';
        slot.replaceChildren(note);
        revealText(note, data.result.message, () => scrollAsk(log));
        return;
      }
      if (data.result?.clarification) {
        const box = document.createElement('div');
        box.className = 'isuka-assistant-clarify';
        const questionLine = document.createElement('p');
        box.append(questionLine);
        const chips = document.createElement('div');
        chips.className = 'isuka-assistant-chips';
        for (const option of data.result.options || []) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'isuka-assistant-chip';
          button.textContent = option.label;
          button.addEventListener('click', () => runRequest(option.request, log, { asChat: true, label: option.label }));
          chips.append(button);
        }
        box.append(chips);
        slot.replaceChildren(box);
        revealText(questionLine, data.result.question, () => scrollAsk(log));
        return;
      }
      renderResult(slot, data.result);
      scrollAsk(log);
      if (data.result?.related?.length) {
        for (const item of data.result.related.slice(0, 2)) {
          await runRequest(item.request, log, { asChat: true, label: item.label, quietUser: true });
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') showError(slot, 'Could not reach the data service.', () => submitQuestion(question, log));
      else showError(slot, 'Request timed out.', () => submitQuestion(question, log));
    } finally {
      clearTimeout(timer);
    }
  }

  async function runRequest(request, target, options = {}) {
    const asChat = options.asChat && askLog && (target === askLog || askLog.contains(target) || target === askLog);
    const log = asChat ? askLog : null;

    if (asChat && log) {
      if (options.quietUser && options.label) {
        const also = document.createElement('p');
        also.className = 'isuka-assistant-also';
        also.textContent = `Also · ${options.label}`;
        log.append(also);
      } else if (!options.quietUser) {
        appendUser(log, options.label || 'Request');
      }
      target = appendAssistantSlot(log);
    }

    aborter?.abort();
    aborter = new AbortController();
    const controller = aborter;
    if (!asChat) target.replaceChildren(createTyping());
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API}/data/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) {
        const messages = {
          STAGE_DATA_UNAVAILABLE: 'Stage breakdown is only for recorded loss.',
          UNKNOWN_METRIC: 'Choose a listed metric.',
          INVALID_YEARS: 'Years must be 2020–2025.',
          INVALID_SEASONS: 'Seasons must be A, B or C.'
        };
        throw Error(messages[data.error] || 'Request could not be validated.');
      }
      renderResult(target, data);
      scrollAsk(log || target);
    } catch (error) {
      showError(
        target,
        error.name === 'AbortError' ? 'Request timed out.' : (error.message || 'Data service did not respond.'),
        () => runRequest(request, log || target, options)
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function formatValue(value, unit) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number.toLocaleString(undefined, { maximumFractionDigits: unit === '%' ? 1 : 2 })}${unit === '%' ? '%' : ` ${unit || ''}`}`.trim();
  }

  function svgChart(data, rows) {
    const width = 1080, top = 116, rowHeight = rows.length > 8 ? 27 : 38, height = top + rows.length * rowHeight + 66;
    const labelX = 42, barX = 320, barWidth = 590, valueX = 930;
    const max = Math.max(0, ...rows.filter(row => row.status === 'ok').map(row => Number(row.value) || 0)) || 1;
    const group = { district: 'by district', crop: 'by crop', year: 'by year', season: 'by season', stage: 'by stage' }[data.request?.breakdown];
    const title = xml(`${data.interpretation || 'Isuka data'}${group ? ` · ${group}` : ''}`);
    const metric = xml(data.request?.metric === 'lossRate' || data.request?.metric === 'lossByStage' ? 'Recorded survey loss' : 'Survey result');
    const color = data.request?.metric === 'lossRate' || data.request?.metric === 'lossByStage' ? '#C08A3E' : '#3D6B1F';
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" class="isuka-assistant-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">`,
      `<rect width="100%" height="100%" fill="#F4F6F1"/>`,
      `<text x="42" y="45" fill="#1F2E17" font-family="Baloo 2,Work Sans,Arial,sans-serif" font-size="26" font-weight="700">${title}</text>`,
      `<text x="42" y="73" fill="#6B7566" font-family="Work Sans,Arial,sans-serif" font-size="13">${metric} · ${xml((data.meta?.periods || []).join(', '))}</text>`,
      `<path d="M42 91H1038" stroke="#E5E9E0"/>`,
      `<text x="${barX}" y="108" fill="#6B7566" font-family="Work Sans,Arial,sans-serif" font-size="10">0</text>`,
      `<text x="${barX + barWidth}" y="108" text-anchor="end" fill="#6B7566" font-family="Work Sans,Arial,sans-serif" font-size="10">${xml(formatValue(max, rows.find(row => row.status === 'ok')?.unit))}</text>`
    ];
    rows.forEach((row, index) => {
      const y = top + index * rowHeight, ok = row.status === 'ok', value = Number(row.value) || 0;
      const bar = Math.max(0, barWidth * value / max);
      const rawLabel = String(row.label || 'Result');
      const label = data.request?.breakdown === 'district' ? rawLabel.replace(/\b\w/g, char => char.toUpperCase()) : rawLabel;
      parts.push(`<path d="M42 ${y + rowHeight - 1}H1038" stroke="#E5E9E0"/>`);
      parts.push(`<text x="${labelX}" y="${y + rowHeight * .66}" fill="#1F2E17" font-family="Work Sans,Arial,sans-serif" font-size="${rows.length > 8 ? 12 : 14}">${xml(label.length > 34 ? `${label.slice(0, 32)}…` : label)}</text>`);
      if (ok) {
        parts.push(
          `<rect x="${barX}" y="${y + rowHeight * .27}" width="${barWidth}" height="${rows.length > 8 ? 8 : 12}" fill="#E3EDD9"/>`,
          `<rect x="${barX}" y="${y + rowHeight * .27}" width="${bar.toFixed(2)}" height="${rows.length > 8 ? 8 : 12}" fill="${color}"/>`,
          `<text x="${valueX}" y="${y + rowHeight * .66}" fill="#1F2E17" font-family="Work Sans,Arial,sans-serif" font-size="${rows.length > 8 ? 12 : 14}" font-weight="600">${xml(formatValue(row.value, row.unit))}</text>`
        );
      } else {
        parts.push(`<text x="${barX}" y="${y + rowHeight * .66}" fill="#6B7566" font-family="Work Sans,Arial,sans-serif" font-size="12">${row.status === 'insufficient' ? 'Insufficient data' : 'Not available'}</text>`);
      }
    });
    parts.push(
      `<text x="42" y="${height - 34}" fill="#485641" font-family="Work Sans,Arial,sans-serif" font-size="11">${xml(data.citation || '')}</text>`,
      `<text x="42" y="${height - 14}" fill="#6B7566" font-family="Work Sans,Arial,sans-serif" font-size="10">Calculation ${xml(data.meta?.calcVersion || '')} · Aggregate survey data · Not an official NISR statement</text></svg>`
    );
    return parts.join('');
  }

  function renderResult(target, data) {
    lastResult = data;
    const card = document.createElement('article');
    card.className = 'isuka-assistant-answer';

    const title = document.createElement('h3');
    title.textContent = data.interpretation || 'Result';
    card.append(title);

    if (data.status === 'unavailable' || data.status === 'partial') {
      const status = document.createElement('p');
      status.className = 'isuka-assistant-meta';
      status.textContent = data.status === 'unavailable' ? 'No data for this request.' : 'Partial coverage.';
      card.append(status);
    }

    const allRows = data.rows || [];
    const chartHost = document.createElement('div');
    const table = document.createElement('table');
    const header = document.createElement('thead');
    header.innerHTML = '<tr><th>Group</th><th>Value</th></tr>';
    table.append(header);
    const tbody = document.createElement('tbody');
    table.append(tbody);
    card.append(chartHost, table);

    let expanded = false;
    const paint = () => {
      const visible = expanded ? allRows : allRows.slice(0, 8);
      tbody.replaceChildren();
      for (const row of visible) {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        const value = document.createElement('td');
        label.textContent = row.label;
        value.textContent = row.status === 'ok'
          ? formatValue(row.value, row.unit)
          : row.status === 'insufficient' ? 'Insufficient data' : 'Not available';
        tr.append(label, value);
        tbody.append(tr);
      }
      const ok = visible.filter(row => row.status === 'ok');
      chartHost.innerHTML = ok.length ? svgChart(data, visible) : '';
      scrollAsk(target);
    };
    paint();

    if (allRows.length > 8) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'isuka-assistant-chip';
      more.textContent = `Show all (${allRows.length})`;
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        expanded = !expanded;
        more.textContent = expanded ? 'Show less' : `Show all (${allRows.length})`;
        more.setAttribute('aria-expanded', String(expanded));
        paint();
      });
      card.append(more);
    }

    if (data.coverageGrid?.some(cell => cell.status !== 'ok')) {
      const grid = document.createElement('div');
      grid.className = 'isuka-assistant-grid';
      grid.setAttribute('aria-label', 'Coverage');
      for (const cell of data.coverageGrid) {
        const item = document.createElement('span');
        item.className = cell.status;
        item.title = `${cell.year} ${cell.season}: ${cell.status}`;
        item.textContent = `${String(cell.year).slice(2)}${cell.season}`;
        grid.append(item);
      }
      const legend = document.createElement('div');
      legend.className = 'isuka-assistant-legend';
      legend.innerHTML = '<span><i class="ok"></i>Available</span><span><i class="insufficient"></i>Insufficient</span><span><i class="none"></i>None</span>';
      card.append(grid, legend);
    }

    if (data.alternatives?.length) {
      const alternatives = document.createElement('div');
      alternatives.className = 'isuka-assistant-chips';
      for (const alternative of data.alternatives.slice(0, 3)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'isuka-assistant-chip';
        const seasons = Array.isArray(alternative.seasons) ? alternative.seasons.join('') : alternative.seasons;
        button.textContent = `${alternative.years.join('–')} · ${seasons}`;
        button.addEventListener('click', () => {
          if (askLog) runRequest(alternative, askLog, { asChat: true, label: `${alternative.years.join('–')} · ${seasons}` });
          else runRequest(alternative, target);
        });
        alternatives.append(button);
      }
      card.append(alternatives);
    }

    const footer = document.createElement('p');
    footer.className = 'isuka-assistant-footer';
    footer.textContent = data.citation || 'Based on NISR Seasonal Agricultural Survey data. Not an official NISR statement.';
    card.append(footer);

    const actions = document.createElement('div');
    actions.className = 'isuka-assistant-actions';
    const add = (label, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => handler(button));
      actions.append(button);
    };
    add('CSV', () => downloadCsv(data));
    add('SVG', () => downloadSvg(data, expanded ? allRows : allRows.slice(0, 8)));
    add('PNG', () => downloadPng(data, expanded ? allRows : allRows.slice(0, 8)));
    add('Cite', button => {
      navigator.clipboard?.writeText(data.citation).then(() => flashDone(button, 'Copied'));
    });
    add('Link', button => {
      const link = data.permalink || `${location.origin}/api/data/query?${queryParams(data.request)}`;
      navigator.clipboard?.writeText(link).then(() => flashDone(button, 'Copied'));
    });
    card.append(actions);
    target.replaceChildren(card);
    card.classList.add('isuka-assistant-answer-in');
  }

  function queryParams(request) {
    return new URLSearchParams(Object.entries(request).map(([key, value]) => [key, JSON.stringify(value)]));
  }
  function downloadCsv(data) {
    location.href = `/api/data/export.csv?${queryParams(data.request)}`;
  }
  function save(blob, name) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 800);
  }
  function filename(data, extension) {
    const slug = String(data.interpretation || 'isuka-data').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 54) || 'isuka-data';
    return `isuka-${slug}.${extension}`;
  }
  function downloadSvg(data, rows) {
    save(new Blob([svgChart(data, rows)], { type: 'image/svg+xml;charset=utf-8' }), filename(data, 'svg'));
  }
  function downloadPng(data, rows) {
    const source = svgChart(data, rows), blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => {
      const scale = 1.5, canvas = document.createElement('canvas');
      canvas.width = 1080 * scale;
      canvas.height = image.height * scale;
      const context = canvas.getContext('2d');
      context.fillStyle = '#F4F6F1';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(png => {
        if (png) save(png, filename(data, 'png'));
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  window.IsukaAssistant = { open, close };
})();
