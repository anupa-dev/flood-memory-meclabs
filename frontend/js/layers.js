// layers.js — Road, waterway, and basemap layer controls
// FM.layers: manages GeoJSON overlays and the #layer-controls toggle panel.

'use strict';

window.FM = window.FM || {};

(function () {

  // ── Internal state ─────────────────────────────────────────────────────────
  const _s = {
    roads: null,       // cached GeoJSON FeatureCollection
    waterways: null,   // cached GeoJSON FeatureCollection

    roadsLayer: null,     // active L.geoJSON layer instance (roads)
    waterwaysLayer: null, // active L.geoJSON layer instance (waterways)

    roadsVisible: false,
    waterwaysVisible: false,
    basemapMode: 'street', // 'street' | 'satellite'

    // Buttons — stored so we can toggle .active / aria-pressed externally
    btnRoads: null,
    btnWaterways: null,
    btnBasemap: null,

    // Unsubscribe handle for the activeYear listener
    _yearUnsub: null
  };

  // ── Basemap tile layers (created lazily) ───────────────────────────────────
  let _streetTile = null;
  let _satelliteTile = null;

  // ── SVG helper ─────────────────────────────────────────────────────────────
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function _svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
    }
    return el;
  }

  function _svg(w, h, children, titleText) {
    const root = _svgEl('svg', {
      xmlns: SVG_NS,
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      'aria-hidden': 'true',
      focusable: 'false',
      fill: 'currentColor'
    });
    if (titleText) {
      const t = _svgEl('title');
      t.textContent = titleText;
      root.appendChild(t);
    }
    children.forEach(function (c) { root.appendChild(c); });
    return root;
  }

  // ── Icon: milestone stone (rounded-bottom rectangle = roads) ─────────────
  function _iconRoads() {
    // Tall rectangle, slightly wider top, rounded bottom — roadside milestone
    const stone = _svgEl('path', {
      d: 'M6 1 h8 a2 2 0 0 1 2 2 v12 a3 3 0 0 1-3 3 H9 a3 3 0 0 1-3-3 V3 a2 2 0 0 1 2-2 Z',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      fill: 'none'
    });
    // Small horizontal line detail on the stone
    const line = _svgEl('line', {
      x1: '7', y1: '7', x2: '13', y2: '7',
      stroke: 'currentColor', 'stroke-width': '1'
    });
    return _svg(20, 20, [stone, line], 'Roads layer');
  }

  // ── Icon: canal-wave (wavy horizontal line = waterways) ──────────────────
  function _iconWaterways() {
    // A wavy polyline — simple sine wave approximation with cubic beziers
    const wave = _svgEl('path', {
      d: 'M1 10 C3 7, 5 7, 7 10 C9 13, 11 13, 13 10 C15 7, 17 7, 19 10',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      fill: 'none',
      'stroke-linecap': 'round'
    });
    // A second wave slightly below
    const wave2 = _svgEl('path', {
      d: 'M1 14 C3 11, 5 11, 7 14 C9 17, 11 17, 13 14 C15 11, 17 11, 19 14',
      stroke: 'currentColor',
      'stroke-width': '1.2',
      fill: 'none',
      'stroke-linecap': 'round',
      opacity: '0.55'
    });
    return _svg(20, 20, [wave, wave2], 'Waterways layer');
  }

  // ── Icon: porthole circle (basemap toggle) ────────────────────────────────
  function _iconBasemap() {
    const outer = _svgEl('circle', {
      cx: '10', cy: '10', r: '8',
      stroke: 'currentColor', 'stroke-width': '1.8', fill: 'none'
    });
    const inner = _svgEl('circle', {
      cx: '10', cy: '10', r: '4',
      stroke: 'currentColor', 'stroke-width': '1', fill: 'none', opacity: '0.6'
    });
    // Cross-hairs for porthole feel
    const h = _svgEl('line', {
      x1: '2', y1: '10', x2: '7', y2: '10',
      stroke: 'currentColor', 'stroke-width': '1', opacity: '0.5'
    });
    const h2 = _svgEl('line', {
      x1: '13', y1: '10', x2: '18', y2: '10',
      stroke: 'currentColor', 'stroke-width': '1', opacity: '0.5'
    });
    const v = _svgEl('line', {
      x1: '10', y1: '2', x2: '10', y2: '7',
      stroke: 'currentColor', 'stroke-width': '1', opacity: '0.5'
    });
    const v2 = _svgEl('line', {
      x1: '10', y1: '13', x2: '10', y2: '18',
      stroke: 'currentColor', 'stroke-width': '1', opacity: '0.5'
    });
    return _svg(20, 20, [outer, inner, h, h2, v, v2], 'Basemap toggle');
  }

  // ── Waterway stroke width by feature type ─────────────────────────────────
  function _waterwayWeight(feature) {
    if (!feature || !feature.properties) return 2;
    const type = (feature.properties.waterway || feature.properties.type || '').toLowerCase();
    if (type === 'river') return 3;
    if (type === 'canal') return 2;
    return 1.5;
  }

  // ── Road styling for a given year ─────────────────────────────────────────
  function _roadStyle(feature, year) {
    const yr = String(year);
    const props = (feature && feature.properties) ? feature.properties : {};
    const floodedKey = `flooded_${yr}`;
    const nearKey    = `near_${yr}`;

    // Check if the year was analysed at all (the flooded_YYYY key exists in
    // the first feature of the dataset — handled per-feature below)
    if (floodedKey in props && props[floodedKey]) {
      return { color: '#8E3B2A', weight: 2.5, opacity: 1 };
    }
    if (nearKey in props && props[nearKey]) {
      return { color: '#B8892B', weight: 2, opacity: 0.7 };
    }
    return { color: '#444444', weight: 1.5, opacity: 0.6 };
  }

  // ── Check if road overlap was analysed for a year ─────────────────────────
  // We decide by sampling the first feature for the flooded_YYYY key.
  function _roadYearAnalysed(geojson, year) {
    if (!geojson || !geojson.features || geojson.features.length === 0) return false;
    const yr = String(year);
    const key = `flooded_${yr}`;
    // If ANY feature has the key (even if false), it was analysed
    return geojson.features.some(function (f) {
      return f.properties && key in f.properties;
    });
  }

  // ── Show / hide the roads overlap note ────────────────────────────────────
  function _setRoadNote(msg) {
    FM.state.set('roadOverlapNote', msg || null);
    // Also visually surface the note near the button if it's in the DOM
    const noteEl = document.getElementById('layer-road-note');
    if (noteEl) {
      noteEl.textContent = msg || '';
      noteEl.style.display = msg ? '' : 'none';
    }
  }

  // ── Roads: show for a given year ──────────────────────────────────────────
  function showRoads(year) {
    if (!FM.map) {
      console.warn('[FM.layers] FM.map not available yet');
      return;
    }
    if (!_s.roads) {
      console.warn('[FM.layers] Road data not loaded');
      return;
    }

    // Remove existing layer
    if (_s.roadsLayer) {
      FM.map.removeLayer(_s.roadsLayer);
      _s.roadsLayer = null;
    }

    const analysed = _roadYearAnalysed(_s.roads, year);

    if (!analysed) {
      // Draw all roads plain grey; emit note
      _s.roadsLayer = L.geoJSON(_s.roads, {
        style: function () {
          return { color: '#888888', weight: 1.5, opacity: 0.5 };
        }
      }).addTo(FM.map);
      _setRoadNote('Road overlap not analysed for this year.');
    } else {
      _s.roadsLayer = L.geoJSON(_s.roads, {
        style: function (feature) {
          return _roadStyle(feature, year);
        }
      }).addTo(FM.map);
      _setRoadNote(null);
    }

    _s.roadsVisible = true;
    if (_s.btnRoads) {
      _s.btnRoads.classList.add('active');
      _s.btnRoads.setAttribute('aria-pressed', 'true');
    }
  }

  function hideRoads() {
    if (_s.roadsLayer && FM.map) {
      FM.map.removeLayer(_s.roadsLayer);
      _s.roadsLayer = null;
    }
    _s.roadsVisible = false;
    _setRoadNote(null);
    if (_s.btnRoads) {
      _s.btnRoads.classList.remove('active');
      _s.btnRoads.setAttribute('aria-pressed', 'false');
    }
  }

  // ── Waterways: show ────────────────────────────────────────────────────────
  function showWaterways() {
    if (!FM.map) {
      console.warn('[FM.layers] FM.map not available yet');
      return;
    }
    if (!_s.waterways) {
      console.warn('[FM.layers] Waterway data not loaded');
      return;
    }

    if (_s.waterwaysLayer) {
      FM.map.removeLayer(_s.waterwaysLayer);
      _s.waterwaysLayer = null;
    }

    _s.waterwaysLayer = L.geoJSON(_s.waterways, {
      style: function (feature) {
        return {
          color: '#7FA9A6',
          weight: _waterwayWeight(feature),
          opacity: 1,
          fill: false
          // No dashArray — one clean line
        };
      },
      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};
        const name = props.name;
        if (!name) return;

        // Label only major/named waterways
        // "Long enough" = geometry length heuristic via bounds diagonal
        let isLong = true;
        try {
          const bounds = layer.getBounds();
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          const dLat = ne.lat - sw.lat;
          const dLon = ne.lng - sw.lng;
          const diag = Math.sqrt(dLat * dLat + dLon * dLon);
          isLong = diag > 0.01; // ~1 km in degrees
        } catch (_) {
          isLong = true;
        }

        if (isLong) {
          layer.bindTooltip(name, {
            permanent: true,
            className: 'waterway-label',
            direction: 'center'
          });
        }
      }
    }).addTo(FM.map);

    _s.waterwaysVisible = true;
    if (_s.btnWaterways) {
      _s.btnWaterways.classList.add('active');
      _s.btnWaterways.setAttribute('aria-pressed', 'true');
    }
  }

  function hideWaterways() {
    if (_s.waterwaysLayer && FM.map) {
      FM.map.removeLayer(_s.waterwaysLayer);
      _s.waterwaysLayer = null;
    }
    _s.waterwaysVisible = false;
    if (_s.btnWaterways) {
      _s.btnWaterways.classList.remove('active');
      _s.btnWaterways.setAttribute('aria-pressed', 'false');
    }
  }

  // ── Basemap cycle: street ↔ satellite ─────────────────────────────────────
  function cycleBasemap() {
    if (!FM.map) return;
    if (_s.basemapMode === 'street') {
      _s.basemapMode = 'satellite';
      if (FM.map.toggleBasemap) FM.map.toggleBasemap('satellite');
      if (_s.btnBasemap) {
        _s.btnBasemap.classList.add('active');
        _s.btnBasemap.setAttribute('aria-pressed', 'true');
        _s.btnBasemap.setAttribute('aria-label', 'Basemap: satellite (click to switch to street)');
      }
    } else {
      _s.basemapMode = 'street';
      if (FM.map.toggleBasemap) FM.map.toggleBasemap('street');
      if (_s.btnBasemap) {
        _s.btnBasemap.classList.remove('active');
        _s.btnBasemap.setAttribute('aria-pressed', 'false');
        _s.btnBasemap.setAttribute('aria-label', 'Basemap: street (click to switch to satellite)');
      }
    }
  }

  // ── Icon: compare (two overlapping frames with divider) ───────────────────
  function _iconCompare() {
    const left = _svgEl('rect', {
      x: '3', y: '4', width: '7', height: '12', rx: '1',
      stroke: 'currentColor', 'stroke-width': '1.3', fill: 'none'
    });
    const right = _svgEl('rect', {
      x: '10', y: '4', width: '7', height: '12', rx: '1',
      stroke: 'currentColor', 'stroke-width': '1.3', fill: 'none'
    });
    const div = _svgEl('line', {
      x1: '10', y1: '2', x2: '10', y2: '18',
      stroke: 'currentColor', 'stroke-width': '1.5'
    });
    return _svg(20, 20, [left, right, div], 'Compare years');
  }

  // ── Icon: report (paper slip pinned to pole) ──────────────────────────────
  function _iconReport() {
    const pole = _svgEl('line', {
      x1: '10', y1: '2', x2: '10', y2: '18',
      stroke: 'currentColor', 'stroke-width': '1.5'
    });
    const slip = _svgEl('path', {
      d: 'M6 5 h7 l2 2 v8 h-9 z',
      stroke: 'currentColor', 'stroke-width': '1.2', fill: 'none'
    });
    const pin = _svgEl('circle', {
      cx: '10', cy: '4', r: '1.5',
      fill: 'currentColor', stroke: 'none'
    });
    return _svg(20, 20, [pole, slip, pin], 'Add community report');
  }

  // ── Build a toggle button ─────────────────────────────────────────────────
  function _makeToggleBtn(id, icon, label, onClick) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'layer-btn layer-toggle-btn btn btn--ghost';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.appendChild(icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── Build the layer controls UI ───────────────────────────────────────────
  function _buildControls() {
    const container = document.getElementById('layer-controls');
    if (!container) return;
    container.innerHTML = '';

    // Roads button
    _s.btnRoads = _makeToggleBtn('btn-layer-roads', _iconRoads(), 'Toggle roads layer', function () {
      if (_s.roadsVisible) {
        hideRoads();
      } else {
        const year = FM.state.get('activeYear') || 2021;
        showRoads(year);
      }
    });

    // Road note element (shown when overlap not analysed)
    const roadNote = document.createElement('span');
    roadNote.id = 'layer-road-note';
    roadNote.className = 'layer-road-note';
    roadNote.style.display = 'none';

    // Waterways button
    _s.btnWaterways = _makeToggleBtn('btn-layer-waterways', _iconWaterways(), 'Toggle waterways layer', function () {
      if (_s.waterwaysVisible) {
        hideWaterways();
      } else {
        showWaterways();
      }
    });

    // Basemap button
    _s.btnBasemap = _makeToggleBtn(
      'btn-layer-basemap',
      _iconBasemap(),
      'Basemap: street (click to switch to satellite)',
      cycleBasemap
    );

    // Compare button
    const btnCompare = _makeToggleBtn(
      'btn-layer-compare',
      _iconCompare(),
      'Compare flood extents between two years',
      function () {
        if (FM.compare && FM.compare.open) {
          FM.compare.open();
        } else {
          FM.state.set('compareOpen', true);
        }
      }
    );

    // Add report button
    const btnReport = _makeToggleBtn(
      'btn-layer-reports',
      _iconReport(),
      'Submit community report',
      function () {
        if (FM.reports && FM.reports.openForm) {
          FM.reports.openForm();
        }
      }
    );

    container.appendChild(_s.btnRoads);
    container.appendChild(roadNote);
    container.appendChild(_s.btnWaterways);
    container.appendChild(_s.btnBasemap);
    container.appendChild(btnCompare);
    container.appendChild(btnReport);
  }

  // ── Init: load data, build controls ───────────────────────────────────────
  async function init() {
    // Build UI immediately so buttons appear even before data loads
    _buildControls();

    // Listen for year changes to reapply road colours
    if (_s._yearUnsub) _s._yearUnsub();
    _s._yearUnsub = FM.state.on('activeYear', function (year) {
      if (_s.roadsVisible) {
        showRoads(year);
      }
    });

    // Load GeoJSON data once
    const [roadsResult, waterwaysResult] = await Promise.allSettled([
      FM.api.roads(),
      FM.api.waterways()
    ]);

    if (roadsResult.status === 'fulfilled') {
      FM.layers._roads = roadsResult.value;
      _s.roads = roadsResult.value;
    } else {
      console.error('[FM.layers] Failed to load roads:', roadsResult.reason);
    }

    if (waterwaysResult.status === 'fulfilled') {
      FM.layers._waterways = waterwaysResult.value;
      _s.waterways = waterwaysResult.value;
    } else {
      console.error('[FM.layers] Failed to load waterways:', waterwaysResult.reason);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  FM.layers = {
    _roads: null,
    _waterways: null,

    init,
    showRoads,
    hideRoads,
    showWaterways,
    hideWaterways,
    cycleBasemap
  };

})();
