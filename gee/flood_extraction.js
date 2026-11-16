// ============================================================
// Flood Memory - Sentinel-1 flood extraction (Niya's part)
// Paste this into https://code.earthengine.google.com/
// ============================================================

// ---------- 1. SETTINGS (edit these) ----------

// Area of interest: [west, south, east, north]. Start small (Kuttanad / Alappuzha).
// Once it works, enlarge it or run it for other districts.
var aoi = ee.Geometry.Rectangle([76.25, 9.25, 76.60, 9.70]);

// Flood event windows per year. VERIFY dates against news / KSDMA reports.
// Keep each window at least ~12 days so Sentinel-1 gets at least one pass.
var EVENTS = {
  2018: {start: '2018-08-10', end: '2018-08-25'},
  2019: {start: '2019-08-08', end: '2019-08-22'},
  2021: {start: '2021-10-15', end: '2021-10-30'}
};

// Baseline (dry season) months used for "normal" water, same year as the event
var BASE_START_MD = '-01-01';
var BASE_END_MD   = '-03-31';

var WATER_THRESHOLD_DB = -16;  // VV below this = water. Tune between -15 and -20.
var MAX_SLOPE_DEG = 5;         // ignore steep terrain (radar shadow looks like water)
var MIN_BLOB_PIXELS = 8;       // remove tiny noisy patches
var SCALE = 30;                // metres per pixel for exports

Map.centerObject(aoi, 10);
Map.addLayer(aoi, {color: 'red'}, 'AOI', false);

// ---------- 2. HELPER DATA ----------

// Sentinel-1 radar (already in dB in Earth Engine)
function getS1(start, end) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV');
}

// Permanent water (rivers, lakes, sea) from JRC Global Surface Water
var permanentWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('occurrence').unmask(0).gt(80);

// Slope from SRTM elevation
var srtm = ee.Image('USGS/SRTMGL1_003');
var slope = ee.Terrain.slope(srtm);
var flatEnough = slope.lt(MAX_SLOPE_DEG);

// Turn a radar composite into a water mask (1 = water)
function toWater(img) {
  return img.focal_median(30, 'circle', 'meters')   // reduce speckle noise
    .lt(WATER_THRESHOLD_DB);
}

// ---------- 3. MAIN LOOP: one flood layer per year ----------

Object.keys(EVENTS).forEach(function (year) {
  var ev = EVENTS[year];

  var eventCol = getS1(ev.start, ev.end);
  var baseCol  = getS1(year + BASE_START_MD, year + BASE_END_MD);

  // CHECK: if either prints 0, widen the dates
  print('Year ' + year + ' - event scenes:', eventCol.size(),
        ' baseline scenes:', baseCol.size());

  var eventWater = toWater(eventCol.median());
  var baseWater  = toWater(baseCol.median());

  // Baseline subtraction: wet now AND not wet normally AND not permanent water
  var flood = eventWater
    .and(baseWater.not())
    .and(permanentWater.not())
    .and(flatEnough)
    .rename('flood')
    .selfMask();

  // Remove small speckle blobs
  var connected = flood.connectedPixelCount(MIN_BLOB_PIXELS + 2, true);
  flood = flood.updateMask(connected.gte(MIN_BLOB_PIXELS)).clip(aoi);

  // Show on map
  Map.addLayer(eventWater.selfMask().clip(aoi), {palette: ['00ffff']},
               year + ' all water (before subtraction)', false);
  Map.addLayer(flood, {palette: ['0000ff']}, year + ' flood');

  // Area statistics in km2
  var areaKm2 = flood.multiply(ee.Image.pixelArea()).divide(1e6)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: SCALE,
      maxPixels: 1e10,
      bestEffort: true
    });
  print('Year ' + year + ' flooded area (km2):', areaKm2.get('flood'));

  // ---------- 4a. EXPORT GeoJSON (for PostGIS / GeoPandas) ----------
  var vectors = flood.reduceToVectors({
    geometry: aoi,
    scale: SCALE,
    geometryType: 'polygon',
    eightConnected: true,
    labelProperty: 'flood',
    maxPixels: 1e10,
    bestEffort: true,
    tileScale: 4
  }).map(function (f) {
    return f.set({year: Number(year), source: 'Sentinel-1 VV',
                  method: 'median composite, baseline subtraction'});
  });

  Export.table.toDrive({
    collection: vectors,
    description: 'flood_' + year + '_geojson',
    folder: 'FloodMemory',
    fileNamePrefix: 'flood_' + year,
    fileFormat: 'GeoJSON'
  });

  // ---------- 4b. PNG overlay (for Leaflet imageOverlay) ----------
  var vis = flood.visualize({palette: ['1e5eff'], opacity: 0.7});
  var pngUrl = vis.getThumbURL({
    region: aoi,
    dimensions: 2048,
    format: 'png'
  });
  print('Year ' + year + ' PNG overlay (click to download):', pngUrl);

  // Also export the raw GeoTIFF as a backup
  Export.image.toDrive({
    image: flood.unmask(0).toByte(),
    description: 'flood_' + year + '_tif',
    folder: 'FloodMemory',
    fileNamePrefix: 'flood_' + year,
    region: aoi,
    scale: SCALE,
    maxPixels: 1e10
  });
});

// Hand to Devika: the PNG covers exactly the AOI bounds
print('AOI bounds [W,S,E,N] for Leaflet imageOverlay:', aoi.bounds());