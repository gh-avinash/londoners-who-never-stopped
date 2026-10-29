import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { useScreenStore } from '../../lib/realtime/stores/screen-store';
import {
    COLORS,
    FONT_FAMILY,
    SECTION_COLUMNS,
    TILE_PADDING,
    TYPE,
    ZOOM_BOUNDS,
    ZOOM_FIRST_COL,
    formatPct
} from '../../lib/story/layout';
import type {
    LiveStatus,
    Station,
    StationsData,
    StoryData,
    StoryState
} from '../../lib/story/types';
import { Kicker, Lines, Tile, useBezelCheck } from './text';

// Text content of every screen in rows 1-3, addressed by column/row. Shapes that span screens
// (panels, bars, the river) live in wall-graphics.tsx. Numbers come from story.json (computed
// by data/scripts/build_app_data.py), never typed in, so the wall matches the analysis.
//
// Fit rules (bezels): primary text (216 px) <= ~15 characters per line, secondary (130 px)
// <= ~25 characters per line; each tile's block fits its 840 px safe height. In development any
// line that reaches a screen edge is outlined in red (see useBezelCheck).

export type TileContext = {
    story: StoryData;
    stations: StationsData;
    week: number;
    state: StoryState;
    live: LiveStatus | null;
    // Whether this tile's section is spotlit right now (drives count-up animations).
    lit: boolean;
};

const COUNT_UP_MS = 1400;

// Text sits in the nine columns the maps leave free (see SECTION_COLUMNS).
const SUBTITLE_COL = 1;
const [LOCKDOWN_FIRST] = SECTION_COLUMNS.lockdown;
const [RECOVERY_COL] = SECTION_COLUMNS.recovery;
const [NORMAL_COL] = SECTION_COLUMNS.normal;
const [WHATIF_COL] = SECTION_COLUMNS.whatif;
const [LIVE_COL] = SECTION_COLUMNS.live;
const [FUTURE_COL] = SECTION_COLUMNS.future;
// Close-up heading and the map legend (top-right of the London map, towards Epping: few
// stations to cover and clear of the lines joining the map to the close-up).
const ZOOM_HEAD_COL = ZOOM_FIRST_COL;
const LEGEND_TILE = { c: ZOOM_FIRST_COL - 1, r: 0 };

// Bar lists: one row per line of secondary text.
const BAR_ROW_H = TYPE.secondary * 1.25;
// Tiles with a big number and three lines of text need a tighter gap to fit the safe area.
const BIG_TILE_GAP = 16;
// Subtitle: four lines that must fit one screen's 840 px safe height.
const SUBTITLE_SIZE = 180;

function thousands(n: number) {
    return n.toLocaleString('en-GB');
}

function roundTo100(n: number) {
    return thousands(Math.round(n / 100) * 100);
}

// Counts up from 0 each time its section is spotlit (ease-out, ~1.4 s - slow, no flashing).
function CountUp({
    value,
    decimals = 0,
    suffix = '',
    active
}: {
    value: number;
    decimals?: number;
    suffix?: string;
    active: boolean;
}) {
    const [shown, setShown] = useState(value);
    useEffect(() => {
        if (!active) {
            setShown(value);
            return;
        }
        let frame = 0;
        const start = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / COUNT_UP_MS);
            setShown(value * (1 - (1 - t) ** 3));
            if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [active, value]);
    return (
        <>
            {shown.toFixed(decimals)}
            {suffix}
        </>
    );
}

function Big({ children, color = COLORS.text }: { children: ReactNode; color?: string }) {
    return <Lines lines={[children]} size="big" color={color} />;
}

// Horizontal bar inside a single screen, label left / value right.
function BarRow({
    label,
    value,
    max,
    accent,
    suffix = '%',
    color
}: {
    label: string;
    value: number;
    max: number;
    accent?: boolean;
    suffix?: string;
    color?: string;
}) {
    const textRef = useRef<HTMLDivElement>(null);
    useBezelCheck(textRef);
    return (
        <div style={{ position: 'relative', height: BAR_ROW_H }}>
            <div
                style={{
                    position: 'absolute',
                    inset: '8% auto 8% 0',
                    width: `${Math.min(100, (value / max) * 100)}%`,
                    background: accent ? COLORS.imperialBlue : '#2A3036'
                }}
            />
            <div
                ref={textRef}
                style={{
                    position: 'relative',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 40,
                    padding: '0 16px',
                    fontSize: TYPE.secondary,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    whiteSpace: 'nowrap'
                }}
            >
                <span>{label}</span>
                <span style={{ color: color ?? (accent ? COLORS.text : COLORS.accent) }}>
                    {value.toFixed(1)}
                    {suffix}
                </span>
            </div>
        </div>
    );
}

export function renderTile(c: number, r: number, ctx: TileContext): ReactNode {
    const { story, lit } = ctx;
    const barMax = story.keptMoving[0]?.pct ?? 1;

    // ---- Title + "1 · Before" (columns 1-2) -------------------------------------------------
    if (c === 0 && r === 0)
        return (
            <Tile justify="flex-end">
                <Lines
                    size="secondary"
                    color={COLORS.subtle}
                    lines={[
                        'Imperial College London',
                        'Data Science Institute',
                        'Data for Humanity',
                        'By Avinash Kotagi',
                        'Imperial MBA 2026–27'
                    ]}
                />
            </Tile>
        );
    if (c === 0 && r === 1)
        return (
            <Tile justify="flex-end">
                <Lines size="title" lines={['The', 'Londoners']} />
            </Tile>
        );
    if (c === 0 && r === 2)
        return (
            <Tile justify="flex-start">
                <Lines size="title" lines={['who never', 'stopped.']} />
            </Tile>
        );
    if (c === SUBTITLE_COL && r === 0)
        return (
            <Tile justify="flex-end">
                <Lines
                    size="primary"
                    // Four lines must fit one screen's safe height: a step below primary size.
                    style={{ fontSize: SUBTITLE_SIZE, letterSpacing: '-0.02em' }}
                    lines={['Who kept', 'London moving', 'in 2020 — and', 'who came back?']}
                />
            </Tile>
        );
    if (c === NORMAL_COL && r === 1)
        return (
            <Tile gap={20}>
                <Kicker>1 · Before · 2019</Kicker>
                <Big color={COLORS.accent}>
                    <CountUp
                        value={story.normalDailyTaps / 1e6}
                        decimals={1}
                        suffix="m"
                        active={lit}
                    />
                </Big>
                <Lines size="secondary" lines={['station taps a weekday']} />
            </Tile>
        );
    if (c === SUBTITLE_COL && r === 2) return <VisitorQr />;

    // ---- Maps: legend and close-up heading ----------------------------------------------------
    if (c === LEGEND_TILE.c && r === LEGEND_TILE.r)
        return (
            // Size = how many taps (entries + exits) a station had that week. Colour = how its
            // traffic changed from its own 2019 normal, compared with London's change: blue kept
            // at least twice London's share, grey at most half, white about the same.
            <Tile justify="flex-start" gap={16}>
                <LegendRow
                    swatch={<Dot size={90} color={COLORS.text} />}
                    text="bigger = more taps"
                />
                <LegendRow
                    swatch={<Dot size={60} color={COLORS.accent} />}
                    text="kept more than London"
                />
                <LegendRow
                    swatch={<Dot size={60} color={COLORS.muted} />}
                    text="lost more than London"
                />
                <Lines size="secondary" color={COLORS.subtle} lines={['vs own 2019 normal']} />
            </Tile>
        );
    if (c === ZOOM_HEAD_COL && r === 0)
        return (
            <Tile justify="flex-start">
                <Kicker>Close-up</Kicker>
                <Lines size="primary" lines={['East London']} />
            </Tile>
        );
    if (c === ZOOM_HEAD_COL + 1 && r === 0) {
        const barking = story.compare.Barking;
        const ls = story.compare['Liverpool Street'];
        const bank = story.compare.Bank;
        if (!barking || !ls || !bank) return null;
        // Only claim "more than both combined" if the data says so.
        const combined = ls.lockdownDaily + bank.lockdownDaily;
        const more = barking.lockdownDaily > combined;
        return (
            <Tile justify="flex-start">
                <Lines
                    size="secondary"
                    lines={[
                        <span key="b" style={{ color: COLORS.accent }}>
                            Barking, lockdown:
                        </span>,
                        // Taps = entries + exits, so a round trip counts twice: not "people".
                        `${roundTo100(barking.lockdownDaily)} entries + exits`,
                        more ? 'a day: more than' : 'a day, vs',
                        'Liverpool St + Bank',
                        more
                            ? `combined (${roundTo100(combined)}).`
                            : `combined: ${roundTo100(combined)}`
                    ]}
                />
            </Tile>
        );
    }

    if (c === ZOOM_HEAD_COL + 2 && r === 0) {
        // Why the close-up is here: how many of the top "kept moving" stations it contains.
        const [[west, south], [east, north]] = ZOOM_BOUNDS;
        const byName = new Map(ctx.stations.stations.map((s) => [s.name, s]));
        const top = story.keptMoving.slice(0, 10);
        const inside = top.filter((k) => {
            const s = byName.get(k.name);
            return s && s.lon >= west && s.lon <= east && s.lat >= south && s.lat <= north;
        }).length;
        if (inside < top.length / 2) return null;
        return (
            <Tile justify="flex-start">
                <Lines
                    size="secondary"
                    lines={[
                        <span key="n" style={{ color: COLORS.accent }}>
                            {`${inside} of the ${top.length} stations`}
                        </span>,
                        'that kept the highest',
                        'share of riders are',
                        'in this close-up.'
                    ]}
                />
            </Tile>
        );
    }

    // ---- 2 · Lockdown (3 columns) ---------------------------------------------------------
    if (c === LOCKDOWN_FIRST && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>2 · Lockdown</Kicker>
                <Lines size="primary" lines={['Spring 2020']} />
                <Lines size="secondary" color={COLORS.subtle} lines={['30 Mar–15 May weekdays']} />
            </Tile>
        );
    if (c === LOCKDOWN_FIRST && r === 1)
        return (
            <Tile gap={BIG_TILE_GAP}>
                <Big color={COLORS.accent}>
                    <CountUp
                        value={story.networkLockdownPct}
                        decimals={1}
                        suffix="%"
                        active={lit}
                    />
                </Big>
                <Lines
                    size="secondary"
                    lines={[
                        'of normal weekday',
                        'travel, network-wide',
                        <span key="r" style={{ color: COLORS.subtle }}>
                            {`about 1 in ${Math.round(100 / story.networkLockdownPct)} trips`}
                        </span>
                    ]}
                />
            </Tile>
        );
    if (c === LOCKDOWN_FIRST && r === 2)
        return (
            <Tile gap={BIG_TILE_GAP}>
                <Big>
                    <CountUp value={story.stationsClosed} active={lit} />
                </Big>
                <Lines
                    size="secondary"
                    lines={[
                        // Detected from the data (under 50 taps a day all spring), not TfL's list:
                        // most were closed by TfL, a few just near-empty (FINDINGS.md F5).
                        'stations closed',
                        'or near-empty',
                        <span key="d" style={{ color: COLORS.subtle }}>
                            (under 50 taps a day)
                        </span>
                    ]}
                />
            </Tile>
        );
    if (c === LOCKDOWN_FIRST + 1 && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>But not evenly</Kicker>
                <Lines size="primary" lines={['Kept moving']} />
                <Lines size="secondary" color={COLORS.subtle} lines={['% of normal, lockdown']} />
            </Tile>
        );
    if (c === LOCKDOWN_FIRST + 1 && r === 1)
        return (
            <Tile gap={0}>
                {story.keptMoving.slice(0, 5).map((s) => (
                    <BarRow
                        key={s.name}
                        label={shortStation(s.name)}
                        value={s.pct}
                        max={barMax}
                        accent
                        suffix=""
                    />
                ))}
            </Tile>
        );
    if (c === LOCKDOWN_FIRST + 1 && r === 2)
        return (
            <Tile gap={0}>
                <Kicker>Emptied</Kicker>
                {story.emptied.slice(0, 4).map((s) => (
                    <BarRow
                        key={s.name}
                        label={shortStation(s.name)}
                        value={s.pct}
                        max={barMax}
                        suffix=""
                    />
                ))}
            </Tile>
        );
    if (c === LOCKDOWN_FIRST + 2 && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>Why?</Kicker>
                <Lines size="primary" lines={['Who couldn’t', 'stay home']} />
            </Tile>
        );
    if (c === LOCKDOWN_FIRST + 2 && r === 1) {
        const { highFrontline: hi, lowFrontline: lo } = story.census;
        const max = Math.max(hi.retention, lo.retention);
        return (
            <Tile gap={10}>
                <Lines size="secondary" lines={['Most frontline areas']} />
                <BarRow label="kept moving" value={hi.retention} max={max} accent />
                <Lines size="secondary" lines={['Most work-from-home']} />
                <BarRow label="kept moving" value={lo.retention} max={max} />
                <Lines
                    size="secondary"
                    color={COLORS.accent}
                    lines={[`${(hi.retention / lo.retention).toFixed(1)}× as many travelled`]}
                />
            </Tile>
        );
    }
    if (c === LOCKDOWN_FIRST + 2 && r === 2)
        return (
            <Tile>
                <Lines
                    size="primary"
                    color={COLORS.accent}
                    lines={[
                        <span key="h">
                            <CountUp value={story.hospitals.above} active={lit} /> of{' '}
                            {story.hospitals.n}
                        </span>
                    ]}
                />
                <Lines
                    size="secondary"
                    lines={[
                        'hospital stations kept',
                        'more riders than the',
                        'stations around them'
                    ]}
                />
            </Tile>
        );

    // ---- 3 · Six years on (1 column) -------------------------------------------------------
    if (c === RECOVERY_COL && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>3 · Six years on</Kicker>
                <Lines size="primary" lines={['Autumn 2026']} />
                <Lines size="secondary" color={COLORS.subtle} lines={['weekdays vs 2019']} />
            </Tile>
        );
    if (c === RECOVERY_COL && r === 1) {
        const byYear = story.recoveryByYear;
        return (
            <Tile gap={BIG_TILE_GAP}>
                <Big color={COLORS.accent}>
                    <CountUp value={byYear['2026'] ?? 0} suffix="%" active={lit} />
                </Big>
                <Lines
                    size="secondary"
                    lines={[
                        'of 2019, flat since 2024',
                        `2021 ${formatPct(byYear['2021'])} → 2023 ${formatPct(byYear['2023'])}`,
                        <span key="x" style={{ color: COLORS.subtle }}>
                            excl. Elizabeth line
                        </span>
                    ]}
                />
            </Tile>
        );
    }
    if (c === RECOVERY_COL && r === 2)
        return (
            <Tile gap={0}>
                <ZoneGrid byZone={story.recoveryByZone} zones={['Zone 1', 'Zones 4+']} />
                <Lines
                    size="secondary"
                    lines={[
                        <span key="e" style={{ color: COLORS.accent }}>
                            {`Elizabeth line ${formatPct(story.elizabethLinePct)}:`}
                        </span>,
                        'new line, new trips'
                    ]}
                />
            </Tile>
        );

    // ---- What if? ----------------------------------------------------------------------------
    if (c === WHATIF_COL && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>What if?</Kicker>
                <Lines size="primary" lines={['Only jobs', 'mattered?']} />
                <Lines
                    size="secondary"
                    color={COLORS.subtle}
                    lines={[ctx.state.whatIf > 0 ? 'Maps: prediction' : 'Maps: real data']}
                />
            </Tile>
        );
    if (c === WHATIF_COL && r === 1)
        return (
            <Tile gap={BIG_TILE_GAP}>
                <Big color={COLORS.accent}>
                    <CountUp value={story.whatIf.r2 * 100} suffix="%" active={lit} />
                </Big>
                <Lines
                    size="secondary"
                    lines={['of the differences', 'explained by one fact:', 'frontline neighbours']}
                />
            </Tile>
        );
    if (c === WHATIF_COL && r === 2) {
        const [a1, a2] = story.whatIf.above;
        const [b1] = story.whatIf.below;
        // Percentage points above/below the prediction.
        const pts = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} pts`;
        // Reasons only where the data shows them: an acute hospital within 800 m, or an airport.
        const hospitals = [a1, a2].every((a) => a?.hospital);
        const airport = b1 && /airport|heathrow/i.test(b1.name);
        return (
            <Tile>
                <Lines
                    size="secondary"
                    lines={[
                        <span key="h" style={{ color: COLORS.accent }}>
                            {hospitals ? 'Busier: near hospitals' : 'Busier than predicted'}
                        </span>,
                        a1 ? `${a1.name} ${pts(a1.pts)}` : '',
                        a2 ? `${a2.name} ${pts(a2.pts)}` : '',
                        <span key="q" style={{ color: COLORS.accent }}>
                            {airport ? 'Quieter: airports' : 'Quieter than predicted'}
                        </span>,
                        b1 ? `${b1.name.replace('Terminal', 'T')} ${pts(b1.pts)}` : ''
                    ]}
                />
            </Tile>
        );
    }

    // ---- Right now (live) --------------------------------------------------------------------
    if (c === LIVE_COL) return <LiveTile r={r} live={ctx.live} />;

    // ---- So what? ------------------------------------------------------------------------------
    if (c === FUTURE_COL && r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>So what?</Kicker>
                <Lines size="primary" lines={['Plan for', 'who can’t stop']} />
            </Tile>
        );
    if (c === FUTURE_COL && r === 1) {
        const ratio = (
            story.census.highFrontline.retention / story.census.lowFrontline.retention
        ).toFixed(1);
        const z1 = story.recoveryByZone['Zone 1'];
        return (
            <Tile>
                <Lines
                    size="secondary"
                    lines={[
                        <span key="1" style={{ color: COLORS.accent }}>
                            1 · In a crisis, protect
                        </span>,
                        'frontline & hospital',
                        `routes (${ratio}× riders)`,
                        <span key="2" style={{ color: COLORS.accent }}>
                            2 · Fridays: centre at
                        </span>,
                        z1 ? `${formatPct(z1.days[4])} of 2019` : 'its lowest'
                    ]}
                />
            </Tile>
        );
    }
    if (c === FUTURE_COL && r === 2)
        return (
            <Tile>
                <Lines
                    size="secondary"
                    lines={[
                        <span key="3" style={{ color: COLORS.accent }}>
                            3 · Look early: open
                        </span>,
                        'data shows who can’t',
                        'stop. Use it first.',
                        <span key="d" style={{ color: COLORS.subtle }}>
                            Data: TfL, ONS Census
                        </span>
                    ]}
                />
            </Tile>
        );

    return null;
}

// Station names long enough to crowd a one-column bar list.
function shortStation(name: string) {
    return name.replace('Heathway', 'Hthwy').replace('Piccadilly Circus', 'Piccadilly Circ.');
}

// ---- live panel -----------------------------------------------------------------------------
function LiveTile({ r, live }: { r: number; live: LiveStatus | null }) {
    if (r === 0)
        return (
            <Tile justify="flex-end">
                <Kicker>Right now · live</Kicker>
                <Lines size="primary" lines={['Still moving', 'today']} />
            </Tile>
        );
    if (!live) {
        return r === 1 ? (
            <Tile>
                <Lines size="secondary" color={COLORS.subtle} lines={['Waiting for TfL…']} />
            </Tile>
        ) : null;
    }
    const good = live.lines.filter((l) => l.good).length;
    if (r === 1)
        return (
            <Tile gap={BIG_TILE_GAP}>
                <Big color={COLORS.accent}>{`${good}/${live.lines.length}`}</Big>
                <Lines
                    size="secondary"
                    lines={[
                        'lines: good service',
                        `${live.liftsOut} lifts out of order`,
                        <span key="u" style={{ color: COLORS.subtle }}>
                            updates every minute
                        </span>
                    ]}
                />
            </Tile>
        );
    if (r === 2) {
        // Two lines per disrupted line (name, then status) keeps each within one screen.
        const disrupted = live.lines.filter((l) => !l.good);
        const issues = disrupted.slice(0, 2);
        const more = disrupted.length - issues.length;
        const time = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/London'
        }).format(new Date(live.at));
        return (
            <Tile>
                <Lines
                    size="secondary"
                    lines={[
                        ...(issues.length
                            ? issues.flatMap((l) => [
                                  <span key={l.name}>{l.name.slice(0, 24)}</span>,
                                  <span key={`${l.name}-s`} style={{ color: COLORS.accent }}>
                                      {l.status.slice(0, 24)}
                                  </span>
                              ])
                            : ['No disruption reported']),
                        <span key="t" style={{ color: COLORS.subtle }}>
                            {more > 0 ? `+${more} more · TfL ${time}` : `TfL, updated ${time}`}
                        </span>
                    ]}
                />
            </Tile>
        );
    }
    return null;
}

// ---- QR code for visitors' phones ---------------------------------------------------------
const QR_SIZE = 560;

function VisitorQr() {
    const [url, setUrl] = useState<string | null>(null);
    const [isLocal, setIsLocal] = useState(false);
    const lanHost = useScreenStore((state) => state.lanHost);
    // Where phones should go, in order: VITE_PUBLIC_URL (a public address, for phones on any
    // network); the server's own network address when the wall was opened via localhost (a
    // phone can't open "localhost" - that means the phone itself); else the wall's own address.
    useEffect(() => {
        const configured: unknown = import.meta.env.VITE_PUBLIC_URL;
        const publicUrl =
            typeof configured === 'string' && /^https?:\/\/[^\s]+$/.test(configured)
                ? configured.replace(/\/+$/, '')
                : null;
        const { protocol, hostname, port, origin } = window.location;
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
        const lanUrl = local && lanHost ? `${protocol}//${lanHost}${port ? `:${port}` : ''}` : null;
        setUrl(`${publicUrl ?? lanUrl ?? origin}/visit`);
        setIsLocal(!publicUrl && local && !lanHost);
    }, [lanHost]);
    const modules = useMemo(
        () => (url ? QRCode.create(url, { errorCorrectionLevel: 'M' }).modules : null),
        [url]
    );
    // No address a phone could open (offline, or the server didn't report one): say so rather
    // than show a dead code.
    if (isLocal)
        return (
            <Tile justify="flex-start">
                <Lines
                    size="secondary"
                    color={COLORS.subtle}
                    lines={['Visitor QR is off:', 'no network address', 'for phones found']}
                />
            </Tile>
        );
    return (
        <Tile justify="flex-start">
            <div style={{ display: 'flex', gap: 60, alignItems: 'center' }}>
                <div
                    // The encoded address, readable in the page for testing.
                    data-visit-url={url ?? undefined}
                    style={{
                        width: QR_SIZE,
                        height: QR_SIZE,
                        background: COLORS.text,
                        padding: 30,
                        flexShrink: 0
                    }}
                >
                    {modules && (
                        <svg
                            viewBox={`0 0 ${modules.size} ${modules.size}`}
                            width="100%"
                            height="100%"
                            shapeRendering="crispEdges"
                        >
                            {Array.from(modules.data).map((on, i) =>
                                on ? (
                                    <rect
                                        key={i}
                                        x={i % modules.size}
                                        y={Math.floor(i / modules.size)}
                                        width={1}
                                        height={1}
                                        fill={COLORS.background}
                                    />
                                ) : null
                            )}
                        </svg>
                    )}
                </div>
                <Lines size="secondary" lines={['Scan: find', 'your station', 'on the wall']} />
            </div>
        </Tile>
    );
}

// ---- small pieces -----------------------------------------------------------------------------
function Dot({ size, color }: { size: number; color: string }) {
    return (
        <div style={{ width: 120, display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: size, height: size, borderRadius: '50%', background: color }} />
        </div>
    );
}

function LegendRow({ swatch, text }: { swatch: ReactNode; text: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
            {swatch}
            <Lines size="secondary" lines={[text]} />
        </div>
    );
}

// Autumn 2026 weekdays as % of 2019 for the given zones (centre = zone 1, outer = zones 4+):
// overall, then Monday to Friday. Friday (the lowest day in every zone) is highlighted.
const GRID_DAYS = ['All', 'Mo', 'Tu', 'We', 'Th', 'Fr'];
const GRID_LABEL_W = 420;
const GRID_CELL_W = 210;
// Short zone names so seven columns fit one screen.
const GRID_ZONE_LABEL: Record<string, string> = {
    'Zone 1': 'Centre',
    'Zones 2–3': '2–3',
    'Zones 4+': 'Outer'
};

function ZoneGrid({ byZone, zones }: { byZone: StoryData['recoveryByZone']; zones: string[] }) {
    const ref = useRef<HTMLDivElement>(null);
    useBezelCheck(ref);
    const row: CSSProperties = {
        display: 'grid',
        gridTemplateColumns: `${GRID_LABEL_W}px repeat(${GRID_DAYS.length}, ${GRID_CELL_W}px)`
    };
    const cell = (color: string): CSSProperties => ({ textAlign: 'right', color });
    return (
        <div
            ref={ref}
            style={{
                fontSize: TYPE.secondary,
                fontWeight: 700,
                lineHeight: 1.25,
                whiteSpace: 'nowrap'
            }}
        >
            <div style={row}>
                <span style={{ color: COLORS.subtle }}>%</span>
                {GRID_DAYS.map((d) => (
                    <span key={d} style={cell(COLORS.subtle)}>
                        {d}
                    </span>
                ))}
            </div>
            {zones
                .map((zone) => [zone, byZone[zone]] as const)
                .map(
                    ([zone, z]) =>
                        z && (
                            <div key={zone} style={row}>
                                <span>{GRID_ZONE_LABEL[zone] ?? zone}</span>
                                {[z.all, ...z.days].map((v, i) => (
                                    <span
                                        key={GRID_DAYS[i]}
                                        style={cell(
                                            i === 0
                                                ? COLORS.text
                                                : i === 5
                                                  ? COLORS.accent
                                                  : COLORS.subtle
                                        )}
                                    >
                                        {Math.round(v)}
                                    </span>
                                ))}
                            </div>
                        )
                )}
        </div>
    );
}

function shortHospital(name: string) {
    return name
        .replace('University College Hospital', 'UCLH')
        .replace(/ (University )?Hospital$/, '');
}

// Card for the station the presenter picked on the tablet.
export function StationCard({
    station,
    week,
    networkPct
}: {
    station: Station;
    week: number;
    networkPct: number;
}) {
    const lines: ReactNode[] = [
        <span key="n" style={{ color: COLORS.accent }}>
            {station.name}
        </span>,
        `Now: ${formatPct(station.w[week])} · London ${formatPct(networkPct)}`
    ];
    if (station.lockdownStatus === 'ok')
        lines.push(`Lockdown: ${formatPct(station.lockdown, 1)} of normal`);
    else if (station.lockdownStatus === 'closed') lines.push('Closed during lockdown');
    if (station.frontline !== null)
        lines.push(`Frontline neighbours: ${formatPct(station.frontline)}`);
    if (station.hospital) lines.push(`Hospital: ${shortHospital(station.hospital)}`);
    return (
        <div
            style={{
                position: 'absolute',
                left: TILE_PADDING / 2,
                top: TILE_PADDING / 2,
                maxWidth: 1920 - TILE_PADDING,
                padding: 50,
                background: 'rgba(22, 26, 29, 0.92)',
                borderLeft: `16px solid ${COLORS.accent}`,
                fontFamily: FONT_FAMILY
            }}
        >
            <Lines size="secondary" lines={lines.slice(0, 5)} />
        </div>
    );
}
