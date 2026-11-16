# GEE Flood Extraction (Sentinel-1)

Part of **Flood Memory**, a satellite-powered historical flood intelligence platform.
This folder contains the Google Earth Engine (GEE) script that extracts satellite-observed
flood extent for past flood years.

> **Important:** the outputs show *satellite-observed surface water / inundation*.
> They do **not** prove that any individual building was flooded.

## What it does

For each flood year, the script:

1. Builds a **median composite** of Sentinel-1 radar (VV, IW mode) from the flood-event window.
2. Builds a **dry-season baseline** (Jan to Mar of the same year).
3. Detects water with a backscatter threshold (VV below -16 dB) after speckle smoothing.
4. **Subtracts** baseline water and **permanent water** (JRC Global Surface Water, occurrence above 80%).
5. Masks **steep slopes** (SRTM slope of 5 degrees or more) and removes tiny noisy blobs.
6. Exports the flood layer as **GeoJSON**, **GeoTIFF** and a **PNG overlay**, and prints the flooded area (km2).

## Current coverage

| Item | Value |
|---|---|
| Area of interest | Alappuzha / Kuttanad |
| Bounds [W, S, E, N] | `76.25, 9.25, 76.60, 9.70` |
| Years | 2018, 2019, 2021 |
| Event windows | 2018: 10-25 Aug; 2019: 8-22 Aug; 2021: 15-30 Oct |
| Resolution | 30 m |

Event dates should be verified against news or official (e.g. KSDMA) reports.

## Files

```
gee/
  flood_extraction.js        # the Earth Engine script (run in the Code Editor)
  README.md                  # this file
data/
  flood_geojson/
    flood_2018.geojson
    flood_2019.geojson
    flood_2021.geojson
  overlays/
    flood_2018.png
    flood_2019.png
    flood_2021.png
```

GeoJSON details:

- Coordinate system: **EPSG:4326** (lat/lon)
- Properties per polygon: `flood` (1), `year`, `source`, `method`

## How to re-run

1. Sign in at https://code.earthengine.google.com/ (registered non-commercial project).
2. Create a new script and paste the contents of `flood_extraction.js`.
3. Edit the **SETTINGS** section if needed (area, years, threshold).
4. Click **Run**. Check the Console for scene counts and flooded area.
5. Open the **Tasks** tab and click **Run** on each export. Files go to the Drive folder `FloodMemory`.
6. PNG download links are printed in the Console.

### Settings you can tune

| Setting | Default | Effect |
|---|---|---|
| `aoi` | Alappuzha box | Area processed |
| `EVENTS` | 2018, 2019, 2021 | Flood windows per year |
| `WATER_THRESHOLD_DB` | -16 | Lower = stricter water detection |
| `MAX_SLOPE_DEG` | 5 | Ignore steeper terrain |
| `MIN_BLOB_PIXELS` | 8 | Remove small patches |
| `SCALE` | 30 | Export resolution (metres) |

## Using the PNG overlays in Leaflet

The PNGs cover exactly the area of interest. Leaflet expects [lat, lon] corners:

```js
const bounds = [[9.25, 76.25], [9.70, 76.60]];
L.imageOverlay('data/overlays/flood_2018.png', bounds).addTo(map);
```

## Known limitations

- Radar can confuse smooth surfaces, shadow and wet paddy fields with floodwater.
- Dense buildings and vegetation can hide floodwater from radar.
- Sentinel-1 revisits every 6 to 12 days, so the image may not show the exact flood peak.
- The result is a pixel-level estimate and has not been formally validated yet.
- Coverage is currently limited to one area and three years.

## Next steps

- Add more years (e.g. 2020, 2022, 2023).
- Extend coverage to other Kerala districts.
- Validate against news reports, official maps or NASA OPERA data.

## Data sources

- Sentinel-1 GRD (`COPERNICUS/S1_GRD`)
- JRC Global Surface Water (`JRC/GSW1_4`)
- SRTM elevation (`USGS/SRTMGL1_003`)