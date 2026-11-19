from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # lets Devika's map talk to this server

BASE_DIR = Path(__file__).resolve().parent.parent
FLOOD_DIR = BASE_DIR / "data" / "flood_geojson"
# Years are detected from the files in data/flood_geojson (flood_YEAR.geojson),
# so adding a new year only needs the new file, no code change.
YEARS = sorted(
    int(p.stem.split("_")[1]) for p in FLOOD_DIR.glob("flood_*.geojson")
)


@app.route("/")
def home():
    return jsonify({"project": "Flood Memory API", "years": YEARS})


@app.route("/api/floods")
def floods():
    year = request.args.get("year", type=int)
    if year not in YEARS:
        return jsonify({"error": f"year must be one of {YEARS}"}), 400
    return send_from_directory(
        FLOOD_DIR, f"flood_{year}.geojson", mimetype="application/json"
    )


if __name__ == "__main__":
    app.run(debug=True)