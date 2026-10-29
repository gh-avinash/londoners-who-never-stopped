# Analysis: how every number on the wall was made

The wall never contains a typed-in figure. Every number comes from the scripts in this folder,
run on public TfL and ONS data, and is written to `apps/website/public/data/*.json` by
`build_app_data.py`.

- **[FINDINGS.md](FINDINGS.md)**: the full record. It holds the findings (F1–F11) and every
  assumption and judgement call (A1–A30). It also has the decisions, data sources, open
  questions and a log of corrections.
- **`scripts/`**: the pipeline (Python 3.9+, standard library only).
- **`processed/`**: the pipeline's outputs, so results can be checked without re-running.
- **`raw/`**: every input, as downloaded (sources and dates in FINDINGS.md §2).

## Re-running everything

From the repo root (Python 3.9+, no packages to install; takes a few seconds):

```sh
python3 -I analysis/scripts/run_all.py
```

This rebuilds `analysis/processed/` and the wall's data in `apps/website/public/data/`.

| Folder in `raw/`                                             | Source                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `StationFootfall_2019.csv` … `StationFootfall_2025_2026.csv` | TfL [crowding.data.tfl.gov.uk](https://crowding.data.tfl.gov.uk/), Network Demand (daily entry + exit taps per station) |
| `stationdata/`                                               | TfL `api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip` (unzipped)                                                |
| `census/ts061`, `ts063`, `ts060`                             | ONS Census 2021 via Nomis bulk downloads (unzipped)                                                                     |
| `census/msoa2021_pwc.csv`                                    | ONS Open Geography Portal, MSOA (Dec 2021) population-weighted centroids                                                |
| `hospitals.csv`                                              | 32 London acute hospitals, postcodes geocoded via postcodes.io                                                          |
| `bank-holidays.json`                                         | gov.uk bank holidays                                                                                                    |

| Script                  | What it works out                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `lockdown_retention.py` | Each station's spring-2020 lockdown traffic as a % of the same weeks in 2019; closed stations; unstable baselines     |
| `station_locations.py`  | Matches footfall station names to TfL locations and fare zones                                                        |
| `recovery.py`           | Autumn 2019 → 2026 recovery by year, zone and weekday; Elizabeth line and service-change exclusions                   |
| `keyworkers.py`         | Census test: frontline-job and work-from-home share of residents within 1 km of each station; hospital neighbour test |
| `build_app_data.py`     | The datasets the wall reads, and the what-if prediction (FINDINGS F11)                                                |

`run_all.py` runs the five scripts above in order.
