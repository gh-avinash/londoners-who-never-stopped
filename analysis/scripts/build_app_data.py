"""Package the analysis into the JSON files the Data Observatory app loads.

Writes to <app_data_dir>:
  stations.json : every station place with location, baseline, weekly % of 2019 (2019 -> 2026),
                  lockdown retention, 2026 recovery, census shares, flags
  story.json    : headline numbers for the wall's text panels, all computed here from the
                  processed outputs (never typed by hand) so the wall can't drift from FINDINGS.md

Usage: python3 -I build_app_data.py <raw_dir> <processed_dir> <app_data_dir>
"""

import csv
import importlib.util
import json
import os
import sys
import math
from collections import defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("recovery", os.path.join(HERE, "recovery.py"))
recovery = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recovery)

FIRST_WEEK = date(2019, 1, 7)  # first full Monday-Friday week of the data
CHRISTMAS_GAP = ((12, 23), (12, 31))  # excluded from the 2019 baseline (holiday lull)
TOP_N = 10
MIN_TOP_LIST_DAILY = 5000  # headline lists use larger stations only (small ones are noisy)
# The "emptied" panel is about the big hubs. This also keeps out New Cross (8.7k/day, ~150/day
# in lockdown), which looks like a service suspension rather than behaviour - unconfirmed.
MIN_EMPTIED_LIST_DAILY = 20000
WEEKDAYS = recovery.WEEKDAYS


# Same radius as the hospital test in keyworkers.py.
HOSPITAL_M = 800


def metres(lat1, lon1, lat2, lon2):
    """Approximate distance (equirectangular; accurate to well under 1% across London)."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def bank_holidays(raw_dir):
    with open(f"{raw_dir}/bank-holidays.json") as f:
        events = json.load(f)["england-and-wales"]["events"]
    return {date.fromisoformat(e["date"]) for e in events}


def is_christmas(d):
    (m1, d1), (m2, d2) = CHRISTMAS_GAP
    return date(d.year, m1, d1) <= d <= date(d.year, m2, d2)


def weighted(rows, col):
    b = sum(r["autumn2019_daily"] for r in rows)
    return round(sum(r["autumn2019_daily"] * r[col] / 100 for r in rows) / b * 100, 1)


def main(raw_dir, processed_dir, out_dir):
    holidays = bank_holidays(raw_dir)
    place_of, _ = recovery.load_places(processed_dir, raw_dir)
    taps = recovery.load_footfall(raw_dir, place_of)
    last_day = max(d for d, _ in taps)

    with open(f"{processed_dir}/station_story.csv") as f:
        story_rows = list(csv.DictReader(f))
    for r in story_rows:
        for k, v in r.items():
            if k.endswith("_pct") or k in ("autumn2019_daily", "lat", "lon"):
                r[k] = float(v) if v not in ("", None) else None
        r["zone"] = int(r["zone"]) if r["zone"] else None
    places = [r["place_id"] for r in story_rows]

    # --- weekly series: weekday mean / own 2019 weekday mean --------------------------
    by_day = defaultdict(dict)
    for (d, p), v in taps.items():
        by_day[d][p] = v

    def ok_day(d):
        return d.weekday() < 5 and d not in holidays

    base_days = [d for d in by_day if d.year == 2019 and ok_day(d) and not is_christmas(d)]
    baseline = {p: sum(by_day[d].get(p, 0) for d in base_days) / len(base_days) for p in places}

    weeks, series, network = [], defaultdict(list), []
    net_base = sum(baseline.values())
    wk = FIRST_WEEK
    while wk + timedelta(days=4) <= last_day:
        days = [wk + timedelta(days=i) for i in range(5)
                if ok_day(wk + timedelta(days=i)) and (wk + timedelta(days=i)) in by_day]
        if days:
            weeks.append(wk.isoformat())
            tot = 0.0
            for p in places:
                v = sum(by_day[d].get(p, 0) for d in days) / len(days)
                tot += v
                series[p].append(round(100 * v / baseline[p]) if baseline[p] else 0)
            network.append(round(100 * tot / net_base, 1))
        wk += timedelta(days=7)

    # --- census + hospitals --------------------------------------------------------------
    with open(f"{processed_dir}/station_census.csv") as f:
        census = {r["place_id"]: r for r in csv.DictReader(f)}
    with open(f"{processed_dir}/hospital_test.csv") as f:
        hosp = list(csv.DictReader(f))
    hosp_by_place = {h["place_id"]: h["hospital"] for h in hosp}
    with open(f"{processed_dir}/keyworker_summary.csv") as f:
        kw = {r["metric"]: float(r["value"]) for r in csv.DictReader(f)}

    # --- "what if travel only followed jobs?" model (FINDINGS F11) -------------------------
    # Ordinary least squares: lockdown retention ~ frontline share, over ranked stations.
    xs = [float(c["frontline_share"]) for c in census.values()]
    ys = [float(c["ret"]) for c in census.values()]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = (sum((x - mx) * (y - my) for x, y in zip(xs, ys))
             / sum((x - mx) ** 2 for x in xs))
    intercept = my - slope * mx
    resid = {p: float(c["ret"]) - (intercept + slope * float(c["frontline_share"]))
             for p, c in census.items()}
    r2 = 1 - (sum(v ** 2 for v in resid.values())
              / sum((y - my) ** 2 for y in ys))

    stations = []
    for r in sorted(story_rows, key=lambda r: -baseline[r["place_id"]]):
        p = r["place_id"]
        c = census.get(p, {})
        stations.append({
            "id": p, "name": r["station"], "lat": r["lat"], "lon": r["lon"], "zone": r["zone"],
            "base": round(baseline[p]),
            "w": series[p],
            "lockdown": r["lockdown_retention_pct"], "lockdownStatus": r["lockdown_status"],
            "rec2026": r["recovery_2026_pct"], "recStatus": r["recovery_status"],
            "dow2026": [r[f"recovery_2026_{d}_pct"] for d in WEEKDAYS],
            "elizabeth": r["elizabeth_line"] == "True",
            "frontline": float(c["frontline_share"]) if c else None,
            "wfh": float(c["wfh_share"]) if c else None,
            "hospital": hosp_by_place.get(p),
            # Jobs-only model's predicted lockdown retention (%), where census data exists.
            "model": round(intercept + slope * float(c["frontline_share"]), 1) if c else None,
        })

    # --- headline numbers ------------------------------------------------------------------
    with open(f"{processed_dir}/lockdown_retention.csv") as f:
        lr = list(csv.DictReader(f))
    ranked = [r for r in lr if r["status"] == "ok"]
    by_name = {r["station"]: r for r in lr}
    network_lockdown = round(100 * sum(int(r["lockdown_2020_daily"]) for r in ranked)
                             / sum(int(r["baseline_spring2019_daily"]) for r in ranked), 1)

    like = [r for r in story_rows if r["recovery_status"] == "ok"]
    zones = {
        "Zone 1": [r for r in like if r["zone"] == 1],
        "Zones 2–3": [r for r in like if r["zone"] in (2, 3)],
        "Zones 4+": [r for r in like if r["zone"] and r["zone"] >= 4],
    }
    zone1_all = [r for r in story_rows if r["zone"] == 1
                 and r["recovery_status"] != "unstable_baseline"]

    lock_ok = [r for r in story_rows if r["lockdown_status"] == "ok"
               and r["autumn2019_daily"] >= MIN_TOP_LIST_DAILY]
    lock_ok.sort(key=lambda r: -r["lockdown_retention_pct"])

    story = {
        "dataEnd": last_day.isoformat(),
        "lockdownWindow": ["2020-03-30", "2020-05-15"],
        "networkLockdownPct": network_lockdown,
        "stationsClosed": sum(r["status"] == "closed" for r in lr),
        "keptMoving": [{"name": r["station"], "pct": r["lockdown_retention_pct"]}
                       for r in lock_ok[:TOP_N]],
        "emptied": [{"name": r["station"], "pct": r["lockdown_retention_pct"]}
                    for r in [r for r in lock_ok
                              if r["autumn2019_daily"] >= MIN_EMPTIED_LIST_DAILY][-TOP_N:][::-1]],
        "compare": {n: {"pct": float(by_name[n]["retention_pct"]),
                        "lockdownDaily": int(by_name[n]["lockdown_2020_daily"])}
                    for n in ("Barking", "Bank", "Liverpool Street")},
        "census": {
            "lowFrontline": {"frontline": kw["quintile_low_frontline_share"],
                             "wfh": kw["quintile_low_wfh_share"],
                             "retention": kw["quintile_low_retention"]},
            "highFrontline": {"frontline": kw["quintile_high_frontline_share"],
                              "wfh": kw["quintile_high_wfh_share"],
                              "retention": kw["quintile_high_retention"]},
            "rhoFrontline": kw["rho_frontline_zone3plus"],
            "rhoWfh": kw["rho_wfh_zone3plus"],
        },
        "hospitals": {
            "above": int(kw["hospital_above"]), "n": int(kw["hospital_n"]),
            "p": kw["hospital_sign_p"],
            "rows": [{"station": h["station"], "hospital": h["hospital"],
                      "pct": float(h["retention_pct"]),
                      "neighbours": float(h["neighbour_median_pct"])} for h in hosp],
        },
        "recoveryByYear": {str(y): weighted(like, f"recovery_{y}_pct")
                           for y in recovery.YEARS[1:]},
        "recoveryByZone": {z: {"all": weighted(rows, "recovery_2026_pct"),
                               "days": [weighted(rows, f"recovery_2026_{d}_pct")
                                        for d in WEEKDAYS]}
                           for z, rows in zones.items()},
        "zone1UpperBound": {"all": weighted(zone1_all, "recovery_2026_pct"),
                            "fri": weighted(zone1_all, "recovery_2026_Fri_pct")},
        # Entries + exits, so one journey usually counts twice (tap in, tap out).
        "normalDailyTaps": round(net_base),
        "stationCount": len(stations),
        "weeks": weeks,
        "stationIndex": sorted(([s["id"], s["name"]] for s in stations), key=lambda x: x[1]),
        "elizabethTop": [{"name": r["station"], "pct": r["recovery_2026_pct"]}
                         for r in sorted((r for r in story_rows
                                          if r["recovery_status"] == "elizabeth_line"
                                          and r["autumn2019_daily"] >= 10000),
                                         key=lambda r: -r["recovery_2026_pct"])[:4]],
        "elizabethLinePct": weighted([r for r in story_rows
                                      if r["recovery_status"] == "elizabeth_line"],
                                     "recovery_2026_pct"),
    }

    # Surprises are listed for larger stations only (small ones are noisy, see A5).
    named = {r["place_id"]: r for r in story_rows}
    big_resid = sorted(((v, named[p]["station"]) for p, v in resid.items()
                        if named[p]["autumn2019_daily"] >= MIN_TOP_LIST_DAILY), reverse=True)
    # Each surprise also names an acute hospital within HOSPITAL_M, if any: the wall uses it to
    # explain "busier than predicted" (FINDINGS F11).
    with open(f"{raw_dir}/hospitals.csv") as f:
        hospitals = [(h["hospital"], float(h["lat"]), float(h["lon"])) for h in csv.DictReader(f)]
    by_station = {r["station"]: r for r in story_rows}

    def near_hospital(name):
        r = by_station[name]
        lat, lon = float(r["lat"]), float(r["lon"])
        near = [(metres(lat, lon, hl, ho), h) for h, hl, ho in hospitals]
        dist, hospital = min(near)
        return hospital if dist <= HOSPITAL_M else None

    def surprise(v, n):
        return {"name": n, "pts": round(v, 1), "hospital": near_hospital(n)}

    story["whatIf"] = {
        "intercept": round(intercept, 2), "slope": round(slope, 3), "r2": round(r2, 2),
        "above": [surprise(v, n) for v, n in big_resid[:4]],
        "below": [surprise(v, n) for v, n in big_resid[-4:][::-1]],
    }

    # Small per-station summary for visitors' phones (avoids sending the 600 KB weekly series).
    cards = [{k: s[k] for k in ("id", "name", "zone", "lockdown", "lockdownStatus", "rec2026",
                                "recStatus", "frontline", "hospital", "model")}
             for s in sorted(stations, key=lambda s: s["name"])]

    os.makedirs(out_dir, exist_ok=True)
    with open(f"{out_dir}/cards.json", "w") as f:
        json.dump({"networkLockdownPct": story["networkLockdownPct"],
                   "recovery2026": story["recoveryByYear"]["2026"], "stations": cards}, f,
                  separators=(",", ":"))
    with open(f"{out_dir}/stations.json", "w") as f:
        json.dump({"weeks": weeks, "network": network, "stations": stations}, f,
                  separators=(",", ":"))
    with open(f"{out_dir}/story.json", "w") as f:
        json.dump(story, f, indent=2, ensure_ascii=False)

    size = os.path.getsize(f"{out_dir}/stations.json") // 1024
    print(f"weeks {weeks[0]} -> {weeks[-1]} ({len(weeks)}), stations {len(stations)}, "
          f"stations.json {size} KB")
    lw = [i for i, w in enumerate(weeks) if "2020-04-06" <= w <= "2020-05-11"]
    print(f"network weekly series, lockdown weeks: {[network[i] for i in lw]}")
    print(json.dumps({k: story[k] for k in ("networkLockdownPct", "stationsClosed",
                                              "recoveryByYear", "recoveryByZone",
                                              "zone1UpperBound", "elizabethLinePct")}, indent=1,
                     ensure_ascii=False))
    print("kept moving:", [(s["name"], s["pct"]) for s in story["keptMoving"]])
    print("emptied:", [(s["name"], s["pct"]) for s in story["emptied"]])


if __name__ == "__main__":
    main(*sys.argv[1:4])
