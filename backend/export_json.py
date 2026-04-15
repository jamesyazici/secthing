"""
Run this after ingesting to export the database to a JSON file
the frontend can load directly (no backend server needed).

Usage:
    python export_json.py
"""

import sqlite3
import json
import os
from datetime import datetime, timezone

DB_PATH  = os.path.join(os.path.dirname(__file__), "sec_data.db")
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "companies.json")

def main():
    if not os.path.exists(DB_PATH):
        print("ERROR: sec_data.db not found. Run the ingest first.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.execute("SELECT * FROM companies ORDER BY name COLLATE NOCASE")
    companies = [dict(r) for r in cur.fetchall()]
    conn.close()

    if not companies:
        print("WARNING: Database is empty. Run the ingest first.")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(companies),
        "companies": companies,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, separators=(",", ":"))  # compact, no extra whitespace

    size_mb = os.path.getsize(OUT_PATH) / 1_000_000
    print(f"Exported {len(companies):,} companies → frontend/public/companies.json ({size_mb:.1f} MB)")

if __name__ == "__main__":
    main()
