"""How unevenly did London come back? Station-level recovery 2019 -> 2026.

Builds one row per *place* (TfL station ID, so e.g. "Canary Wharf", "Canary Wharf DLR" and
"Canary Wharf Elizabeth Line" are counted together) with:
  - lockdown retention (spring 2020 vs spring 2019; same rules as lockdown_retention.py)
  - autumn weekday recovery for each year 2020-2026 vs autumn 2019
  - 2026 recovery by day of week (Mon..Fri vs the same weekday in 2019)

Usage: python3 -I recovery.py <raw_dir> <processed_dir>
"""

import csv
import math
import statistics
import sys
from collections import defaultdict
from datetime import date

FILES = [  # later files win where date ranges overlap
    "StationFootfall_2019.csv", "StationFootfall_2020.csv", "StationFootfall_2021.csv",
    "StationFootfall_2022.csv", "StationFootfall_2023.csv", "StationFootfall_2024.csv",
    "StationFootfall_2024_2025.csv", "StationFootfall_2025_2026.csv",
]
YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
# Latest data ends 24 Oct 2026, so every year uses the same weekday window: 1 Sep - 24 Oct.
AUTUMN = ((9, 1), (10, 24))
FEB_CHECK = (date(2020, 2, 3), date(2020, 2, 28))
# Lockdown windows: identical to lockdown_retention.py
LOCKDOWN = (date(2020, 3, 30), date(2020, 5, 15))
SPRING_BASE = (date(2019, 4, 1), date(2019, 5, 17))
BANK_HOLIDAYS = {
    date(2019, 4, 19), date(2019, 4, 22), date(2019, 5, 6),
    date(2020, 4, 10), date(2020, 4, 13), date(2020, 5, 8),
}
MIN_BASELINE_DAILY = 1000
CLOSED_DAILY = 50
MAX_BASELINE_DISAGREEMENT = 0.25
# A day whose network total is below this share of its weekday median (within that year's
# window) is treated as disrupted (strike, major closure) and dropped.
DISRUPTED_DAY_SHARE = 0.85
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
# Woolwich Arsenal lost riders to the new Woolwich Elizabeth line station (opened 2022, ~400 m
# away, not in the 2019 data), so its "recovery" reflects a switch, not fewer journeys.
DISPLACED_BY_NEW_STATION = {"HUBWWA"}
# A day with taps below this share of the place's own median in that window counts as a
# closure day (station shut / line suspended). 3+ closure days in a window -> flagged.
CLOSURE_DAY_SHARE = 0.25
MAX_CLOSURE_DAYS = 2
# The network moved < 1% between autumn 2025 and 2026, so a station moving > 30% in one year
# points to a local service change (e.g. Barons Court: platforms closed for most of 2026).
MAX_YEAR_ON_YEAR_CHANGE = 0.30
# Stations this close to an Elizabeth line station lose/gain riders to it (e.g. Barbican <->
# Farringdon's Barbican-end entrance; Moorgate <-> Liverpool Street EL's Moorgate entrance).
# Kept in the like-for-like set but flagged, and reported as a sensitivity check.
NEAR_EL_METRES = 400


def parse_day(s):
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def load_places(processed_dir, raw_dir):
    place_of, info = {}, {}
    with open(f"{processed_dir}/station_locations.csv") as f:
        for r in csv.DictReader(f):
            place_of[r["station"]] = r["tfl_station_id"]
            info.setdefault(r["tfl_station_id"], {"lat": r["lat"], "lon": r["lon"],
                                                  "names": []})["names"].append(r["station"])
    tfl = {}
    with open(f"{raw_dir}/stationdata/Stations.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            tfl[r["UniqueId"]] = (r["Name"].strip(), r["FareZones"].strip())
    for pid, d in info.items():
        name, zones = tfl.get(pid, (None, ""))
        d["label"] = name or ("West Silvertown" if pid == "940GZZDLWSV" else d["names"][0])
        d["zone"] = min((int(z) for z in zones.split("|") if z.isdigit()), default="")
    return place_of, info


def load_footfall(raw_dir, place_of):
    """Return {(date, place): taps}. Later files override earlier ones for the same date+name."""
    by_name = {}
    overlaps = mismatches = 0
    for fname in FILES:
        with open(f"{raw_dir}/{fname}", encoding="utf-8-sig", newline="") as f:
            r = csv.reader(f)
            next(r)
            for row in r:
                if not row:
                    continue
                key = (row[0], row[2].strip())
                val = int(row[3] or 0) + int(row[4] or 0)
                if key in by_name:
                    overlaps += 1
                    mismatches += by_name[key] != val
                by_name[key] = val
    taps = defaultdict(int)
    skipped = defaultdict(int)
    for (d, name), v in by_name.items():
        if name not in place_of:  # only "Unknown" (~0.02% of taps in 2020-2022)
            skipped[name] += v
            continue
        taps[(parse_day(d), place_of[name])] += v
    print(f"overlapping rows across files: {overlaps:,}  (values differ: {mismatches:,})")
    print(f"skipped unmapped names: {dict(skipped)}")
    return taps


def window_days(year):
    (m1, d1), (m2, d2) = AUTUMN
    return date(year, m1, d1), date(year, m2, d2)


def elizabeth_line_places(raw_dir):
    """Station IDs with Elizabeth line platforms (opened May 2022; parts ran as TfL Rail before)."""
    with open(f"{raw_dir}/stationdata/Platforms.csv", encoding="utf-8-sig") as f:
        plat = {r["UniqueId"]: r["StationUniqueId"] for r in csv.DictReader(f)}
    with open(f"{raw_dir}/stationdata/PlatformServices.csv", encoding="utf-8-sig") as f:
        return {plat.get(r["PlatformUniqueId"]) for r in csv.DictReader(f)
                if r["Line"] == "elizabeth"}


def metres(lat1, lon1, lat2, lon2):
    """Equirectangular distance; accurate to well under 1% at London's scale."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def el_points(raw_dir, el_places):
    """All entrance/platform points of Elizabeth line stations."""
    with open(f"{raw_dir}/stationdata/StationPoints.csv", encoding="utf-8-sig") as f:
        return [(float(r["Lat"]), float(r["Lon"])) for r in csv.DictReader(f)
                if r["StationUniqueId"] in el_places]


def closure_days(taps, days, place):
    vals = [taps.get((d, place), 0) for d in days]
    med = statistics.median(vals) if vals else 0
    return sum(v < CLOSURE_DAY_SHARE * med for v in vals)


def means(taps, days):
    """Average daily taps per place over `days` (a missing row counts as 0 that day)."""
    tot = defaultdict(int)
    for (d, p), v in taps.items():
        if d in days:
            tot[p] += v
    return {p: tot[p] / len(days) for p in tot}


def pick_days(all_days, start, end, exclude=frozenset()):
    return {d for d in all_days if start <= d <= end and d.weekday() < 5 and d not in exclude}


def drop_disrupted(days, network_total, label):
    by_wd = defaultdict(list)
    for d in days:
        by_wd[d.weekday()].append(network_total[d])
    med = {wd: statistics.median(v) for wd, v in by_wd.items()}
    dropped = sorted(d for d in days if network_total[d] < DISRUPTED_DAY_SHARE * med[d.weekday()])
    if dropped:
        print(f"  {label}: dropped {len(dropped)} disrupted day(s): "
              + ", ".join(f"{d:%a %d %b} ({network_total[d] / med[d.weekday()]:.0%})"
                          for d in dropped))
    return days - set(dropped)


def main(raw_dir, processed_dir):
    place_of, info = load_places(processed_dir, raw_dir)
    el_places = elizabeth_line_places(raw_dir)
    el_pts = el_points(raw_dir, el_places)
    taps = load_footfall(raw_dir, place_of)
    all_days = {d for d, _ in taps}
    network_total = defaultdict(int)
    for (d, _), v in taps.items():
        network_total[d] += v
    print(f"data covers {min(all_days)} -> {max(all_days)}")

    # --- autumn windows, per year and per weekday ---------------------------------------
    year_days = {}
    for y in YEARS:
        s, e = window_days(y)
        year_days[y] = drop_disrupted(pick_days(all_days, s, e), network_total, f"autumn {y}")
    year_mean = {y: means(taps, ds) for y, ds in year_days.items()}
    dow_mean = {
        (y, wd): means(taps, {d for d in year_days[y] if d.weekday() == wd})
        for y in (2019, 2026) for wd in range(5)
    }

    # --- lockdown retention (per place) -------------------------------------------------
    spring = means(taps, pick_days(all_days, *SPRING_BASE, BANK_HOLIDAYS))
    lock = means(taps, pick_days(all_days, *LOCKDOWN, BANK_HOLIDAYS))
    feb = means(taps, pick_days(all_days, *FEB_CHECK))

    def unstable(a, b):
        return b == 0 or abs(a - b) / max(a, b) > MAX_BASELINE_DISAGREEMENT

    rows = []
    for p, base in year_mean[2019].items():
        if base < MIN_BASELINE_DAILY:
            continue
        sb, lk, fb = spring.get(p, 0), lock.get(p, 0), feb.get(p, 0)
        if lk < CLOSED_DAILY:
            lstatus = "closed"
        elif unstable(sb, fb):
            lstatus = "unstable_baseline"
        else:
            lstatus = "ok"
        closed19 = closure_days(taps, year_days[2019], p)
        closed26 = closure_days(taps, year_days[2026], p)
        if unstable(base, fb):
            rstatus = "unstable_baseline"
        elif p in el_places:
            rstatus = "elizabeth_line"
        elif p in DISPLACED_BY_NEW_STATION:
            rstatus = "displaced_by_new_station"
        elif max(closed19, closed26) > MAX_CLOSURE_DAYS:
            rstatus = "closure_in_window"
        elif year_mean[2025].get(p, 0) and abs(
                year_mean[2026].get(p, 0) / year_mean[2025][p] - 1) > MAX_YEAR_ON_YEAR_CHANGE:
            rstatus = "service_change_2025_26"
        else:
            rstatus = "ok"
        row = {
            "place_id": p, "station": info[p]["label"], "zone": info[p]["zone"],
            "lat": info[p]["lat"], "lon": info[p]["lon"],
            "footfall_names": "|".join(sorted(info[p]["names"])),
            "autumn2019_daily": round(base),
            "lockdown_retention_pct": round(100 * lk / sb, 1) if sb else "",
            "lockdown_status": lstatus,
            "recovery_status": rstatus,
            "elizabeth_line": p in el_places,
            "metres_to_elizabeth_line": round(min(
                metres(float(info[p]["lat"]), float(info[p]["lon"]), a, b) for a, b in el_pts)),
            "closure_days_autumn2019": closed19,
            "closure_days_autumn2026": closed26,
        }
        for y in YEARS[1:]:
            row[f"recovery_{y}_pct"] = round(100 * year_mean[y].get(p, 0) / base, 1)
        for wd in range(5):
            b = dow_mean[(2019, wd)].get(p, 0)
            row[f"recovery_2026_{WEEKDAYS[wd]}_pct"] = (
                round(100 * dow_mean[(2026, wd)].get(p, 0) / b, 1) if b else "")
        rows.append(row)

    out = f"{processed_dir}/station_story.csv"
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["station"]))
    print(f"\nwrote {len(rows)} places -> {out}")

    # --- summary ------------------------------------------------------------------------
    ok = [r for r in rows if r["recovery_status"] == "ok"]
    print(f"recovery ranked (like-for-like): {len(ok)}")
    for st in ["unstable_baseline", "elizabeth_line", "displaced_by_new_station",
               "closure_in_window", "service_change_2025_26"]:
        sel = [r for r in rows if r["recovery_status"] == st]
        print(f"   {st} ({len(sel)}): " + ", ".join(
            f"{r['station']} [{r['closure_days_autumn2019']}/{r['closure_days_autumn2026']}]"
            if st == "closure_in_window" else r["station"] for r in sel))

    def agg(sel, col_y):
        b = sum(r["autumn2019_daily"] for r in sel)
        return 100 * sum(r["autumn2019_daily"] * r[col_y] / 100 for r in sel) / b

    print("\nNetwork recovery (autumn weekdays vs 2019, ranked places):")
    print("  " + "  ".join(f"{y}: {agg(ok, f'recovery_{y}_pct'):5.1f}%" for y in YEARS[1:]))
    for z, sel in [("zone 1", [r for r in ok if r["zone"] == 1]),
                   ("zones 2-3", [r for r in ok if r["zone"] in (2, 3)]),
                   ("zones 4+", [r for r in ok if isinstance(r["zone"], int) and r["zone"] >= 4])]:
        print(f"  {z:<9} ({len(sel):3}): 2026 = {agg(sel, 'recovery_2026_pct'):5.1f}%   by day: "
              + "  ".join(f"{d} {agg(sel, f'recovery_2026_{d}_pct'):5.1f}%" for d in WEEKDAYS))

    far = [r for r in ok if r["metres_to_elizabeth_line"] > NEAR_EL_METRES]
    near = [r for r in ok if r["metres_to_elizabeth_line"] <= NEAR_EL_METRES]
    print(f"  near-EL stations kept in like-for-like ({len(near)}): "
          + ", ".join(r["station"] for r in near))
    print("  sensitivity, excluding near-EL stations:")
    for z, sel in [("zone 1", [r for r in far if r["zone"] == 1]),
                   ("zones 2-3", [r for r in far if r["zone"] in (2, 3)]),
                   ("zones 4+", [r for r in far if isinstance(r["zone"], int) and r["zone"] >= 4])]:
        print(f"    {z:<9} ({len(sel):3}): 2026 = {agg(sel, 'recovery_2026_pct'):5.1f}%   by day: "
              + "  ".join(f"{d} {agg(sel, f'recovery_2026_{d}_pct'):5.1f}%" for d in WEEKDAYS))
    allz1 = [r for r in rows if r["zone"] == 1 and r["recovery_status"] != "unstable_baseline"]
    print(f"  upper bound, zone 1 incl. Elizabeth line & all flagged ({len(allz1)}): "
          f"{agg(allz1, 'recovery_2026_pct'):5.1f}%  Fri {agg(allz1, 'recovery_2026_Fri_pct'):5.1f}%")
    el = [r for r in rows if r["recovery_status"] == "elizabeth_line"]
    print(f"  Elizabeth line places ({len(el)}): 2026 = {agg(el, 'recovery_2026_pct'):5.1f}%")

    srt = sorted(ok, key=lambda r: -r["recovery_2026_pct"])
    big = [r for r in srt if r["autumn2019_daily"] >= 10000]
    print("\nMOST RECOVERED 2026 (>=10k/day in 2019)")
    for r in big[:15]:
        print(f"  {r['recovery_2026_pct']:6.1f}%  z{r['zone']}  {r['station']:<32} "
              f"lockdown {r['lockdown_retention_pct']}% ({r['lockdown_status']})")
    print("\nLEAST RECOVERED 2026 (>=10k/day in 2019)")
    for r in big[-15:]:
        print(f"  {r['recovery_2026_pct']:6.1f}%  z{r['zone']}  {r['station']:<32} "
              f"Mon {r['recovery_2026_Mon_pct']}  Wed {r['recovery_2026_Wed_pct']}  "
              f"Fri {r['recovery_2026_Fri_pct']}")

    both = [r for r in ok if r["lockdown_status"] == "ok"]
    xs = [r["lockdown_retention_pct"] for r in both]
    ys = [r["recovery_2026_pct"] for r in both]
    print(f"\nSpearman(lockdown retention, 2026 recovery) over {len(both)} places: "
          f"{spearman(xs, ys):.2f}")


def spearman(xs, ys):
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    # Pearson on ranks (statistics.correlation needs Python 3.10+).
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    return cov / (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
