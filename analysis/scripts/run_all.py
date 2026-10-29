"""Re-run the whole analysis, from raw data to the files the wall reads.

Usage (from anywhere): python3 -I analysis/scripts/run_all.py [app_data_dir]

Reads analysis/raw/, writes analysis/processed/ and (by default) apps/website/public/data/.
Standard library only (Python 3.9+). Takes a minute or two.
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ANALYSIS = os.path.dirname(HERE)
RAW = os.path.join(ANALYSIS, "raw")
PROCESSED = os.path.join(ANALYSIS, "processed")
APP_DATA = os.path.join(os.path.dirname(ANALYSIS), "apps", "website", "public", "data")

STEPS = [
    ("lockdown_retention.py", [RAW, os.path.join(PROCESSED, "lockdown_retention.csv")]),
    ("station_locations.py", [RAW, os.path.join(PROCESSED, "station_locations.csv")]),
    ("recovery.py", [RAW, PROCESSED]),
    ("keyworkers.py", [RAW, PROCESSED]),
    ("build_app_data.py", [RAW, PROCESSED, None]),
]


def main(app_data):
    os.makedirs(PROCESSED, exist_ok=True)
    os.makedirs(app_data, exist_ok=True)
    for script, args in STEPS:
        args = [app_data if a is None else a for a in args]
        print(f"\n=== {script}", flush=True)
        subprocess.run([sys.executable, "-I", os.path.join(HERE, script), *args], check=True)
    print(f"\nDone. Processed tables: {PROCESSED}\nWall data: {app_data}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else APP_DATA)
