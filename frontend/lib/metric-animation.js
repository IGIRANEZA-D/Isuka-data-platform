const animations = new WeakMap();

/** Smoothly count a metric to its latest value, while keeping its page formatter. */
export function animateMetric(element, target, formatter = (value) => Math.round(value).toLocaleString(), duration = 850) {
  if (!element) return;

  const previous = animations.get(element);
  if (previous?.frame) cancelAnimationFrame(previous.frame);

  const value = Number(target);
  if (!Number.isFinite(value)) {
    animations.delete(element);
    element.textContent = formatter(Number.NaN);
    return;
  }

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    animations.set(element, { value });
    element.textContent = formatter(value);
    return;
  }

  const start = previous?.value ?? 0;
  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - ((1 - progress) ** 3);
    const current = start + ((value - start) * eased);
    element.textContent = formatter(current);
    if (progress < 1) {
      const frame = requestAnimationFrame(tick);
      animations.set(element, { value: current, frame });
    } else {
      animations.set(element, { value });
    }
  };

  const frame = requestAnimationFrame(tick);
  animations.set(element, { value: start, frame });
}
