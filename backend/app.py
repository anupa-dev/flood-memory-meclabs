import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, url_for
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # lets Devika's map talk to this server
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024  # 6 MB upload limit

BACKEND_DIR = Path(__file__).resolve().parent
BASE_DIR = BACKEND_DIR.parent
FLOOD_DIR = BASE_DIR / "data" / "flood_geojson"
UPLOAD_DIR = BACKEND_DIR / "uploads"
DB_PATH = BACKEND_DIR / "reports.db"
UPLOAD_DIR.mkdir(exist_ok=True)

# Years are detected from data/flood_geojson/flood_YEAR.geojson
YEARS = sorted(int(p.stem.split("_")[1]) for p in FLOOD_DIR.glob("flood_*.geojson"))

# Area covered by the flood data: west, south, east, north
WEST, SOUTH, EAST, NORTH = 76.25, 9.25, 76.60, 9.70


def in_coverage(lat, lon):
    return SOUTH <= lat <= NORTH and WEST <= lon <= EAST


def find_file(name):
    """Find a data file anywhere under gis/ or data/ so exact paths don't matter."""
    for folder in (BASE_DIR / "gis", BASE_DIR / "data"):
        for p in folder.rglob(name):
            return p
    return None


def serve_geojson(name):
    path = find_file(name)
    if path is None:
        return jsonify({"error": f"{name} not found in the repo"}), 404
    return send_from_directory(path.parent, path.name, mimetype="application/json")


@app.route("/")
def home():
    return jsonify({"project": "Flood Memory API", "years": YEARS})


# ---------- map layers ----------
@app.route("/api/floods")
def api_floods():
    year = request.args.get("year", type=int)
    if year not in YEARS:
        return jsonify({"error": f"year must be one of {YEARS}"}), 400
    return send_from_directory(FLOOD_DIR, f"flood_{year}.geojson", mimetype="application/json")


@app.route("/api/roads")
def api_roads():
    return serve_geojson("roads_flood_by_year.geojson")


@app.route("/api/waterways")
def api_waterways():
    return serve_geojson("waterways.geojson")


# ---------- location summary ----------
_gis = {"layers": None, "error": None}


def ensure_gis():
    """Load the heavy GIS data once, on the first summary request."""
    if _gis["layers"] is not None or _gis["error"] is not None:
        return
    try:
        import gis_summary
        roads = find_file("roads_flood_by_year.geojson")
        water = find_file("waterways.geojson")
        dem = find_file("dem.tif")
        missing = [n for n, p in [("roads_flood_by_year.geojson", roads),
                                  ("waterways.geojson", water), ("dem.tif", dem)] if p is None]
        if missing:
            raise FileNotFoundError(f"missing data files: {missing}")
        _gis["layers"] = gis_summary.load_layers(FLOOD_DIR, roads, water, dem)
    except Exception as exc:  # keep the rest of the API alive
        _gis["error"] = f"{type(exc).__name__}: {exc}"
        print("GIS data not loaded:", _gis["error"])


@app.route("/api/summary")
def api_summary():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    radius = min(max(request.args.get("radius", default=500, type=int), 50), 2000)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon are required, e.g. /api/summary?lat=9.509&lon=76.372"}), 400
    if not in_coverage(lat, lon):
        return jsonify({"error": "location is outside the area covered by the flood data"}), 422
    ensure_gis()
    if _gis["error"]:
        return jsonify({"error": "summary data could not be loaded", "detail": _gis["error"]}), 503
    import gis_summary
    return jsonify(gis_summary.location_summary(lat, lon, _gis["layers"], radius))


# ---------- community reports ----------
def query(sql, args=(), commit=False):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(sql, args)
        if commit:
            conn.commit()
            return cur.lastrowid
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def init_db():
    query("""CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lat REAL NOT NULL, lon REAL NOT NULL,
        event_year INTEGER, water_level_cm REAL,
        description TEXT, photo TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL)""", commit=True)


init_db()


def public(r):
    return {
        "id": r["id"], "lat": r["lat"], "lon": r["lon"],
        "event_year": r["event_year"], "water_level_cm": r["water_level_cm"],
        "description": r["description"],
        "photo_url": url_for("uploads", filename=r["photo"], _external=True) if r["photo"] else None,
        "created_at": r["created_at"],
    }


@app.get("/api/reports")
def list_reports():
    year = request.args.get("year", type=int)
    sql, args = "SELECT * FROM reports WHERE status = 'approved'", ()
    if year is not None:
        sql, args = sql + " AND event_year = ?", (year,)
    rows = query(sql + " ORDER BY id DESC", args)
    return jsonify([public(r) for r in rows])


@app.post("/api/reports")
def create_report():
    data = request.form if request.form else (request.get_json(silent=True) or {})
    try:
        lat, lon = float(data.get("lat")), float(data.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lon are required numbers"}), 400
    if not in_coverage(lat, lon):
        return jsonify({"error": "location is outside the pilot area"}), 422

    event_year = water_level = None
    try:
        if data.get("event_year"):
            event_year = int(data["event_year"])
            if not 2000 <= event_year <= 2100:
                raise ValueError
        if data.get("water_level_cm"):
            water_level = float(data["water_level_cm"])
            if not 0 <= water_level <= 1000:
                raise ValueError
    except ValueError:
        return jsonify({"error": "event_year or water_level_cm is not valid"}), 400

    description = str(data.get("description", "")).strip()[:1000]

    filename = None
    photo = request.files.get("photo")
    if photo and photo.filename:
        ext = Path(photo.filename).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            return jsonify({"error": "photo must be jpg, png or webp"}), 400
        filename = f"{uuid.uuid4().hex}{ext}"
        photo.save(UPLOAD_DIR / filename)

    new_id = query(
        "INSERT INTO reports (lat, lon, event_year, water_level_cm, description, photo, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (lat, lon, event_year, water_level, description, filename,
         datetime.now(timezone.utc).isoformat()),
        commit=True,
    )
    return jsonify({"id": new_id, "status": "pending",
                    "message": "Thanks! Your report will appear after review."}), 201


@app.route("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "file too large (max 6 MB)"}), 413


if __name__ == "__main__":
    app.run(debug=True)