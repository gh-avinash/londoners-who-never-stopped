"""Which stations kept moving during the first 2020 lockdown?

For each station: average weekday (entries + exits) during the strict lockdown window,
as a percentage of the same calendar weeks in 2019 ("retention").

Usage: python3 -I lockdown_retention.py <raw_dir> <out_csv>
"""

import csv
import sys
from collections import defaultdict
from datetime import date

# Strict lockdown weeks (stay-at-home order 23 Mar; first easing 13 May, wider easing 1 Jun).
LOCKDOWN = (date(2020, 3, 30), date(2020, 5, 15))
BASELINE = (date(2019, 4, 1), date(2019, 5, 17))  # same calendar weeks, one year earlier
# Cross-check baseline: pre-Covid weekdays in Feb 2020. If the two "normal" levels disagree
# (e.g. service changes or a rebuilt station in one period), retention depends on which we pick,
# so the station is excluded from the ranking rather than guessed.
CHECK_BASELINE = (date(2020, 2, 3), date(2020, 2, 28))
MAX_BASELINE_DISAGREEMENT = 0.25  # flag if the two baselines differ by more than 25%
CLOSED_DAILY = 50  # below this in lockdown, treat the station as closed by TfL (not behaviour)
BANK_HOLIDAYS = {
    date(2019, 4, 19), date(2019, 4, 22), date(2019, 5, 6),
    date(2020, 4, 10), date(2020, 4, 13), date(2020, 5, 8),
}
MIN_BASELINE_DAILY = 1000  # drop tiny stations where percentages are noise


def parse_day(s):
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def weekday_means(path, window):
    totals, days = defaultdict(int), defaultdict(int)
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if not row or not row[0].isdigit():
                continue  # header
            d = parse_day(row[0])
            if not (window[0] <= d <= window[1]) or d.weekday() >= 5 or d in BANK_HOLIDAYS:
                continue
            station = row[2].strip()
            totals[station] += int(row[3] or 0) + int(row[4] or 0)
            days[station] += 1
    return {s: totals[s] / days[s] for s in totals}


def main(raw_dir, out_csv):
    base = weekday_means(f"{raw_dir}/StationFootfall_2019.csv", BASELINE)
    lock = weekday_means(f"{raw_dir}/StationFootfall_2020.csv", LOCKDOWN)
    check = weekday_means(f"{raw_dir}/StationFootfall_2020.csv", CHECK_BASELINE)

    rows, closed, unstable = [], [], []
    for station, b in base.items():
        if b < MIN_BASELINE_DAILY:
            continue
        l = lock.get(station, 0.0)  # missing in 2020 = station closed
        c = check.get(station, 0.0)
        if l < CLOSED_DAILY:
            closed.append(station)
            status = "closed"
        elif c == 0 or abs(b - c) / max(b, c) > MAX_BASELINE_DISAGREEMENT:
            unstable.append((station, round(b), round(c)))
            status = "unstable_baseline"
        else:
            status = "ok"
        rows.append((station, round(b), round(c), round(l),
                     round(100 * l / b, 1), round(100 * l / c, 1) if c else "", status))
    rows.sort(key=lambda r: -r[4])

    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["station", "baseline_spring2019_daily", "baseline_feb2020_daily",
                    "lockdown_2020_daily", "retention_pct", "retention_vs_feb2020_pct",
                    "status"])
        w.writerows(rows)

    print(f"closed by TfL during lockdown: {len(closed)}")
    print(f"unstable baseline (excluded from ranking): {len(unstable)}")
    for u in sorted(unstable, key=lambda u: u[1] / max(u[2], 1))[:20]:
        print(f"    {u[0]:<36} spring2019 {u[1]:>7,}  feb2020 {u[2]:>7,}")
    rows = [r for r in rows if r[6] == "ok"]

    only_2019 = sorted(s for s in base if s not in lock and base[s] >= MIN_BASELINE_DAILY)
    total_b = sum(r[1] for r in rows)
    total_l = sum(r[3] for r in rows)
    pcts = sorted(r[4] for r in rows)
    print(f"\nstations ranked: {len(rows)}  (absent in 2020 window: {len(only_2019)})")
    print(f"retention across ranked stations: {100 * total_l / total_b:.1f}%")
    print(f"median station: {pcts[len(pcts) // 2]}%  | p10: {pcts[len(pcts) // 10]}%  "
          f"| p90: {pcts[9 * len(pcts) // 10]}%")
    print("\nTOP 25 (kept moving)")
    for r in rows[:25]:
        print(f"  {r[4]:5.1f}% (vs Feb20 {r[5]:5.1f}%)  {r[0]:<36} {r[1]:>7,} -> {r[3]:>6,}")
    print("\nBOTTOM 25 (emptied)")
    for r in rows[-25:]:
        print(f"  {r[4]:5.1f}% (vs Feb20 {r[5]:5.1f}%)  {r[0]:<36} {r[1]:>7,} -> {r[3]:>6,}")
    print("\nabsent from 2020 file:", only_2019[:30])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
