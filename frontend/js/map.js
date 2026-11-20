'use strict';
/**
 * map.js — Leaflet map core, basemaps, flood overlays, pin marker, search.
 *
 * Exposes:  FM.map = { init, toggleBasemap, showOverlay, clearOverlay,
 *                      dropPin, clearPin, search, _currentOverlay }
 *
 * Depends on (loaded before this):
 *   - Leaflet 1.9.4 (global L)
 *   - js/config.js  (ACTIVE_REGION, API_BASE)
 *   - js/state.js   (FM.state)
 *   - js/api.js     (FM.api)
 */

window.FM = window.FM || {};

FM.map = (function () {

    /* ─────────────────────────── private state ─────────────────────────── */

    /** @type {L.Map|null} */
    let _map = null;

    /** @type {L.TileLayer} */
    let _streetLayer = null;
    /** @type {L.TileLayer} */
    let _satLayer = null;
    let _labelStreet = null;
    let _labelSat = null;
    /** Current basemap mode: 'street' | 'satellite' */
    let _basemapMode = 'street';

    /** @type {L.Layer|null}  — the current flood overlay (image or GeoJSON) */
    let _currentOverlay = null;

    /** @type {L.Marker|null} */
    let _pin = null;

    /** @type {HTMLElement|null} — autocomplete dropdown */
    let _dropdown = null;

    /* ─────────────────────────── helpers ───────────────────────────────── */

    /**
     * Expand a [[s,w],[n,e]] bounds array by `delta` degrees on every side.
     * Returns an L.LatLngBounds.
     * @param {number[][]} bounds
     * @param {number} delta
     * @returns {L.LatLngBounds}
     */
    function _expandBounds(bounds, delta) {
        const [[s, w], [n, e]] = bounds;
        return L.latLngBounds(
            L.latLng(s - delta, w - delta),
            L.latLng(n + delta, e + delta)
        );
    }

    /**
     * Check whether a lat/lon pair is within ACTIVE_REGION.bounds.
     * @param {number} lat
     * @param {number} lon
     * @returns {boolean}
     */
    function _inRegion(lat, lon) {
        const [[s, w], [n, e]] = ACTIVE_REGION.bounds;
        return lat >= s && lat <= n && lon >= w && lon <= e;
    }

    /**
     * Show a toast notification for `msg`.  Reuses an existing #fm-toast if
     * present, otherwise creates one.
     * @param {string} msg
     * @param {number} [duration=4000]
     */
    function _toast(msg, duration = 4000) {
        let el = document.getElementById('fm-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'fm-toast';
            el.setAttribute('role', 'alert');
            el.setAttribute('aria-live', 'assertive');
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('fm-toast--visible');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('fm-toast--visible'), duration);
    }

    /* ───────────────────── street basemap builders ───────────────────────── */

    /** Basic raster street map (no key needed). */
    function _buildEsriStreet() {
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxNativeZoom: 19,
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors'
        });
    }

    /** Scale one label size value (number, legacy stops, or expression). */
    function _scaleSize(v) {
        const k = (typeof LABEL_SCALE !== 'undefined') ? LABEL_SCALE : 1.7;
        const min = (typeof LABEL_MIN_PX !== 'undefined') ? LABEL_MIN_PX : 15;
        const f = (n) => Math.max(n * k, min);

        function expr(e) {
            if (typeof e === 'number') return f(e);
            if (!Array.isArray(e)) return e;
            const op = e[0];
            if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') {
                const out = e.slice(0, 3);
                for (let i = 3; i < e.length; i += 2) out.push(e[i], expr(e[i + 1]));
                return out;
            }
            if (op === 'step') {
                const out = ['step', e[1], expr(e[2])];
                for (let i = 3; i < e.length; i += 2) out.push(e[i], expr(e[i + 1]));
                return out;
            }
            if (op === 'case') {
                const out = ['case'];
                for (let i = 1; i < e.length - 1; i += 2) out.push(e[i], expr(e[i + 1]));
                out.push(expr(e[e.length - 1]));
                return out;
            }
            if (op === 'match') {
                const out = ['match', e[1]];
                for (let i = 2; i < e.length - 1; i += 2) out.push(e[i], expr(e[i + 1]));
                out.push(expr(e[e.length - 1]));
                return out;
            }
            return e; // unknown form: leave as the provider drew it
        }

        if (v === undefined || v === null) return f(16);
        if (typeof v === 'number') return f(v);
        if (Array.isArray(v)) return expr(v);
        if (v && Array.isArray(v.stops)) {
            return Object.assign({}, v, {
                stops: v.stops.map(([z, s]) => [z, typeof s === 'number' ? f(s) : s]),
            });
        }
        return v;
    }

    /** Make every place label larger and readable. Returns how many layers were changed. */
    function _scaleLabels(gl) {
        let done = 0;
        try {
            (gl.getStyle().layers || []).forEach((l) => {
                if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) return;
                try {
                    gl.setLayoutProperty(l.id, 'text-size', _scaleSize(l.layout['text-size']));
                    done++;
                } catch (_) { /* leave that layer as drawn */ }
            });
        } catch (_) { /* style not ready yet; try again on the next event */ }
        return done;
    }

    /** Detailed vector street map (MapTiler data via MapLibre). */
    function _buildVectorStreet() {
        const layer = L.maplibreGL({
            style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=' + MAPTILER_KEY,
            attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
        });

        let fellBack = false;
        layer.on('add', function () {
            const gl = layer.getMaplibreMap && layer.getMaplibreMap();
            if (!gl) return;
            // The style arrives a moment after the map is created, so retry until labels are scaled
            let scaled = false;
            const tryScale = () => {
                if (scaled) return;
                if (_scaleLabels(gl) > 0) scaled = true;
            };
            gl.on('styledata', tryScale);
            gl.on('load', tryScale);
            gl.on('idle', tryScale);
            // Bad or blocked key: switch to the basic map so the app still works
            gl.on('error', (e) => {
                const st = e && e.error && e.error.status;
                if ((st === 401 || st === 403) && !fellBack) {
                    fellBack = true;
                    _toast('Map key was rejected, so the basic map is showing. Check MAPTILER_KEY in config.js.', 8000);
                    if (_map && _basemapMode === 'street') {
                        _map.removeLayer(layer);
                        _streetLayer = _buildEsriStreet();
                        _streetLayer.addTo(_map);
                    }
                }
            });
        });
        return layer;
    }

    /* ───────────────────── 1. MAP INITIALISATION ────────────────────────── */

    /**
     * Initialise the Leaflet map.  Called once from main.js after DOM ready.
     */
    function init() {
        if (_map) return; // guard against double-init

        /* --- create map ---------------------------------------------------- */
        _map = L.map('map-container', {
            center: ACTIVE_REGION.center,
            zoom: ACTIVE_REGION.zoom,
            zoomControl: false,   // we build our own
            attributionControl: true,
            minZoom: 8,
            maxZoom: 19,
            maxBounds: ACTIVE_REGION.panBounds
                ? L.latLngBounds(ACTIVE_REGION.panBounds)
                : _expandBounds(ACTIVE_REGION.bounds, 0.15),
            maxBoundsViscosity: 0.9,
        });

        /* --- basemap tile layers ------------------------------------------- */
        if (typeof MAPTILER_KEY !== 'undefined' && MAPTILER_KEY && L.maplibreGL) {
            _streetLayer = _buildVectorStreet();
        } else {
            _streetLayer = _buildEsriStreet();
        }

        _satLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community',
                maxZoom: 19,
            }
        );

        /* --- place-name labels: own pane above the flood overlay ------------ */
        _map.createPane('fmLabels');
        _map.getPane('fmLabels').style.zIndex = 450;
        _map.getPane('fmLabels').style.pointerEvents = 'none';

        // Street map already has names baked in, so no separate label layer
        _labelStreet = L.layerGroup();
        _labelSat = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            { pane: 'fmLabels', maxNativeZoom: 17, maxZoom: 17 }
        );

        // Dashed outline of the area that has satellite flood data
        L.rectangle(ACTIVE_REGION.bounds, {
            color: '#B8892B', weight: 1.5, dashArray: '6 6', fill: false, interactive: false,
        }).addTo(_map);

        // Start with street basemap
        _streetLayer.addTo(_map);
        _labelStreet.addTo(_map);
        _basemapMode = 'street';

        /* --- fly to region -------------------------------------------------- */
        _map.flyTo(ACTIVE_REGION.center, ACTIVE_REGION.zoom, { duration: 1.4 });

        /* --- custom zoom control (bottom-right, gold +/-) ------------------- */
        _buildZoomControl();

        /* --- click-to-pick -------------------------------------------------- */
        _map.on('click', function (e) {
            // Ignore clicks on controls or UI panels (they stop propagation themselves)
            dropPin(e.latlng.lat, e.latlng.lng);
        });

        /* --- outside-coverage state listener -------------------------------- */
        FM.state.on('outsideCoverage', function (val) {
            if (!val) return;
            _showCoverageWarning();
            // Reset flag so the listener fires again next time
            setTimeout(() => FM.state.set('outsideCoverage', false), 100);
        });
    }

    /* ─────────────────────── Custom zoom control ─────────────────────────── */

    /**
     * Hand-craft a #custom-zoom div in the bottom-right corner.
     * Uses gold (#C9A84C) for button faces.
     */
    function _buildZoomControl() {
        const container = L.DomUtil.create('div', 'leaflet-control');
        container.id = 'custom-zoom';
        container.setAttribute('aria-label', 'Zoom controls');

        const btnIn = document.createElement('button');
        btnIn.className = 'custom-zoom__btn custom-zoom__btn--in';
        btnIn.type = 'button';
        btnIn.setAttribute('aria-label', 'Zoom in');
        btnIn.innerHTML = '<span aria-hidden="true">+</span>';

        const btnOut = document.createElement('button');
        btnOut.className = 'custom-zoom__btn custom-zoom__btn--out';
        btnOut.type = 'button';
        btnOut.setAttribute('aria-label', 'Zoom out');
        btnOut.innerHTML = '<span aria-hidden="true">−</span>';

        L.DomEvent.on(btnIn, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.on(btnOut, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.disableClickPropagation(container);

        btnIn.addEventListener('click', () => _map.zoomIn());
        btnOut.addEventListener('click', () => _map.zoomOut());

        container.appendChild(btnIn);
        container.appendChild(btnOut);

        // Leaflet custom control
        const ZoomCtrl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd() { return container; },
            onRemove() { },
        });
        new ZoomCtrl().addTo(_map);
    }

    /* ───────────────────── Always-visible disclaimer ─────────────────────── */

    /**
     * Add a Leaflet control at bottom-left carrying the legal disclaimer text.
     */
    function _buildDisclaimer() {
        const DisclaimerCtrl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                const el = L.DomUtil.create('div', 'fm-disclaimer');
                el.textContent = 'Historical satellite-observed inundation near this location. Not proof that a specific building flooded.';
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.disableScrollPropagation(el);
                return el;
            },
            onRemove() { },
        });
        new DisclaimerCtrl().addTo(_map);
    }

    /* ─────────────────────── 2. BASEMAP TOGGLE ──────────────────────────── */

    /**
     * Switch between street and satellite basemap.
     * @param {'street'|'satellite'} mode
     */
    function toggleBasemap(mode) {
        if (!_map) return;
        if (mode === _basemapMode) return;

        if (mode === 'satellite') {
            _map.removeLayer(_streetLayer);
            _map.removeLayer(_labelStreet);
            _satLayer.addTo(_map);
            _labelSat.addTo(_map);
        } else {
            _map.removeLayer(_satLayer);
            _map.removeLayer(_labelSat);
            _streetLayer.addTo(_map);
            _labelStreet.addTo(_map);
        }
        _basemapMode = mode;
    }

    /* ─────────────────────── 3. FLOOD OVERLAYS ──────────────────────────── */

    /**
     * Animate opacity of a Leaflet layer from `from` to `to` over `ms` ms.
     * Works for both L.ImageOverlay and L.GeoJSON (which inherits setStyle).
     * @param {L.Layer} layer
     * @param {number}  from   0–1
     * @param {number}  to     0–1
     * @param {number}  ms
     * @returns {Promise<void>}
     */
    function _fadeLayer(layer, from, to, ms) {
        return new Promise((resolve) => {
            const start = performance.now();
            const delta = to - from;

            function step(now) {
                const t = Math.min((now - start) / ms, 1);
                const val = from + delta * t;

                if (layer instanceof L.ImageOverlay) {
                    layer.setOpacity(val);
                } else if (layer.setStyle) {
                    // GeoJSON — set fillOpacity and stroke opacity proportionally
                    layer.setStyle({
                        opacity: val,
                        fillOpacity: val * 0.55 / 0.75, // scale relative to target 0.55
                    });
                }

                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(step);
        });
    }

    /**
     * Show a flood overlay for the given year.
     * Tries PNG image overlay first; falls back to GeoJSON on 404/error.
     * Cross-fades with the existing overlay.
     *
     * @param {number|string} year
     */
    async function showOverlay(year) {
        if (!_map) return;

        const bounds = L.latLngBounds(
            L.latLng(ACTIVE_REGION.bounds[0][0], ACTIVE_REGION.bounds[0][1]),
            L.latLng(ACTIVE_REGION.bounds[1][0], ACTIVE_REGION.bounds[1][1])
        );

        let newOverlay = null;

        /* --- attempt 1: PNG image overlay ---------------------------------- */
        try {
            const imgUrl = `${API_BASE}/api/overlays/${year}.png`;
            const response = await fetch(imgUrl, { method: 'HEAD' });

            if (!response.ok) {
                if (response.status === 404) throw { is404: true };
                throw { is404: false, msg: `HTTP ${response.status}` };
            }

            newOverlay = L.imageOverlay(imgUrl, bounds, {
                opacity: 0,
                interactive: false,
                className: 'fm-flood-overlay',
            });

        } catch (err) {
            if (err && !err.is404) {
                // Non-404 network error
                const msg = err.msg || 'Network error loading overlay.';
                FM.state.set('overlayError', { year, msg });
                _toast(`Could not load flood data for ${year}: ${msg}`);
                return;
            }

            /* --- fallback: GeoJSON ------------------------------------------ */
            try {
                const geojson = await FM.api.floods(year);
                newOverlay = L.geoJSON(geojson, {
                    style: {
                        color: '#1e5eff',
                        weight: 1,
                        opacity: 0,
                        fillColor: '#1e5eff',
                        fillOpacity: 0,
                        fillRule: 'nonzero',
                    },
                    interactive: false,
                });
            } catch (geoErr) {
                const msg = geoErr?.message || 'Failed to load flood GeoJSON.';
                FM.state.set('overlayError', { year, msg });
                _toast(`Could not load flood data for ${year}: ${msg}`);
                return;
            }
        }

        /* --- cross-fade ---------------------------------------------------- */
        const oldOverlay = _currentOverlay;

        // Add new overlay at opacity 0 first
        newOverlay.addTo(_map);

        // Fade out old, fade in new simultaneously
        const fadeOutOld = oldOverlay
            ? _fadeLayer(oldOverlay, 0.55, 0, 500)
            : Promise.resolve();

        const fadeInNew = _fadeLayer(newOverlay, 0, 0.55, 500);

        await Promise.all([fadeOutOld, fadeInNew]);

        // Remove old overlay after fade-out
        if (oldOverlay) {
            _map.removeLayer(oldOverlay);
        }

        _currentOverlay = newOverlay;
    }

    /**
     * Remove the current flood overlay from the map.
     */
    function clearOverlay() {
        if (_currentOverlay && _map) {
            _map.removeLayer(_currentOverlay);
        }
        _currentOverlay = null;
    }

    /* ─────────────────────── 4. PLACE MARKER ────────────────────────────── */

    /**
     * Build the custom SVG pin icon.
     * Shape: circular head (gold ring, laterite fill, plus cross), stem pointing down.
     * @returns {L.DivIcon}
     */
    function _buildPinIcon() {
        // Laterite: #A0522D  Gold ring: #C9A84C  Plus: #fff
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48" aria-hidden="true">
  <!-- stem -->
  <line x1="18" y1="32" x2="18" y2="47" stroke="#7A3B1E" stroke-width="3" stroke-linecap="round"/>
  <!-- gold ring (outer circle) -->
  <circle cx="18" cy="18" r="16" fill="#C9A84C"/>
  <!-- laterite fill (inner circle) -->
  <circle cx="18" cy="18" r="12" fill="#A0522D"/>
  <!-- plus cross arms -->
  <line x1="18" y1="11" x2="18" y2="25" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <line x1="11" y1="18" x2="25" y2="18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`.trim();

        return L.divIcon({
            html: svg,
            className: 'fm-pin-icon',      // CSS adds bounce animation
            iconSize: [36, 48],
            iconAnchor: [18, 47],           // tip of stem
            popupAnchor: [0, -48],
        });
    }

    /**
     * Drop a custom pin at [lat, lon].
     * Flies to the location, then places the marker with a bounce animation.
     * Emits FM.state.set('activePoint', {lat, lon}).
     *
     * @param {number} lat
     * @param {number} lon
     */
    /** Show the place name for a point: use `name` if given, else look it up. */
    let _placeReq = 0;
    async function _setPlaceName(lat, lon, name) {
        const id = ++_placeReq;
        if (name) { FM.state.set('placeName', name); return; }
        FM.state.set('placeName', '');
        try {
            const u = new URL('https://nominatim.openstreetmap.org/reverse');
            u.searchParams.set('format', 'json');
            u.searchParams.set('lat', lat);
            u.searchParams.set('lon', lon);
            u.searchParams.set('zoom', '15');
            const r = await fetch(u.toString(), { headers: { 'Accept-Language': 'en' } });
            const j = await r.json();
            if (id !== _placeReq) return;
            const a = j.address || {};
            const short = a.village || a.suburb || a.town || a.city || a.hamlet || a.neighbourhood || a.county || '';
            const more = a.state_district || a.county || a.state || '';
            FM.state.set('placeName', [short, more && more !== short ? more : ''].filter(Boolean).join(', '));
        } catch (_) { /* name stays empty; coordinates still show */ }
    }

    function dropPin(lat, lon, name) {
        if (!_map) return;
        _setPlaceName(lat, lon, name);

        // Remove existing pin
        clearPin();

        // Fly first, then drop pin on arrival
        _map.flyTo([lat, lon], Math.max(_map.getZoom(), 14), {
            duration: 0.8,
        });

        _map.once('moveend', function () {
            _pin = L.marker([lat, lon], {
                icon: _buildPinIcon(),
                keyboard: true,
                title: `Selected location: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
                riseOnHover: true,
                zIndexOffset: 1000,
            });

            _pin.addTo(_map);

            // Trigger bounce via CSS class toggle (removed after animation ends)
            const el = _pin.getElement();
            if (el) {
                el.classList.add('fm-pin--bounce');
                el.addEventListener('animationend', () => {
                    el.classList.remove('fm-pin--bounce');
                }, { once: true });
            }
        });

        FM.state.set('activePoint', { lat, lon });
    }

    /**
     * Remove the current pin from the map.
     */
    function clearPin() {
        if (_pin && _map) {
            _map.removeLayer(_pin);
        }
        _pin = null;
    }

    /* ─────────────────────── 5. SEARCH (NOMINATIM) ─────────────────────── */

    /**
     * Search Nominatim for `query`, show autocomplete dropdown under #search-bar.
     * On selection: check bounds, then dropPin or emit outsideCoverage.
     *
     * @param {string} query
     */
    async function search(query, goToFirst) {
        const q = (query || '').trim();
        _closeDropdown();
        if (!q) return;

        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'json');
        url.searchParams.set('q', q);
        url.searchParams.set('countrycodes', 'in');
        url.searchParams.set('limit', '5');
        url.searchParams.set('bounded', '1');
        const [[ps, pw], [pn, pe]] = ACTIVE_REGION.panBounds || ACTIVE_REGION.bounds;
        url.searchParams.set('viewbox', `${pw},${pn},${pe},${ps}`);

        let results = [];
        try {
            const res = await fetch(url.toString(), {
                headers: { 'Accept-Language': 'en' },
            });
            results = await res.json();
        } catch (_) {
            _showDropdown([]);
            return;
        }

        _showDropdown(results);
        // Pressing Search or Enter goes straight to the best match
        if (goToFirst && results.length) {
            const first = _dropdown && _dropdown.querySelector('.fm-search-dropdown__item');
            if (first) first.click();
        }
    }

    /**
     * Render the autocomplete dropdown under #search-bar.
     * @param {object[]} results  — Nominatim result objects
     */
    function _showDropdown(results) {
        _closeDropdown();

        const anchor = document.getElementById('search-bar');
        if (!anchor) return;

        const ul = document.createElement('ul');
        ul.id = 'fm-search-dropdown';
        ul.className = 'fm-search-dropdown';
        ul.setAttribute('role', 'listbox');
        ul.setAttribute('aria-label', 'Search results');

        if (!results || results.length === 0) {
            const li = document.createElement('li');
            li.className = 'fm-search-dropdown__empty';
            li.textContent = 'No places found for that search';
            ul.appendChild(li);
        } else {
            results.slice(0, 5).forEach((r) => {
                const lat = parseFloat(r.lat);
                const lon = parseFloat(r.lon);
                const name = r.display_name || 'Unknown place';
                const shortName = name.split(',').slice(0, 3).join(',').trim();

                const li = document.createElement('li');
                li.className = 'fm-search-dropdown__item';
                li.textContent = shortName;
                li.setAttribute('role', 'option');
                li.setAttribute('tabindex', '0');
                li.setAttribute('title', name);

                const pick = () => {
                    _closeDropdown();
                    if (!_inRegion(lat, lon)) {
                        // Show the place on the map, but say there is no satellite data for it
                        _map.flyTo([lat, lon], Math.max(_map.getZoom(), 13), { duration: 0.8 });
                        FM.state.set('outsideCoverage', true);
                    } else {
                        dropPin(lat, lon, shortName);
                    }
                };

                li.addEventListener('click', pick);
                li.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
                });

                ul.appendChild(li);
            });
        }

        // Position below the search bar
        // The search bar is clipped to a ticket shape, so the list lives on <body>
        // and is placed just under the bar.
        const r = anchor.getBoundingClientRect();
        ul.style.position = 'fixed';
        ul.style.top = (r.bottom + 4) + 'px';
        ul.style.left = r.left + 'px';
        ul.style.width = r.width + 'px';
        ul.style.right = 'auto';
        document.body.appendChild(ul);
        _dropdown = ul;

        // Dismiss on outside click
        setTimeout(() => {
            document.addEventListener('click', _outsideClickHandler, { once: true });
        }, 0);
    }

    /** Close the autocomplete dropdown. */
    function _closeDropdown() {
        if (_dropdown) {
            _dropdown.remove();
            _dropdown = null;
        }
        document.removeEventListener('click', _outsideClickHandler);
    }

    /** Handler to close dropdown when clicking outside. */
    function _outsideClickHandler(e) {
        if (_dropdown && !_dropdown.contains(e.target)) {
            _closeDropdown();
        }
    }

    /* ─────────────────────── 6. COVERAGE WARNING ───────────────────────── */

    /**
     * Show a dismissible banner: "That place is outside the area we have
     * satellite data for so far."
     */
    function _showCoverageWarning() {
        const existing = document.getElementById('fm-coverage-warning');
        if (existing) return; // already showing

        const banner = document.createElement('div');
        banner.id = 'fm-coverage-warning';
        banner.className = 'fm-coverage-warning';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');

        const msg = document.createElement('span');
        msg.textContent = 'That place is outside the area we have satellite data for so far.';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fm-coverage-warning__dismiss';
        btn.setAttribute('aria-label', 'Dismiss');
        btn.textContent = '✕';
        btn.addEventListener('click', () => banner.remove());

        banner.appendChild(msg);
        banner.appendChild(btn);
        document.body.appendChild(banner);

        // Auto-dismiss after 8 s
        setTimeout(() => banner.remove(), 8000);
    }

    /* ─────────────────────── PUBLIC API ─────────────────────────────────── */

    return {
        /** Initialise the Leaflet map. Call once from main.js. */
        init,

        /**
         * Switch basemap.
         * @param {'street'|'satellite'} mode
         */
        toggleBasemap,

        /**
         * Display (and cross-fade) a flood overlay for the given year.
         * @param {number|string} year
         */
        showOverlay,

        /** Remove the current flood overlay. */
        clearOverlay,

        /**
         * Drop a custom pin at [lat, lon] and fly there.
         * @param {number} lat
         * @param {number} lon
         */
        dropPin,

        /** Remove the current pin. */
        clearPin,

        /** Geocode a free-text query via Nominatim and show an autocomplete list. */
        search,

        /** The Leaflet map instance */
        getMap() { return _map; },
        get _leafletMap() { return _map; },
        addLayer(layer) { if (_map && layer) _map.addLayer(layer); return this; },
        removeLayer(layer) { if (_map && layer) _map.removeLayer(layer); return this; },
        hasLayer(layer) { return _map ? _map.hasLayer(layer) : false; },

        /** The currently displayed flood overlay layer (or null). */
        get _currentOverlay() { return _currentOverlay; },
    };

}());
