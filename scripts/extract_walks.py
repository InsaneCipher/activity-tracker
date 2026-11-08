"""
Extract walks and hikes from raw_data into walk_data.

Reads the files written by strava_exporter.py (no Strava API calls) and writes
one JSON file per month containing all walks/hikes from that month:

  walk_data/2026/2026_oct_data.json

Each file looks like {"year": 2026, "month": "oct", "walks": [...]}.
walk_data/index.json lists all the month files, for a web page to load.

Run:
  python scripts/extract_walks.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent      # scripts/
PROJECT_DIR = SCRIPTS_DIR.parent                   # folder containing scripts/
# STRAVA_RAW_DIR lets the GitHub Actions workflow keep raw_data outside this
# (public) repo; locally it defaults to raw_data in the project folder.
RAW_DIR = Path(os.environ.get("STRAVA_RAW_DIR") or PROJECT_DIR / "raw_data").resolve()
OUT_DIR = PROJECT_DIR / "walk_data"

WALK_TYPES = {"Walk", "Hike"}

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
          "jul", "aug", "sep", "oct", "nov", "dec"]

# Include the GPS route (Strava's encoded polyline) in each file. Off by
# default because walk_data may be published, and routes usually start and
# end at home.
INCLUDE_ROUTE = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_json(path: Path, default=None):
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def rnd(x, digits: int = 0):
    if x is None:
        return None
    return int(round(x)) if digits == 0 else round(x, digits)


def format_duration(seconds) -> str | None:
    """35:34 for under an hour, 1:03:31 for an hour or more."""
    if seconds is None:
        return None
    h, rem = divmod(int(round(seconds)), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def pace(seconds, metres) -> str | None:
    """Minutes per km, e.g. 11:16."""
    if not seconds or not metres:
        return None
    return format_duration(seconds / (metres / 1000))


def speed_kmh(ms):
    return rnd(ms * 3.6, 1) if ms is not None else None


def steps_per_min(cadence):
    # Strava stores walking cadence per foot; double it for steps per minute.
    return rnd(cadence * 2) if cadence else None


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def build_walk(act: dict) -> dict:
    start = act.get("start_date_local") or act.get("start_date") or ""
    moving = act.get("moving_time")
    distance = act.get("distance") or 0
    cadence = act.get("average_cadence")

    splits = []
    for s in act.get("splits_metric") or []:
        splits.append({
            "km": s.get("split"),
            "distance_m": rnd(s.get("distance")),
            "moving_time": format_duration(s.get("moving_time")),
            "pace_min_per_km": pace(s.get("moving_time"), s.get("distance")),
            "elevation_change_m": rnd(s.get("elevation_difference"), 1),
            "heart_rate_avg_bpm": rnd(s.get("average_heartrate")),
        })

    walk = {
        "id": act["id"],
        "url": f"https://www.strava.com/activities/{act['id']}",
        "name": act.get("name"),
        "type": act.get("sport_type") or act.get("type"),
        "date": start[:10],
        "time": start[11:16],
        "distance_km": rnd(distance / 1000, 2),
        "moving_time": format_duration(moving),
        "moving_time_sec": moving,
        "elapsed_time": format_duration(act.get("elapsed_time")),
        "elapsed_time_sec": act.get("elapsed_time"),
        "pace_min_per_km": pace(moving, distance),
        "speed_avg_kmh": speed_kmh(act.get("average_speed")),
        "speed_max_kmh": speed_kmh(act.get("max_speed")),
        "elevation_gain_m": rnd(act.get("total_elevation_gain")),
        "elevation_high_m": rnd(act.get("elev_high"), 1),
        "elevation_low_m": rnd(act.get("elev_low"), 1),
        "heart_rate_avg_bpm": rnd(act.get("average_heartrate")),
        "heart_rate_max_bpm": rnd(act.get("max_heartrate")),
        "cadence_avg_spm": steps_per_min(cadence),
        "steps_estimated": (rnd(cadence * 2 * moving / 60)
                            if cadence and moving else None),
        "calories": rnd(act.get("calories")),
        "relative_effort": rnd(act.get("suffer_score")),
        "device": act.get("device_name"),
        "description": act.get("description"),
        "splits": splits,
    }
    if INCLUDE_ROUTE:
        m = act.get("map") or {}
        walk["route_polyline"] = m.get("polyline") or m.get("summary_polyline")
    return walk


def main() -> None:
    year_files = sorted(RAW_DIR.glob("*.json"))
    if not year_files:
        sys.exit("No data in raw_data - run strava_exporter.py first.")

    activities = []
    for path in year_files:
        data = load_json(path, [])
        if isinstance(data, list):
            activities.extend(data)

    walks = [a for a in activities
             if (a.get("sport_type") or a.get("type")) in WALK_TYPES]
    walks.sort(key=lambda a: a.get("start_date_local") or "")

    by_month: dict[tuple[str, int], list[dict]] = {}
    for act in walks:
        walk = build_walk(act)
        key = (walk["date"][:4], int(walk["date"][5:7]))
        by_month.setdefault(key, []).append(walk)

    files = []
    for (year, month_num), month_walks in sorted(by_month.items()):
        month = MONTHS[month_num - 1]
        path = OUT_DIR / year / f"{year}_{month}_data.json"
        save_json(path, {"year": int(year), "month": month, "walks": month_walks})
        print(f"walk_data/{year}/{path.name}: {len(month_walks)} walk(s)")
        files.append(f"{year}/{path.name}")

    # List of month files, so web pages know what to load.
    save_json(OUT_DIR / "index.json", {"files": files})

    # Month files left over from activities that have since been deleted or
    # excluded (any other .json files in the year folders are left alone).
    for path in OUT_DIR.glob("*/*_data.json"):
        rel = f"{path.parent.name}/{path.name}"
        if rel not in files:
            try:
                path.unlink()
            except OSError:
                save_json(path, {"year": int(path.parent.name),
                                 "month": path.stem.split("_")[1], "walks": []})
            print(f"Removed {OUT_DIR.name}/{rel} (no walks left)")
    print(f"\nDone - {len(walks)} walks/hikes written to walk_data.")


if __name__ == "__main__":
    main()
