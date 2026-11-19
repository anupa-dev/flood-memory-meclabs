'use strict';

/**
 * compare.js — Year-to-year split-view comparison for Flood Map.
 *
 * Exposes FM.compare = { open, close }
 *
 * Depends on (loaded before this):
 *   - Leaflet 1.9.4 (global L)
 *   - js/config.js  (ACTIVE_REGION, API_BASE, DATA_YEARS)
 *   - js/state.js   (FM.state)
 *   - js/api.js     (FM.api)
 *   - js/map.js     (FM.map)
 */

window.FM = window.FM || {};

FM.compare = (function () {

  /* ─────────────────────── private state ──────────────────────── */

  let _panel      = null;   // #compare-panel element
  let _leftLayer  = null;   // L.Layer for year A
  let _rightLayer = null;   // L.Layer for year B
  let _dividerPct = 50;     // divider position as % of map container width
  let _dragging   = false;
  let _mapContainer = null;
  let _dividerEl  = null;   // the draggable bar DOM element
  let _selectA    = null;   // <select> for year A
  let _selectB    = null;   // <select> for year B
  let _isOpen     = false;

  /* ─────────────────────── helpers ─────────────────────────────── */

  /**
   * Build a Leaflet overlay layer (image or GeoJSON) for a given year,
   * starting at opacity 0, then fading to target opacity.
   * @param {number|string} year
   * @param {number} [targetOpacity=0.75]
   * @returns {Promise<L.Layer|null>}
   */
  async function _buildOverlayLayer(year, targetOpacity) {
    if (!year) return null;
    const op = (typeof targetOpacity === 'number') ? targetOpacity : 0.75;

    const bounds = L.latLngBounds(
      L.latLng(ACTIVE_REGION.bounds[0][0], ACTIVE_REGION.bounds[0][1]),
      L.latLng(ACTIVE_REGION.bounds[1][0], ACTIVE_REGION.bounds[1][1])
    );

    // Try PNG first
    try {
      const imgUrl = `${API_BASE}/api/overlays/${year}.png`;
      const res = await fetch(imgUrl, { method: 'HEAD' });
      if (res.ok) {
        return L.imageOverlay(imgUrl, bounds, {
          opacity: op,
          interactive: false,
          className: 'fm-flood-overlay fm-compare-overlay',
        });
      }
    } catch (_) { /* fall through to GeoJSON */ }

    // Fall back to GeoJSON
    try {
      const geojson = await FM.api.floods(year);
      return L.geoJSON(geojson, {
        style: {
          color: '#1e5eff',
          weight: 1,
          opacity: op,
          fillColor: '#1e5eff',
          fillOpacity: op * 0.73,
          fillRule: 'nonzero',
        },
        interactive: false,
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Apply CSS clip-path to both overlay layers based on current _dividerPct.
   * Left layer: inset(0 (100-pct)% 0 0)   → shows only left portion
   * Right layer: inset(0 0 0 pct%)          → shows only right portion
   */
  function _applyClip() {
    const pct  = _dividerPct;
    const rPct = 100 - pct;

    // Helper to get the DOM element for a Leaflet layer
    function getLayerEl(layer) {
      if (!layer) return null;
      if (layer instanceof L.ImageOverlay) return layer.getElement();
      // GeoJSON: get its pane's SVG container
      const pane = layer.options && layer.options.pane;
      return pane ? document.querySelector(`.leaflet-${pane || 'overlay'}-pane`) : null;
    }

    if (_leftLayer) {
      const leftEl = getLayerEl(_leftLayer);
      if (leftEl) {
        leftEl.style.clipPath = `inset(0 ${rPct.toFixed(2)}% 0 0)`;
        leftEl.style.webkitClipPath = `inset(0 ${rPct.toFixed(2)}% 0 0)`;
      } else {
        // For GeoJSON, clip the whole SVG overlay pane only if single-use panes
        // Fallback: use inline clip on the layer's container
      }
    }

    if (_rightLayer) {
      const rightEl = getLayerEl(_rightLayer);
      if (rightEl) {
        rightEl.style.clipPath = `inset(0 0 0 ${pct.toFixed(2)}%)`;
        rightEl.style.webkitClipPath = `inset(0 0 0 ${pct.toFixed(2)}%)`;
      }
    }

    // Move divider bar
    if (_dividerEl && _mapContainer) {
      _dividerEl.style.left = `${pct}%`;
    }
  }

  /**
   * Build dedicated paned overlay layers so we can clip them independently.
   * We add each layer to its own custom pane.
   * @param {L.Map} map
   */
  function _ensurePanes(map) {
    if (!map.getPane('compareLeft')) {
      map.createPane('compareLeft');
      map.getPane('compareLeft').style.zIndex = 310;
      map.getPane('compareLeft').style.pointerEvents = 'none';
    }
    if (!map.getPane('compareRight')) {
      map.createPane('compareRight');
      map.getPane('compareRight').style.zIndex = 311;
      map.getPane('compareRight').style.pointerEvents = 'none';
    }
  }

  /**
   * Load overlays for year A (left) and year B (right), apply clip immediately.
   * @param {L.Map} map
   * @param {number|string} yearA
   * @param {number|string} yearB
   */
  async function _loadOverlays(map, yearA, yearB) {
    // Remove existing
    if (_leftLayer)  { try { map.removeLayer(_leftLayer);  } catch(_){} _leftLayer  = null; }
    if (_rightLayer) { try { map.removeLayer(_rightLayer); } catch(_){} _rightLayer = null; }

    _ensurePanes(map);

    // Build both
    const [lLayer, rLayer] = await Promise.all([
      _buildOverlayLayer(yearA, 0.80),
      _buildOverlayLayer(yearB, 0.80),
    ]);

    if (!_isOpen) return; // closed while loading

    if (lLayer) {
      if (lLayer instanceof L.ImageOverlay) {
        lLayer.options.pane = 'compareLeft';
        // Re-add with correct pane by setting before addTo
        lLayer.addTo(map);
        // Move element to correct pane
        const pane = map.getPane('compareLeft');
        if (lLayer.getElement()) pane.appendChild(lLayer.getElement());
      } else {
        lLayer.options = lLayer.options || {};
        lLayer.options.pane = 'compareLeft';
        lLayer.addTo(map);
      }
      _leftLayer = lLayer;
    }

    if (rLayer) {
      if (rLayer instanceof L.ImageOverlay) {
        rLayer.options.pane = 'compareRight';
        rLayer.addTo(map);
        const pane = map.getPane('compareRight');
        if (rLayer.getElement()) pane.appendChild(rLayer.getElement());
      } else {
        rLayer.options = rLayer.options || {};
        rLayer.options.pane = 'compareRight';
        rLayer.addTo(map);
      }
      _rightLayer = rLayer;
    }

    // Apply clip after a tick (so Leaflet renders elements)
    setTimeout(_applyClip, 50);
  }

  /* ─────────────────────── UI BUILD ─────────────────────────────── */

  /**
   * Build the compare panel UI (year pickers + close button).
   * Injected into #compare-panel.
   */
  function _buildPanelUI() {
    _panel.innerHTML = '';

    // Header row
    const header = document.createElement('div');
    header.className = 'compare-panel__header';

    const title = document.createElement('h2');
    title.className = 'compare-panel__title';
    title.textContent = 'Compare years';

    // Unique close button: a diamond-shaped "✕" button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'compare-panel__close';
    closeBtn.setAttribute('aria-label', 'Close compare view');
    closeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <polygon points="14,2 26,14 14,26 2,14" fill="#C9A84C" stroke="#14302E" stroke-width="1.5"/>
        <line x1="10" y1="10" x2="18" y2="18" stroke="#14302E" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="18" y1="10" x2="10" y2="18" stroke="#14302E" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`;
    closeBtn.addEventListener('click', close);

    header.appendChild(title);
    header.appendChild(closeBtn);
    _panel.appendChild(header);

    // Year picker row
    const pickers = document.createElement('div');
    pickers.className = 'compare-panel__pickers';

    function buildPicker(label, defaultIdx) {
      const wrap = document.createElement('div');
      wrap.className = 'compare-panel__picker-wrap';

      const lbl = document.createElement('label');
      lbl.className = 'compare-panel__picker-label';
      lbl.textContent = label;

      const sel = document.createElement('select');
      sel.className = 'compare-panel__select';
      sel.setAttribute('aria-label', label);

      // Populate only selectable years (DATA_YEARS, no gaps)
      const years = (typeof DATA_YEARS !== 'undefined' ? DATA_YEARS : [])
        .slice()
        .sort((a, b) => a - b);

      years.forEach((y, i) => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (i === defaultIdx || (defaultIdx < 0 && i === years.length + defaultIdx)) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });

      lbl.htmlFor = sel.id = `compare-${label.toLowerCase().replace(/\s+/g, '-')}`;
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      return { wrap, sel };
    }

    const { wrap: wrapA, sel: selA } = buildPicker('Left year', 0);
    const { wrap: wrapB, sel: selB } = buildPicker('Right year', -1);
    _selectA = selA;
    _selectB = selB;

    pickers.appendChild(wrapA);

    // Visual divider arrow between pickers
    const arrow = document.createElement('span');
    arrow.className = 'compare-panel__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '⇄';
    pickers.appendChild(arrow);

    pickers.appendChild(wrapB);
    _panel.appendChild(pickers);

    // Listen for changes and reload overlays
    const onPickerChange = () => {
      const map = _getLeafletMap();
      if (map) _loadOverlays(map, +_selectA.value, +_selectB.value);
    };
    selA.addEventListener('change', onPickerChange);
    selB.addEventListener('change', onPickerChange);

    // Instructions
    const hint = document.createElement('p');
    hint.className = 'compare-panel__hint';
    hint.textContent = 'Drag the bar on the map to compare flood extents.';
    _panel.appendChild(hint);
  }

  /**
   * Build the draggable divider bar overlaid on the map container.
   */
  function _buildDivider() {
    _removeDivider();

    _mapContainer = document.getElementById('map-container');
    if (!_mapContainer) return;

    const bar = document.createElement('div');
    bar.id = 'fm-compare-divider';
    bar.className = 'fm-compare-divider';
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-label', 'Drag to compare years');
    bar.style.left = `${_dividerPct}%`;

    // Handle icon — double-arrow
    bar.innerHTML = `
      <div class="fm-compare-divider__handle" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
          <path d="M8 12l-5 0M16 12l5 0" stroke="#14302E" stroke-width="2" stroke-linecap="round"/>
          <path d="M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" stroke="#14302E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="10" fill="#C9A84C" stroke="#14302E" stroke-width="1.5"/>
          <path d="M9 12l-2 0M15 12l2 0M7 12l2-2M7 12l2 2M17 12l-2-2M17 12l-2 2" stroke="#14302E" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>`;

    // Mouse events
    bar.addEventListener('mousedown', _onDividerMouseDown);
    // Touch events
    bar.addEventListener('touchstart', _onDividerTouchStart, { passive: false });

    _mapContainer.appendChild(bar);
    _dividerEl = bar;
  }

  function _removeDivider() {
    const existing = document.getElementById('fm-compare-divider');
    if (existing) existing.remove();
    _dividerEl = null;
  }

  /* ─────────────────────── drag logic ───────────────────────────── */

  function _onDividerMouseDown(e) {
    e.preventDefault();
    _dragging = true;
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup', _onMouseUp, { once: true });
  }

  function _onMouseMove(e) {
    if (!_dragging || !_mapContainer) return;
    const rect = _mapContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    _dividerPct = Math.max(5, Math.min(95, (x / rect.width) * 100));
    _applyClip();
  }

  function _onMouseUp() {
    _dragging = false;
    document.removeEventListener('mousemove', _onMouseMove);
  }

  function _onDividerTouchStart(e) {
    e.preventDefault();
    _dragging = true;
    document.addEventListener('touchmove', _onTouchMove, { passive: false });
    document.addEventListener('touchend', _onTouchEnd, { once: true });
  }

  function _onTouchMove(e) {
    if (!_dragging || !_mapContainer) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = _mapContainer.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    _dividerPct = Math.max(5, Math.min(95, (x / rect.width) * 100));
    _applyClip();
  }

  function _onTouchEnd() {
    _dragging = false;
    document.removeEventListener('touchmove', _onTouchMove);
  }

  /* ─────────────────────── Leaflet map ref ───────────────────────── */

  function _getLeafletMap() {
    // FM.map exposes the internal map via a getter; we probe the container
    const mc = document.getElementById('map-container');
    if (!mc) return null;
    // Leaflet stores map instance on the container's _leaflet_id key
    // but doesn't expose it publicly — we keep a lazy local reference via FM.map
    // which wraps the map. We'll ask map.js via a duck-typed internal getter.
    if (FM.map && FM.map._leafletMap) return FM.map._leafletMap;
    // Fallback: scan Leaflet's internal registry
    for (const key of Object.keys(mc)) {
      if (key.startsWith('_leaflet_') && mc[key] instanceof Object) {
        const candidate = mc[key];
        if (candidate && typeof candidate.getPane === 'function') return candidate;
      }
    }
    return null;
  }

  /* ─────────────────────── PUBLIC API ───────────────────────────── */

  /**
   * Open the compare panel.
   */
  function open() {
    if (_isOpen) return;
    _isOpen = true;

    _panel = document.getElementById('compare-panel');
    if (!_panel) return;

    _panel.removeAttribute('hidden');
    _panel.setAttribute('aria-hidden', 'false');
    _panel.classList.add('compare-open');

    _buildPanelUI();
    _buildDivider();

    // Load initial overlays
    const map = _getLeafletMap();
    if (map && _selectA && _selectB) {
      _loadOverlays(map, +_selectA.value, +_selectB.value);
    }

    FM.state.set('activePanel', 'compare');
  }

  /**
   * Close the compare panel, remove overlays, restore normal map state.
   */
  function close() {
    if (!_isOpen) return;
    _isOpen = false;

    // Remove overlay layers
    const map = _getLeafletMap();
    if (map) {
      if (_leftLayer)  { try { map.removeLayer(_leftLayer);  } catch(_){} }
      if (_rightLayer) { try { map.removeLayer(_rightLayer); } catch(_){} }
    }
    _leftLayer  = null;
    _rightLayer = null;

    // Remove divider
    _removeDivider();

    // Hide panel
    if (_panel) {
      _panel.classList.remove('compare-open');
      _panel.setAttribute('hidden', '');
      _panel.setAttribute('aria-hidden', 'true');
      _panel.innerHTML = '';
    }

    // Clean up drag listeners just in case
    document.removeEventListener('mousemove', _onMouseMove);
    document.removeEventListener('touchmove', _onTouchMove);

    if (FM.state.get('activePanel') === 'compare') {
      FM.state.set('activePanel', null);
    }
  }

  /* ─────────────────────── state wiring ─────────────────────────── */

  FM.state.on('compareOpen', function (val) {
    if (val) open(); else close();
  });

  return { open, close };

}());
