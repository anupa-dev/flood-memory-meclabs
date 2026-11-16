# Flood Memory: Tech Stack Documentation

## 1. Overview

Flood Memory is a satellite-powered historical flood intelligence platform. It combines
satellite observations, GIS data and community reports into an interactive map of past
flooding in Kerala. Users search for a location, explore flood events year by year, and see
satellite-observed inundation, nearby roads and waterways, elevation, and community photos
and reports.

> The platform shows **satellite-observed inundation** and clearly separates it from
> ground-level community reports. Satellite data alone does **not** prove that an individual
> building was flooded.

## 2. Stack at a glance

| Component | Technology | Purpose | Owner |
|---|---|---|---|
| Satellite processing | Google Earth Engine (JavaScript) | Extract yearly flood extent from radar | Niya |
| Satellite data | Sentinel-1 radar (VV) | Detect surface water through cloud | Niya |
| Supporting datasets | JRC Global Surface Water, SRTM | Remove permanent water and steep terrain; elevation | Niya |
| Roads and waterways | OpenStreetMap via `osmnx` | Roads and waterways near each location | Diya |
| GIS analysis | Python, GeoPandas | Roads intersecting flood areas, per-location stats | Diya |
| Elevation | SRTM DEM (`dem.tif`) | Elevation at a location | Diya |
| Frontend | [TODO: React or HTML/CSS/JS] | Search, timeline, layers, summary panel | Devika |
| Interactive map | [TODO: Leaflet or Mapbox] | Show flood layers on a map | Devika |
| Backend / API | Python, [TODO: Flask or FastAPI] | Serve data, handle community reports | Anupa |
| Database | PostgreSQL + PostGIS | Store flood polygons and community reports | Anupa |
| Dev tools | VS Code, Git, GitHub | Coding, version control, pull requests | All |
| Optional AI/ML | Not implemented | Flood classification, clustering, photo analysis | Future work |

## 3. Architecture and data flow

```
Satellite Data (Sentinel-1)
        |
        v
Flood / Water Detection (Google Earth Engine)
        |
        v
Historical Flood Database (GeoJSON -> PostGIS)
        |
        v
GIS Layers: Roads + Buildings + Waterways + Elevation  <--  Community Ground Reports
        |
        v
Flood Memory Map (API + web frontend)
        |
        v
Residents, Local Governments, Researchers
```

In short: radar images become yearly flood polygons, which are stored in the database, combined
with GIS layers and community reports, and shown to users on the map.

## 4. Data sources

| Dataset | Used for | Status |
|---|---|---|
| Sentinel-1 GRD (`COPERNICUS/S1_GRD`) | Flood and water detection | Used |
| JRC Global Surface Water (`JRC/GSW1_4`) | Removing permanent water (rivers, sea) | Used |
| SRTM elevation (`USGS/SRTMGL1_003`) | Slope masking and `dem.tif` | Used |
| OpenStreetMap | Roads and waterways | [TODO: Diya to confirm] |
| NASA OPERA surface water products | Validation of our flood extents | Planned |
| Community reports (photo, date, water level) | Ground-level evidence | [TODO: Anupa to confirm] |

## 5. Component details

### 5.1 Satellite flood extraction (Niya)

Script: `gee/flood_extraction.js`, run in the Earth Engine Code Editor.

Method, per flood year:

1. Build a **median composite** of Sentinel-1 VV backscatter over the flood-event window.
2. Build a **dry-season baseline** composite (January to March of the same year).
3. Smooth speckle with a focal median, then classify **water** where VV is below -16 dB.
4. **Baseline subtraction:** keep pixels that are water in the event image but not in the baseline.
5. Remove **permanent water** (JRC occurrence above 80%).
6. Mask **steep terrain** (slope of 5 degrees or more) to avoid radar shadow.
7. Remove small noisy patches (fewer than 8 connected pixels).
8. Calculate flooded area (km2) and export results.

Coverage so far:

| Item | Value |
|---|---|
| Area | Alappuzha / Kuttanad |
| Bounds [W, S, E, N] | 76.25, 9.25, 76.60, 9.70 |
| Years | 2018, 2019, 2021 |
| Resolution | 30 m |

Outputs:

| Output | Format | Used by |
|---|---|---|
| `flood_YYYY.geojson` | Vector polygons, EPSG:4326 | GIS analysis, PostGIS |
| `flood_YYYY.png` | Transparent map overlay | Leaflet `imageOverlay` |
| `flood_YYYY.tif` | Raster backup | Reference |
| `dem.tif` | SRTM elevation, 30 m | GIS analysis |

### 5.2 GIS analysis (Diya)

[TODO: Diya to confirm.] Planned: download OSM roads and waterways with `osmnx`, read elevation
from `dem.tif`, and use GeoPandas to find roads intersecting flood areas and to produce summary
statistics per location (for example flooded years, nearby roads affected, elevation).

### 5.3 Frontend and map (Devika)

[TODO: Devika to confirm.] Planned: Leaflet map, year timeline slider, layer toggles, search
box and a location summary panel. Flood PNG overlays use the bounds
`[[9.25, 76.25], [9.70, 76.60]]`.

### 5.4 Backend, database and reports (Anupa)

[TODO: Anupa to confirm.] Planned: Python API with PostgreSQL + PostGIS, storing flood polygons
by year and community reports (photo, date, water level), plus integration of all parts.

## 6. Shared data conventions

- Coordinate system: **EPSG:4326** (latitude/longitude) for all vector data.
- Flood files: `flood_2018.geojson`, `flood_2019.geojson`, and so on.
- GeoJSON properties: `flood`, `year`, `source`, `method`.
- Leaflet bounds are `[lat, lon]`, which is the reverse order of the Earth Engine script.
- Satellite-observed flooding and community reports are always shown as **separate layers**.

## 7. Why these choices

| Choice | Reason |
|---|---|
| Sentinel-1 radar | Sees through monsoon clouds, which optical satellites cannot, and is free |
| Google Earth Engine | Handles large satellite datasets without downloading imagery; free for non-commercial use |
| Baseline subtraction | Separates real flooding from rivers and backwaters that are always there |
| PostgreSQL + PostGIS | Efficient storage and spatial queries on polygons |
| GeoJSON | Simple, open format that works with GeoPandas, PostGIS and Leaflet |
| Leaflet | Lightweight, open-source and beginner-friendly mapping |
| OpenStreetMap | Free, open road and waterway data |

## 8. Development tools and workflow

- **VS Code** for code, **Git/GitHub** for version control.
- Each member works on their own branch (for example `niya/gee-flood-extraction`) and opens a
  **pull request** into `main`, which is reviewed and merged by the repo owner.
- Run `git pull` before starting work each day.

Repository layout (current):

```
gee/               Earth Engine script and notes
data/
  flood_geojson/   yearly flood polygons
  overlays/        PNG overlays
  dem.tif          elevation
```

## 9. Limitations

- Radar can confuse smooth surfaces, radar shadow and wet paddy fields with floodwater.
- Dense buildings and vegetation can hide floodwater from radar.
- Sentinel-1 revisits every 6 to 12 days, so images may miss the exact flood peak.
- Results are pixel-level estimates and have not yet been formally validated.
- SRTM elevation is from 2000 and has 30 m resolution; it is approximate.
- Coverage is currently limited to Alappuzha / Kuttanad and three years.
- Satellite data cannot prove that an individual building was flooded.

## 10. Future work

- Add more years (2020, 2022, 2023) and extend coverage to other Kerala districts.
- Validate against news reports, official maps and NASA OPERA data.
- Optional AI/ML: flood classification, clustering and analysis of community photos.
- Later: predictive modelling.

## 11. How to run

**Satellite part (Niya):**
1. Sign in at https://code.earthengine.google.com/ with a registered non-commercial account.
2. Paste `gee/flood_extraction.js`, adjust the SETTINGS section, and click Run.
3. Run the export tasks in the Tasks tab; files are saved to the Drive folder `FloodMemory`.

**Other parts:** [TODO: each teammate adds their own setup steps here.]
