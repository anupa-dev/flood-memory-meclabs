// All region-specific values live here. To add a region later,
// extend REGIONS and update ACTIVE_REGION.
const API_BASE = "http://127.0.0.1:5000";
const MAPTILER_KEY = "MAG1xzpGCfXs9gNsiQ51";
const REGIONS = {
    default: {
        // Area that has satellite flood data
        bounds: [[9.25, 76.25], [9.70, 76.60]],
        // Wider area the map can show and search (all of Kerala); no flood data outside `bounds`
        panBounds: [[8.10, 74.80], [12.90, 77.60]],
        center: [9.4981, 76.3388],
        zoom: 11,
        demoPoint: [9.5094, 76.3722]
    }
};

const ACTIVE_REGION = REGIONS.default;

// Optional local-language wordmark line. Leave empty; fill in without touching layout.
const WORDMARK_LOCAL = "";

// Years that exist as satellite data records. Loaded from GET / at runtime.
// Populated by api.js; this is the fallback shape.
let DATA_YEARS = [];
