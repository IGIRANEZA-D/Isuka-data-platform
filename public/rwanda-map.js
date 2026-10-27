(() => {
  const svgNs = 'http://www.w3.org/2000/svg';
  const frame = { width: 1000, height: 640, padding: 22 };

  function coordinatesOf(geometry, visit) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(visit)));
  }

  function boundsOf(features) {
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    features.forEach((feature) => coordinatesOf(feature.geometry, ([longitude, latitude]) => {
      bounds.west = Math.min(bounds.west, longitude);
      bounds.east = Math.max(bounds.east, longitude);
      bounds.south = Math.min(bounds.south, latitude);
      bounds.north = Math.max(bounds.north, latitude);
    }));
    return bounds;
  }

  function safeTooltip(value) {
    return String(value ?? '').replace(/<br\s*\/?\s*>/gi, ' · ').replace(/<[^>]*>/g, '').replace(/\s+·\s+·/g, ' ·').trim();
  }

  class IsukaMap {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.layers = new Set();
      this.zoom = 0;
      this.bounds = { west: 28.82, east: 30.92, south: -2.87, north: -1.01 };
      container.replaceChildren();
      container.classList.add('leaflet-container', 'isuka-map');
      const pane = document.createElement('div');
      pane.className = 'leaflet-overlay-pane';
      this.svg = document.createElementNS(svgNs, 'svg');
      this.svg.setAttribute('class', 'leaflet-zoom-animated');
      this.svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
      this.svg.setAttribute('role', 'group');
      this.svg.setAttribute('aria-label', 'Interactive map of Rwanda districts');
      this.layerGroup = document.createElementNS(svgNs, 'g');
      pane.append(this.svg);
      this.svg.append(this.layerGroup);
      container.append(pane);
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'isuka-map-tooltip';
      this.tooltip.setAttribute('role', 'status');
      this.tooltip.hidden = true;
      container.append(this.tooltip);
      this.installControls();
    }

    installControls() {
      if (this.options.zoomControl === false) return;
      const controls = document.createElement('div');
      controls.className = 'isuka-map-zoom';
      [['+', 'Zoom in', 1], ['−', 'Zoom out', -1]].forEach(([label, description, direction]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', description);
        button.textContent = label;
        button.addEventListener('click', () => {
          this.zoom = Math.max(0, Math.min(4, this.zoom + direction));
          this.redraw();
        });
        controls.append(button);
      });
      this.container.append(controls);
    }

    setView() { return this; }
    invalidateSize() { this.redraw(); return this; }
    fitBounds(bounds) { if (bounds && Number.isFinite(bounds.west)) this.bounds = { ...bounds }; this.zoom = 0; this.redraw(); return this; }
    addLayer(layer) { this.layers.add(layer); layer.render(); return this; }
    removeLayer(layer) { this.layers.delete(layer); layer.group?.remove(); return this; }
    redraw() { this.layers.forEach((layer) => layer.render()); }

    project([longitude, latitude]) {
      const bounds = { ...this.bounds };
      const aspect = (frame.width - frame.padding * 2) / (frame.height - frame.padding * 2);
      const longitudeSpan = Math.max(bounds.east - bounds.west, 0.01) / (1.35 ** this.zoom);
      const latitudeSpan = Math.max(bounds.north - bounds.south, 0.01) / (1.35 ** this.zoom);
      const centerLongitude = (bounds.east + bounds.west) / 2;
      const centerLatitude = (bounds.north + bounds.south) / 2;
      let width = longitudeSpan, height = latitudeSpan;
      if (width / height < aspect) width = height * aspect;
      else height = width / aspect;
      const west = centerLongitude - width / 2;
      const north = centerLatitude + height / 2;
      const usableWidth = frame.width - frame.padding * 2;
      const usableHeight = frame.height - frame.padding * 2;
      return [frame.padding + ((longitude - west) / width) * usableWidth, frame.padding + ((north - latitude) / height) * usableHeight];
    }

    showTooltip(content, event) {
      if (!content) return;
      this.tooltip.textContent = safeTooltip(content);
      this.tooltip.hidden = false;
      const rect = this.container.getBoundingClientRect();
      const pointerX = Number.isFinite(event?.clientX) ? event.clientX - rect.left : 14;
      const pointerY = Number.isFinite(event?.clientY) ? event.clientY - rect.top : 14;
      this.tooltip.style.left = `${Math.max(8, Math.min(rect.width - this.tooltip.offsetWidth - 8, pointerX + 12))}px`;
      this.tooltip.style.top = `${Math.max(8, Math.min(rect.height - this.tooltip.offsetHeight - 8, pointerY + 12))}px`;
    }
  }

  class FeatureLayer {
    constructor(feature, options) {
      this.feature = feature;
      this.options = { interactive: true };
      this.style = {};
      this.tooltip = '';
      this.listeners = {};
      this.element = document.createElementNS(svgNs, 'path');
      this.element.setAttribute('class', 'leaflet-interactive isuka-district-shape');
      this.element.setAttribute('fill-rule', 'evenodd');
      this.element.setAttribute('tabindex', '0');
      this.element.setAttribute('role', 'button');
      this.setStyle(typeof options.style === 'function' ? options.style(feature) : options.style || {});
      options.onEachFeature?.(feature, this);
      this.installEvents();
    }

    setStyle(style = {}) { Object.assign(this.style, style); this.renderStyle(); return this; }
    bindTooltip(content) { this.tooltip = safeTooltip(content); this.element.setAttribute('aria-label', this.tooltip); this.updateTitle(); return this; }
    setTooltipContent(content) { return this.bindTooltip(content); }
    unbindTooltip() { this.tooltip = ''; this.element.removeAttribute('aria-label'); this.updateTitle(); return this; }
    on(listeners = {}) { Object.assign(this.listeners, listeners); return this; }
    getElement() { return this.element; }
    updateTitle() {
      let title = this.element.querySelector('title');
      if (!this.tooltip) { title?.remove(); return; }
      if (!title) { title = document.createElementNS(svgNs, 'title'); this.element.prepend(title); }
      title.textContent = this.tooltip;
    }
    renderStyle() {
      const style = this.style;
      this.element.setAttribute('fill', style.fillColor || style.fill || '#6fa83c');
      this.element.setAttribute('fill-opacity', String(style.fillOpacity ?? 0.78));
      this.element.setAttribute('stroke', style.color || style.stroke || '#fff');
      this.element.setAttribute('stroke-width', String(style.weight ?? style.strokeWidth ?? 1.2));
      this.element.setAttribute('stroke-opacity', String(style.opacity ?? 1));
    }
    installEvents() {
      this.element.addEventListener('mouseenter', (event) => { this.listeners.mouseover?.(event); this.map?.showTooltip(this.tooltip, event); });
      this.element.addEventListener('mousemove', (event) => this.map?.showTooltip(this.tooltip, event));
      this.element.addEventListener('mouseleave', (event) => { this.listeners.mouseout?.(event); if (!this.element.matches(':focus')) this.map && (this.map.tooltip.hidden = true); });
      this.element.addEventListener('focus', (event) => this.map?.showTooltip(this.tooltip, event));
      this.element.addEventListener('blur', () => { if (this.map) this.map.tooltip.hidden = true; });
      this.element.addEventListener('click', (event) => this.listeners.click?.(event));
      this.element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.listeners.click?.(event); } });
    }
    render() {
      const geometry = this.feature.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const path = polygons.flatMap((polygon) => polygon.map((ring) => ring.map((coordinate, index) => {
        const [x, y] = this.map.project(coordinate);
        return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(' ') + ' Z')).join(' ');
      this.element.setAttribute('d', path);
      this.element.style.pointerEvents = this.options.interactive ? '' : 'none';
      this.renderStyle();
    }
  }

  class FeatureCollectionLayer {
    constructor(data, options = {}) {
      this.features = (data.features || []).map((feature) => new FeatureLayer(feature, options));
      this.bounds = boundsOf(data.features || []);
      this.map = null;
      this.group = null;
    }
    addTo(map) {
      this.map = map;
      this.group = document.createElementNS(svgNs, 'g');
      map.layerGroup.append(this.group);
      this.features.forEach((featureLayer) => { featureLayer.map = map; this.group.append(featureLayer.element); });
      map.addLayer(this);
      return this;
    }
    remove() { if (this.map) this.map.removeLayer(this); return this; }
    eachLayer(callback) { this.features.forEach(callback); }
    getBounds() { return this.bounds; }
    render() { this.features.forEach((featureLayer) => featureLayer.render()); }
  }

  window.L = {
    map: (container, options) => new IsukaMap(container, options),
    geoJSON: (data, options) => new FeatureCollectionLayer(data, options)
  };
})();
