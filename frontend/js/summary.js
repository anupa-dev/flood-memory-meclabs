// summary.js — Location summary panel
// FM.summary: loads and renders the location summary ledger panel.
// Triggered by activePoint, activeYear, and activeRadius state changes.

'use strict';

window.FM = window.FM || {};

(function () {

  // ── Sentinel so concurrent loads don't race ────────────────────────────────
  let _loadId = 0;

  // ── Track last loaded point to avoid redundant fetches ────────────────────
  let _lastLat = null;
  let _lastLon = null;
  let _lastRadius = null;
  let _lastData = null;

  // ── Compute all years dynamically from DATA_YEARS or fallback ──────────────
  function _getAllYears() {
    const dataYears = (typeof DATA_YEARS !== 'undefined' && Array.isArray(DATA_YEARS) && DATA_YEARS.length)
      ? DATA_YEARS
      : [2018, 2019, 2021, 2022, 2023, 2025];
    const mn = Math.min(...dataYears);
    const mx = Math.max(...dataYears);
    const years = [];
    for (let y = mn; y <= mx; y++) {
      years.push(y);
    }
    return years;
  }

  // ── Grab the panel element ─────────────────────────────────────────────────
  function _panel() {
    return document.getElementById('summary-panel');
  }

  // ── Open / close animation ─────────────────────────────────────────────────
  function _open() {
    const p = _panel();
    if (!p) return;
    p.setAttribute('aria-hidden', 'false');
    // Force reflow so the transition fires even on first open
    void p.offsetWidth;
    p.classList.add('summary-open');
  }

  function _close() {
    const p = _panel();
    if (!p) return;
    p.classList.remove('summary-open');
    p.setAttribute('aria-hidden', 'true');
  }

  // ── Loading shimmer ────────────────────────────────────────────────────────
  function _showLoading() {
    const p = _panel();
    if (!p) return;
    _open();
    p.innerHTML = `
      <div class="summary-inner binding-edge panel-texture">
        <div class="summary-loading" aria-label="Loading summary" role="status">
          <div class="loading-shimmer shimmer-line shimmer-line--wide"></div>
          <div class="loading-shimmer shimmer-line shimmer-line--narrow"></div>
          <div class="loading-shimmer shimmer-line shimmer-line--wide"></div>
          <div class="loading-shimmer shimmer-block"></div>
          <div class="loading-shimmer shimmer-line shimmer-line--narrow"></div>
          <div class="loading-shimmer shimmer-line shimmer-line--mid"></div>
        </div>
      </div>`;
  }

  // ── Error display ──────────────────────────────────────────────────────────
  function _showError(message) {
    const p = _panel();
    if (!p) return;
    _open();
    p.innerHTML = `
      <div class="summary-inner binding-edge panel-texture">
        <div class="summary-header">
          <button class="summary-close btn btn--ghost" aria-label="Close summary panel">✕</button>
        </div>
        <div class="summary-error" role="alert">
          <p>${_esc(message)}</p>
        </div>
      </div>`;
    _bindClose();
  }

  // ── Escape HTML ────────────────────────────────────────────────────────────
  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Format coordinate display ──────────────────────────────────────────────
  function _fmtCoord(val, posLabel, negLabel) {
    const abs = Math.abs(val).toFixed(5);
    return `${abs}°\u202F${val >= 0 ? posLabel : negLabel}`;
  }

  // ── Build gauge bar row ────────────────────────────────────────────────────
  function _buildGaugeBars(byYear, activeYear) {
    const container = document.createElement('div');
    container.className = 'gauge-bar-row';
    container.setAttribute('role', 'list');
    container.setAttribute('aria-label', 'Year-by-year inundation breakdown');

    _getAllYears().forEach(function (year) {
      const yrStr = String(year);
      const item = byYear ? byYear[yrStr] : null;
      const isActive = Number(activeYear) === year;

      const wrapper = document.createElement('div');
      wrapper.className = 'gauge-bar-wrap';
      wrapper.setAttribute('role', 'listitem');

      const bar = document.createElement('div');
      bar.className = 'gauge-bar';

      if (!item) {
        // No record for this year
        bar.classList.add('gauge-bar--no-record');
        bar.setAttribute('title', `${year}: no satellite record`);
        const noRecLabel = document.createElement('span');
        noRecLabel.className = 'gauge-bar__no-record-label';
        noRecLabel.textContent = 'no record';
        wrapper.appendChild(bar);
        wrapper.appendChild(noRecLabel);
      } else if (item.inundation_within_radius) {
        // Flooded year — tall blue bar
        bar.classList.add('gauge-bar--flooded');
        const distTxt = item.distance_to_inundation_m != null
          ? `${Math.round(item.distance_to_inundation_m)} m to inundation`
          : 'inundation present';
        bar.setAttribute('title', `${year}: ${distTxt}`);
        bar.setAttribute('aria-label', `${year}: flooded, ${distTxt}`);
        wrapper.appendChild(bar);
      } else {
        // Checked, no flood — short paddy green bar
        bar.classList.add('gauge-bar--clear');
        bar.setAttribute('title', `${year}: no inundation within radius`);
        bar.setAttribute('aria-label', `${year}: no inundation observed`);
        wrapper.appendChild(bar);
      }

      if (isActive) {
        bar.classList.add('gauge-bar--active');
        bar.setAttribute('aria-current', 'true');
      }

      // Year label below the bar
      const label = document.createElement('span');
      label.className = 'gauge-bar__year';
      label.textContent = `'${yrStr.slice(2)}`;
      wrapper.appendChild(label);

      // Hover tooltip (accessible via title + native tooltip)
      wrapper.addEventListener('mouseenter', function () {
        wrapper.classList.add('gauge-bar-wrap--hover');
      });
      wrapper.addEventListener('mouseleave', function () {
        wrapper.classList.remove('gauge-bar-wrap--hover');
      });

      // Click on bar → change active year
      wrapper.addEventListener('click', function () {
        if (item) {
          FM.state.set('activeYear', year);
        }
      });
      if (item) {
        wrapper.style.cursor = 'pointer';
        wrapper.setAttribute('tabindex', '0');
        wrapper.setAttribute('role', 'button');
        wrapper.setAttribute('aria-label', `Select year ${year}`);
        wrapper.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            FM.state.set('activeYear', year);
          }
        });
      }

      container.appendChild(wrapper);
    });

    return container;
  }

  // ── Radius stepper ─────────────────────────────────────────────────────────
  function _buildRadiusStepper(currentRadius) {
    const wrapper = document.createElement('div');
    wrapper.className = 'radius-stepper';

    const lbl = document.createElement('label');
    lbl.className = 'radius-stepper__label';
    lbl.textContent = 'Search radius';
    lbl.id = 'radius-stepper-label';

    const controls = document.createElement('div');
    controls.className = 'radius-stepper__controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-labelledby', 'radius-stepper-label');

    const btnMinus = document.createElement('button');
    btnMinus.className = 'btn btn--ghost radius-stepper__btn';
    btnMinus.textContent = '−';
    btnMinus.setAttribute('aria-label', 'Decrease radius by 100 m');

    const display = document.createElement('span');
    display.className = 'radius-stepper__value';
    display.setAttribute('aria-live', 'polite');
    display.textContent = `${currentRadius} m`;

    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn btn--ghost radius-stepper__btn';
    btnPlus.textContent = '+';
    btnPlus.setAttribute('aria-label', 'Increase radius by 100 m');

    const STEP = 100;
    const MIN = 50;
    const MAX = 2000;

    let r = currentRadius;

    function _updateBtnState() {
      btnMinus.disabled = r <= MIN;
      btnPlus.disabled = r >= MAX;
      btnMinus.setAttribute('aria-disabled', String(r <= MIN));
      btnPlus.setAttribute('aria-disabled', String(r >= MAX));
    }
    _updateBtnState();

    btnMinus.addEventListener('click', function () {
      if (r <= MIN) return;
      r = Math.max(MIN, r - STEP);
      display.textContent = `${r} m`;
      _updateBtnState();
      FM.state.set('activeRadius', r);
    });

    btnPlus.addEventListener('click', function () {
      if (r >= MAX) return;
      r = Math.min(MAX, r + STEP);
      display.textContent = `${r} m`;
      _updateBtnState();
      FM.state.set('activeRadius', r);
    });

    controls.appendChild(btnMinus);
    controls.appendChild(display);
    controls.appendChild(btnPlus);
    wrapper.appendChild(lbl);
    wrapper.appendChild(controls);

    return wrapper;
  }

  // ── Bind close button inside the panel ────────────────────────────────────
  function _bindClose() {
    const closeBtn = _panel() && _panel().querySelector('.summary-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        FM.state.set('activePanel', null);
        _close();
      });
    }
  }

  // ── Render a fully-loaded summary ─────────────────────────────────────────
  function _render(data, activeYear, radius) {
    const p = _panel();
    if (!p) return;

    const lat = data.lat;
    const lon = data.lon;
    const elevM = data.elevation_m != null ? data.elevation_m.toFixed(1) : '—';
    const elevNote = data.elevation_note || '';
    const distWater = data.distance_to_nearest_waterway_m != null
      ? Math.round(data.distance_to_nearest_waterway_m)
      : '—';
    const yearsWithFlood = data.years_with_nearby_inundation;
    const yearsChecked = data.years_checked;
    const byYear = data.by_year || {};
    const noteText = data.note || '';

    const latStr = _fmtCoord(lat, 'N', 'S');
    const lonStr = _fmtCoord(lon, 'E', 'W');
    const radiusDisplay = `${radius} m`;

    // ── Build HTML string for static parts ──
    const staticHTML = `
      <div class="summary-inner binding-edge panel-texture">

        <header class="summary-header">
          <div class="summary-coords" aria-label="Location coordinates">
            <span class="summary-coords__lat">${_esc(latStr)}</span>
            <span class="summary-coords__sep">,&thinsp;</span>
            <span class="summary-coords__lon">${_esc(lonStr)}</span>
          </div>
          <span class="summary-radius-badge" aria-label="Search radius ${radiusDisplay}">
            radius: ${_esc(radiusDisplay)}
          </span>
          <button class="summary-close btn btn--ghost" aria-label="Close summary panel">✕</button>
        </header>

        <div class="summary-lead" aria-live="polite">
          Satellite data shows inundation within <strong>${_esc(radiusDisplay)}</strong>
          in <strong>${yearsWithFlood}</strong> of <strong>${yearsChecked}</strong> years.
        </div>

        <div class="summary-facts">
          <div class="summary-fact">
            <span class="summary-fact__label">Elevation</span>
            <span class="summary-fact__value">${_esc(elevM)} m above sea level</span>
            ${elevNote ? `<em class="summary-fact__note">${_esc(elevNote)} <span class="summary-fact__source">(approximate, SRTM data)</span></em>` : '<em class="summary-fact__note"><span class="summary-fact__source">(approximate, SRTM data)</span></em>'}
          </div>
          <div class="summary-fact">
            <span class="summary-fact__label">Nearest waterway</span>
            <span class="summary-fact__value">${_esc(String(distWater))} m to nearest waterway</span>
          </div>
        </div>

        <div class="summary-gauge-section" id="summary-gauge-mount"></div>

        <div class="summary-radius-section" id="summary-radius-mount"></div>

        ${noteText ? `<div class="summary-note">${_esc(noteText)}</div>` : ''}

        <footer class="summary-disclaimer">
          Historical satellite-observed inundation near this location.
          Not proof that a specific building flooded.
        </footer>

      </div>`;

    p.innerHTML = staticHTML;

    // Mount the gauge bars (DOM nodes, not innerHTML, to attach events)
    const gaugeMount = p.querySelector('#summary-gauge-mount');
    if (gaugeMount) {
      gaugeMount.appendChild(_buildGaugeBars(byYear, activeYear));
    }

    // Mount radius stepper
    const radiusMount = p.querySelector('#summary-radius-mount');
    if (radiusMount) {
      radiusMount.appendChild(_buildRadiusStepper(radius));
    }

    _bindClose();
    _open();
  }

  // ── Re-render gauge bars only (year changed, same data) ───────────────────
  function _rerenderGauge(activeYear) {
    const mount = _panel() && _panel().querySelector('#summary-gauge-mount');
    if (!mount || !_lastData) return;
    mount.innerHTML = '';
    mount.appendChild(_buildGaugeBars(_lastData.by_year || {}, activeYear));
  }

  // ── Core load function ─────────────────────────────────────────────────────
  async function load(lat, lon, radius) {
    _loadId += 1;
    const thisLoad = _loadId;

    _showLoading();

    let res;
    try {
      res = await FM.api.summary(lat, lon, radius);
    } catch (err) {
      if (thisLoad !== _loadId) return; // superseded
      if (err && err.offline) {
        _showError("Can't reach the Flood Map server. Check that it's running on port 5000.");
      } else {
        _showError('An unexpected error occurred loading the summary.');
      }
      return;
    }

    if (thisLoad !== _loadId) return; // superseded by a later click

    // FM.api.summary returns the raw Response object's .json() — it doesn't
    // throw on HTTP errors; we check status via a wrapper. Because api.js calls
    // res.json() directly (no status check), we have to inspect the data for
    // our error codes. If the server ever sends JSON with a "status" field we
    // use that; otherwise fall through.

    // Handle server-side error shapes: { error: "...", status: 400|422|503 }
    if (res && (res.status || res.error)) {
      const s = res.status;
      const errText = (res.error || '').toLowerCase();
      if (s === 400 || errText.includes('lat and lon') || errText.includes('required')) {
        _showError('Coordinates are missing. Click the map or use the search to pick a place.');
        return;
      }
      if (s === 422 || errText.includes('outside')) {
        _showError('That place is outside the area we have satellite data for so far.');
        return;
      }
      if (s === 503 || errText.includes('summary data could not be loaded')) {
        _showError('Summary data is still loading. Try again in a moment.');
        return;
      }
      if (s >= 400 || res.error) {
        _showError(res.error || 'An unexpected error occurred loading the summary.');
        return;
      }
    }

    // Guard: minimal shape check
    if (!res || res.lat == null) {
      _showError('Received an unexpected response from the server.');
      return;
    }

    _lastData = res;
    _lastLat = lat;
    _lastLon = lon;
    _lastRadius = radius;

    _render(res, FM.state.get('activeYear'), radius);
  }

  // ── State subscriptions ────────────────────────────────────────────────────
  function _init() {
    FM.state.on('activePoint', function (point) {
      if (!point) {
        _close();
        return;
      }
      const lat = point.lat !== undefined ? point.lat : point[0];
      const lon = point.lon !== undefined ? point.lon : point[1];
      if (lat == null || lon == null) return;
      const radius = FM.state.get('activeRadius') || 500;
      FM.state.set('activePanel', 'summary');
      load(lat, lon, radius);
    });

    FM.state.on('activeRadius', function (radius) {
      const point = FM.state.get('activePoint');
      if (!point) return;
      const lat = point.lat !== undefined ? point.lat : point[0];
      const lon = point.lon !== undefined ? point.lon : point[1];
      if (lat == null || lon == null) return;
      load(lat, lon, radius);
    });

    FM.state.on('activeYear', function (year) {
      // Only re-render bars; don't refetch (year doesn't affect summary API)
      if (_lastData) {
        _rerenderGauge(year);
      }
    });

    // Close panel when activePanel is cleared by another module
    FM.state.on('activePanel', function (panel) {
      if (panel !== 'summary') {
        _close();
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  FM.summary = {
    load,
    init: _init,
    close: _close
  };

  // Auto-init once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
