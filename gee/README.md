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
| Years with a flood layer | 2018, 2019, 2021, 2022, 2023, 2025 |
| Years with no layer | 2020, 2024 (no major flood event identified) |
| Resolution | 30 m |

## Year status and event windows

| Year | Status | Event window | Source |
|---|---|---|---|
| 2018 | Flood layer | 10 to 25 Aug 2018 | [https://www.manoramaonline.com/news/latest-news/2018/08/20/kottayam-rain-havoc-kerala-flood-live-updates.html#] |
| 2019 | Flood layer | 8 to 22 Aug 2019 | [https://ml.wikipedia.org/wiki/%E0%B4%95%E0%B5%87%E0%B4%B0%E0%B4%B3%E0%B4%A4%E0%B5%8D%E0%B4%A4%E0%B4%BF%E0%B4%B2%E0%B5%86_%E0%B4%B5%E0%B5%86%E0%B4%B3%E0%B5%8D%E0%B4%B3%E0%B4%AA%E0%B5%8D%E0%B4%AA%E0%B5%8A%E0%B4%95%E0%B5%8D%E0%B4%95%E0%B4%82_(2019)] |
| 2020 | No layer: no major flood event identified | n/a | Checked news and KSDMA reports on [1 June to 18 August 2020] |
| 2021 | Flood layer | 15 to 30 Oct 2021 | [https://www.thenewsminute.com/kerala/consistent-floods-damaged-homes-force-people-leave-kerala-s-kuttanad-152898] |
| 2022 | Flood layer| 25 Aug to 8 Sep 2022 | News: Kuttanad waterlogging around 30 Aug 2022 |
| 2023 | Flood layer| 3 to 17 Jul 2023 | News: Kuttanad above danger level around 5 to 8 Jul 2023|
| 2024 | No layer: no major flood event identified | n/a | Checked news and KSDMA reports|
| 2025 | Flood layer (to verify) | 24 May to 7 Jun 2025 | News: Kuttanad inundation in late May 2025|

"No layer" reflects what we found in public reports. It does not prove that no flooding occurred.

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
    flood_2022.geojson
    flood_2023.geojson
    flood_2025.geojson
  overlays/
    flood_2018.png
    flood_2019.png
    flood_2021.png
    flood_2022.png
    flood_2023.png
    flood_2025.png
  dem.tif                    # SRTM elevation, 30 m
```

GeoJSON details:

- Coordinate system: **EPSG:4326** (lat/lon)
- Properties per polygon: `flood` (1), `year`, `source`, `method`

## How to re-run

1. Sign in at https://code.earthengine.google.com/ (registered non-commercial project).
2. Create a new script and paste the contents of `flood_extraction.js`.
3. Edit the **SETTINGS** section if needed (area, years, event windows, threshold).
4. Click **Run**. Check the Console for scene counts and flooded area.
5. Open the **Tasks** tab and click **Run** only on the exports you need. Files go to the Drive folder `FloodMemory`.
6. PNG download links are printed in the Console.

### Settings you can tune

| Setting | Default | Effect |
|---|---|---|
| `aoi` | Alappuzha box | Area processed |
| `YEARS` | 2018, 2019, 2021, 2022, 2023, 2025 | Which years are processed |
| `EVENTS` | one window per year | Flood window used for each year |
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

For 2020 and 2024 there is no overlay. The app should show "No major flood event identified"
for those years instead of an empty map.

## Known limitations

- Radar can confuse smooth surfaces, shadow and wet paddy fields with floodwater.
- Dense buildings and vegetation can hide floodwater from radar.
- Sentinel-1 revisits every 6 to 12 days (about 12 days after 2021), so the image may not show the exact flood peak.
- The result is a pixel-level estimate and has not been formally validated yet.
- Coverage is limited to one area (Alappuzha / Kuttanad) and six flood years.
- Some event windows (2022, 2023, 2025) come from news reports and still need checking against official sources.
- The script has a "season composite" fallback for years without a fixed window. It overestimates
  flooding in Kuttanad, so it is not used for any published layer.

## Next steps

- Verify the 2022, 2023 and 2025 windows against KSDMA or other official reports.
- Extend coverage to other Kerala districts.
- Validate against news reports, official maps or NASA OPERA data.

## Data sources

- Sentinel-1 GRD (`COPERNICUS/S1_GRD`)
- JRC Global Surface Water (`JRC/GSW1_4`)
- SRTM elevation (`USGS/SRTMGL1_003`)
- KSDMA modelled flood hazard maps for Alappuzha are a separate reference. They show modelled
  return-period scenarios, not observed floods, and are not used to build these layers.
