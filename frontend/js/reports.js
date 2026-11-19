// reports.js — Community reports markers and submission form
// FM.reports: renders ground evidence markers on the map and manages user report submissions.

'use strict';

window.FM = window.FM || {};

FM.reports = (function () {

  let _markersLayer = null;
  let _pickingLocation = false;
  let _pickedCoords = null;

  function _panel() {
    return document.getElementById('report-panel');
  }

  function _getMap() {
    if (FM.map && FM.map.getMap) return FM.map.getMap();
    if (FM.map && FM.map._leafletMap) return FM.map._leafletMap;
    const mc = document.getElementById('map-container');
    if (!mc) return null;
    for (const key of Object.keys(mc)) {
      if (key.startsWith('_leaflet_') && mc[key] && typeof mc[key].getPane === 'function') {
        return mc[key];
      }
    }
    return null;
  }

  // ── Custom SVG marker for community report (paper slip with pin) ───────────
  function _createReportMarkerIcon() {
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
  <!-- Pole pin shadow -->
  <line x1="15" y1="24" x2="15" y2="37" stroke="#14302E" stroke-width="2.2" stroke-linecap="round"/>
  <!-- Paper slip -->
  <path d="M 6 8 L 20 8 L 24 12 L 24 24 L 6 24 Z" fill="#E4EBE5" stroke="#14302E" stroke-width="1.3"/>
  <path d="M 20 8 L 20 12 L 24 12 Z" fill="#C8CECC" stroke="#14302E" stroke-width="1"/>
  <!-- Ruled note lines -->
  <line x1="9" y1="13" x2="18" y2="13" stroke="#14302E" stroke-width="0.9" opacity="0.6"/>
  <line x1="9" y1="16.5" x2="21" y2="16.5" stroke="#14302E" stroke-width="0.9" opacity="0.6"/>
  <line x1="9" y1="20" x2="17" y2="20" stroke="#14302E" stroke-width="0.9" opacity="0.6"/>
  <!-- Pin head (laterite with gold accent) -->
  <circle cx="15" cy="7" r="3" fill="#8E3B2A" stroke="#B8892B" stroke-width="1.2"/>
</svg>`.trim();

    return L.divIcon({
      html: svg,
      className: 'fm-report-marker',
      iconSize: [30, 38],
      iconAnchor: [15, 37],
      popupAnchor: [0, -38]
    });
  }

  // ── Format date ────────────────────────────────────────────────────────────
  function _formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const day = d.getDate();
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      return `Reported: ${day} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    } catch (_) {
      return isoStr;
    }
  }

  // ── Load and display reports for a year ─────────────────────────────────────
  async function loadReportsForYear(year) {
    const map = _getMap();
    if (!map) return;

    if (_markersLayer) {
      map.removeLayer(_markersLayer);
      _markersLayer = null;
    }

    if (!year) return;

    let reports = [];
    try {
      reports = await FM.api.reports(year);
    } catch (err) {
      console.warn('[FM.reports] Failed to load reports for year', year, err);
      return;
    }

    if (!Array.isArray(reports) || reports.length === 0) return;

    const group = L.layerGroup();

    reports.forEach(function (r) {
      if (r.lat == null || r.lon == null) return;
      const marker = L.marker([r.lat, r.lon], {
        icon: _createReportMarkerIcon(),
        title: `Community report: ${r.event_year || ''}`
      });

      const waterLevelText = r.water_level_cm != null
        ? `<div class="report-popup__stat"><strong>${r.water_level_cm} cm</strong> water level reported</div>`
        : '';

      const photoHtml = r.photo_url
        ? `<div class="report-popup__photo-wrap"><img src="${r.photo_url}" alt="Report photograph" class="report-popup__photo" loading="lazy" /></div>`
        : '';

      const descHtml = r.description
        ? `<p class="report-popup__desc">${_esc(r.description)}</p>`
        : '';

      const dateHtml = r.created_at
        ? `<div class="report-popup__date">${_formatDate(r.created_at)}</div>`
        : '';

      const popupContent = `
        <div class="report-popup panel-texture">
          <div class="report-popup__badge">Community report</div>
          ${waterLevelText}
          ${descHtml}
          ${photoHtml}
          ${dateHtml}
          <div class="report-popup__disclaimer">
            This is ground evidence from a community member. Reviewed before publication.
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, {
        className: 'fm-custom-popup',
        maxWidth: 280,
        minWidth: 220
      });

      group.addLayer(marker);
    });

    group.addTo(map);
    _markersLayer = group;
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Open Form Panel ────────────────────────────────────────────────────────
  function openForm(defaultLat, defaultLon) {
    const p = _panel();
    if (!p) return;

    FM.state.set('activePanel', 'report');

    let initLat = defaultLat;
    let initLon = defaultLon;

    if (initLat == null || initLon == null) {
      const pt = FM.state.get('activePoint');
      if (pt) {
        initLat = pt.lat !== undefined ? pt.lat : pt[0];
        initLon = pt.lon !== undefined ? pt.lon : pt[1];
      }
    }

    _pickedCoords = (initLat != null && initLon != null) ? { lat: initLat, lon: initLon } : null;

    const currentYear = new Date().getFullYear();
    const activeYear = FM.state.get('activeYear') || currentYear;

    let yearOptions = '';
    for (let y = currentYear; y >= 2000; y--) {
      yearOptions += `<option value="${y}" ${y === activeYear ? 'selected' : ''}>${y}</option>`;
    }

    const coordsDisplay = _pickedCoords
      ? `${_pickedCoords.lat.toFixed(5)}, ${_pickedCoords.lon.toFixed(5)}`
      : 'Click map or choose below';

    p.innerHTML = `
      <div class="summary-inner binding-edge panel-texture" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <header class="report-panel-header">
          <h2>Submit community report</h2>
          <button type="button" class="report-close btn btn--ghost" aria-label="Close report panel">✕</button>
        </header>

        <form id="fm-report-form" class="report-body" novalidate style="flex:1;overflow-y:auto;padding:var(--space-4);">
          <div class="report-field">
            <label for="report-coords-btn">Location coordinates</label>
            <div style="display:flex;gap:var(--space-2);align-items:center;">
              <span id="report-coords-text" style="font-family:var(--font-sans);font-size:var(--text-xs);color:var(--color-night);font-weight:500;">
                ${coordsDisplay}
              </span>
              <button type="button" id="report-coords-btn" class="btn btn--secondary" style="font-size:var(--text-2xs);padding:var(--space-1) var(--space-2);">
                Pick on map
              </button>
            </div>
            <input type="hidden" name="lat" id="report-lat" value="${_pickedCoords ? _pickedCoords.lat : ''}">
            <input type="hidden" name="lon" id="report-lon" value="${_pickedCoords ? _pickedCoords.lon : ''}">
          </div>

          <div class="report-field">
            <label for="report-year">Year of observation</label>
            <select name="event_year" id="report-year" required>
              ${yearOptions}
            </select>
          </div>

          <div class="report-field">
            <label for="report-water-level">Water level (cm)</label>
            <input type="number" name="water_level_cm" id="report-water-level" placeholder="e.g. 75" min="0" max="1000" step="1">
          </div>

          <div class="report-field">
            <label for="report-description">Description</label>
            <textarea name="description" id="report-description" maxlength="500" placeholder="Describe the water depth, surrounding landmarks, or marks left on walls..."></textarea>
          </div>

          <div class="report-field">
            <label for="report-photo">Photograph (optional, max 6 MB)</label>
            <input type="file" name="photo" id="report-photo" accept=".jpg,.jpeg,.png,.webp">
          </div>

          <div id="report-form-error" class="report-error" role="alert" style="display:none;color:var(--color-laterite);font-size:var(--text-xs);margin-bottom:var(--space-3);"></div>

          <div style="margin-top:var(--space-4);padding-bottom:var(--space-4);">
            <button type="submit" id="report-submit-btn" class="btn btn--primary" style="width:100%;">
              Submit report
            </button>
          </div>

          <p style="font-size:var(--text-2xs);color:rgba(20,48,46,0.6);font-style:italic;line-height:1.4;">
            Community reports are ground evidence reviewed before publication. They are never merged into satellite inundation calculations.
          </p>
        </form>
      </div>
    `;

    p.removeAttribute('hidden');
    p.setAttribute('aria-hidden', 'false');
    void p.offsetWidth;
    p.classList.add('report-open');

    // Bind close
    p.querySelector('.report-close').addEventListener('click', closeForm);

    // Bind pick on map
    const pickBtn = p.querySelector('#report-coords-btn');
    pickBtn.addEventListener('click', function () {
      _startLocationPick();
    });

    // Bind submit
    const form = p.querySelector('#fm-report-form');
    form.addEventListener('submit', _handleSubmit);
  }

  function closeForm() {
    const p = _panel();
    if (!p) return;
    p.classList.remove('report-open');
    p.setAttribute('aria-hidden', 'true');
    p.setAttribute('hidden', '');
    if (_pickingLocation) {
      _stopLocationPick();
    }
    if (FM.state.get('activePanel') === 'report') {
      FM.state.set('activePanel', null);
    }
  }

  function _startLocationPick() {
    _pickingLocation = true;
    const map = _getMap();
    if (!map) return;
    const mc = document.getElementById('map-container');
    if (mc) mc.style.cursor = 'crosshair';

    // Show temporary notice toast
    _showToast('Click anywhere on the map to set report location.');

    map.once('click', function (e) {
      _stopLocationPick();
      _pickedCoords = { lat: e.latlng.lat, lon: e.latlng.lng };

      const latInput = document.getElementById('report-lat');
      const lonInput = document.getElementById('report-lon');
      const coordsText = document.getElementById('report-coords-text');

      if (latInput) latInput.value = _pickedCoords.lat;
      if (lonInput) lonInput.value = _pickedCoords.lon;
      if (coordsText) {
        coordsText.textContent = `${_pickedCoords.lat.toFixed(5)}, ${_pickedCoords.lon.toFixed(5)}`;
      }
    });
  }

  function _stopLocationPick() {
    _pickingLocation = false;
    const mc = document.getElementById('map-container');
    if (mc) mc.style.cursor = '';
  }

  async function _handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const errorEl = document.getElementById('report-form-error');
    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    const latVal = form.lat.value;
    const lonVal = form.lon.value;

    if (!latVal || !lonVal) {
      if (errorEl) {
        errorEl.textContent = 'Please pick a location on the map first.';
        errorEl.style.display = 'block';
      }
      return;
    }

    const submitBtn = document.getElementById('report-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    const formData = new FormData(form);

    try {
      const res = await FM.api.submitReport(formData);
      if (res && res.status === 'pending') {
        _showToast(res.message || 'Thanks! Your report will appear after review.');
        closeForm();
      } else if (res && res.error) {
        if (errorEl) {
          errorEl.textContent = res.error;
          errorEl.style.display = 'block';
        }
      } else {
        _showToast('Thanks! Your report will appear after review.');
        closeForm();
      }
    } catch (err) {
      if (err && err.offline) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'Could not submit report. Check fields and try again.';
          errorEl.style.display = 'block';
        }
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit report';
      }
    }
  }

  function _showToast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast--info';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast--exit');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  function init() {
    FM.state.on('activeYear', function (year) {
      loadReportsForYear(year);
    });

    FM.state.on('activePanel', function (panel) {
      if (panel !== 'report') {
        const p = _panel();
        if (p && !p.hasAttribute('hidden')) {
          p.classList.remove('report-open');
          p.setAttribute('aria-hidden', 'true');
          p.setAttribute('hidden', '');
        }
      }
    });

    const yr = FM.state.get('activeYear');
    if (yr) {
      loadReportsForYear(yr);
    }
  }

  return {
    init,
    openForm,
    closeForm,
    loadReportsForYear
  };

})();

