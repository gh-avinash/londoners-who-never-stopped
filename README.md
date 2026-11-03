# The Londoners who never stopped

An interactive Data Observatory demo for the 16 × 4 wall (30,720 × 4,320 px), built on
TfL open data and the 2021 Census.

When London locked down in spring 2020, the network fell to 5.8% of normal, but not evenly.
Stations whose neighbours work frontline jobs (carers, drivers, cleaners) kept 2.3× the riders
of work-from-home areas, and 13 of 15 hospital stations stayed busier than the stations around
them. Six years on, travel has settled at 80% of 2019, lowest in the centre and on Fridays.

By Avinash Kotagi (Imperial MBA 2026–27), for the Imperial Data Science Institute's Data for
Humanity Internship. Built on [dsi-icl/do-starter-playground](https://github.com/dsi-icl/do-starter-playground).

## Run it

Needs [Node.js](https://nodejs.org) 22.12 or newer. pnpm comes with Node via Corepack.

```bash
git clone <this repo's URL>
cd <repo folder>
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` prints two addresses: **Network** and **Local**.

**Network address: from any device on the same network** (a tablet as the presenter's remote, a
phone, another computer). Replace `<network-address>` with the "Network" address `pnpm dev`
prints, which is this computer's address on its current network and changes from network to
network:

| Address                                      | What it is                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| http://<network-address>:5780/wall           | **The whole wall on one monitor**, animated. Best place to start.                                |
| http://<network-address>:5780/control        | The presenter's tablet (password-protected): chapters, guided tour, timeline, what-if, spotlight |
| http://<network-address>:5780/screen?c=0&r=0 | One physical screen (column `c` 0–15, row `r` 0–3), as the DO runs it                            |
| http://<network-address>:5780/               | The starter's simulator (a few live screens plus the tablet)                                     |
| http://<network-address>:5780/visit          | Optional phone page: a visitor finds their station and it lights up on the wall                  |

University and office Wi-Fi (e.g. eduroam) often blocks devices from reaching each other; if
the Network address doesn't open on another device, use a phone hotspot or a network where it
does.

**Local address: on the computer running the app only** (works on any network, or none):

| Address                              | What it is                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| http://localhost:5780/wall           | **The whole wall on one monitor**, animated. Best place to start.                                |
| http://localhost:5780/control        | The presenter's tablet (password-protected): chapters, guided tour, timeline, what-if, spotlight |
| http://localhost:5780/screen?c=0&r=0 | One physical screen (column `c` 0–15, row `r` 0–3), as the DO runs it                            |
| http://localhost:5780/               | The starter's simulator (a few live screens plus the tablet)                                     |
| http://localhost:5780/visit          | Optional phone page: a visitor finds their station and it lights up on the wall                  |

Leave it alone for 45 seconds and the wall plays the story by itself, on a loop.

The live panel needs internet access to `api.tfl.gov.uk` (no API key). Everything else runs
from data in the repo.

## Stopping the app

In the terminal where `pnpm dev` is running, press **Ctrl + C**. The wall, tablet and phone
pages stop working until you run `pnpm dev` again.

If that terminal is already closed, or `pnpm dev` says port 5780 is in use, stop whatever is
still running on that port (macOS/Linux):

```bash
lsof -ti tcp:5780 | xargs kill
```

## Presenter password

Only the presenter's tablet (`/control`) needs a password. The wall, its screens and the
`/visit` phone page open without one.

**Option A: use the password printed at start-up (nothing to set up).**

1. Run `pnpm dev`. The terminal prints a password, for example:
    ```
      Presenter password for /control: k7m2xq9p
    ```
2. Open `/control` and enter it. The tablet remembers it until that browser tab is closed.

A new password is generated every time the server starts.

**Option B: set your own password permanently.**

1. Create a file named `.env.local` in `apps/website/` (next to its `package.json`).
2. Put one line in it (at least 4 characters):
    ```
    CONTROL_PASSWORD=your-password
    ```
3. Save, then restart `pnpm dev`. The tablet now always uses this password, and nothing is
   printed at start-up.

`.env.local` is ignored by git, so the password never ends up on GitHub. To go back to a
generated password, delete the file and restart.

Five wrong attempts lock that device out for a minute.

## What's on the wall

| Columns | Content                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| 1–2     | Title, 2019 baseline, the dataset at a glance                                             |
| 3–6     | All of London: 407 stations, sized by taps, coloured by how well each held up vs London   |
| 7–9     | East London close-up: 8 of the 10 stations that kept the highest share of riders are here |
| 10–12   | Lockdown: 5.8%, closures, who kept moving and who emptied, the census and hospital tests  |
| 13      | Six years on: 80%, centre vs outer by weekday, the Elizabeth line                         |
| 14      | What if? Reality vs a prediction from neighbours' jobs alone                              |
| 15      | Live TfL line status and lift outages, every minute                                       |
| 16      | So what: three takeaways                                                                  |
| Row 4   | A timeline of weekly travel, 2019 → 2026, across the whole wall, with a moving playhead   |

## Data and method

Everything is in [`analysis/`](analysis/): raw downloads, the Python pipeline (standard library
only), its output tables, and [`FINDINGS.md`](analysis/FINDINGS.md). FINDINGS.md records every
finding, assumption, judgement call and correction. To rebuild the wall's data from the raw files:

```bash
python3 -I analysis/scripts/run_all.py
```

## Code map

| Path                                               | Role                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/website/src/routes/bus.ts`                   | Websocket hub: owns the shared state, playback clock, idle autoplay, visitor picks, live TfL polling |
| `apps/website/src/routes/screen.tsx`, `wall.tsx`   | One screen; the whole-wall preview                                                                   |
| `apps/website/src/components/wall/`                | Map, text tiles, timeline and backdrop layers                                                        |
| `apps/website/src/lib/story/`                      | Layout, story timeline, data loading, message types                                                  |
| `apps/website/src/routes/control.tsx`, `visit.tsx` | Presenter tablet; visitor phone page                                                                 |

Checks: `pnpm exec vp fmt`, `pnpm exec vp lint`. Stack and DO design notes from the starter are
in [BEST_PRACTICES.md](BEST_PRACTICES.md).
