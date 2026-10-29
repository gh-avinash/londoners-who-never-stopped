import { useMemo, type ReactNode } from 'react';

import {
    COLORS,
    FONT_FAMILY,
    MAP_FIRST_COL,
    ZOOM_BOUNDS,
    ZOOM_COLS,
    ZOOM_FIRST_COL,
    projectToWall,
    RIVER_CURVE_BOTTOM,
    RIVER_CURVE_TOP,
    RIVER_ROW,
    RIVER_TOP,
    RIVER_Y_MAX,
    SECTION_COLUMNS,
    TILE_PADDING,
    TYPE,
    formatPct,
    formatWeek,
    type Section
} from '../../lib/story/layout';
import { effectiveFocus, weekIndexOf, weekToX } from '../../lib/story/timeline';
import type { StoryState } from '../../lib/story/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH, WALL_COLS, WALL_ROWS } from '../../lib/wall';

// The wall is designed as ONE 30,720 x 4,320 px canvas. Every screen renders the same drawing
// through an SVG viewBox cropped to its own 1920 x 1080 window, so shapes flow seamlessly across
// bezels. Only text is kept inside single screens (it is rendered by tiles.tsx / WallLabel).

const WALL_W = WALL_COLS * SCREEN_WIDTH;

// Viewport onto the wall canvas for screen (c, r).
function WallWindow({ c, r, children }: { c: number; r: number; children: ReactNode }) {
    return (
        <svg
            width={SCREEN_WIDTH}
            height={SCREEN_HEIGHT}
            viewBox={`${c * SCREEN_WIDTH} ${r * SCREEN_HEIGHT} ${SCREEN_WIDTH} ${SCREEN_HEIGHT}`}
            style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
        >
            {children}
        </svg>
    );
}

const colX = (c: number) => c * SCREEN_WIDTH;

// ---- backdrop: one continuous layer over the map (never dimmed) ---------------------------
// No per-section boxes: the map runs behind the whole wall, and this layer darkens it smoothly
// wherever text sits, clearing over London. Gradients are in wall coordinates, so every screen
// shows its slice of the same fade.
const WALL_H = WALL_ROWS * SCREEN_HEIGHT;
const SCRIM_ALPHA = 0.8;
// Wall x where the scrim fades out (west of the London map) and back in (east of the close-up).
const CLEAR_FROM = colX(MAP_FIRST_COL) - 300;
const CLEAR_START = colX(MAP_FIRST_COL) + 100;
const CLEAR_END = colX(ZOOM_FIRST_COL + ZOOM_COLS) - 200;
const CLEAR_TO = colX(ZOOM_FIRST_COL + ZOOM_COLS) + 300;

// The close-up's area: a box on the London map, and the same corners on the close-up, joined by
// two lines across the bezel so the eye reads the second map as a magnification.
const [[ZW, ZS], [ZE, ZN]] = ZOOM_BOUNDS;
const INSET_NW = projectToWall(ZW, ZN);
const INSET_SE = projectToWall(ZE, ZS);
const CLOSE_NW = projectToWall(ZW, ZN, true);
const CLOSE_SW = projectToWall(ZW, ZS, true);
const INSET_STROKE = 8;

export function BackdropLayer({
    c,
    r,
    state
}: {
    c: number;
    r: number;
    state: Pick<StoryState, 'focus' | 'week'>;
}) {
    const stop = (x: number) => `${((100 * x) / WALL_W).toFixed(3)}%`;
    const id = `${c}-${r}`;
    const focus = effectiveFocus(state);
    const focusSpan = state.focus === 'all' ? null : SECTION_COLUMNS[focus as Section];
    return (
        <WallWindow c={c} r={r}>
            <defs>
                <linearGradient
                    id={`scrim-${id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={0}
                    x2={WALL_W}
                    y1={0}
                    y2={0}
                >
                    <stop offset="0%" stopColor={COLORS.background} stopOpacity={SCRIM_ALPHA} />
                    <stop
                        offset={stop(CLEAR_FROM)}
                        stopColor={COLORS.background}
                        stopOpacity={SCRIM_ALPHA}
                    />
                    <stop
                        offset={stop(CLEAR_START)}
                        stopColor={COLORS.background}
                        stopOpacity={0}
                    />
                    <stop offset={stop(CLEAR_END)} stopColor={COLORS.background} stopOpacity={0} />
                    <stop
                        offset={stop(CLEAR_TO)}
                        stopColor={COLORS.background}
                        stopOpacity={SCRIM_ALPHA}
                    />
                    <stop offset="100%" stopColor={COLORS.background} stopOpacity={SCRIM_ALPHA} />
                </linearGradient>
                {/* Imperial Blue washes in from the left edge behind the title. */}
                <linearGradient
                    id={`brand-${id}`}
                    gradientUnits="userSpaceOnUse"
                    x1={0}
                    x2={colX(2)}
                    y1={0}
                    y2={0}
                >
                    <stop offset="0%" stopColor={COLORS.imperialBlue} stopOpacity={0.95} />
                    <stop offset="55%" stopColor={COLORS.imperialBlue} stopOpacity={0.85} />
                    <stop offset="100%" stopColor={COLORS.imperialBlue} stopOpacity={0} />
                </linearGradient>
            </defs>
            <rect x={0} y={0} width={WALL_W} height={WALL_H} fill={`url(#scrim-${id})`} />
            <rect x={0} y={0} width={colX(2)} height={WALL_H} fill={`url(#brand-${id})`} />
            <g stroke={COLORS.accent} strokeWidth={INSET_STROKE} fill="none" opacity={0.7}>
                <rect
                    x={INSET_NW[0]}
                    y={INSET_NW[1]}
                    width={INSET_SE[0] - INSET_NW[0]}
                    height={INSET_SE[1] - INSET_NW[1]}
                />
                <line x1={INSET_SE[0]} y1={INSET_NW[1]} x2={CLOSE_NW[0]} y2={CLOSE_NW[1]} />
                <line x1={INSET_SE[0]} y1={INSET_SE[1]} x2={CLOSE_SW[0]} y2={CLOSE_SW[1]} />
            </g>
            {/* One rule along the top of the whole wall; the spotlit section's stretch glows
                (toolkit: "continuous graphic element"). */}
            <rect x={0} y={24} width={WALL_W} height={20} fill={COLORS.muted} opacity={0.5} />
            {focusSpan && (
                <rect
                    x={colX(focusSpan[0])}
                    y={24}
                    width={colX(focusSpan[1] + 1) - colX(focusSpan[0])}
                    height={20}
                    fill={COLORS.accent}
                    style={{ transition: 'x 900ms ease, width 900ms ease' }}
                />
            )}
        </WallWindow>
    );
}

// ---- timeline river (never dimmed) --------------------------------------------------------
const BEAM_HALF_WIDTH = 450;

const curveY = (v: number) =>
    RIVER_CURVE_BOTTOM -
    (Math.min(v, RIVER_Y_MAX) / RIVER_Y_MAX) * (RIVER_CURVE_BOTTOM - RIVER_CURVE_TOP);

// Moments named on the river. Public, well-documented dates (see FINDINGS.md A29).
export const RIVER_EVENTS: Array<{ date: string; label: string }> = [
    { date: '2020-03-23', label: 'Stay at home' },
    { date: '2020-07-06', label: 'Pubs reopen' },
    { date: '2020-11-02', label: '2nd lockdown' },
    { date: '2021-01-04', label: '3rd lockdown' },
    { date: '2022-05-23', label: 'Elizabeth line' },
    { date: '2025-09-08', label: 'Tube strike' }
];

export function RiverLayer({
    c,
    r,
    network,
    week
}: {
    c: number;
    r: number;
    network: number[];
    week: number;
}) {
    const last = network.length - 1;
    // Geometry depends only on the data; memoised so each week only moves the playhead.
    const { area, line, years } = useMemo(() => {
        const pts = network.map((v, i) => `${weekToX(i, last).toFixed(0)},${curveY(v).toFixed(0)}`);
        return {
            area: `M0,${RIVER_CURVE_BOTTOM}L${pts.join('L')}L${WALL_W},${RIVER_CURVE_BOTTOM}Z`,
            line: `M${pts.join('L')}`,
            years: [2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) =>
                weekToX(weekIndexOf(`${y}-01-06`), last)
            )
        };
    }, [network, last]);

    const px = weekToX(week, last);
    const py = curveY(network[week] ?? 0);
    const clipId = `played-${c}-${r}`;

    return (
        <WallWindow c={c} r={r}>
            <defs>
                <clipPath id={clipId}>
                    <rect x={0} y={RIVER_TOP} width={px} height={SCREEN_HEIGHT} />
                </clipPath>
                <linearGradient id={`beam-${c}-${r}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0} />
                    <stop offset="50%" stopColor={COLORS.accent} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`riverbed-${c}-${r}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.background} stopOpacity={0} />
                    <stop offset="35%" stopColor={COLORS.background} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={COLORS.background} stopOpacity={0.85} />
                </linearGradient>
            </defs>
            {/* The river's bed is translucent, so the map (south London) shows through it. */}
            <rect
                x={0}
                y={RIVER_TOP}
                width={WALL_W}
                height={SCREEN_HEIGHT}
                fill={`url(#riverbed-${c}-${r})`}
            />
            {/* A column of light follows the playhead up the whole wall: the one moving element
                every screen shares. */}
            <rect
                x={px - BEAM_HALF_WIDTH}
                y={0}
                width={2 * BEAM_HALF_WIDTH}
                height={RIVER_TOP + SCREEN_HEIGHT}
                fill={`url(#beam-${c}-${r})`}
            />
            <line
                x1={0}
                x2={WALL_W}
                y1={curveY(100)}
                y2={curveY(100)}
                stroke={COLORS.muted}
                strokeWidth={6}
                strokeDasharray="30 24"
            />
            {years.map((x) => (
                <line
                    key={x}
                    x1={x}
                    x2={x}
                    y1={RIVER_CURVE_TOP}
                    y2={RIVER_CURVE_BOTTOM + 40}
                    stroke="#2E353C"
                    strokeWidth={6}
                />
            ))}
            {/* Future: dim. Played: bright - the river fills in as time passes. */}
            <path d={area} fill={COLORS.muted} opacity={0.12} />
            <path d={line} fill="none" stroke={COLORS.muted} strokeWidth={10} opacity={0.6} />
            <g clipPath={`url(#${clipId})`}>
                <path d={area} fill={COLORS.accent} opacity={0.22} />
                <path d={line} fill="none" stroke={COLORS.accent} strokeWidth={14} />
            </g>
            <line
                x1={px}
                x2={px}
                y1={RIVER_TOP + 40}
                y2={RIVER_CURVE_BOTTOM}
                stroke={COLORS.text}
                strokeWidth={8}
            />
            <circle cx={px} cy={py} r={34} fill={COLORS.text} />
        </WallWindow>
    );
}

// ---- text anchored to a point on the wall canvas -----------------------------------------
// Drawn only by the screen that contains the anchor, and clamped inside that screen, so text
// never straddles a bezel (it hops to the next screen when the anchor crosses an edge).
export function WallLabel({
    c,
    r,
    x,
    y,
    width,
    height,
    children,
    align = 'left'
}: {
    c: number;
    r: number;
    x: number;
    y: number;
    width: number;
    height: number;
    children: ReactNode;
    align?: 'left' | 'center';
}) {
    if (Math.floor(x / SCREEN_WIDTH) !== c || Math.floor(y / SCREEN_HEIGHT) !== r) return null;
    const localX = x - c * SCREEN_WIDTH - (align === 'center' ? width / 2 : 0);
    const margin = TILE_PADDING / 2;
    const left = Math.min(Math.max(margin, localX), SCREEN_WIDTH - margin - width);
    const top = Math.min(
        Math.max(margin / 2, y - r * SCREEN_HEIGHT),
        SCREEN_HEIGHT - margin / 2 - height
    );
    return (
        <div
            style={{
                position: 'absolute',
                left,
                top,
                width,
                fontFamily: FONT_FAMILY,
                color: COLORS.text,
                pointerEvents: 'none'
            }}
        >
            {children}
        </div>
    );
}

const LABEL_CHAR_EM = 0.58;
const EVENT_LABEL_PAD = 60 + 34;

// Two heights for event labels. Each label is placed where WallLabel will actually draw it
// (pulled back inside its anchor's screen near an edge) and takes the first height where it
// clears the label before it, so events close together in time never collide. A label that
// fits at neither height is left out rather than overlapping.
function eventLevels(last: number) {
    const ends = [-Infinity, -Infinity];
    const placed: Array<{ event: (typeof RIVER_EVENTS)[number]; ex: number; level: number }> = [];
    for (const event of RIVER_EVENTS) {
        const ex = weekToX(weekIndexOf(event.date), last);
        const width = event.label.length * TYPE.secondary * LABEL_CHAR_EM + EVENT_LABEL_PAD;
        const tile = Math.floor(ex / SCREEN_WIDTH) * SCREEN_WIDTH;
        const margin = TILE_PADDING / 2;
        const left = Math.min(Math.max(tile + margin, ex), tile + SCREEN_WIDTH - margin - width);
        const level = ends.findIndex((end) => end + 40 <= left);
        if (level === -1) continue;
        ends[level] = left + width;
        placed.push({ event, ex, level });
    }
    return placed;
}

// Year ticks, named events and the playhead readout along the river.
export function RiverLabels({
    c,
    r,
    weeks,
    network,
    week
}: {
    c: number;
    r: number;
    weeks: string[];
    network: number[];
    week: number;
}) {
    if (r !== RIVER_ROW) return null;
    const last = weeks.length - 1;
    const px = weekToX(week, last);
    const secondaryW = (text: string) => text.length * TYPE.secondary * LABEL_CHAR_EM;
    return (
        <>
            {[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((year) => (
                <WallLabel
                    key={year}
                    c={c}
                    r={r}
                    x={weekToX(weekIndexOf(`${year}-01-06`), last) + 20}
                    y={RIVER_CURVE_BOTTOM + 10}
                    width={secondaryW('2026')}
                    height={TYPE.secondary}
                >
                    <div
                        style={{
                            fontSize: TYPE.secondary,
                            fontWeight: 700,
                            color: COLORS.subtle,
                            lineHeight: 1
                        }}
                    >
                        {year}
                    </div>
                </WallLabel>
            ))}
            {eventLevels(last).map(({ event, ex, level }) => {
                return (
                    <WallLabel
                        key={event.date}
                        c={c}
                        r={r}
                        x={ex}
                        y={RIVER_TOP + 40 + level * (TYPE.secondary + 20)}
                        width={secondaryW(event.label) + 60}
                        height={TYPE.secondary}
                    >
                        <div
                            style={{
                                fontSize: TYPE.secondary,
                                fontWeight: 700,
                                lineHeight: 1,
                                color: ex <= px ? COLORS.text : COLORS.muted,
                                borderLeft: `10px solid ${ex <= px ? COLORS.accent : COLORS.muted}`,
                                paddingLeft: 24,
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {event.label}
                        </div>
                    </WallLabel>
                );
            })}
            <WallLabel
                c={c}
                r={r}
                x={px + 60}
                y={curveY(network[week] ?? 0) - 330}
                width={1140}
                height={300}
            >
                <div style={{ background: 'rgba(22, 26, 29, 0.85)', padding: '10px 24px' }}>
                    <div
                        style={{
                            fontSize: TYPE.secondary,
                            fontWeight: 700,
                            color: COLORS.subtle,
                            lineHeight: 1.1
                        }}
                    >
                        {formatWeek(weeks[week])}
                    </div>
                    <div
                        style={{
                            fontSize: TYPE.primary,
                            fontWeight: 700,
                            color: COLORS.accent,
                            lineHeight: 1.1
                        }}
                    >
                        {formatPct(network[week])}
                        <span style={{ fontSize: TYPE.secondary, color: COLORS.text }}>
                            {' '}
                            of 2019
                        </span>
                    </div>
                </div>
            </WallLabel>
        </>
    );
}

export { WALL_ROWS };
