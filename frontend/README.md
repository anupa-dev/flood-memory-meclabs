# Flood Map — Frontend

## Run

1. Start the backend: `cd backend && python app.py`
2. Start the frontend: `cd frontend && python -m http.server 5500`
3. Open http://localhost:5500 in your browser.

## How to add a region

Edit `frontend/js/config.js` only:
1. Add an entry to `REGIONS` with `bounds`, `center`, `zoom`, and `demoPoint`.
2. Set `ACTIVE_REGION = REGIONS.yourNewKey`.
3. Reload. No other file needs to change.

## File map

| File | Purpose |
|------|---------|
| js/config.js | Region bounds, API base URL, all region-specific values |
| js/api.js | Fetch wrappers for every backend endpoint |
| js/state.js | Observable key-value store |
| js/map.js | Leaflet init, basemap, overlays, markers |
| js/gauge.js | River gauge SVG timeline |
| js/summary.js | Location summary panel |
| js/layers.js | Roads, waterways, layer toggles |
| js/compare.js | Year-compare split view |
| js/reports.js | Community reports markers and form |
| js/ambient.js | Kettuvallam, palms, rain — ambient world |
| js/main.js | Boot sequence and arrival animation |
| css/main.css | Design tokens, typography, global resets |
| css/map.css | Map container and overlay styles |
| css/gauge.css | Gauge rail styles |
| css/panels.css | Summary, legend, controls, bottom-sheet |
| css/ambient.css | Ambient element styles |
| assets/ | Hand-written SVG icons and illustrations |
