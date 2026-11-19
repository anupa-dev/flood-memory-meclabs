"""Location summary, based on Diya's location_summary() in gis/diya_gis_analysis.py.
Made self-contained so the API does not depend on her script's other imports."""
import geopandas as gpd
import rasterio
from shapely.geometry import Point

UTM = 32643  # UTM zone 43N (metres), suits Kerala


def _union(gdf):
    g = gdf.geometry
    return g.union_all() if hasattr(g, "union_all") else g.unary_union


def load_layers(flood_dir, roads_path, water_path, dem_path):
    roads = gpd.read_file(roads_path).to_crs(UTM)
    water = gpd.read_file(water_path).to_crs(UTM)
    floods = {}
    for p in sorted(flood_dir.glob("flood_*.geojson")):
        year = int(p.stem.split("_")[1])
        floods[year] = _union(gpd.read_file(p).to_crs(UTM))
    return {"roads": roads, "water": water, "floods": floods, "dem": str(dem_path)}


def location_summary(lat, lon, layers, radius=500):
    roads, water, floods = layers["roads"], layers["water"], layers["floods"]
    pt = gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(UTM).iloc[0]
    circle = pt.buffer(radius)

    with rasterio.open(layers["dem"]) as dem:
        elev = float(next(dem.sample([(lon, lat)]))[0])

    nearest_water = water.distance(pt).min() if len(water) else None
    near_roads = roads[roads.intersects(circle)]

    years = {}
    for year, flood in floods.items():
        col = f"flooded_m_{year}"
        dist = None if flood.is_empty else float(flood.distance(pt))
        years[year] = {
            "inundation_within_radius": bool(flood.intersects(circle)),
            "distance_to_inundation_m": round(dist, 1) if dist is not None else None,
            "flooded_road_m_in_radius": (
                round(float(near_roads[col].sum()), 1) if col in near_roads.columns else None
            ),
        }

    n_hit = sum(v["inundation_within_radius"] for v in years.values())
    return {
        "lat": lat,
        "lon": lon,
        "radius_m": radius,
        "elevation_m": round(elev, 1) if elev > -1000 else None,
        "elevation_note": "Approximate SRTM terrain height; errors of several metres are possible.",
        "distance_to_nearest_waterway_m": (
            round(float(nearest_water), 1) if nearest_water is not None else None
        ),
        "years_with_nearby_inundation": n_hit,
        "years_checked": len(years),
        "by_year": years,
        "note": "Historical satellite-observed inundation near this location. "
                "Not proof that a specific building flooded.",
    }