"""
Download all your Strava data into the raw_data folder.

Writes, in the project folder (the one containing scripts/):
  raw_data/<year>.json         every activity (all sports) that started in that
                               year, with Strava's full activity details
                               (calories, laps, splits, gear, description, ...)
  raw_data/streams/<id>.json   the second-by-second sensor data for each
                               activity: time, distance, GPS, altitude, speed,
                               heart rate, cadence, power, temperature, ...

After downloading, it runs extract_rides.py and extract_walks.py (if they're
in scripts/) to rebuild ride_data and walk_data from raw_data. Use
  python scripts/strava_exporter.py --no-extract
to only download.

Later runs only download activities that aren't in raw_data yet, and
activities you've deleted on Strava are removed from raw_data too. Use
  python scripts/strava_exporter.py --refresh
to download every activity's details again (e.g. after editing old activities
on Strava).

Setup (one time):
  1. Create an API application at https://www.strava.com/settings/api
     with "Authorization Callback Domain" set to localhost.
  2. Put the Client ID and Client Secret in scripts/strava_config.json:
       {"client_id": "...", "client_secret": "..."}
  3. pip install truststore   (uses Windows' certificate store for HTTPS)

Run:
  python scripts/strava_exporter.py

The first run opens your browser so you can authorize access. Tokens are
stored in strava_tokens.json and refreshed automatically on later runs.

Strava allows about 100 requests per 15 minutes. Each new activity needs two
requests, so a big first download pauses for 15 minutes at a time; progress is
saved, so you can also stop it and run it again later.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Use the operating system's certificate store (Windows/macOS) for HTTPS.
# This fixes "CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate
# chain" errors caused by antivirus HTTPS scanning or corporate proxies.
# Install with:  pip install truststore
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    truststore = None

SCRIPTS_DIR = Path(__file__).resolve().parent      # scripts/
PROJECT_DIR = SCRIPTS_DIR.parent                   # folder containing scripts/
RAW_DIR = PROJECT_DIR / "raw_data"
STREAMS_DIR = RAW_DIR / "streams"
CONFIG_FILE = SCRIPTS_DIR / "strava_config.json"
TOKEN_FILE = SCRIPTS_DIR / "strava_tokens.json"

AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
API_URL = "https://www.strava.com/api/v3"

REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/callback"
SCOPE = "read,activity:read_all"  # activity:read_all includes private activities
PER_PAGE = 200  # Strava's maximum

# Every stream type Strava offers. Missing ones (e.g. watts on a walk) are
# simply left out of the response.
STREAM_KEYS = ("time,distance,latlng,altitude,velocity_smooth,heartrate,"
               "cadence,watts,temp,moving,grade_smooth")

SAVE_EVERY = 10  # save progress after this many newly downloaded activities


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_json(path: Path, default=None):
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, data, compact: bool = False) -> None:
    with open(path, "w", encoding="utf-8") as f:
        if compact:  # streams are large - keep them on one line
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(data, f, indent=2, ensure_ascii=False)


def http_request(url: str, method: str = "GET", data: dict | None = None,
                 headers: dict | None = None, allow_404: bool = False):
    """Make an HTTP request, handling Strava rate limits (HTTP 429)."""
    body = urllib.parse.urlencode(data).encode() if data else None
    while True:
        req = urllib.request.Request(url, data=body, method=method,
                                     headers=headers or {})
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404 and allow_404:
                return None
            if e.code == 429:
                print("Strava rate limit reached - waiting 15 minutes before "
                      "continuing...")
                time.sleep(15 * 60 + 5)
                continue
            detail = e.read().decode("utf-8", errors="replace")
            raise SystemExit(f"HTTP {e.code} error from Strava: {detail}")
        except urllib.error.URLError as e:
            if "CERTIFICATE_VERIFY_FAILED" in str(e.reason):
                hint = ("Run:  pip install truststore   and try again."
                        if truststore is None else
                        "Check your antivirus HTTPS scanning or proxy settings.")
                raise SystemExit(
                    "SSL certificate check failed. Something on this computer "
                    "(often antivirus web scanning or a VPN/proxy) is intercepting "
                    f"HTTPS traffic.\n{hint}")
            raise SystemExit(f"Network error contacting Strava: {e.reason}")


# ---------------------------------------------------------------------------
# Credentials & OAuth
# ---------------------------------------------------------------------------

def get_client_credentials() -> tuple[str, str]:
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    if client_id and client_secret:
        return client_id, client_secret

    config = load_json(CONFIG_FILE, {})
    if config.get("client_id") and config.get("client_secret"):
        return str(config["client_id"]), config["client_secret"]

    print("Strava API credentials not found.")
    print("Create an app at https://www.strava.com/settings/api "
          "(set Authorization Callback Domain to 'localhost').")
    client_id = input("Client ID: ").strip()
    client_secret = input("Client Secret: ").strip()
    save_json(CONFIG_FILE, {"client_id": client_id, "client_secret": client_secret})
    print(f"Saved credentials to {CONFIG_FILE.name}")
    return client_id, client_secret


def authorize(client_id: str) -> str:
    """Open the browser for user consent and capture the authorization code."""
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in params:
                result["code"] = params["code"][0]
                result["scope"] = params.get("scope", [""])[0]
                msg = "Authorization successful! You can close this tab."
            else:
                result["error"] = params.get("error", ["unknown"])[0]
                msg = f"Authorization failed: {result['error']}"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(f"<h2>{msg}</h2>".encode())

        def log_message(self, *args):
            pass  # keep console quiet

    query = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": SCOPE,
    })
    url = f"{AUTH_URL}?{query}"

    server = HTTPServer(("localhost", REDIRECT_PORT), Handler)
    print("Opening your browser to authorize access to Strava...")
    print(f"If it doesn't open, visit this URL manually:\n{url}\n")
    webbrowser.open(url)
    while not result:
        server.handle_request()
    server.server_close()

    if "error" in result:
        raise SystemExit(f"Authorization failed: {result['error']}")
    if "activity:read_all" not in result.get("scope", ""):
        print("Warning: 'View raw_data about your private activities' was not granted; "
              "private activities will be skipped.")
    return result["code"]


def get_tokens() -> dict:
    client_id, client_secret = get_client_credentials()
    tokens = load_json(TOKEN_FILE)

    if tokens is None:
        code = authorize(client_id)
        tokens = http_request(TOKEN_URL, "POST", {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
        })
        save_json(TOKEN_FILE, tokens)
    elif tokens.get("expires_at", 0) < time.time() + 60:
        print("Refreshing access token...")
        refreshed = http_request(TOKEN_URL, "POST", {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        })
        refreshed.setdefault("athlete", tokens.get("athlete"))
        tokens = refreshed
        save_json(TOKEN_FILE, tokens)

    return tokens


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def fetch_activity_list(headers: dict) -> list[dict]:
    activities = []
    page = 1
    while True:
        url = f"{API_URL}/athlete/activities?" + urllib.parse.urlencode(
            {"page": page, "per_page": PER_PAGE})
        batch = http_request(url, headers=headers)
        if not batch:
            break
        activities.extend(batch)
        page += 1
    print(f"Found {len(activities)} activities on Strava")
    return activities


def load_existing() -> dict[int, dict]:
    """Activities already saved in raw_data, keyed by id."""
    existing = {}
    for path in RAW_DIR.glob("*.json"):
        data = load_json(path, [])
        if isinstance(data, list):
            for act in data:
                if isinstance(act, dict) and "id" in act:
                    existing[act["id"]] = act
    return existing


def year_of(act: dict) -> str:
    date = act.get("start_date_local") or act.get("start_date") or ""
    return date[:4] if date[:4].isdigit() else "unknown"


def save_by_year(activities: list[dict]) -> dict[str, int]:
    by_year = defaultdict(list)
    for act in activities:
        by_year[year_of(act)].append(act)
    for acts in by_year.values():
        acts.sort(key=lambda a: a.get("start_date_local") or "")
        save_json(RAW_DIR / f"{year_of(acts[0])}.json", acts)
    return {y: len(a) for y, a in by_year.items()}


def remove_file(path: Path) -> None:
    """Delete a file; if that isn't allowed, empty it instead."""
    try:
        path.unlink()
    except OSError:
        save_json(path, [] if path.parent == RAW_DIR else {})


def remove_deleted(activities: list[dict], counts: dict[str, int]) -> None:
    """Remove local data for activities that no longer exist on Strava."""
    for path in RAW_DIR.glob("*.json"):
        if path.stem not in counts:  # every activity from that year is gone
            remove_file(path)
            print(f"Removed raw_data/{path.name} (no activities left)")
    ids = {str(a["id"]) for a in activities}
    gone = [p for p in STREAMS_DIR.glob("*.json") if p.stem not in ids]
    for path in gone:
        remove_file(path)
    if gone:
        print(f"Removed streams for {len(gone)} activity(s) deleted on Strava")


def fetch_streams(activity_id: int, headers: dict) -> dict:
    url = (f"{API_URL}/activities/{activity_id}/streams?"
           + urllib.parse.urlencode({"keys": STREAM_KEYS, "key_by_type": "true"}))
    streams = http_request(url, headers=headers, allow_404=True)
    if streams is None:  # e.g. manually entered activities have no streams
        return {}
    if isinstance(streams, list):  # older response style
        streams = {s.get("type"): s for s in streams}
    return streams


EXTRACT_SCRIPTS = ("extract_rides.py", "extract_walks.py")


def run_extract_scripts() -> None:
    """Run each extract script's main() as if it had been run directly."""
    for name in EXTRACT_SCRIPTS:
        path = SCRIPTS_DIR / name
        if not path.exists():
            print(f"\n{name} not found - skipping")
            continue
        print(f"\n--- Running {name} ---")
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
            module.main()
        except SystemExit as e:  # an extract script stopped early
            if e.code not in (None, 0):
                print(e.code)


def main() -> None:
    refresh = "--refresh" in sys.argv[1:]
    RAW_DIR.mkdir(exist_ok=True)
    STREAMS_DIR.mkdir(exist_ok=True)

    tokens = get_tokens()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    summaries = fetch_activity_list(headers)
    existing = load_existing()

    # Start from the activity list (so activities deleted on Strava drop out),
    # reusing full details already downloaded.
    activities = []
    to_fetch = []
    for summary in summaries:
        saved = existing.get(summary["id"])
        if saved and saved.get("resource_state") == 3 and not refresh:
            activities.append(saved)
        else:
            activities.append(summary)
            to_fetch.append(len(activities) - 1)

    missing_streams = [
        i for i, a in enumerate(activities)
        if i not in to_fetch and not (STREAMS_DIR / f"{a['id']}.json").exists()
    ]

    if to_fetch or missing_streams:
        print(f"Downloading {len(to_fetch)} activities "
              f"({len(summaries) - len(to_fetch)} already saved)...")

    for n, i in enumerate(to_fetch, 1):
        act_id = activities[i]["id"]
        detail = http_request(f"{API_URL}/activities/{act_id}", headers=headers)
        activities[i] = detail
        save_json(STREAMS_DIR / f"{act_id}.json", fetch_streams(act_id, headers), compact=True)
        print(f"  [{n}/{len(to_fetch)}] {(detail.get('start_date_local') or '')[:10]} "
              f"{detail.get('sport_type', '')}: {detail.get('name', '')}")
        if n % SAVE_EVERY == 0:
            save_by_year(activities)

    for i in missing_streams:
        act_id = activities[i]["id"]
        save_json(STREAMS_DIR / f"{act_id}.json", fetch_streams(act_id, headers), compact=True)

    counts = save_by_year(activities)
    removed = len(existing.keys() - {a["id"] for a in activities})
    if removed:
        print(f"{removed} activity(s) were deleted on Strava and removed locally")
    remove_deleted(activities, counts)
    for year in sorted(counts):
        print(f"Saved {counts[year]:>4} activities to raw_data/{year}.json")
    print(f"\nDone - {len(activities)} activities in raw_data.")

    if "--no-extract" not in sys.argv[1:]:
        run_extract_scripts()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nCancelled - progress so far is saved; run again to continue.")
