"""
Extract bike rides from raw_data into ride_data.

Reads the files written by strava_exporter.py (no Strava API calls) and writes
one JSON file per month containing all bike rides from that month:

  ride_data/2026/2026_oct_data.json

Each file looks like {"year": 2026, "month": "oct", "rides": [...]}, with each
ride in the Ride Log format (distance, power, heart rate, cadence, zones, ...).
ride_data/index.json lists all the month files, for the web page to load.

Intensity, training load and power zones depend on your FTP, which Strava's
API doesn't provide. They use ftp_history.json (created on the first run) -
add an entry there whenever your FTP changes.

Values Strava doesn't have (e.g. heart rate on a ride recorded without a
strap) can be filled in by hand in ride_overrides.json, keyed by Strava
activity id. Values there replace what comes from Strava; keys starting with
"_" are notes and are ignored. Add "exclude": true to leave a ride out of
ride_data (and so off the website) completely.

To join a ride that was split in two (e.g. the app crashed mid-ride), add
"merge_with": ["<other activity id>", ...] to the first part. The parts become
one ride: distances, times and totals are added up, averages are weighted by
time, and power zones and max cadence come from all parts' data.

Run:
  python scripts/extract_rides.py
"""

from __future__ import annotations

import json
import os
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent      # scripts/
PROJECT_DIR = SCRIPTS_DIR.parent                   # folder containing scripts/
# STRAVA_RAW_DIR lets the GitHub Actions workflow keep raw_data outside this
# (public) repo; locally it defaults to raw_data in the project folder.
RAW_DIR = Path(os.environ.get("STRAVA_RAW_DIR") or PROJECT_DIR / "raw_data").resolve()
STREAMS_DIR = RAW_DIR / "streams"
OUT_DIR = PROJECT_DIR / "ride_data"
FTP_FILE = PROJECT_DIR / "ftp_history.json"
OVERRIDES_FILE = PROJECT_DIR / "ride_overrides.json"

# Which Strava sport types count as a bike ride.
# To keep only MyWhoosh/virtual rides, change this to {"VirtualRide"}.
RIDE_TYPES = {
    "Ride", "VirtualRide", "MountainBikeRide", "GravelRide",
    "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle",
}

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
          "jul", "aug", "sep", "oct", "nov", "dec"]

# Used to create ftp_history.json the first time. Each entry applies from its
# "from" date onwards; rides before the first date use the first entry.
DEFAULT_FTP_HISTORY = [
    {"from": "2026-08-29", "ftp": 150},
    {"from": "2026-09-28", "ftp": 160},
]

# Coggan power zones (upper limit as a fraction of FTP), as used by Strava.
POWER_ZONES = [
    ("recovery_sec", 0.55),
    ("endurance_sec", 0.75),
    ("tempo_sec", 0.90),
    ("threshold_sec", 1.05),
    ("vo2max_sec", 1.20),
    ("anaerobic_sec", 1.50),
    ("neuromuscular_sec", math.inf),
]


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


def round_half_up(x, digits: int = 0):
    """Round like Strava's website (2.5 -> 3, not Python's 2.5 -> 2)."""
    if x is None:
        return None
    factor = 10 ** digits
    value = math.floor(x * factor + 0.5) / factor
    return int(value) if digits == 0 else value


def floor_to(x, digits: int = 0):
    """Cut decimals off (11.957 -> 11.95), which matches Strava for some values."""
    if x is None:
        return None
    factor = 10 ** digits
    value = math.floor(x * factor + 1e-9) / factor
    return int(value) if digits == 0 else value


def format_duration(seconds) -> str | None:
    """35:34 for under an hour, 1:03:31 for an hour or more."""
    if seconds is None:
        return None
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# FTP, streams and zones
# ---------------------------------------------------------------------------

def load_ftp_history() -> list[dict]:
    history = load_json(FTP_FILE)
    if not history:
        history = DEFAULT_FTP_HISTORY
        save_json(FTP_FILE, history)
        print(f"Created {FTP_FILE.name} - add an entry there whenever "
              "your FTP changes.")
    return sorted(history, key=lambda e: e["from"])


def ftp_for_date(history: list[dict], date: str):
    if not history:
        return None
    ftp = history[0]["ftp"]
    for entry in history:
        if entry["from"] <= date:
            ftp = entry["ftp"]
    return ftp


def load_streams(activity_id: int) -> dict:
    streams = load_json(STREAMS_DIR / f"{activity_id}.json", {}) or {}
    return {k: (v.get("data") if isinstance(v, dict) else v) or []
            for k, v in streams.items()}


def load_merged_streams(activity_ids: list) -> dict:
    """Streams of several activities joined end to end."""
    joined: dict[str, list] = defaultdict(list)
    offset = 0
    for act_id in activity_ids:
        streams = load_streams(act_id)
        times = streams.get("time", [])
        for key, data in streams.items():
            joined[key].extend([t + offset for t in data] if key == "time" else data)
        if times:
            offset += times[-1] + 1
    return dict(joined)


def merge_activities(parts: list[dict]) -> dict:
    """Combine the parts of a split ride into one activity."""
    parts = sorted(parts, key=lambda a: a.get("start_date_local") or "")
    merged = dict(parts[0])
    merged["_merged_ids"] = [a["id"] for a in parts]

    def values(field):
        return [(a.get(field), a.get("moving_time") or 0) for a in parts
                if a.get(field) is not None]

    for field in ("distance", "moving_time", "elapsed_time", "total_elevation_gain",
                  "kilojoules", "calories", "suffer_score"):
        vals = [v for v, _ in values(field)]
        merged[field] = sum(vals) if vals else None
    for field in ("max_speed", "max_watts", "max_heartrate"):
        vals = [v for v, _ in values(field)]
        merged[field] = max(vals) if vals else None
    for field in ("average_watts", "average_heartrate", "average_cadence"):
        vals = values(field)
        secs = sum(t for _, t in vals)
        merged[field] = sum(v * t for v, t in vals) / secs if secs else None
    # Weighted (normalised) power combines as a time-weighted 4th-power mean.
    vals = values("weighted_average_watts")
    secs = sum(t for _, t in vals)
    merged["weighted_average_watts"] = (round((sum(v ** 4 * t for v, t in vals) / secs) ** 0.25)
                                        if secs else None)
    if merged.get("distance") and merged.get("moving_time"):
        merged["average_speed"] = merged["distance"] / merged["moving_time"]
    return merged


def power_zones(times: list, watts: list, ftp) -> dict | None:
    if not watts or not ftp:
        return None
    zones = {name: 0 for name, _ in POWER_ZONES}
    for i, w in enumerate(watts):
        if w is None:
            continue
        dt = 1
        if 0 < i < len(times):
            dt = times[i] - times[i - 1]
            if dt <= 0 or dt > 5:  # pause or glitch - count as one sample
                dt = 1
        ratio = w / ftp
        for name, upper in POWER_ZONES:
            if ratio <= upper:
                zones[name] += dt
                break
    return zones


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

# Which app a ride came from, by words in Strava's "device_name" field.
APPS = (("MyWhoosh", ("mywhoosh",)), ("Rouvy", ("rouvy",)), ("Zwift", ("zwift",)))


def app_for(act: dict) -> str:
    """MyWhoosh / Rouvy / Zwift from the device name; otherwise Outdoor for a
    real-world ride with GPS, or Indoor for a trainer ride without an app."""
    device = (act.get("device_name") or "").lower()
    for app, words in APPS:
        if any(w in device for w in words):
            return app
    if (act.get("sport_type") or act.get("type")) == "VirtualRide":
        return "Other app"
    if act.get("trainer") or not act.get("start_latlng"):
        return "Indoor"
    return "Outdoor"


def gear_names(activities: list[dict]) -> dict:
    """Gear id -> current name. Uses raw_data/gear.json (kept up to date by
    strava_exporter.py, including renames on Strava), falling back to the name
    saved in each activity's details."""
    names = {}
    for act in sorted(activities, key=lambda a: a.get("start_date_local") or ""):
        gear = act.get("gear") or {}
        if gear.get("id") and gear.get("name"):
            names[gear["id"]] = gear["name"]
    current = (load_json(RAW_DIR / "gear.json", {}) or {}).get("gear", {})
    for gear_id, info in current.items():
        if isinstance(info, dict) and info.get("name"):
            names[gear_id] = info["name"]
    return names


def build_ride(act: dict, ftp) -> dict:
    start = act.get("start_date_local") or act.get("start_date") or ""
    name = act.get("name") or ""
    # MyWhoosh names rides e.g. "Bike Ride - <route>", "Bike Ride (Sprint) - <route>"
    # or "MyWhoosh - <route>"; keep just the route.
    map_name = re.sub(r"^\s*(Bike Ride|MyWhoosh)[^-]*-\s*", "", name, flags=re.I).strip()

    merged_ids = act.get("_merged_ids")
    streams = load_merged_streams(merged_ids) if merged_ids else load_streams(act["id"])
    cadence = [c for c in streams.get("cadence", []) if c]

    moving = act.get("moving_time")
    wap = act.get("weighted_average_watts")
    intensity = training_load = None
    if wap and ftp:
        factor = wap / ftp
        intensity = round_half_up(factor * 100)
        if moving:
            training_load = floor_to(moving * factor * factor / 36)

    kj = act.get("kilojoules")

    def speed(ms):
        return round_half_up(ms * 3.6, 1) if ms is not None else None

    return {
        "date": start[:10],
        "time": start[11:16],
        "map_name": map_name,
        "distance_km": floor_to((act.get("distance") or 0) / 1000, 2),
        "moving_time": format_duration(moving),
        "elevation_m": round_half_up(act.get("total_elevation_gain")),
        "relative_effort": round_half_up(act.get("suffer_score")),
        "weighted_avg_power_w": wap,
        "total_work_kj": round_half_up(kj),
        "training_load": training_load,
        "intensity_pct": intensity,
        "speed_avg_kmh": speed(act.get("average_speed")),
        "speed_max_kmh": speed(act.get("max_speed")),
        "heart_rate_avg_bpm": round_half_up(act.get("average_heartrate")),
        "heart_rate_max_bpm": round_half_up(act.get("max_heartrate")),
        "cadence_avg": round_half_up(act.get("average_cadence")),
        "cadence_max": max(cadence) if cadence else None,
        "power_avg_w": round_half_up(act.get("average_watts")),
        "power_max_w": act.get("max_watts"),
        "calories": round_half_up(act.get("calories") or kj),
        "ftp": ftp,
        "url": f"https://www.strava.com/activities/{act['id']}",
        "elapsed_time": format_duration(act.get("elapsed_time")),
        "zones": power_zones(streams.get("time", []), streams.get("watts", []), ftp),
        **({"merged_urls": [f"https://www.strava.com/activities/{i}" for i in merged_ids]}
           if merged_ids else {}),
    }


def main() -> None:
    year_files = sorted(RAW_DIR.glob("*.json"))
    if not year_files:
        sys.exit("No data in raw_data - run strava_exporter.py first.")

    activities = []
    for path in year_files:
        data = load_json(path, [])
        if isinstance(data, list):
            activities.extend(data)

    rides = [a for a in activities
             if (a.get("sport_type") or a.get("type")) in RIDE_TYPES]
    rides.sort(key=lambda a: a.get("start_date_local") or "")
    ftp_history = load_ftp_history()
    bikes = gear_names(activities)
    overrides = load_json(OVERRIDES_FILE, {}) or {}
    applied = 0
    excluded = 0

    # Rides that are joined onto another ride with "merge_with".
    by_id = {str(a["id"]): a for a in rides}
    merge_parts = {}
    for main_id, fixes in overrides.items():
        if main_id in by_id and isinstance(fixes, dict) and fixes.get("merge_with"):
            merge_parts[main_id] = [str(i) for i in fixes["merge_with"] if str(i) in by_id]
    merged_away = {i for ids in merge_parts.values() for i in ids}

    by_month: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for act in rides:
        if str(act["id"]) in merged_away:
            continue
        fixes = overrides.get(str(act["id"]))
        if fixes and fixes.get("exclude"):
            excluded += 1
            continue
        if merge_parts.get(str(act["id"])):
            act = merge_activities([act] + [by_id[i] for i in merge_parts[str(act["id"])]])
        date = (act.get("start_date_local") or "")[:10]
        ride = build_ride(act, ftp_for_date(ftp_history, date))
        gear_id = act.get("gear_id")
        ride["bike_id"] = gear_id
        ride["bike"] = bikes.get(gear_id) if gear_id else None
        ride["app"] = app_for(act)
        ride["device"] = act.get("device_name")
        if fixes:
            ride.update({k: v for k, v in fixes.items()
                         if not k.startswith("_") and k not in ("exclude", "merge_with")})
            applied += 1
        by_month[(date[:4], int(date[5:7]))].append(ride)

    files = []
    for (year, month_num), month_rides in sorted(by_month.items()):
        month = MONTHS[month_num - 1]
        path = OUT_DIR / year / f"{year}_{month}_data.json"
        save_json(path, {"year": int(year), "month": month, "rides": month_rides})
        print(f"ride_data/{year}/{path.name}: {len(month_rides)} ride(s)")
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
                                 "month": path.stem.split("_")[1], "rides": []})
            print(f"Removed {OUT_DIR.name}/{rel} (no rides left)")
    if applied:
        print(f"Applied {OVERRIDES_FILE.name} to {applied} ride(s)")
    if excluded:
        print(f"Excluded {excluded} ride(s) marked in {OVERRIDES_FILE.name}")
    if merged_away:
        print(f"Merged {len(merged_away)} ride part(s) into {len(merge_parts)} ride(s)")
    print(f"\nDone - {len(rides) - excluded - len(merged_away)} rides written to ride_data.")


if __name__ == "__main__":
    main()
