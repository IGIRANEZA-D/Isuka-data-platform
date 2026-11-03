import { attachTooltip } from './chart-tooltip.js';

const NS = 'http://www.w3.org/2000/svg';
const palette = ['#3d6b1f', '#78a94d', '#c08a3e', '#7793a6', '#9b6c85', '#a83c3c'];
const validNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const compact = (value, unit = '') => {
  if (!validNumber(value)) return '—';
  const n = Number(value);
  const amount = Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${amount}${unit ? ` ${unit}` : ''}`;
};
const format = (value, unit = '') => validNumber(value) ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}` : '—';
const svg = (tag, attrs = {}) => { const node = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; };

function chartFrame(spec) {
  const card = document.createElement('article');
  card.className = 'analytics-chart-card';
  card.dataset.chartType = spec.type;
  const head = document.createElement('header');
  head.className = 'analytics-chart-head';
  const text = document.createElement('div');
  text.innerHTML = `<p>${esc(spec.eyebrow || 'SURVEY DATA')}</p><h2>${esc(spec.title)}</h2><span>${esc(spec.description || '')}</span>`;
  const actions = document.createElement('div');
  actions.className = 'analytics-chart-actions';
  actions.innerHTML = '<button type="button" class="analytics-chart-menu-button" aria-label="Chart options" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/></svg></button><div class="analytics-chart-menu" role="menu" hidden><button type="button" role="menuitem" data-action="fullscreen">View full screen</button><button type="button" role="menuitem" data-action="print">Print chart</button><hr><button type="button" role="menuitem" data-action="png">Download PNG image</button><button type="button" role="menuitem" data-action="svg">Download SVG image</button><button type="button" role="menuitem" data-action="csv">Download CSV</button><button type="button" role="menuitem" data-action="xls">Download XLS</button><hr><button type="button" role="menuitem" data-action="table">View data table</button></div>';
  head.append(text, actions);
  const context = document.createElement('div');
  context.className = 'analytics-chart-context';
  context.textContent = spec.context || 'All available survey records';
  const measure = document.createElement('div');
  measure.className = 'analytics-chart-measure';
  measure.textContent = `MEASURE · ${spec.measureLabel || spec.unit || 'count'}`;
  const stage = document.createElement('div');
  stage.className = 'analytics-chart-stage';
  stage.classList.add(`analytics-stage-${spec.type}`);
  const table = document.createElement('div');
  table.className = 'analytics-chart-data-table';
  table.hidden = true;
  card.append(head, context, measure, stage, table);
  return { card, stage, table, actions };
}

function axisLabel(value) { return compact(value); }
function drawAxes(svgNode, { width, height, left = 58, right = 18, top = 18, bottom = 48, max, unit = '', ticks = 4 }) {
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const grid = [];
  for (let i = 0; i <= ticks; i += 1) {
    const value = max * i / ticks;
    const y = top + plotHeight - plotHeight * i / ticks;
    grid.push(`<g class="analytics-grid-line"><line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text x="${left - 9}" y="${y + 4}" text-anchor="end">${esc(axisLabel(value))}</text></g>`);
  }
  svgNode.insertAdjacentHTML('beforeend', grid.join(''));
  return { left, right, top, bottom, plotWidth, plotHeight, x: (i, count) => left + (count <= 1 ? plotWidth / 2 : i * plotWidth / (count - 1)), y: (value) => top + plotHeight - plotHeight * value / (max || 1), baseline: top + plotHeight, unit };
}

function drawBar(stage, spec, horizontal = false) {
  const rows = (spec.data || []).filter((d) => validNumber(d.value));
  if (!rows.length) return empty(stage);
  const width = 760, height = Math.max(300, rows.length * (horizontal ? 36 : 62) + 92);
  const max = Math.max(...rows.map((d) => Number(d.value))) * 1.12 || 1;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${spec.title}; ${spec.unit || 'value'}` });
  if (horizontal) {
    const left = 150, right = 78, top = 16, rowHeight = (height - 40) / rows.length, plotWidth = width - left - right;
    [0.25, 0.5, 0.75, 1].forEach((f) => chart.appendChild(svg('line', { x1: left + plotWidth * f, x2: left + plotWidth * f, y1: top, y2: height - 20, class: 'analytics-grid-guide' })));
    rows.forEach((row, i) => {
      const y = top + i * rowHeight + rowHeight * .25, barH = Math.min(20, rowHeight * .54), value = Number(row.value), barW = value / max * plotWidth;
      chart.insertAdjacentHTML('beforeend', `<text class="analytics-category" x="${left - 12}" y="${y + barH * .8}" text-anchor="end">${esc(row.label)}</text><rect class="analytics-mark" x="${left}" y="${y}" width="${plotWidth}" height="${barH}" rx="${barH / 2}" fill="#edf2e9"/><rect class="analytics-mark analytics-bar-horizontal analytics-hoverable" tabindex="0" x="${left}" y="${y}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${row.color || palette[i % palette.length]}" data-index="${i}"/><text class="analytics-value-label" x="${width - 10}" y="${y + barH * .8}" text-anchor="end">${esc(compact(value, spec.unit))}</text>`);
    });
  } else {
    const box = drawAxes(chart, { width, height, max });
    const slot = box.plotWidth / rows.length, barW = Math.min(58, slot * .58);
    rows.forEach((row, i) => {
      const value = Number(row.value), x = box.left + i * slot + (slot - barW) / 2, y = box.y(value), h = box.baseline - y;
      chart.insertAdjacentHTML('beforeend', `<rect class="analytics-mark analytics-bar-vertical analytics-hoverable" tabindex="0" x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${row.color || palette[i % palette.length]}" data-index="${i}"/><text class="analytics-category" x="${x + barW / 2}" y="${box.baseline + 22}" text-anchor="middle">${esc(row.label)}</text><text class="analytics-value-label" x="${x + barW / 2}" y="${Math.max(box.top + 11, y - 7)}" text-anchor="middle">${esc(compact(value, spec.unit))}</text>`);
    });
  }
  stage.appendChild(chart);
  bindPointTips(chart, rows, spec);
}

function drawLine(stage, spec) {
  const rows = (spec.data || []).filter((d) => validNumber(d.value));
  if (!rows.length) return empty(stage);
  const width = 820, height = 340, max = Math.max(...rows.map((d) => Number(d.value))) * 1.18 || 1;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${spec.title}; ${spec.unit || 'value'} by survey period` });
  const box = drawAxes(chart, { width, height, left: 70, right: 24, top: 22, bottom: 62, max });
  const points = rows.map((row, i) => `${i ? 'L' : 'M'}${box.x(i, rows.length)},${box.y(Number(row.value))}`).join(' ');
  const area = `${points} L${box.x(rows.length - 1, rows.length)},${box.baseline} L${box.x(0, rows.length)},${box.baseline} Z`;
  chart.insertAdjacentHTML('beforeend', `<path class="analytics-line-area" d="${area}"/><path class="analytics-line analytics-line-draw" d="${points}"/>`);
  rows.forEach((row, i) => {
    const x = box.x(i, rows.length), y = box.y(Number(row.value));
    chart.insertAdjacentHTML('beforeend', `<circle class="analytics-line-point analytics-mark analytics-hoverable" tabindex="0" cx="${x}" cy="${y}" r="5.5" data-index="${i}"/><text class="analytics-category" x="${x}" y="${box.baseline + 22}" text-anchor="middle">${esc(row.label)}</text>`);
  });
  stage.appendChild(chart);
  const line = chart.querySelector('.analytics-line-draw');
  if (line) line.style.setProperty('--analytics-line-length', String(line.getTotalLength()));
  bindPointTips(chart, rows, spec);
}

function drawGrouped(stage, spec) {
  const categories = (spec.data || []).filter((row) => Array.isArray(row.series) && row.series.some((series) => validNumber(series.value)));
  if (!categories.length) return empty(stage);
  const flat = categories.flatMap((row) => row.series.filter((series) => validNumber(series.value)).map((series) => ({ label:series.name, period:row.period || row.label, value:Number(series.value), color:series.color })));
  const max = Math.max(...flat.map((row) => row.value)) * 1.12 || 1, width = 820, height = 350;
  const chart = svg('svg', { viewBox:`0 0 ${width} ${height}`, role:'img', 'aria-label':spec.title });
  const box = drawAxes(chart,{width,height,left:70,right:20,top:22,bottom:58,max});
  const slot = box.plotWidth / categories.length;
  let flatIndex = 0;
  categories.forEach((category,index) => {
    const series = category.series.filter((item) => validNumber(item.value));
    const groupWidth = Math.min(112,slot*.74), gap=4, barWidth=Math.min(38,(groupWidth-gap*(series.length-1))/series.length);
    const start=box.left+index*slot+(slot-(barWidth*series.length+gap*(series.length-1)))/2;
    series.forEach((item,seriesIndex) => {
      const value=Number(item.value), x=start+seriesIndex*(barWidth+gap), y=box.y(value), pointIndex=flatIndex++;
      chart.insertAdjacentHTML('beforeend',`<rect class="analytics-mark analytics-bar-vertical analytics-hoverable" tabindex="0" x="${x}" y="${y}" width="${barWidth}" height="${box.baseline-y}" rx="5" fill="${item.color||palette[seriesIndex%palette.length]}" data-index="${pointIndex}"/>`);
    });
    chart.insertAdjacentHTML('beforeend',`<text class="analytics-category" x="${box.left+index*slot+slot/2}" y="${box.baseline+22}" text-anchor="middle">${esc(category.label)}</text>`);
  });
  const legend = [...new Map(flat.map((row,index) => [row.label,row.color||palette[index%palette.length]]))];
  legend.forEach(([name,color],index)=>chart.insertAdjacentHTML('beforeend',`<circle cx="${box.left+index*145}" cy="${height-12}" r="5" fill="${color}"/><text class="analytics-category" x="${box.left+index*145+10}" y="${height-8}">${esc(name)}</text>`));
  stage.appendChild(chart); bindPointTips(chart,flat,spec);
}

function drawDonut(stage, spec) {
  const rows = (spec.data || []).filter((d) => validNumber(d.value) && Number(d.value) >= 0);
  const total = rows.reduce((sum, d) => sum + Number(d.value), 0);
  if (!rows.length || !total) return empty(stage);
  const chart = svg('svg', { viewBox: '0 0 520 280', role: 'img', 'aria-label': `${spec.title}; distribution by category` });
  const radius = 72, cx = 112, cy = 140, circumference = 2 * Math.PI * radius;
  let offset = 0;
  rows.forEach((row, i) => {
    const fraction = Number(row.value) / total;
    chart.insertAdjacentHTML('beforeend', `<circle class="analytics-donut-segment analytics-mark analytics-hoverable" tabindex="0" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${row.color || palette[i % palette.length]}" stroke-width="23" stroke-dasharray="${fraction * circumference} ${circumference}" stroke-dashoffset="${-offset * circumference}" transform="rotate(-90 ${cx} ${cy})" data-index="${i}"/>`);
    offset += fraction;
  });
  chart.insertAdjacentHTML('beforeend', `<text class="analytics-donut-total" x="${cx}" y="${cy - 1}" text-anchor="middle">${esc(compact(total))}</text><text class="analytics-donut-caption" x="${cx}" y="${cy + 20}" text-anchor="middle">${esc(spec.centerLabel || 'TOTAL')}</text>`);
  rows.forEach((row, i) => { const y = 34 + i * Math.min(37, 210 / Math.max(rows.length, 1)); chart.insertAdjacentHTML('beforeend', `<circle cx="220" cy="${y + 2}" r="5" fill="${row.color || palette[i % palette.length]}"/><text class="analytics-legend-label" x="233" y="${y + 1}">${esc(row.label)}</text><text class="analytics-legend-value" x="233" y="${y + 16}">${esc(format(row.value, spec.unit))} · ${(Number(row.value) / total * 100).toFixed(1)}%</text>`); });
  stage.appendChild(chart);
  bindPointTips(chart, rows, spec);
}

function empty(stage) { stage.innerHTML = '<div class="analytics-empty">No data for this filter selection.</div>'; }
function bindPointTips(chart, rows, spec) {
  chart.querySelectorAll('[data-index]').forEach((mark) => {
    const row = rows[Number(mark.dataset.index)];
    const label = row.label;
    attachTooltip(mark, `<strong>${esc(row.period || spec.period || 'Survey result')}</strong><span>${esc(label)}${spec.context ? ` · ${esc(spec.context)}` : ''}</span><b>${esc(format(row.value, spec.unit))}</b>`);
  });
  const marks = [...chart.querySelectorAll('[data-index]')];
  const setActive = (mark, persistent = false) => {
    chart.classList.toggle('has-active-mark', Boolean(mark));
    chart.classList.toggle('has-selected-mark', persistent && Boolean(mark));
    marks.forEach((item) => {
      item.classList.toggle('is-muted', Boolean(mark) && item !== mark);
      item.classList.toggle('is-selected', persistent && item === mark);
    });
  };
  let selected = null;
  chart.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-index]');
    if (!mark) { selected = null; setActive(null); return; }
    selected = selected === mark ? null : mark;
    setActive(selected, Boolean(selected));
  });
  chart.addEventListener('pointerover', (event) => {
    if (!event.target.closest('[data-index]')) return;
    if (selected) return;
    chart.classList.add('has-active-mark');
    chart.querySelectorAll('[data-index]').forEach((mark) => mark.classList.toggle('is-muted', mark !== event.target.closest('[data-index]')));
  });
  chart.addEventListener('pointerout', (event) => {
    if (event.relatedTarget && chart.contains(event.relatedTarget)) return;
    if (!selected) setActive(null);
  });
  chart.addEventListener('focusin', (event) => { if (!selected && event.target.matches('[data-index]')) setActive(event.target); });
  chart.addEventListener('focusout', () => { if (!selected) setActive(null); });
  chart.addEventListener('keydown', (event) => { if (event.key === 'Escape' && selected) { selected = null; setActive(null); } });
}

function exportRows(spec) {
  if (spec.type !== 'grouped') return (spec.data || []).map((row) => ({ period:row.period && row.period !== row.label ? row.period : '', label:row.label, value:row.value }));
  return (spec.data || []).flatMap((row) => (row.series || []).map((series) => ({ period:row.period || row.label, label:series.name, value:series.value })));
}
function makeTable(table, spec) {
  const rows = exportRows(spec);
  const hasPeriod = rows.some((row) => row.period);
  table.innerHTML = `<table><caption>${esc(spec.title)} — ${esc(spec.context || 'selected filters')}</caption><thead><tr>${hasPeriod ? '<th scope="col">Period</th>' : ''}<th scope="col">${esc(spec.categoryLabel || 'Category')}</th><th scope="col">${esc(spec.measureLabel || `Value (${spec.unit || 'count'})`)}</th></tr></thead><tbody>${rows.map((row) => `<tr>${hasPeriod ? `<td>${esc(row.period)}</td>` : ''}<th scope="row">${esc(row.label)}</th><td>${esc(format(row.value, spec.unit))}</td></tr>`).join('')}</tbody></table>`;
}
function download(name, content, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function svgMarkup(chart, spec) {
  const sourceBox = chart.viewBox.baseVal;
  const outputWidth = 1200, plotWidth = outputWidth - 64;
  const plotHeight = plotWidth * sourceBox.height / sourceBox.width;
  const chartTop = 164, outputHeight = chartTop + plotHeight + 28;
  const output = svg('svg', { xmlns:NS, width:outputWidth, height:outputHeight, viewBox:`0 0 ${outputWidth} ${outputHeight}`, role:'img', 'aria-label':`${spec.title} chart image` });
  const imageTitle=svg('title'); imageTitle.textContent=spec.title || 'Isuka chart'; output.appendChild(imageTitle);
  output.appendChild(svg('rect', { x:0, y:0, width:outputWidth, height:outputHeight, fill:'#ffffff' }));
  const addText = (value, x, y, attrs = {}) => { const node=svg('text',{x,y,...attrs}); node.textContent=String(value || ''); output.appendChild(node); return node; };
  const titleSize = Math.max(23, Math.min(34, Math.floor(1090 / Math.max(String(spec.title || '').length * .58, 1))));
  addText(spec.eyebrow || 'ISUKA · SURVEY DATA', 38, 32, { fill:'#52783a', 'font-family':'Arial,sans-serif', 'font-size':13, 'font-weight':700, 'letter-spacing':1.6 });
  addText(spec.title, 38, 72, { fill:'#20351b', 'font-family':'Arial,sans-serif', 'font-size':titleSize, 'font-weight':700 });
  addText(spec.description || '', 38, 103, { fill:'#62705d', 'font-family':'Arial,sans-serif', 'font-size':15 });
  addText(`Filters: ${spec.context || 'All available records'}`, 38, 129, { fill:'#62705d', 'font-family':'Arial,sans-serif', 'font-size':13 });
  addText(`Measure: ${spec.measureLabel || spec.unit || 'Count'}`, 38, 151, { fill:'#52783a', 'font-family':'Arial,sans-serif', 'font-size':11, 'font-weight':700 });
  const copy=chart.cloneNode(true);
  copy.querySelectorAll('.is-muted,.is-selected').forEach((mark)=>mark.classList.remove('is-muted','is-selected'));
  copy.setAttribute('x','32'); copy.setAttribute('y',String(chartTop)); copy.setAttribute('width',String(plotWidth)); copy.setAttribute('height',String(plotHeight));
  const style=svg('style');
  style.textContent='.analytics-line{fill:none;stroke:#3d6b1f;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}.analytics-line-draw{stroke-dasharray:none!important;stroke-dashoffset:0!important}.analytics-line-area{fill:#3d6b1f;opacity:.08}.analytics-line-point{fill:#fff;stroke:#3d6b1f;stroke-width:3}.analytics-grid-line line,.analytics-grid-guide{stroke:#dfe7da;stroke-width:1;stroke-dasharray:3 6}.analytics-grid-line text{fill:#71806e;font:11px Arial,sans-serif}.analytics-category{fill:#566650;font:11px Arial,sans-serif}.analytics-value-label,.analytics-legend-label{fill:#263a20;font:700 11px Arial,sans-serif}.analytics-legend-value{fill:#71806e;font:10px Arial,sans-serif}.analytics-donut-total{fill:#20351b;font:700 22px Arial,sans-serif}.analytics-donut-caption{fill:#71806e;font:700 8px Arial,sans-serif;letter-spacing:1px}';
  copy.insertBefore(style,copy.firstChild); output.appendChild(copy);
  return new XMLSerializer().serializeToString(output);
}
function fileSlug(value) { return String(value || 'isuka-chart').normalize('NFKD').replace(/[^\w-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'isuka-chart'; }
function setupActions({ card, stage, table, actions }, spec) {
  const button = actions.querySelector('.analytics-chart-menu-button'), menu = actions.querySelector('.analytics-chart-menu');
  makeTable(table, spec);
  const tableAction = menu.querySelector('[data-action="table"]');
  button.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('[role="menuitem"]')?.focus(); });
  document.addEventListener('pointerdown', (event) => { if (!actions.contains(event.target)) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('fullscreenchange', () => { const isFullscreen = document.fullscreenElement === card || card.classList.contains('analytics-chart-expanded'); menu.querySelector('[data-action="fullscreen"]').textContent = isFullscreen ? 'Exit full screen' : 'View full screen'; });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && card.classList.contains('analytics-chart-expanded')) { card.classList.remove('analytics-chart-expanded'); menu.querySelector('[data-action="fullscreen"]').textContent = 'View full screen'; } });
  actions.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.hidden = true; button.focus(); button.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    const chart = stage.querySelector('svg');
    if (action === 'fullscreen') { if (document.fullscreenElement === card) { await document.exitFullscreen(); } else if (card.classList.contains('analytics-chart-expanded')) { card.classList.remove('analytics-chart-expanded'); } else if (card.requestFullscreen) { try { await card.requestFullscreen(); } catch { card.classList.add('analytics-chart-expanded'); } } else { card.classList.add('analytics-chart-expanded'); } menu.querySelector('[data-action="fullscreen"]').textContent = document.fullscreenElement === card || card.classList.contains('analytics-chart-expanded') ? 'Exit full screen' : 'View full screen'; }
    if (action === 'table') { table.hidden = !table.hidden; tableAction.textContent = table.hidden ? 'View data table' : 'Hide data table'; if (!table.hidden) table.scrollIntoView({ block:'nearest', behavior:'smooth' }); }
    if (action === 'csv') { const rows = exportRows(spec), hasPeriod = rows.some((row) => row.period); const csv = [[...(hasPeriod ? ['Period'] : []), spec.categoryLabel || 'Category', spec.measureLabel || `Value (${spec.unit || 'count'})`], ...rows.map((row) => [...(hasPeriod ? [row.period] : []), row.label, row.value])].map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n'); download('isuka-chart-data.csv', csv, 'text/csv;charset=utf-8'); }
    if (action === 'xls') {
      const xmlEscape=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
      const exported=exportRows(spec), hasPeriod=exported.some((row)=>row.period); const rows=[[...(hasPeriod?['Period']:[]),spec.categoryLabel||'Category',spec.measureLabel||`Value (${spec.unit||'count'})`],...exported.map((row)=>[...(hasPeriod?[row.period]:[]),row.label,row.value])];
      const workbook=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Chart data"><Table>${rows.map((row)=>`<Row>${row.map((cell)=>`<Cell><Data ss:Type="${typeof cell==='number'?'Number':'String'}">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
      download('isuka-chart-data.xls',workbook,'application/vnd.ms-excel;charset=utf-8');
    }
    if (action === 'svg' && chart) download(`${fileSlug(spec.title)}.svg`, svgMarkup(chart,spec), 'image/svg+xml;charset=utf-8');
    if (action === 'png' && chart) {
      const xml = svgMarkup(chart,spec), image = new Image(), url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = Math.round(2400 * image.naturalHeight / image.naturalWidth); const context=canvas.getContext('2d'); if (!context) { URL.revokeObjectURL(url); return; } context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height); canvas.toBlob((blob) => { if (blob) { const png = URL.createObjectURL(blob), link = document.createElement('a'); link.href = png; link.download = `${fileSlug(spec.title)}.png`; link.click(); setTimeout(()=>URL.revokeObjectURL(png),1000); } URL.revokeObjectURL(url); },'image/png'); };
      image.onerror = () => URL.revokeObjectURL(url); image.src = url;
    }
    if (action === 'print' && chart) { const popup = window.open('', '_blank', 'width=1000,height=720'); if (popup) { const imageUrl=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(chart,spec))}`; popup.document.write(`<!doctype html><title>${esc(spec.title)}</title><style>body{margin:0;padding:20px;background:#f3f6f0}img{display:block;width:100%;height:auto;background:#fff}</style><img alt="${esc(spec.title)}" src="${imageUrl}">`); popup.document.close(); const printImage=popup.document.querySelector('img'); const printNow=()=>{popup.focus();popup.print();}; if (printImage?.complete) setTimeout(printNow,0); else printImage?.addEventListener('load',printNow,{once:true}); } }
  });
}

export function renderChartGrid(container, specs) {
  if (!container) return;
  container.innerHTML = '';
  specs.forEach((spec) => {
    const frame = chartFrame(spec);
    container.appendChild(frame.card);
    try {
      if (spec.type === 'line') drawLine(frame.stage, spec);
      else if (spec.type === 'donut') drawDonut(frame.stage, spec);
      else if (spec.type === 'grouped') drawGrouped(frame.stage, spec);
      else drawBar(frame.stage, spec, spec.type === 'bar');
    } catch (error) {
      console.error(`Could not render chart: ${spec.title}`, error);
      frame.stage.innerHTML = '<div class="analytics-empty">This chart could not be drawn. Other dashboard data is still available.</div>';
    }
    setupActions(frame, spec);
  });
}

export const chartFormat = { compact, format, palette };
