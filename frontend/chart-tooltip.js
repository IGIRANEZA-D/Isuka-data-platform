const tooltip = document.createElement('div');
tooltip.className = 'chart-tooltip';
tooltip.setAttribute('role', 'status');
tooltip.setAttribute('aria-hidden', 'true');
document.body.appendChild(tooltip);

function placeTooltip(target) {
  const rect = target.getBoundingClientRect();
  const margin = 12;
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - margin;
  if (top < margin) top = rect.bottom + margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function showChartTooltip(target, content) {
  tooltip.innerHTML = content;
  tooltip.classList.add('is-visible');
  tooltip.setAttribute('aria-hidden', 'false');
  placeTooltip(target);
}

export function hideChartTooltip() {
  tooltip.classList.remove('is-visible');
  tooltip.setAttribute('aria-hidden', 'true');
}

export function attachTooltip(target, content) {
  target.addEventListener('mouseenter', () => showChartTooltip(target, content));
  target.addEventListener('mousemove', () => placeTooltip(target));
  target.addEventListener('mouseleave', hideChartTooltip);
  target.addEventListener('focus', () => showChartTooltip(target, content));
  target.addEventListener('blur', hideChartTooltip);
  target.setAttribute('tabindex', target.getAttribute('tabindex') || '0');
}
