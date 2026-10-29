"""Give every footfall station name a TfL station ID and a lat/lon.

Footfall files use short names ("Abbey Road DLR", "St Pauls"); TfL's station data uses full
names ("Abbey Road", "St Paul's") and IDs. Coordinates = mean of all StationPoints (entrances,
platforms) belonging to that station ID.

Usage: python3 -I station_locations.py <raw_dir> <out_csv>
"""

import csv
import sys
from collections import defaultdict

# Footfall name -> TfL station name (or explicit ID where a name is shared by two stations).
ALIASES = {
    "Abbey Road DLR": "Abbey Road",
    "Bethnal Green NR": "id:910GBTHNLGR",  # Overground station, ~800 m from the Tube one
    "Bethnal Green": "id:940GZZLUBLG",
    "Canary Wharf DLR": "Canary Wharf",
    "Canary Wharf EL": "Canary Wharf",
    "Canary Wharf Elizabeth Line": "Canary Wharf",
    "Custom House DLR": "Custom House for ExCel",
    "Custom House EL": "Custom House for ExCel",
    "Custom House Elizabeth Line": "Custom House for ExCel",
    "Cutty Sark": "Cutty Sark for Maritime Greenwich",
    "Earls Court": "Earl's Court",
    "Edgware Road B": "id:940GZZLUERB",  # Bakerloo
    "Edgware Road C&H": "id:940GZZLUERC",  # Circle & Hammersmith
    "Euston NR": "Euston",
    "Hammersmith C&H": "Hammersmith",
    "Hammersmith D&P": "Hammersmith",
    "Heathrow T2&3 TfL Rail/HEx": "Heathrow Terminals 2 & 3",
    "Heathrow Terminals 2&3": "Heathrow Terminals 2 & 3",
    "Heathrow T4 TfL Rail/HEx": "Heathrow Terminal 4",
    "Heathrow T5 TfL Rail/HEx": "Heathrow Terminal 5",
    "Kensington Olympia": "Kensington (Olympia)",
    "Kings Cross St Pancras": "King's Cross St Pancras",
    "Langley Berks": "Langley",
    "Burnham Bucks": "Burnham",
    "Lewisham DLR": "Lewisham",
    "Limehouse DLR": "Limehouse",
    "Liverpool St NR": "Liverpool Street",
    "Paddington EL": "Paddington",
    "Pontoon Dock DLR": "Pontoon Dock",
    "Queens Park": "Queen's Park",
    "Queens Rd Peckham": "Queens Road Peckham",
    "Regents Park": "Regent's Park",
    "Shadwell DLR": "Shadwell",
    "Shadwell LO": "Shadwell",
    "Shepherds Bush": "Shepherd's Bush",
    "Shepherds Bush LO": "Shepherd's Bush",
    "Shepherds Bush Market": "Shepherd's Bush Market",
    "St Johns Wood": "St John's Wood",
    "St Pauls": "St Paul's",
    "Star Lane DLR": "Star Lane",
    "Sydenham SR": "Sydenham",
    "Walthamstow Queens Road": "Walthamstow Queen's Road",
    "Watford Met": "Watford",
    "West Hampstead LO": "id:910GWHMDSTD",
    "West Hampstead": "id:940GZZLUWHP",
    "Woolwich Arsenal DLR": "Woolwich Arsenal",
    "Woolwich Arsenal NR": "Woolwich Arsenal",
    "Woolwich EL": "Woolwich",
    "Woolwich Elizabeth Line": "Woolwich",
}
# Missing from TfL's station dataset; coordinates from the TfL StopPoint API (940GZZDLWSV).
MANUAL_COORDS = {"W Silvertown": (51.502838, 0.02246)}


def footfall_names(raw_dir):
    names = set()
    for f in ["StationFootfall_2019.csv", "StationFootfall_2025_2026.csv"]:
        with open(f"{raw_dir}/{f}", encoding="utf-8-sig", newline="") as fh:
            r = csv.reader(fh)
            next(r)
            names.update(row[2].strip() for row in r if row)
    return sorted(names)


def main(raw_dir, out_csv):
    ids_by_name = defaultdict(list)
    with open(f"{raw_dir}/stationdata/Stations.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            ids_by_name[r["Name"].strip()].append(r["UniqueId"])

    points = defaultdict(list)
    with open(f"{raw_dir}/stationdata/StationPoints.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            points[r["StationUniqueId"]].append((float(r["Lat"]), float(r["Lon"])))

    out, problems = [], []
    for name in footfall_names(raw_dir):
        if name in MANUAL_COORDS:
            lat, lon = MANUAL_COORDS[name]
            out.append((name, "940GZZDLWSV", round(lat, 6), round(lon, 6), "manual"))
            continue
        target = ALIASES.get(name, name)
        if target.startswith("id:"):
            sid = target[3:]
        else:
            ids = ids_by_name.get(target, [])
            if len(ids) != 1:
                problems.append((name, target, ids))
                continue
            sid = ids[0]
        pts = points.get(sid)
        if not pts:
            problems.append((name, sid, "no points"))
            continue
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        out.append((name, sid, round(lat, 6), round(lon, 6), "alias" if name in ALIASES else "exact"))

    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["station", "tfl_station_id", "lat", "lon", "match"])
        w.writerows(out)

    print(f"located {len(out)} stations; problems: {len(problems)}")
    for p in problems:
        print("  ", p)
    lats = [o[2] for o in out]
    lons = [o[3] for o in out]
    print(f"lat range {min(lats)}..{max(lats)}  lon range {min(lons)}..{max(lons)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
