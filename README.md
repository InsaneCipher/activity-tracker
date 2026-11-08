# Activity Tracker

Personal activity tracker for my rides and walks. Activities sync automatically
from Strava every 15 minutes and are shown on a static site hosted with GitHub Pages.

**Live site:** https://insanecipher.github.io/activity-tracker/

## Pages

| Page | What it shows |
|------|---------------|
| [Home](index.html) | Totals across everything, a card per activity type, an activity calendar and the 10 latest activities |
| [Ride Log](rides.html) | Rides (mostly MyWhoosh virtual rides): power, FTP, speed, heart rate, power zones, records and route history |
| [Walk Log](walks.html) | Walks and hikes: pace, steps, heart rate, km splits, records and monthly trends |

### Ride Log

<img width="1542" height="802" alt="Ride Log table" src="https://github.com/user-attachments/assets/c11d2f4a-2062-459a-82a2-bfd3cfe0ea29" />

<img width="1413" height="869" alt="Ride Log graphs" src="https://github.com/user-attachments/assets/f2d22ca8-9705-4dc4-afb0-609c8dae2004" />

## How it works

```
Strava API
   │  every 15 min (GitHub Actions: .github/workflows/strava-sync.yml)
   ▼
scripts/strava_exporter.py ──► raw_data  (full activity details + second-by-second streams)
   │                            kept in a private repo, as it contains GPS tracks
   ├─► scripts/extract_rides.py ──► ride_data/<year>/<year>_<mon>_data.json
   └─► scripts/extract_walks.py ──► walk_data/<year>/<year>_<mon>_data.json
                                         │
                                         ▼
                         index.html · rides.html · walks.html (GitHub Pages)
```

The workflow commits `ride_data` and `walk_data` only when something changed.
Each folder has an `index.json` listing its monthly files, which the pages load.

## Repository layout

```
├── index.html, rides.html, walks.html   the site
├── ride_data/, walk_data/               generated activity data (don't edit by hand)
├── ftp_history.json                     my FTP over time (for intensity, training load and zones)
├── ride_overrides.json                  hand fixes for rides, and "exclude": true to hide a ride
├── scripts/
│   ├── strava_exporter.py               downloads from Strava, then runs the extract scripts
│   ├── extract_rides.py                 builds ride_data from raw_data
│   └── extract_walks.py                 builds walk_data from raw_data
└── .github/workflows/strava-sync.yml    the scheduled sync
```

## Making changes

- **Hide or fix a ride:** edit `ride_overrides.json` (keyed by Strava activity ID) and push.
- **FTP changed:** add an entry to `ftp_history.json` and push.

The next sync rebuilds the data with the change. Always pull before editing,
as the workflow commits new data regularly.

## Setup (for reference)

The workflow needs these in **Settings → Secrets and variables → Actions**:

- Secrets: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (Strava API app),
  `DATA_REPO_TOKEN` (fine-grained token with Contents read/write on the private data repo)
- Variable: `DATA_REPO`, the private repo holding `strava/raw_data` and `strava/strava_tokens.json`

To run the scripts locally instead, put the Strava app details in
`scripts/strava_config.json` as `{"client_id": "...", "client_secret": "..."}`,
`pip install truststore` (Windows), and run `python scripts/strava_exporter.py`.
The first run opens a browser to log in to Strava. Don't run it locally while the
workflow is active, since both would refresh the same Strava login.
