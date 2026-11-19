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
| Roads and waterways: OpenStreetMap (.pbf extract) via pyogrio; osmnx as fallback
GIS analysis: Python, GeoPandas, Shapely, Rasterio | Diya |
| Elevation | SRTM DEM (`dem.tif`) | Elevation at a location | Diya |
| Frontend | [TODO: React or HTML/CSS/JS] | Search, timeline, layers, summary panel | Devika |
| Interactive map | [TODO: Leaflet or Mapbox] | Show flood layers on a map | Devika |
| Backend / API | Python, [TODO: Flask] | Serve data, handle community reports | Anupa |
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
| OpenStreetMap (© OpenStreetMap contributors, ODbL) | Roads and waterways | Used |
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

**Technologies**

| Technology | Version | Role | Why chosen |
|---|---|---|---|
| Python | 3.14 | Language for the analysis pipeline | Standard for GIS work; same language as the Flask backend |
| osmnx | 2.1.1 | Downloads OSM roads/waterways via the Overpass API (fallback when no `.pbf` file is present) | Clean road networks in one function call |
| pyogrio | 0.13.0 | Reads the OSM `.pbf` file; fast GeoJSON read/write | Works offline, so no dependence on busy public servers |
| GeoPandas | 1.2.0 | Overlay of roads with flood polygons, per-year statistics | Spatial operations on tables of geometries |
| Shapely | 2.2.0 | Geometry operations: intersects, buffer, distance | Core geometry engine under GeoPandas |
| Rasterio | 1.5.2 | Reads elevation values from `dem.tif` | Reads GeoTIFF rasters |
| pandas / numpy | 3.1.0 / 2.5.4 | Data handling and statistics | Required by GeoPandas |

**Inputs**

- Flood polygons: `flood_2018/2019/2021.geojson`, EPSG:4326 (from `data/flood_geojson/`)
- Elevation: `data/dem.tif`, SRTM 30 m GeoTIFF, EPSG:4326
- Roads and waterways: `data/gis/osm.pbf`, a BBBike extract of OpenStreetMap data

**What it does**

1. Extracts drivable roads and waterways (rivers, canals, streams, drains) from the OSM file.
2. Finds roads intersecting flood areas for each year. Each road gets `flooded_<year>`
   (true/false), `near_<year>` (within 100 m) and `flooded_m_<year>` (metres flooded).
3. `location_summary(lat, lon)` returns elevation, distance to the nearest waterway, and for
   each year whether inundation was seen within 500 m, how far away, and metres of flooded road.

**Coordinate systems and formats**

- Exchange format: GeoJSON in EPSG:4326, directly loadable in Leaflet.
- Calculations are reprojected to EPSG:32643 (UTM zone 43N) so distances are in metres.
- Summary output: JSON for the Flask API and database.

**Outputs** (the script writes to `out/`; results are stored in `data/gis/`)

- `roads.geojson` (3,419 road segments)
- `waterways.geojson` (298 waterway segments)
- `roads_flood_by_year.geojson` (roads with flood attributes per year)
- `location_summary_example.json` (format reference for the API)

**Interfaces with the team**

- Niya to Diya: flood GeoJSON and `dem.tif`
- Diya to Devika: `roads_flood_by_year.geojson` and `waterways.geojson` (map layers)
- Diya to Anupa: `location_summary_example.json` and `location_summary()` (API/database)

**Area covered**

8 km radius around 9.4981, 76.3388, limited to the downloaded OSM extract (about lat 9.447 to
9.539, lon 76.258 to 76.386). The flood extraction area is larger (W 76.25, S 9.25, E 76.60,
N 9.70).

**How to run**

1. `pip install -r requirements.txt` (includes osmnx, geopandas, rasterio, shapely, pyogrio)
2. In `gis/diya_gis_analysis.py`, check the path settings at the top match the repo:
   `FLOOD_DIR = "data/flood_geojson"`, `DEM_PATH = "data/dem.tif"`, `OSM_FILE = "data/gis/osm.pbf"`
3. From the repo root run: `python gis/diya_gis_analysis.py`
4. Results are written to `out/`.

**Design decisions**

- Public Overpass servers were often overloaded, so the script reads a downloaded `.pbf` file
  when one exists and falls back to Overpass (with automatic retries) when it does not.
- The demo point is chosen automatically as the middle of the most-flooded road, so the
  example output shows flooding.

**Limitations**

- OSM road data may be incomplete.
- Only 3 years (2018, 2019, 2021) and one area (Alappuzha / Kuttanad).
- Results depend on the satellite extraction and are not formally validated.
- Elevation is sampled at a single point, not an area summary.
- No buildings layer yet.
- The data shows satellite-observed inundation near a location, not proof that a specific road
  or building flooded.

### 5.3 Frontend and map (Devika)

[TODO: Devika to confirm.] Planned: Leaflet map, year timeline slider, layer toggles, search
box and a location summary panel. Flood PNG overlays use the bounds
`[[9.25, 76.25], [9.70, 76.60]]`.

### 5.4 Backend, database and reports (Anupa)

**Backend (Flask API, `backend/app.py`).** A Python Flask server that serves the flood layers and
GIS results to the Leaflet map and stores community reports. Flood polygons, roads and waterways
are precomputed files (GeoJSON) served directly; the location summary is computed on request with
GeoPandas and rasterio from those files and the SRTM elevation raster. Community reports (location,
event year, water level, description, optional photo) are stored in SQLite, chosen over
PostgreSQL/PostGIS because it needs no setup and the data volume is small; the schema maps directly
to a PostGIS table if the project grows. New reports start as "pending" and appear on the map only
after a team member approves them. Photos are limited to 6 MB and to jpg/png/webp.
Endpoints: GET /api/floods?year=, /api/roads, /api/waterways, /api/summary?lat=&lon=,
GET and POST /api/reports.
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
