"""Test the "key workers kept London moving" interpretation of lockdown retention.

Two independent checks (the hypotheses and metrics were fixed before looking at the results):

1. Census 2021 (taken 21 March 2021, during the third lockdown). For each station, residents of
   census areas (MSOAs) whose population-weighted centre is within CATCHMENT_M:
     - wfh_share       : worked mainly at or from home              (expect NEGATIVE link)
     - frontline_share : occupation groups 6, 8, 9 (caring/leisure/other service;
                         process, plant & machine operatives incl. drivers; elementary)
                                                                     (expect POSITIVE link)
     - health_share    : industry Q, human health & social work      (expect POSITIVE link)
     - managers_prof   : occupation groups 1 + 2                      (expect NEGATIVE link)
   Correlated (Spearman) with lockdown retention for all ranked stations, and for zones 3+
   only - central stations are mostly *destinations* (workers arriving), so their riders are
   not the local residents the census describes.

2. Hospitals. Each London acute hospital is matched to its nearest station (if within
   HOSPITAL_M). That station's retention is compared with the median of its own neighbours
   (other ranked stations within NEIGHBOUR_M, excluding hospital stations) - a like-for-like
   local comparison rather than against London as a whole.

Usage: python3 -I keyworkers.py <raw_dir> <processed_dir>
"""

import csv
import math
import statistics
import sys

CATCHMENT_M = 1000
HOSPITAL_M = 800
NEIGHBOUR_M = 3000
MIN_NEIGHBOURS = 3


def metres(lat1, lon1, lat2, lon2):
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


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
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    return cov / (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5


def read_census(path, cols):
    """{msoa: [values of cols]} using column indexes (headers contain commas)."""
    out = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            out[row[2]] = [int(row[c]) for c in cols]
    return out


def main(raw_dir, processed_dir):
    c = f"{raw_dir}/census"
    travel = read_census(f"{c}/ts061/census2021-ts061-msoa.csv", [3, 4])  # total, WFH
    occ = read_census(f"{c}/ts063/census2021-ts063-msoa.csv", list(range(3, 13)))  # total, 1..9
    ind = read_census(f"{c}/ts060/census2021-ts060-msoa.csv", [3, 94])  # total, Q health
    with open(f"{c}/msoa2021_pwc.csv") as f:
        cent = {r["msoa"]: (float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f)}

    with open(f"{processed_dir}/station_story.csv") as f:
        stations = [r for r in csv.DictReader(f) if r["lockdown_status"] == "ok"]
    for s in stations:
        s["lat"], s["lon"] = float(s["lat"]), float(s["lon"])
        s["ret"] = float(s["lockdown_retention_pct"])
        s["zone"] = int(s["zone"]) if s["zone"] else 99

    # ---- 1. census catchments --------------------------------------------------------
    near_box = [m for m, (la, lo) in cent.items() if 51.2 < la < 51.8 and -1.1 < lo < 0.5]
    rows = []
    for s in stations:
        dists = [(metres(s["lat"], s["lon"], *cent[m]), m) for m in near_box]
        catch = [m for d, m in dists if d <= CATCHMENT_M] or [min(dists)[1]]
        t_emp = sum(travel[m][0] for m in catch)
        o_emp = sum(occ[m][0] for m in catch)
        i_emp = sum(ind[m][0] for m in catch)
        s.update({
            "catchment_msoas": len(catch),
            "wfh_share": 100 * sum(travel[m][1] for m in catch) / t_emp,
            # occ[m] = [total, g1..g9] -> g6 = index 6, g8 = 8, g9 = 9
            "frontline_share": 100 * sum(occ[m][6] + occ[m][8] + occ[m][9] for m in catch) / o_emp,
            "managers_prof_share": 100 * sum(occ[m][1] + occ[m][2] for m in catch) / o_emp,
            "health_share": 100 * sum(ind[m][1] for m in catch) / i_emp,
        })
        rows.append(s)

    metrics = [("wfh_share", "-"), ("frontline_share", "+"), ("managers_prof_share", "-"),
               ("health_share", "+")]
    print(f"stations with ok lockdown retention: {len(rows)}; "
          f"median catchment size {statistics.median(r['catchment_msoas'] for r in rows)} MSOAs")
    for label, sel in [("all ranked stations", rows),
                       ("zones 3+ (residential)", [r for r in rows if r["zone"] >= 3]),
                       ("zones 4+", [r for r in rows if r["zone"] >= 4])]:
        print(f"\nSpearman vs lockdown retention - {label} (n={len(sel)}):")
        for m, sign in metrics:
            rho = spearman([r[m] for r in sel], [r["ret"] for r in sel])
            print(f"   {m:<22} rho = {rho:+.2f}   (expected {sign})")

    sel = [r for r in rows if r["zone"] >= 3]
    sel.sort(key=lambda r: r["frontline_share"])
    q = len(sel) // 5
    lo, hi = sel[:q], sel[-q:]
    print(f"\nzones 3+: quintiles by frontline share (n={q} each)")
    for lab, g in [("lowest-frontline", lo), ("highest-frontline", hi)]:
        print(f"   {lab:<18} frontline {statistics.median(r['frontline_share'] for r in g):4.1f}%  "
              f"WFH {statistics.median(r['wfh_share'] for r in g):4.1f}%  "
              f"-> median lockdown retention {statistics.median(r['ret'] for r in g):4.1f}%")

    with open(f"{processed_dir}/station_census.csv", "w", newline="") as f:
        cols = ["place_id", "station", "zone", "ret", "catchment_msoas", "wfh_share",
                "frontline_share", "managers_prof_share", "health_share"]
        w = csv.writer(f)
        w.writerow(cols)
        for r in sorted(rows, key=lambda r: -r["ret"]):
            w.writerow([round(r[c], 2) if isinstance(r[c], float) else r[c] for c in cols])

    # ---- 2. hospitals vs their neighbours -----------------------------------------------
    with open(f"{raw_dir}/hospitals.csv") as f:
        hospitals = list(csv.DictReader(f))
    with open(f"{processed_dir}/station_story.csv") as f:
        everything = list(csv.DictReader(f))
    hosp_station = {}
    for h in hospitals:
        hl, ho = float(h["lat"]), float(h["lon"])
        d, s = min((metres(hl, ho, float(s["lat"]), float(s["lon"])), s) for s in everything)
        tag = (f"{s['station']} ({round(d)} m, {s['lockdown_status']})" if d <= HOSPITAL_M
               else f"none within {HOSPITAL_M} m")
        if d <= HOSPITAL_M and s["lockdown_status"] == "ok":
            hosp_station.setdefault(s["place_id"], []).append(h["hospital"])
        h["match"] = tag
    print(f"\nHOSPITALS: {len(hospitals)} geocoded; "
          f"{sum(len(v) for v in hosp_station.values())} matched to a ranked station within {HOSPITAL_M} m")
    for h in hospitals:
        print(f"   {h['hospital']:<38} -> {h['match']}")

    diffs, hosp_rows = [], []
    print(f"\nhospital station vs median of non-hospital neighbours within {NEIGHBOUR_M} m:")
    for s in rows:
        if s["place_id"] not in hosp_station:
            continue
        nb = [n["ret"] for n in rows if n is not s and n["place_id"] not in hosp_station
              and metres(s["lat"], s["lon"], n["lat"], n["lon"]) <= NEIGHBOUR_M]
        if len(nb) < MIN_NEIGHBOURS:
            print(f"   {s['station']:<28} skipped ({len(nb)} neighbours)")
            continue
        med = statistics.median(nb)
        diffs.append(s["ret"] - med)
        hosp_rows.append([s["place_id"], s["station"], " / ".join(hosp_station[s["place_id"]]),
                          round(s["ret"], 1), round(med, 1), round(s["ret"] - med, 1), len(nb)])
        print(f"   {s['station']:<28} {s['ret']:5.1f}% vs {med:5.1f}% (n={len(nb):2})  "
              f"diff {s['ret'] - med:+5.1f}  [{', '.join(hosp_station[s['place_id']])}]")
    above = sum(d > 0 for d in diffs)
    # One-sided sign test: P(at least `above` of n above neighbours | no hospital effect).
    n = len(diffs)
    p = sum(math.comb(n, k) for k in range(above, n + 1)) / 2 ** n
    print(f"\n   {above}/{n} hospital stations above their neighbours; "
          f"median difference {statistics.median(diffs):+.1f} pts; sign-test p = {p:.3f}")
    with open(f"{processed_dir}/hospital_test.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["place_id", "station", "hospital", "retention_pct",
                    "neighbour_median_pct", "diff_pts", "neighbours"])
        w.writerows(sorted(hosp_rows, key=lambda r: -r[5]))
    with open(f"{processed_dir}/keyworker_summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["metric", "value"])
        lo_ret = statistics.median(r["ret"] for r in lo)
        hi_ret = statistics.median(r["ret"] for r in hi)
        w.writerows([
            ["quintile_low_frontline_share", round(statistics.median(r["frontline_share"] for r in lo), 1)],
            ["quintile_low_wfh_share", round(statistics.median(r["wfh_share"] for r in lo), 1)],
            ["quintile_low_retention", round(lo_ret, 1)],
            ["quintile_high_frontline_share", round(statistics.median(r["frontline_share"] for r in hi), 1)],
            ["quintile_high_wfh_share", round(statistics.median(r["wfh_share"] for r in hi), 1)],
            ["quintile_high_retention", round(hi_ret, 1)],
            ["hospital_above", above], ["hospital_n", n],
            ["hospital_median_diff", round(statistics.median(diffs), 1)],
            ["hospital_sign_p", round(p, 4)],
            ["rho_frontline_zone3plus", round(spearman(
                [r["frontline_share"] for r in rows if r["zone"] >= 3],
                [r["ret"] for r in rows if r["zone"] >= 3]), 2)],
            ["rho_wfh_zone3plus", round(spearman(
                [r["wfh_share"] for r in rows if r["zone"] >= 3],
                [r["ret"] for r in rows if r["zone"] >= 3]), 2)],
        ])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
