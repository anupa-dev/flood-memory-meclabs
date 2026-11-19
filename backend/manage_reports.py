import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent / "reports.db"
conn = sqlite3.connect(DB)
cmd = sys.argv[1] if len(sys.argv) > 1 else "list"

if cmd == "list":
    for row in conn.execute(
        "SELECT id, status, event_year, water_level_cm, substr(description, 1, 60) FROM reports ORDER BY id"
    ):
        print(row)
elif cmd in ("approve", "reject") and len(sys.argv) == 3:
    status = "approved" if cmd == "approve" else "rejected"
    conn.execute("UPDATE reports SET status = ? WHERE id = ?", (status, int(sys.argv[2])))
    conn.commit()
    print("done")
else:
    print("usage: python backend/manage_reports.py list | approve ID | reject ID")