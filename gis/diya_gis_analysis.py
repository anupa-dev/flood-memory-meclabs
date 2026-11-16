import glob
import json
import os
import re
import time

import geopandas as gpd
import osmnx as ox
import rasterio
from shapely.geometry import Point

# ---------- SETTINGS (change these to match Niya's flood area) ----------
CENTER = (9.4981, 76.3388)   # (lat, lon) of Alappuzha town
DIST_M = 8000                # radius in metres around CENTER
UTM = "EPSG:32643"           # metric CRS for Kerala
NEAR_M = 100                 # "near flood" distance in metres
FLOOD_DIR = "data/flood"
DEM_PATH = "data/dem.tif"
OSM_FILE = "data/osm.pbf"   # downloaded map file (used instead of the busy server)
OUT = "out"
os.makedirs(OUT, exist_ok=True)

# Backup Overpass server + longer timeout.
# If this server also fails, delete the next line to use the default server,
# or try "https://overpass.kumi.systems/api"
# using the default Overpass server
ox.settings.requests_timeout = 300


def retry(fn, tries=5, wait=20):
    """Run fn; if the server is busy, wait and try again."""
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            print(f"Attempt {i + 1} failed: {str(e)[:100]}")
            if i == tries - 1:
                raise
            time.sleep(wait * (i + 1))


def keep_columns(gdf, cols):
    """Keep only the given columns, adding empty ones if OSM didn't supply them."""
    for c in cols:
        if c not in gdf.columns:
            gdf[c] = ""
        gdf[c] = gdf[c].astype(str)
    return gdf[cols + ["geometry"]].copy()



# ---------- 1a. Roads and waterways from a downloaded .pbf file (no server) ----------
def download_osm_from_file():
    import math
    from pyogrio import read_dataframe

    dlat = DIST_M / 111000
    dlon = DIST_M / (111000 * math.cos(math.radians(CENTER[0])))
    bbox = (CENTER[1] - dlon, CENTER[0] - dlat, CENTER[1] + dlon, CENTER[0] + dlat)

    print(f"Reading {OSM_FILE} (this can take a few minutes)...")
    lines = read_dataframe(OSM_FILE, layer="lines", bbox=bbox)

    drivable = [
        "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
        "residential", "service", "living_street",
        "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    ]
    roads = lines[lines["highway"].isin(drivable)].reset_index(drop=True)
    roads = keep_columns(roads, ["name", "highway"])
    roads.to_file(f"{OUT}/roads.geojson", driver="GeoJSON")

    water = lines[lines["waterway"].isin(["river", "canal", "stream", "drain"])]
    water = keep_columns(water.reset_index(drop=True), ["name", "waterway"])
    water.to_file(f"{OUT}/waterways.geojson", driver="GeoJSON")

    print(f"Saved {len(roads)} roads and {len(water)} waterways to '{OUT}/'")
    return roads, water

# ---------- 1. Roads and waterways from OpenStreetMap ----------
def download_osm():
    if os.path.exists(OSM_FILE):
        return download_osm_from_file()
    G = retry(lambda: ox.graph_from_point(CENTER, dist=DIST_M, network_type="drive"))
    roads = ox.graph_to_gdfs(G, nodes=False).reset_index(drop=True)
    roads = keep_columns(roads, ["name", "highway"])
    roads.to_file(f"{OUT}/roads.geojson", driver="GeoJSON")

    tags = {"waterway": ["river", "canal", "stream", "drain"]}
    water = retry(
        lambda: ox.features_from_point(CENTER, tags=tags, dist=DIST_M)
    ).reset_index(drop=True)
    water = water[water.geometry.type.isin(["LineString", "MultiLineString"])]
    water = keep_columns(water, ["name", "waterway"])
    water.to_file(f"{OUT}/waterways.geojson", driver="GeoJSON")

    print(f"Saved {len(roads)} roads and {len(water)} waterways to '{OUT}/'")
    return roads, water


# ---------- 2. Load Niya's flood layers ----------
def load_floods():
    floods = {}
    for path in sorted(glob.glob(f"{FLOOD_DIR}/flood_*.geojson")):
        year = re.search(r"(\d{4})", os.path.basename(path)).group(1)
        gdf = gpd.read_file(path).to_crs(UTM)
        floods[year] = gdf.geometry.union_all()  # one merged shape per year
    if not floods:
        raise FileNotFoundError(
            f"No flood files found in '{FLOOD_DIR}'. "
            "Expected names like flood_2018.geojson"
        )
    return floods


# ---------- 3. Roads intersecting flood areas ----------
def analyse_roads(roads, floods):
    roads = roads.to_crs(UTM)
    for year, flood in floods.items():
        roads[f"flooded_{year}"] = roads.intersects(flood)
        roads[f"near_{year}"] = roads.intersects(flood.buffer(NEAR_M))
        roads[f"flooded_m_{year}"] = roads.geometry.intersection(flood).length.round(1)
    roads.to_crs(4326).to_file(f"{OUT}/roads_flood_by_year.geojson", driver="GeoJSON")

    print("Roads intersecting flood areas, by year:")
    for year in floods:
        n = int(roads[f"flooded_{year}"].sum())
        km = roads[f"flooded_m_{year}"].sum() / 1000
        print(f"  {year}: {n} road segments, {km:.1f} km")
    return roads


# ---------- 4. Per-location summary ----------
def location_summary(lat, lon, roads_utm, water_utm, floods, radius=500):
    pt = gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(UTM).iloc[0]
    circle = pt.buffer(radius)

    with rasterio.open(DEM_PATH) as dem:
        elev = next(dem.sample([(lon, lat)]))[0]

    nearest_water = water_utm.distance(pt).min() if len(water_utm) else None

    years = {}
    for year, flood in floods.items():
        years[year] = {
            "inundation_within_radius": bool(flood.intersects(circle)),
            "distance_to_inundation_m": round(float(flood.distance(pt)), 1),
            "flooded_road_m_in_radius": round(
                float(roads_utm[f"flooded_m_{year}"][roads_utm.intersects(circle)].sum()), 1
            ),
        }

    n_hit = sum(v["inundation_within_radius"] for v in years.values())
    return {
        "lat": lat,
        "lon": lon,
        "radius_m": radius,
        "elevation_m": round(float(elev), 1),
        "distance_to_nearest_waterway_m": (
            round(float(nearest_water), 1) if nearest_water is not None else None
        ),
        "years_with_nearby_inundation": n_hit,
        "years_checked": len(years),
        "by_year": years,
        "note": "Historical satellite-observed inundation near this location. "
                "Not proof that a specific building flooded.",
    }


if __name__ == "__main__":
    roads, water = download_osm()
    floods = load_floods()
    roads_utm = analyse_roads(roads, floods)
    water_utm = water.to_crs(UTM)

    # Demo point = middle of the most-flooded road, so the example shows flooding
    worst_year = max(floods, key=lambda y: roads_utm[f"flooded_m_{y}"].sum())
    worst = roads_utm.loc[roads_utm[f"flooded_m_{worst_year}"].idxmax()]
    demo = gpd.GeoSeries([worst.geometry.representative_point()], crs=UTM).to_crs(4326).iloc[0]
    print(f"Demo point: lat {demo.y:.5f}, lon {demo.x:.5f} (most flooded road in {worst_year})")

    result = location_summary(demo.y, demo.x, roads_utm, water_utm, floods)
    with open(f"{OUT}/location_summary_example.json", "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))