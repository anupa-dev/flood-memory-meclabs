// main.js — Application entry point, boot orchestration, and arrival motion.

'use strict';

window.FM = window.FM || {};

FM.main = (function () {

  // ── Build Search Bar DOM ──────────────────────────────────────────────────
  function _buildSearchBar() {
    const bar = document.getElementById('search-bar');
    if (!bar) return;

    bar.innerHTML = `
      <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="text" id="search-input" placeholder="Search place in Kerala..." aria-label="Search place in Kerala" autocomplete="off" />
      <button type="button" id="search-btn" class="btn btn--secondary" aria-label="Search place">
        <span>Search</span>
      </button>
    `;

    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');

    function doSearch() {
      const q = input.value.trim();
      if (q && FM.map && FM.map.search) {
        FM.map.search(q);
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      doSearch();
    });
  }

  // ── Build Legend Bar DOM ──────────────────────────────────────────────────
  function _buildLegend() {
    const legend = document.getElementById('legend-bar');
    if (!legend) return;

    legend.innerHTML = `
      <div class="legend-item">
        <span class="legend-swatch legend-swatch--waterway" aria-hidden="true" style="height:3px;background-color:#7FA9A6;"></span>
        <span>Waterway</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch legend-swatch--inundation" aria-hidden="true" style="background-color:rgb(30,94,255);opacity:0.75;"></span>
        <span>Satellite-observed inundation</span>
      </div>
      <div class="legend-disclaimer">
        Historical satellite-observed inundation near this location. Not proof that a specific building flooded.
      </div>
    `;
  }

  // ── Show Backend Down Banner ──────────────────────────────────────────────
  function _showBackendDownBanner() {
    const errorDisplay = document.getElementById('error-display');
    if (!errorDisplay) return;

    errorDisplay.innerHTML = `
      <div class="backend-down-banner" role="alert" style="background-color:#8E3B2A;color:#E4EBE5;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;font-family:'Anek Latin',sans-serif;font-size:13px;z-index:10000;position:fixed;top:0;left:0;right:0;box-shadow:0 2px 10px rgba(0,0,0,0.5);">
        <span>Can't reach the Flood Map server. Check that it's running on port 5000.</span>
        <button type="button" class="btn btn--ghost" style="color:#fff;border-color:rgba(255,255,255,0.4);font-size:11px;padding:3px 8px;" onclick="this.parentElement.remove()">Dismiss</button>
      </div>
    `;
    errorDisplay.removeAttribute('hidden');
    errorDisplay.setAttribute('aria-hidden', 'false');
  }

  // ── Setup Arrival Overlay Screen ──────────────────────────────────────────
  function _setupArrivalOverlay() {
    const overlay = document.getElementById('arrival-overlay');
    if (!overlay) return;

    const wordmarkLocal = typeof WORDMARK_LOCAL !== 'undefined' && WORDMARK_LOCAL ? `<div class="arrival-local" style="font-size:0.9rem;opacity:0.75;margin-bottom:4px;">${WORDMARK_LOCAL}</div>` : '';

    overlay.innerHTML = `
      <div style="text-align:center;padding:20px;">
        ${wordmarkLocal}
        <h1 class="arrival-title">Flood Map</h1>
        <div class="arrival-subtitle">Historical satellite flood intelligence</div>
        <div class="arrival-loader-bar" aria-hidden="true">
          <div class="arrival-loader-progress"></div>
        </div>
      </div>
    `;
  }

  // ── Orchestrated Arrival Sequence ─────────────────────────────────────────
  async function _runArrivalSequence(firstYear) {
    const overlay = document.getElementById('arrival-overlay');
    const mapContainer = document.getElementById('map-container');

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isReduced = mql.matches;

    if (isReduced) {
      if (overlay) overlay.remove();
      if (firstYear) {
        FM.map.showOverlay(firstYear);
        if (ACTIVE_REGION && ACTIVE_REGION.demoPoint) {
          FM.map.dropPin(ACTIVE_REGION.demoPoint[0], ACTIVE_REGION.demoPoint[1]);
        }
      }
      return;
    }

    if (mapContainer) {
      mapContainer.style.filter = 'blur(4px)';
      mapContainer.style.transition = 'filter 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    }

    // Step 1: monsoon rain begins
    if (FM.ambient && FM.ambient.startRain) {
      FM.ambient.startRain(85);
    }

    // Step 2: 1.2s - rain begins settling down
    setTimeout(function () {
      if (FM.ambient && FM.ambient.setRainDensity) {
        FM.ambient.setRainDensity(8);
      }
    }, 1200);

    // Step 3: 1.8s - river staff gauge fills to first year
    setTimeout(function () {
      if (firstYear && FM.gauge && FM.gauge.selectYear) {
        FM.gauge.selectYear(firstYear);
      }
    }, 1800);

    // Step 4: 2.2s - map comes into focus
    setTimeout(function () {
      if (mapContainer) {
        mapContainer.style.filter = 'none';
      }
    }, 2200);

    // Step 5: 2.8s - arrival overlay fades out
    setTimeout(function () {
      if (overlay) {
        overlay.classList.add('arrival-fade-out');
        setTimeout(function () {
          overlay.remove();
        }, 800);
      }
    }, 2800);

    // Step 6: 3.2s - automatically drop demo pin to show initial summary
    setTimeout(function () {
      if (ACTIVE_REGION && ACTIVE_REGION.demoPoint && FM.map && FM.map.dropPin) {
        FM.map.dropPin(ACTIVE_REGION.demoPoint[0], ACTIVE_REGION.demoPoint[1]);
      }
    }, 3200);
  }

  // ── Main Boot Sequence ────────────────────────────────────────────────────
  async function boot() {
    _setupArrivalOverlay();
    _buildSearchBar();
    _buildLegend();

    // 1. Initialise Map and ambient early
    if (FM.map && FM.map.init) FM.map.init();
    if (FM.ambient && FM.ambient.init) FM.ambient.init();
    if (FM.gauge && FM.gauge.init) FM.gauge.init();
    if (FM.summary && FM.summary.init) FM.summary.init();
    if (FM.layers && FM.layers.init) FM.layers.init();
    if (FM.reports && FM.reports.init) FM.reports.init();

    // 2. Fetch data from backend
    let years = [];
    let isOffline = false;

    try {
      years = await FM.api.init();
    } catch (err) {
      isOffline = true;
      _showBackendDownBanner();
    }

    if (!Array.isArray(years) || years.length === 0) {
      // Fallback years if offline
      years = [2018, 2019, 2021, 2022, 2023, 2025];
    }

    // 3. Set years in gauge and state
    if (FM.gauge && FM.gauge.setYears) {
      FM.gauge.setYears(years);
    }

    const firstYear = years.includes(2021) ? 2021 : years[0];
    FM.state.set('activeYear', firstYear);

    // 4. Listen for year changes to update overlay
    FM.state.on('activeYear', function (year) {
      if (FM.map && FM.map.showOverlay) {
        FM.map.showOverlay(year);
      }
    });

    // 5. Trigger orchestrated arrival moment
    _runArrivalSequence(firstYear);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return {
    boot
  };

})();

